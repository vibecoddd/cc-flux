const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeCompressionConfig } = require('../adapter/compression');

function homePath(...parts) {
  return path.join(os.homedir(), ...parts);
}

function configHomePath(...parts) {
  const base = process.env.CC_FLUX_HOME || homePath('.cc-flux');
  return path.join(base, ...parts);
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function resolveProvidersPath(cwd = process.cwd()) {
  if (process.env.CC_FLUX_PROVIDERS_PATH) {
    return process.env.CC_FLUX_PROVIDERS_PATH;
  }

  return firstExisting([
    path.resolve(cwd, 'tui', 'providers.json'),
    path.resolve(cwd, '..', 'tui', 'providers.json'),
    path.resolve(cwd, 'providers.json'),
    configHomePath('providers.json')
  ]);
}

function resolveStatePath() {
  return process.env.CC_FLUX_STATE_PATH || configHomePath('state.json');
}

function readJson(filePath, fallback) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { value: fallback, error: null };
  }

  try {
    return { value: JSON.parse(fs.readFileSync(filePath, 'utf8')), error: null };
  } catch (error) {
    return { value: fallback, error };
  }
}

function loadProfiles() {
  const providersPath = resolveProvidersPath();
  const result = readJson(providersPath, []);
  const profiles = Array.isArray(result.value) ? result.value : [];
  return { profiles, providersPath, error: result.error };
}

function loadState(statePath = resolveStatePath()) {
  const result = readJson(statePath, {});
  const value = result.value && typeof result.value === 'object' ? result.value : {};
  return { state: value, statePath, error: result.error };
}

function saveState(activeProviderId, statePath = resolveStatePath()) {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ activeProviderId }, null, 2) + '\n');
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
}

function normalizeCapabilityOverrides(capabilities) {
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    return {};
  }

  const overrides = {};
  for (const key of ['streaming', 'tools', 'reasoning', 'local', 'retry', 'compression']) {
    if (typeof capabilities[key] === 'boolean') {
      overrides[key] = capabilities[key];
    }
  }
  return overrides;
}

function isLocalBaseUrl(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch (error) {
    return false;
  }
}

function inferCapabilities(profile, options = {}) {
  const provider = String(profile.provider || '').toLowerCase();
  const baseUrl = String(profile.baseUrl || '');
  const model = String(profile.model || '').toLowerCase();
  const compression = options.compression || normalizeCompressionConfig(profile.compression || {});
  const retryEnabled = options.retryEnabled !== undefined
    ? Boolean(options.retryEnabled)
    : Boolean(profile.retryEnabled);

  return {
    streaming: true,
    tools: true,
    reasoning: provider === 'deepseek' || model.includes('reasoner') || model.includes('r1'),
    local: provider === 'ollama' || isLocalBaseUrl(baseUrl),
    retry: retryEnabled || provider === 'ollama',
    compression: Boolean(compression.enabled),
    ...normalizeCapabilityOverrides(profile.capabilities)
  };
}

function inferRuntimeCapabilities(config) {
  return inferCapabilities({
    provider: config.targetProvider,
    baseUrl: config.targetBaseUrl,
    model: config.targetModel,
    retryEnabled: config.retryEnabled,
    compression: config.compression,
    capabilities: config.capabilityOverrides
  }, {
    retryEnabled: config.retryEnabled,
    compression: config.compression
  });
}

function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return { valid: false, message: 'Profile must be an object.' };
  }
  if (!profile.id || typeof profile.id !== 'string') {
    return { valid: false, message: 'Profile id is required.' };
  }
  if (!profile.provider || typeof profile.provider !== 'string') {
    return { valid: false, message: `Profile '${profile.id}' is missing provider.` };
  }
  if (!profile.baseUrl || typeof profile.baseUrl !== 'string') {
    return { valid: false, message: `Profile '${profile.id}' is missing baseUrl.` };
  }
  if (!profile.model || typeof profile.model !== 'string') {
    return { valid: false, message: `Profile '${profile.id}' is missing model.` };
  }
  return { valid: true, message: '' };
}

function profileToRuntime(profile, baseState) {
  const profileCompression = profile.compression
    ? normalizeCompressionConfig({ ...baseState.compression, ...profile.compression })
    : baseState.compression;
  const retryEnabled = profile.retryEnabled !== undefined ? Boolean(profile.retryEnabled) : baseState.retryEnabled;

  return {
    ...baseState,
    targetProvider: profile.provider,
    targetBaseUrl: profile.baseUrl,
    targetApiKey: profile.apiKey || '',
    targetModel: profile.model,
    retryEnabled,
    activeProviderId: profile.id,
    compression: profileCompression,
    capabilityOverrides: normalizeCapabilityOverrides(profile.capabilities)
  };
}

function redactRuntimeConfig(config) {
  return {
    host: config.host,
    provider: config.targetProvider,
    baseUrl: config.targetBaseUrl,
    model: config.targetModel,
    retryEnabled: config.retryEnabled,
    socketPath: config.socketPath,
    activeProviderId: config.activeProviderId || null,
    compression: { ...config.compression },
    capabilities: inferRuntimeCapabilities(config),
    apiKeyConfigured: Boolean(config.targetApiKey)
  };
}

function redactProfile(profile) {
  return {
    id: profile.id,
    name: profile.name || profile.id,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    retryEnabled: Boolean(profile.retryEnabled),
    compression: profile.compression ? normalizeCompressionConfig(profile.compression) : null,
    capabilities: inferCapabilities(profile),
    apiKeyConfigured: Boolean(profile.apiKey)
  };
}

function createConfigError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

module.exports = {
  createConfigError,
  inferCapabilities,
  inferRuntimeCapabilities,
  loadProfiles,
  loadState,
  profileToRuntime,
  redactProfile,
  redactRuntimeConfig,
  resolveProvidersPath,
  resolveStatePath,
  saveState,
  validateProfile
};
