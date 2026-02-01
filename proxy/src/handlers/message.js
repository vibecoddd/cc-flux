const axios = require('axios');
const config = require('../config');
const { convertRequest } = require('../adapter/request');
const StreamAdapter = require('../adapter/response');

// Helper: Check if tool calls have valid JSON arguments
function validateToolCalls(choice) {
  if (!choice || !choice.message || !choice.message.tool_calls) return { valid: true };
  
  for (const tc of choice.message.tool_calls) {
    if (tc.function && tc.function.arguments) {
      try {
        JSON.parse(tc.function.arguments);
      } catch (e) {
        return { valid: false, error: `Invalid JSON in tool '${tc.function.name}': ${e.message}` };
      }
    }
  }
  return { valid: true };
}

// Strategy 1: Standard Streaming (Low Latency)
async function handleStreaming(request, reply, targetBody, cfg) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.targetApiKey}`
  };

  const upstreamResponse = await axios({
    method: 'post',
    url: `${cfg.targetBaseUrl}/chat/completions`,
    data: targetBody,
    headers: headers,
    responseType: 'stream'
  });

  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');

  const streamAdapter = new StreamAdapter();

  upstreamResponse.data.on('data', (chunk) => {
    const events = streamAdapter.processChunk(chunk.toString());
    for (const event of events) reply.raw.write(event);
  });

  return new Promise((resolve, reject) => {
    upstreamResponse.data.on('end', () => {
      reply.raw.end();
      resolve();
    });
    upstreamResponse.data.on('error', reject);
  });
}

// Strategy 2: Buffering & Retry (High Reliability for Local Models)
async function handleBufferingRetry(request, reply, targetBody, cfg) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.targetApiKey}`
  };

  let attempts = 0;
  let currentBody = JSON.parse(JSON.stringify(targetBody)); // Clone
  currentBody.stream = false; // Force non-streaming for validation

  while (attempts <= config.get().maxRetries) {
    attempts++;
    request.log.info(`Attempt ${attempts} (Provider: ${cfg.targetProvider})`);

    let response;
    try {
      response = await axios({
        method: 'post',
        url: `${cfg.targetBaseUrl}/chat/completions`,
        data: currentBody,
        headers: headers,
        responseType: 'json' // Wait for full JSON
      });
    } catch (err) {
       // Network error or 500, throw immediately
       throw err;
    }

    const choice = response.data.choices && response.data.choices[0];
    const validation = validateToolCalls(choice);

    if (validation.valid) {
      // Success! Simulate a stream back to the client
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      
      const streamAdapter = new StreamAdapter();
      
      // Simulate chunk 1: Message Start
      // We construct a fake "delta" stream from the full "message"
      // This is a simplified simulation. 
      // Real simulation would need to iterate the message content.
      
      // Hack: We can re-use StreamAdapter if we convert the full message to chunks?
      // Or just manually construct the Anthropic events.
      // Let's use StreamAdapter by feeding it "fake" OpenAI stream chunks.
      
      const fakeChunks = [];
      const msg = choice.message;
      
      // 1. Text Content
      if (msg.content) {
        fakeChunks.push({
          choices: [{ delta: { content: msg.content }, finish_reason: null }]
        });
      }
      
      // 2. Tool Calls
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          // Start Tool
          fakeChunks.push({
             choices: [{ delta: { tool_calls: [{ index: 0, id: tc.id, function: { name: tc.function.name, arguments: "" } }] }, finish_reason: null }]
          });
          // Args
          fakeChunks.push({
             choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: tc.function.arguments } }] }, finish_reason: null }]
          });
        }
      }
      
      // 3. Finish
      fakeChunks.push({
        choices: [{ delta: {}, finish_reason: msg.finish_reason || 'stop' }]
      });

      // Send events
      for (const fc of fakeChunks) {
        const events = streamAdapter.processChunk('data: ' + JSON.stringify(fc));
        for (const e of events) reply.raw.write(e);
      }
      
      reply.raw.end();
      return;
    } else {
      // Validation Failed
      request.log.warn(`Validation failed: ${validation.error}`);
      
      if (attempts > config.get().maxRetries) {
        // Give up, return error to client
         // Or just send the broken response? sending broken response might crash client.
         // Better send a text response explaining the error.
         reply.code(500).send({ error: { message: "Model failed to produce valid JSON after retries." } });
         return;
      }

      // Prepare for Retry
      // Add the invalid response to history
      currentBody.messages.push(choice.message);
      // Add a system/user correction message
      currentBody.messages.push({
        role: 'user',
        content: `Error: ${validation.error}. Please correct the JSON format and try again.`
      });
    }
  }
}

async function messageHandler(request, reply) {
  const incomingBody = request.body;
  const cfg = config.get();
  
  // 1. Convert Request
  let targetBody;
  try {
    targetBody = convertRequest(incomingBody, cfg.targetProvider);
    if (cfg.targetModel) targetBody.model = cfg.targetModel;
  } catch (err) {
    request.log.error(err, 'Request conversion failed');
    return reply.code(400).send({ error: { message: 'Failed to convert request: ' + err.message } });
  }

  try {
    // 2. Choose Strategy
    // Default: 'ollama' implies retry might be needed. Or user explicitly enabled it.
    const shouldRetry = cfg.retryEnabled || (cfg.targetProvider === 'ollama');

    if (shouldRetry) {
      await handleBufferingRetry(request, reply, targetBody, cfg);
    } else {
      await handleStreaming(request, reply, targetBody, cfg);
    }

  } catch (err) {
    request.log.error(err, 'Upstream request failed');
    const status = err.response ? err.response.status : 500;
    const data = err.response ? err.response.data : { error: { message: err.message } };
    
    if (!reply.raw.headersSent) {
      return reply.code(status).send(data);
    }
    reply.raw.end();
  }
}

module.exports = messageHandler;
