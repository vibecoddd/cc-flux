const { v4: uuidv4 } = require('uuid');

const OLLAMA_TOOL_INSTRUCTION = `
IMPORTANT: You are a model that supports function calling. 
When you receive a tool definition, you must decide if you need to call it.
To call a tool, return a JSON object like this:
{ "tool_uses": [{ "name": "tool_name", "parameters": { ... } }] }
Do not wrap it in markdown or other text if possible. 
If you simply want to reply to the user, just write the text.
`;

function mapRole(role) {
  if (role === 'assistant') return 'assistant';
  return 'user';
}

function convertTools(anthropicTools) {
  if (!anthropicTools || anthropicTools.length === 0) return undefined;
  
  return anthropicTools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema
    }
  }));
}

function convertMessages(anthropicMessages, systemPrompt, provider) {
  const openAIMessages = [];

  // Handle System Prompt
  let finalSystemPrompt = systemPrompt || "";
  
  // Inject instructions for local models if needed
  if (provider === 'ollama') {
    finalSystemPrompt += "\n" + OLLAMA_TOOL_INSTRUCTION;
  }

  if (finalSystemPrompt) {
    openAIMessages.push({
      role: 'system',
      content: finalSystemPrompt
    });
  }

  for (const msg of anthropicMessages) {
    const role = mapRole(msg.role);
    
    if (Array.isArray(msg.content)) {
      const toolCalls = [];
      const partsToProcess = msg.content;
      let currentToolResults = [];
      let textContent = "";

      // 1. Scan for Tools and Text
      for (const part of partsToProcess) {
        if (part.type === 'text') {
          textContent += part.text;
        } else if (part.type === 'tool_use') {
          toolCalls.push({
            id: part.id,
            type: 'function',
            function: {
              name: part.name,
              arguments: JSON.stringify(part.input)
            }
          });
        } else if (part.type === 'tool_result') {
           currentToolResults.push({
             role: 'tool',
             tool_call_id: part.tool_use_id,
             content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content)
           });
        }
      }

      // 2. Add User Text
      if (textContent && role === 'user') {
        openAIMessages.push({ role: 'user', content: textContent });
      }

      // 3. Add Tool Results (User side)
      if (currentToolResults.length > 0) {
        openAIMessages.push(...currentToolResults);
      }
      
      // 4. Add Assistant content (Text + Tool Calls)
      if (role === 'assistant') {
        const msgObj = { role: 'assistant' };
        // Only add content if it exists. Some APIs fail if content is empty string when tool_calls are present.
        if (textContent) msgObj.content = textContent; 
        if (toolCalls.length > 0) msgObj.tool_calls = toolCalls;
        
        // Safety: If message is empty (no text, no tools), skip or add dummy?
        // Usually won't happen.
        openAIMessages.push(msgObj);
      }

    } else {
      openAIMessages.push({ role, content: msg.content });
    }
  }

  return openAIMessages;
}

module.exports = {
  convertRequest: (body, provider) => {
    return {
      model: body.model, 
      messages: convertMessages(body.messages, body.system, provider),
      tools: convertTools(body.tools),
      stream: body.stream,
      temperature: body.temperature,
      max_tokens: body.max_tokens
    };
  }
};