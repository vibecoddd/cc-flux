const { v4: uuidv4 } = require('uuid');

class StreamAdapter {
  constructor() {
    this.messageId = 'msg_' + uuidv4();
    this.currentBlockIndex = 0;
    this.currentBlockType = null; // 'text' | 'tool_use'
    this.hasSentMessageStart = false;
    this.toolCallId = null;
    this.toolName = '';
  }

  processChunk(chunkStr) {
    const lines = chunkStr.split('\n').filter(line => line.trim() !== '');
    const events = [];

    for (const line of lines) {
      if (line === 'data: [DONE]') {
        events.push(this.createEvent('message_stop', { type: 'message_stop' }));
        return events;
      }
      if (!line.startsWith('data: ')) continue;

      let data;
      try {
        data = JSON.parse(line.slice(6));
      } catch (e) {
        continue;
      }

      const choice = data.choices && data.choices[0];
      if (!choice) continue;

      const { delta, finish_reason } = choice;

      // 1. Initialize Message
      if (!this.hasSentMessageStart) {
        events.push(this.createEvent('message_start', {
          type: 'message_start',
          message: {
            id: this.messageId,
            type: 'message',
            role: 'assistant',
            content: [],
            model: data.model || 'proxy-model',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 } 
          }
        }));
        this.hasSentMessageStart = true;
      }

      // 1.5 Handle DeepSeek Reasoning (Thinking)
      if (delta.reasoning_content) {
        if (this.currentBlockType !== 'text') {
           if (this.currentBlockType) {
             events.push(this.createEvent('content_block_stop', {
                type: 'content_block_stop',
                index: this.currentBlockIndex
             }));
             this.currentBlockIndex++;
           }
           
           this.currentBlockType = 'text';
           events.push(this.createEvent('content_block_start', {
             type: 'content_block_start',
             index: this.currentBlockIndex,
             content_block: { type: 'text', text: '' }
           }));
        }

        // Wrap reasoning in a visual indicator, e.g., blockquote or tags
        // Note: Since this is a delta, we can't easily wrap the whole block in tags once.
        // But we can prepend a tag on the FIRST reasoning delta? 
        // For simplicity in streaming, we just pass it through. 
        // Or we can prefix it with "> " to make it a quote.
        // Let's explicitly format it as <thinking> block content.
        
        events.push(this.createEvent('content_block_delta', {
          type: 'content_block_delta',
          index: this.currentBlockIndex,
          delta: { type: 'text_delta', text: delta.reasoning_content }
        }));
      }

      // 2. Handle Text Content
      if (delta.content) {
        if (this.currentBlockType !== 'text') {
          // If we were in a tool block, close it? OpenAI doesn't explicitly close until finish or switch?
          // For now, assume if we switch types, we start a new block.
          // In practice, OpenAI usually sends all text then all tools.
          if (this.currentBlockType) {
            events.push(this.createEvent('content_block_stop', {
               type: 'content_block_stop',
               index: this.currentBlockIndex
            }));
            this.currentBlockIndex++;
          }
          
          this.currentBlockType = 'text';
          events.push(this.createEvent('content_block_start', {
            type: 'content_block_start',
            index: this.currentBlockIndex,
            content_block: { type: 'text', text: '' }
          }));
        }

        events.push(this.createEvent('content_block_delta', {
          type: 'content_block_delta',
          index: this.currentBlockIndex,
          delta: { type: 'text_delta', text: delta.content }
        }));
      }

      // 3. Handle Tool Calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          // OpenAI sends: index, id (only on first chunk), function.name (first), function.arguments (stream)
          
          if (tc.id) {
             // New tool call starting
             if (this.currentBlockType) {
               events.push(this.createEvent('content_block_stop', {
                 type: 'content_block_stop',
                 index: this.currentBlockIndex
               }));
               this.currentBlockIndex++;
             }
             
             this.currentBlockType = 'tool_use';
             this.toolCallId = tc.id;
             this.toolName = tc.function.name || 'unknown_tool'; // Sometimes name is split? usually first chunk.
             
             events.push(this.createEvent('content_block_start', {
               type: 'content_block_start',
               index: this.currentBlockIndex,
               content_block: {
                 type: 'tool_use',
                 id: this.toolCallId,
                 name: this.toolName,
                 input: {} // Anthropic expects empty object here? No, 'input' is not sent in start for streaming?
                 // Actually Anthropic sends: content_block: { type: 'tool_use', id: '...', name: '...' }
               }
             }));
          }

          if (tc.function && tc.function.arguments) {
            // Streaming arguments
            events.push(this.createEvent('content_block_delta', {
              type: 'content_block_delta',
              index: this.currentBlockIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: tc.function.arguments
              }
            }));
          }
        }
      }

      // 4. Handle Finish
      if (finish_reason) {
        if (this.currentBlockType) {
           events.push(this.createEvent('content_block_stop', {
             type: 'content_block_stop',
             index: this.currentBlockIndex
           }));
        }
        
        const stopReason = finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn';
        events.push(this.createEvent('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: stopReason, stop_sequence: null },
          usage: { output_tokens: 0 }
        }));
        
        events.push(this.createEvent('message_stop', { type: 'message_stop' }));
      }
    }

    return events;
  }

  createEvent(event, data) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }
}

module.exports = StreamAdapter;
