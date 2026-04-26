#!/usr/bin/env node

/**
 * CC-Flux CLI
 * Multimodal Coding Agent Proxy
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CONFIG_FILE = '.cc-flux.env';
const DEFAULT_PORT = 8080;

// Get package root (handle both local and global installs)
const packageRoot = fs.existsSync(path.join(__dirname, 'package.json')) 
  ? __dirname 
  : path.join(__dirname, '..');

function printHelp() {
  console.log(`
🔄 CC-Flux - Multimodal Coding Agent Proxy

Usage: cc-flux <command> [options]

Commands:
  start [opts]    Start the proxy server
  tui             Start the TUI controller
  profiles        List configured provider profiles
  current         Show active proxy configuration
  switch <id>     Hot-switch the running proxy to a profile
  config          Show current configuration
  help            Show this help message

Options:
  -p, --port <n>    Set proxy port (default: ${DEFAULT_PORT})
  -m, --model <n>   Set default model
  -k, --key <key>   Set API key
  -u, --url <url>   Set API base URL
  -h, --help        Show help

Examples:
  cc-flux start -p 8080
  cc-flux start -m deepseek-reasoner -k sk-xxx -u https://api.deepseek.com
  cc-flux tui
  cc-flux config

Environment Variables:
  PORT, TARGET_PROVIDER, TARGET_BASE_URL, TARGET_API_KEY, TARGET_MODEL
  CC_FLUX_ADMIN_URL, CC_FLUX_PROVIDERS_PATH, CC_FLUX_STATE_PATH

Quick Install:
  npm install -g cc-flux
  cc-flux start -k YOUR_API_KEY

For more info: https://github.com/cc-flux/cc-flux
`);
}

function loadConfig() {
  const config = {};
  
  // Priority: CLI args > env file > defaults
  const envPaths = [
    path.join(process.cwd(), '.env'),
    path.join(packageRoot, '.env'),
    path.join(process.env.HOME || '', '.cc-flux.env')
  ];
  
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match && !match[1].startsWith('#')) {
          config[match[1].trim()] = match[2].trim();
        }
      });
    }
  }
  
  return config;
}

function parseArgs(args) {
  const config = {};
  const unknown = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['-p', '--port', '-m', '--model', '-k', '--key', '-u', '--url'].includes(arg)) {
      config[arg] = args[++i];
    } else if (arg === '-h' || arg === '--help') {
      config.help = true;
    } else if (!arg.startsWith('-')) {
      unknown.push(arg);
    }
  }
  
  return { config, unknown };
}

function getAdminBaseUrl() {
  const fileConfig = loadConfig();
  const port = process.env.CC_FLUX_PORT || fileConfig.PORT || process.env.PORT || DEFAULT_PORT;
  return process.env.CC_FLUX_ADMIN_URL || `http://localhost:${port}`;
}

async function adminRequest(pathname, options = {}) {
  const url = getAdminBaseUrl() + pathname;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = body.error && body.error.message ? body.error.message : response.statusText;
    const error = new Error(message);
    error.statusCode = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function printProfileTable(profiles) {
  if (!profiles.length) {
    console.log('No provider profiles found.');
    return;
  }

  for (const profile of profiles) {
    const keyStatus = profile.apiKeyConfigured ? 'key configured' : 'no key';
    console.log(`${profile.id}\t${profile.name}\t${profile.provider}\t${profile.model}\t${keyStatus}`);
  }
}

async function listProfiles() {
  const body = await adminRequest('/admin/profiles');
  printProfileTable(body.profiles || []);
}

async function showCurrent() {
  const body = await adminRequest('/admin/current');
  const cfg = body.config;
  console.log(`Provider: ${cfg.provider}`);
  console.log(`Model: ${cfg.model || '(not set)'}`);
  console.log(`Base URL: ${cfg.baseUrl}`);
  console.log(`Retry enabled: ${cfg.retryEnabled}`);
  console.log(`Active profile: ${cfg.activeProviderId || '(runtime config)'}`);
  console.log(`API key: ${cfg.apiKeyConfigured ? 'configured' : 'not set'}`);
}

async function switchProfile(id) {
  if (!id) {
    console.error('Usage: cc-flux switch <profile-id>');
    process.exit(1);
  }

  const body = await adminRequest('/admin/switch', {
    method: 'POST',
    body: { id }
  });

  const cfg = body.config;
  console.log(`Switched to ${cfg.activeProviderId || id}: ${cfg.provider}/${cfg.model}`);
  if (!body.statePersisted) {
    console.log(`Warning: active profile was not persisted: ${body.warning}`);
  }
}

function runAsync(fn) {
  fn().catch((error) => {
    const prefix = error.statusCode ? `HTTP ${error.statusCode}` : 'Error';
    console.error(`${prefix}: ${error.message}`);
    process.exit(1);
  });
}

async function startProxy(args) {
  const { config: cliConfig } = parseArgs(args);
  const fileConfig = loadConfig();
  
  // Merge configs (CLI > file > env)
  const finalConfig = { ...fileConfig, ...cliConfig };
  
  // Set environment
  if (finalConfig.port || finalConfig['-p']) {
    process.env.PORT = finalConfig.port || finalConfig['-p'];
  }
  if (finalConfig.model || finalConfig['-m']) {
    process.env.TARGET_MODEL = finalConfig.model || finalConfig['-m'];
  }
  if (finalConfig.key || finalConfig['-k']) {
    process.env.TARGET_API_KEY = finalConfig.key || finalConfig['-k'];
  }
  if (finalConfig.url || finalConfig['-u']) {
    process.env.TARGET_BASE_URL = finalConfig.url || finalConfig['-u'];
  }
  
  const port = process.env.PORT || DEFAULT_PORT;
  
  console.log(`🚀 Starting CC-Flux Proxy on port ${port}...`);
  console.log(`   Model: ${process.env.TARGET_MODEL || 'default'}`);
  console.log(`   Provider: ${process.env.TARGET_PROVIDER || 'openai'}`);
  
  const serverPath = path.join(packageRoot, 'src', 'server.js');
  
  if (!fs.existsSync(serverPath)) {
    console.error('❌ Server not found. Is CC-Flux properly installed?');
    process.exit(1);
  }
  
  const child = spawn('node', [serverPath], {
    cwd: packageRoot,
    env: process.env,
    stdio: 'inherit'
  });
  
  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

function startTUI() {
  console.log('🎮 Starting CC-Flux TUI...');
  
  const possiblePaths = [
    path.join(packageRoot, '..', 'tui', 'cc-flux'),
    path.join(packageRoot, '..', 'tui', 'cc-flux.exe'),
    path.join(packageRoot, 'tui', 'cc-flux'),
    '/usr/local/bin/cc-flux-tui'
  ];
  
  let tuiPath = possiblePaths.find(p => fs.existsSync(p));
  
  if (!tuiPath) {
    console.log('⚠️  TUI not found.');
    console.log('   Build it with: cd tui && go build -o cc-flux .');
    console.log('   Or run: cc-flux install-tui');
    return;
  }
  
  const child = spawn(tuiPath, [], {
    cwd: path.dirname(tuiPath),
    stdio: 'inherit'
  });
  
  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

function showConfig() {
  const config = loadConfig();
  console.log('📋 CC-Flux Configuration:\n');
  console.log('  PORT:            ', config.PORT || DEFAULT_PORT);
  console.log('  TARGET_PROVIDER: ', config.TARGET_PROVIDER || 'openai');
  console.log('  TARGET_BASE_URL: ', config.TARGET_BASE_URL || 'https://api.openai.com/v1');
  console.log('  TARGET_MODEL:    ', config.TARGET_MODEL || '(not set)');
  console.log('  TARGET_API_KEY: ', config.TARGET_API_KEY ? '***configured***' : '(not set)');
  console.log('');
  console.log('📝 To configure, edit .env or use CLI args:');
  console.log('   cc-flux start -k YOUR_KEY -m deepseek-reasoner');
}

// Main
const args = process.argv.slice(2);
const command = args[0] || 'start';

switch (command) {
  case 'start':
  case 'run':
    startProxy(args.slice(1));
    break;
    
  case 'tui':
  case 'ui':
    startTUI();
    break;

  case 'profiles':
    runAsync(listProfiles);
    break;

  case 'current':
    runAsync(showCurrent);
    break;

  case 'switch':
    runAsync(() => switchProfile(args[1]));
    break;
    
  case 'config':
    showConfig();
    break;
    
  case 'install-tui':
    console.log('📦 To build TUI:');
    console.log('   cd tui');
    console.log('   go build -o cc-flux .');
    console.log('   # Then: cc-flux tui');
    break;
    
  case 'help':
  case '-h':
  case '--help':
  default:
    printHelp();
}
