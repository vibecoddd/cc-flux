const DEFAULT_COMPRESSION = Object.freeze({
  enabled: false,
  maxMessages: 40,
  keepRecent: 16
});

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
}

function normalizeInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function normalizeCompressionConfig(input = {}) {
  return {
    enabled: normalizeBoolean(input.enabled, DEFAULT_COMPRESSION.enabled),
    maxMessages: normalizeInteger(input.maxMessages, DEFAULT_COMPRESSION.maxMessages),
    keepRecent: normalizeInteger(input.keepRecent, DEFAULT_COMPRESSION.keepRecent)
  };
}

function validateCompressionConfig(input = {}) {
  const config = normalizeCompressionConfig(input);

  if (config.maxMessages < 2) {
    return { valid: false, message: 'maxMessages must be at least 2.', config };
  }
  if (config.keepRecent < 1) {
    return { valid: false, message: 'keepRecent must be at least 1.', config };
  }
  if (config.keepRecent > config.maxMessages) {
    return { valid: false, message: 'keepRecent must be less than or equal to maxMessages.', config };
  }

  return { valid: true, message: '', config };
}

function cloneWithoutReasoning(value) {
  if (Array.isArray(value)) {
    return value.map(cloneWithoutReasoning);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const clone = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'reasoning_content') continue;
    clone[key] = cloneWithoutReasoning(child);
  }
  return clone;
}

function leadingSystemCount(messages) {
  let count = 0;
  while (count < messages.length && messages[count].role === 'system') {
    count++;
  }
  return count;
}

function assistantHasToolCall(message, toolCallId) {
  return Boolean(
    message &&
    message.role === 'assistant' &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.some((toolCall) => toolCall.id === toolCallId)
  );
}

function findAssistantForTool(messages, fromIndex, minIndex) {
  const toolCallId = messages[fromIndex] && messages[fromIndex].tool_call_id;
  if (!toolCallId) return fromIndex;

  for (let index = fromIndex - 1; index >= minIndex; index--) {
    if (assistantHasToolCall(messages[index], toolCallId)) {
      return index;
    }
  }

  return fromIndex;
}

function expandRecentStart(messages, start, minIndex) {
  let expanded = start;
  let changed = true;

  while (changed) {
    changed = false;

    for (let index = expanded; index < messages.length; index++) {
      if (messages[index].role !== 'tool') continue;
      const assistantIndex = findAssistantForTool(messages, index, minIndex);
      if (assistantIndex < expanded) {
        expanded = assistantIndex;
        changed = true;
        break;
      }
    }
  }

  return expanded;
}

function contentToSummaryText(content) {
  if (content === undefined || content === null) return '';
  if (typeof content === 'string') return content;
  return JSON.stringify(content);
}

function summarizeMessage(message) {
  if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    const calls = message.tool_calls
      .map((toolCall) => `${toolCall.function && toolCall.function.name ? toolCall.function.name : 'tool'}(${toolCall.id})`)
      .join(', ');
    const text = contentToSummaryText(message.content);
    return text ? `- assistant: ${text} [tool calls: ${calls}]` : `- assistant tool calls: ${calls}`;
  }

  if (message.role === 'tool') {
    return `- tool result for ${message.tool_call_id || 'unknown'}: ${contentToSummaryText(message.content)}`;
  }

  return `- ${message.role}: ${contentToSummaryText(message.content)}`;
}

function buildSummaryMessage(messages) {
  return {
    role: 'user',
    content: [
      '[CC-Flux compressed conversation history]',
      ...messages.map(summarizeMessage).filter(Boolean)
    ].join('\n')
  };
}

function compressMessages(messages, settings = {}) {
  const validation = validateCompressionConfig(settings);
  const config = validation.config;
  const sanitized = messages.map(cloneWithoutReasoning);
  const baseMeta = {
    applied: false,
    originalCount: messages.length,
    finalCount: sanitized.length,
    summaryCount: 0,
    reason: ''
  };

  if (!validation.valid) {
    return { messages: sanitized, meta: { ...baseMeta, reason: 'invalid_config' } };
  }

  if (!config.enabled) {
    return { messages: sanitized, meta: { ...baseMeta, reason: 'disabled' } };
  }

  if (sanitized.length <= config.maxMessages) {
    return { messages: sanitized, meta: { ...baseMeta, reason: 'below_threshold' } };
  }

  const systemCount = leadingSystemCount(sanitized);
  const nonSystemCount = sanitized.length - systemCount;
  let recentStart = systemCount + Math.max(0, nonSystemCount - config.keepRecent);
  recentStart = expandRecentStart(sanitized, recentStart, systemCount);

  const older = sanitized.slice(systemCount, recentStart);
  if (older.length === 0) {
    return { messages: sanitized, meta: { ...baseMeta, reason: 'preserved_window_too_large' } };
  }

  const compressed = [
    ...sanitized.slice(0, systemCount),
    buildSummaryMessage(older),
    ...sanitized.slice(recentStart)
  ];

  return {
    messages: compressed,
    meta: {
      applied: true,
      originalCount: messages.length,
      finalCount: compressed.length,
      summaryCount: older.length,
      reason: 'compressed'
    }
  };
}

module.exports = {
  DEFAULT_COMPRESSION,
  compressMessages,
  normalizeCompressionConfig,
  validateCompressionConfig
};
