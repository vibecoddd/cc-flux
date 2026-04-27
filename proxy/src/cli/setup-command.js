const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_PROFILES = [
  {
    id: 'openai-gpt4o',
    name: 'OpenAI - GPT-4o',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o'
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek - Reasoner (R1)',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-reasoner',
    retryEnabled: true
  },
  {
    id: 'ollama-local',
    name: 'Local - Ollama (Llama 3)',
    provider: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: 'ollama',
    model: 'llama3',
    retryEnabled: true
  }
];

function resolveHomeDir(env = process.env) {
  return env.CC_FLUX_HOME || path.join(os.homedir(), '.cc-flux');
}

function resolveSetupPaths(env = process.env) {
  const homeDir = resolveHomeDir(env);
  return {
    homeDir,
    providersPath: env.CC_FLUX_PROVIDERS_PATH || path.join(homeDir, 'providers.json'),
    statePath: env.CC_FLUX_STATE_PATH || path.join(homeDir, 'state.json')
  };
}

function writeJsonIfMissing(filePath, value) {
  if (fs.existsSync(filePath)) {
    return { path: filePath, created: false };
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
  return { path: filePath, created: true };
}

function initializeConfig(options = {}) {
  const env = options.env || process.env;
  const profiles = options.profiles || DEFAULT_PROFILES;
  const paths = resolveSetupPaths(env);
  const firstProfileId = profiles.length ? profiles[0].id : null;

  return {
    paths,
    providers: writeJsonIfMissing(paths.providersPath, profiles),
    state: writeJsonIfMissing(paths.statePath, { activeProviderId: firstProfileId })
  };
}

function readJsonStatus(filePath) {
  if (!fs.existsSync(filePath)) {
    return { path: filePath, status: 'missing', error: null };
  }

  try {
    JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { path: filePath, status: 'ok', error: null };
  } catch (error) {
    return { path: filePath, status: 'invalid', error: error.message };
  }
}

function buildDoctorReport(options = {}) {
  const env = options.env || process.env;
  const paths = resolveSetupPaths(env);
  const providers = readJsonStatus(paths.providersPath);
  const state = readJsonStatus(paths.statePath);
  const ok = providers.status === 'ok' && state.status === 'ok';

  return {
    ok,
    nodeVersion: process.version,
    adminUrl: env.CC_FLUX_ADMIN_URL || `http://localhost:${env.PORT || 8080}`,
    adminTokenConfigured: Boolean(env.CC_FLUX_ADMIN_TOKEN),
    paths,
    providers,
    state
  };
}

function formatFileStatus(label, status) {
  const suffix = status.error ? ` (${status.error})` : '';
  return `${label}: ${status.status} - ${status.path}${suffix}`;
}

function formatInitResult(result) {
  return [
    'CC-Flux config initialized.',
    `Home: ${result.paths.homeDir}`,
    `Providers: ${result.providers.created ? 'created' : 'exists'} - ${result.providers.path}`,
    `State: ${result.state.created ? 'created' : 'exists'} - ${result.state.path}`
  ].join('\n');
}

function formatDoctorReport(report) {
  return [
    'CC-Flux doctor',
    `Node: ${report.nodeVersion}`,
    `Admin URL: ${report.adminUrl}`,
    `Admin token: ${report.adminTokenConfigured ? 'configured' : 'not configured'}`,
    formatFileStatus('Providers', report.providers),
    formatFileStatus('State', report.state)
  ].join('\n');
}

module.exports = {
  DEFAULT_PROFILES,
  buildDoctorReport,
  formatDoctorReport,
  formatInitResult,
  initializeConfig,
  resolveSetupPaths
};
