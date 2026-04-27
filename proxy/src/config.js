require('dotenv').config();

const store = require('./config/profile-store');
const {
  normalizeCompressionConfig,
  validateCompressionConfig
} = require('./adapter/compression');

function envBool(value) {
  return value === 'true';
}

function baseStateFromEnv() {
  return {
    port: Number(process.env.PORT || 8080),
    targetProvider: process.env.TARGET_PROVIDER || 'openai',
    targetBaseUrl: process.env.TARGET_BASE_URL || 'https://api.openai.com/v1',
    targetApiKey: process.env.TARGET_API_KEY || '',
    targetModel: process.env.TARGET_MODEL || '',
    retryEnabled: envBool(process.env.RETRY_ENABLED),
    maxRetries: 2,
    socketPath: process.env.SOCKET_PATH || '',
    activeProviderId: null,
    compression: normalizeCompressionConfig({
      enabled: process.env.CC_FLUX_COMPRESSION_ENABLED,
      maxMessages: process.env.CC_FLUX_COMPRESSION_MAX_MESSAGES,
      keepRecent: process.env.CC_FLUX_COMPRESSION_KEEP_RECENT
    })
  };
}

let profiles = [];
let providersPath = '';
let providersError = null;
let statePath = '';
let stateError = null;
let runtimeState = baseStateFromEnv();

function findProfile(id) {
  return profiles.find((profile) => profile.id === id);
}

function applyInitialState() {
  runtimeState = baseStateFromEnv();

  const loadedProfiles = store.loadProfiles();
  profiles = loadedProfiles.profiles;
  providersPath = loadedProfiles.providersPath;
  providersError = loadedProfiles.error;

  const loadedState = store.loadState();
  statePath = loadedState.statePath;
  stateError = loadedState.error;

  const activeProviderId = loadedState.state.activeProviderId;
  const activeProfile = activeProviderId ? findProfile(activeProviderId) : null;
  if (!activeProfile) return;

  const validation = store.validateProfile(activeProfile);
  if (validation.valid) {
    runtimeState = store.profileToRuntime(activeProfile, runtimeState);
  }
}

function get() {
  return { ...runtimeState };
}

function getPublic() {
  return store.redactRuntimeConfig(runtimeState);
}

function getCompression() {
  return { ...runtimeState.compression };
}

function getMeta() {
  return {
    providersPath,
    statePath,
    providersError: providersError ? providersError.message : null,
    stateError: stateError ? stateError.message : null
  };
}

function listProfiles() {
  return profiles.map(store.redactProfile);
}

function switchProfile(id) {
  const profile = findProfile(id);
  if (!profile) {
    throw store.createConfigError(404, 'profile_not_found', `Profile '${id}' was not found.`);
  }

  const validation = store.validateProfile(profile);
  if (!validation.valid) {
    throw store.createConfigError(400, 'invalid_profile', validation.message);
  }

  runtimeState = store.profileToRuntime(profile, runtimeState);
  const persisted = store.saveState(id, statePath || store.resolveStatePath());
  return {
    config: getPublic(),
    statePersisted: persisted.ok,
    warning: persisted.error ? persisted.error.message : null
  };
}

function updateCompression(updates) {
  const validation = validateCompressionConfig({
    ...runtimeState.compression,
    ...updates
  });
  if (!validation.valid) {
    throw store.createConfigError(400, 'invalid_compression_config', validation.message);
  }

  runtimeState.compression = validation.config;
  return getCompression();
}

function update(updates) {
  if (updates.targetProvider) runtimeState.targetProvider = updates.targetProvider;
  if (updates.targetBaseUrl) runtimeState.targetBaseUrl = updates.targetBaseUrl;
  if (updates.targetApiKey) runtimeState.targetApiKey = updates.targetApiKey;
  if (updates.targetModel) runtimeState.targetModel = updates.targetModel;
  if (updates.retryEnabled !== undefined) runtimeState.retryEnabled = Boolean(updates.retryEnabled);
  if (updates.socketPath !== undefined) runtimeState.socketPath = updates.socketPath;
  if (updates.compression !== undefined) updateCompression(updates.compression);
  runtimeState.activeProviderId = null;
  console.log('[Config] Updated:', getPublic());
  return get();
}

applyInitialState();

module.exports = {
  get,
  getCompression,
  getMeta,
  getPublic,
  listProfiles,
  switchProfile,
  update,
  updateCompression,
  _reloadForTests: applyInitialState
};
