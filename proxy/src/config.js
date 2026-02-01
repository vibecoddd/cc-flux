require('dotenv').config();

// Initial state from environment variables
const state = {
  port: process.env.PORT || 8080,
  targetProvider: process.env.TARGET_PROVIDER || 'openai',
  targetBaseUrl: process.env.TARGET_BASE_URL || 'https://api.openai.com/v1',
  targetApiKey: process.env.TARGET_API_KEY || '',
  targetModel: process.env.TARGET_MODEL || '', 
  retryEnabled: process.env.RETRY_ENABLED === 'true',
  maxRetries: 2,
  socketPath: process.env.SOCKET_PATH || '' // Optional: \\.\pipe\cc-flux or /tmp/cc-flux.sock
};

module.exports = {
  // Accessor for current state
  get: () => state,
  
  // Updater
  update: (updates) => {
    if (updates.targetProvider) state.targetProvider = updates.targetProvider;
    if (updates.targetBaseUrl) state.targetBaseUrl = updates.targetBaseUrl;
    if (updates.targetApiKey) state.targetApiKey = updates.targetApiKey;
    if (updates.targetModel) state.targetModel = updates.targetModel;
    if (updates.retryEnabled !== undefined) state.retryEnabled = updates.retryEnabled;
    if (updates.socketPath !== undefined) state.socketPath = updates.socketPath;
    console.log('[Config] Updated:', state);
  }
};