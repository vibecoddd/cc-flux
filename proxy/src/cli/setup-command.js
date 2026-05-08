const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

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

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { path: filePath, status: 'missing', error: null, data: null };
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { path: filePath, status: 'ok', error: null, data };
  } catch (error) {
    return { path: filePath, status: 'invalid', error: error.message, data: null };
  }
}

function validateProfile(profile) {
  const issues = [];
  if (!profile.apiKey || profile.apiKey.trim() === '') {
    issues.push('missing API key');
  }
  if (!profile.model || profile.model.trim() === '') {
    issues.push('missing model');
  }
  if (!profile.baseUrl || profile.baseUrl.trim() === '') {
    issues.push('missing baseUrl');
  }
  return {
    id: profile.id,
    name: profile.name,
    valid: issues.length === 0,
    issues
  };
}

function validateProfiles(profiles) {
  if (!Array.isArray(profiles)) {
    return {
      valid: false,
      profiles: [],
      error: 'providers.json must contain an array'
    };
  }

  const results = profiles.map(validateProfile);
  const allValid = results.every(p => p.valid);

  return {
    valid: allValid,
    profiles: results
  };
}

function checkPortAvailability(port) {
  const net = require('net');
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve({ port, available: false }));
    server.once('listening', () => {
      server.close();
      resolve({ port, available: true });
    });
    server.listen(port, '127.0.0.1');
  });
}

function checkGoAvailability() {
  try {
    const version = execSync('go version', { encoding: 'utf8' }).trim();
    return {
      status: 'ok',
      installed: true,
      version: version.replace('go version go', '').split(' ')[0],
      message: `Go ${version.replace('go version go', '').split(' ')[0]} installed`
    };
  } catch (error) {
    return {
      status: 'missing',
      installed: false,
      message: 'Go not found',
      suggestion: 'Install Go from https://go.dev/dl/ or via your package manager'
    };
  }
}

function checkTuiBinary() {
  const possiblePaths = [
    path.join(process.cwd(), '..', 'tui', 'cc-flux'),
    path.join(process.cwd(), '..', 'tui', 'cc-flux.exe'),
    path.join(os.homedir(), '.cc-flux', 'cc-flux'),
    '/usr/local/bin/cc-flux-tui'
  ];

  for (const tuiPath of possiblePaths) {
    if (fs.existsSync(tuiPath)) {
      return {
        status: 'ok',
        path: tuiPath,
        message: `TUI binary found at ${tuiPath}`
      };
    }
  }

  return {
    status: 'missing',
    message: 'TUI binary not found',
    suggestion: 'Run: cd tui && go build -o cc-flux .'
  };
}

function checkClaudeCode() {
  try {
    execSync('claude --version', { encoding: 'utf8', stdio: 'pipe' });
    return {
      status: 'ok',
      installed: true,
      message: 'Claude Code CLI found'
    };
  } catch (error) {
    return {
      status: 'missing',
      installed: false,
      message: 'Claude Code CLI not found',
      suggestion: 'Install from https://docs.anthropic.com/en/docs/claude-code'
    };
  }
}

async function buildDoctorReport(options = {}) {
  const env = options.env || process.env;
  const paths = resolveSetupPaths(env);
  const port = parseInt(env.PORT || '8080', 10);
  const adminUrl = env.CC_FLUX_ADMIN_URL || `http://localhost:${port}`;

  const providersFile = readJsonFile(paths.providersPath);
  const stateFile = readJsonFile(paths.statePath);

  let profileValidation = null;
  let activeProfileValid = null;

  if (providersFile.status === 'ok' && Array.isArray(providersFile.data)) {
    profileValidation = validateProfiles(providersFile.data);

    if (stateFile.status === 'ok' && stateFile.data && stateFile.data.activeProviderId) {
      const activeId = stateFile.data.activeProviderId;
      const activeProfile = providersFile.data.find(p => p.id === activeId);
      activeProfileValid = {
        activeProviderId: activeId,
        found: !!activeProfile,
        valid: activeProfile ? validateProfile(activeProfile).valid : false
      };
    }
  }

  let portCheck = null;
  try {
    portCheck = await checkPortAvailability(port);
  } catch (error) {
    portCheck = { port, available: null, error: error.message };
  }

  const optional = {};
  if (options.withTui) {
    optional.Go = checkGoAvailability();
    optional['TUI Binary'] = checkTuiBinary();
  }
  if (options.withClaude) {
    optional['Claude Code'] = checkClaudeCode();
  }

  const requiredIssues = [];
  if (providersFile.status !== 'ok') requiredIssues.push(providersFile.status);
  if (stateFile.status !== 'ok') requiredIssues.push(stateFile.status);
  if (portCheck && !portCheck.available && portCheck.available !== null) {
    requiredIssues.push('port_in_use');
  }
  if (activeProfileValid && !activeProfileValid.found) {
    requiredIssues.push('active_profile_missing');
  }

  return {
    ok: requiredIssues.length === 0,
    nodeVersion: process.version,
    port,
    adminUrl,
    adminTokenConfigured: Boolean(env.CC_FLUX_ADMIN_TOKEN),
    adminReachable: null,
    adminError: null,
    paths,
    providers: providersFile,
    state: stateFile,
    profileValidation,
    activeProfileValid,
    portCheck,
    optional
  };
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatFileStatus(label, status, isRequired = true) {
  const prefix = isRequired ? '' : '  ';
  if (status.status === 'ok') {
    return `${prefix}✓ ${label}: ${status.path}`;
  } else if (status.status === 'missing') {
    return [
      `${prefix}✗ ${label}: not found`,
      `${prefix}  → Fix: Run 'cc-flux init' to create`
    ].join('\n');
  } else if (status.status === 'invalid') {
    return [
      `${prefix}✗ ${label}: invalid JSON`,
      `${prefix}  → Fix: Edit ${status.path} to fix JSON syntax`,
      `${prefix}  → Error: ${status.error}`
    ].join('\n');
  }
  return `${prefix}? ${label}: ${status.path} (${status.status})`;
}

function formatDoctorReport(report) {
  const lines = ['CC-Flux doctor\n'];

  lines.push('=== Required Checks ===\n');

  lines.push(`  Node.js: ${report.nodeVersion}`);

  lines.push('');
  lines.push(formatFileStatus('Providers', report.providers));
  lines.push(formatFileStatus('State', report.state));

  if (report.portCheck) {
    lines.push('');
    if (report.portCheck.available === true) {
      lines.push(`  ✓ Port ${report.portCheck.port}: available`);
    } else if (report.portCheck.available === false) {
      lines.push(`  ✗ Port ${report.portCheck.port}: already in use`);
      lines.push(`    → Fix: Set PORT env var or stop the conflicting process`);
      lines.push(`    → Tip: Run 'lsof -i :${report.portCheck.port}' on macOS/Linux to find the process`);
    }
  }

  if (report.profileValidation) {
    lines.push('');
    if (report.profileValidation.error) {
      lines.push(`  ✗ Profiles: ${report.profileValidation.error}`);
    } else {
      const invalidProfiles = report.profileValidation.profiles.filter(p => !p.valid);
      if (invalidProfiles.length === 0) {
        lines.push(`  ✓ All ${report.profileValidation.profiles.length} profiles valid`);
      } else {
        lines.push(`  ✗ ${invalidProfiles.length} of ${report.profileValidation.profiles.length} profiles have issues:`);
        for (const profile of invalidProfiles) {
          lines.push(`    → ${profile.id}: ${profile.issues.join(', ')}`);
        }
      }
    }
  }

  if (report.activeProfileValid) {
    lines.push('');
    if (report.activeProfileValid.found && report.activeProfileValid.valid) {
      lines.push(`  ✓ Active profile '${report.activeProfileValid.activeProviderId}' is valid`);
    } else if (!report.activeProfileValid.found) {
      lines.push(`  ✗ Active profile '${report.activeProfileValid.activeProviderId}' not found in providers`);
      lines.push(`    → Fix: Edit ${report.state.path} to set a valid activeProviderId`);
    } else {
      lines.push(`  ✗ Active profile '${report.activeProfileValid.activeProviderId}' has issues`);
    }
  }

  lines.push('\n=== Admin API ===\n');

  lines.push(`  URL: ${report.adminUrl}`);
  lines.push(`  Token: ${report.adminTokenConfigured ? 'configured' : 'not configured (OK for local use)'}`);

  if (report.adminReachable === true) {
    lines.push(`  Status: ✓ reachable`);
  } else if (report.adminReachable === false) {
    lines.push(`  Status: ✗ not reachable`);
    if (report.adminError) {
      lines.push(`    → ${report.adminError}`);
      if (report.adminError.includes('401') || report.adminError.includes('Unauthorized')) {
        lines.push(`    → Fix: Check CC_FLUX_ADMIN_TOKEN matches the proxy's value`);
      } else if (report.adminError.includes('ECONNREFUSED')) {
        lines.push(`    → Fix: Start the proxy with 'cc-flux start'`);
      }
    }
  } else {
    lines.push(`  Status: (run 'cc-flux doctor' with proxy running to check)`);
  }

  const optionalKeys = Object.keys(report.optional || {});
  if (optionalKeys.length > 0) {
    lines.push('\n=== Optional Checks ===\n');
    for (const [name, result] of Object.entries(report.optional)) {
      if (result.status === 'ok') {
        lines.push(`  ✓ ${name}: ${result.message}`);
      } else {
        lines.push(`  ○ ${name}: ${result.message}`);
        if (result.suggestion) {
          lines.push(`    → ${result.suggestion}`);
        }
      }
    }
  }

  lines.push(`\n${report.ok ? '✓ All required checks passed' : '✗ Some checks failed'}`);
  lines.push('');

  return lines.join('\n');
}

function formatInitResult(result) {
  const lines = [
    'CC-Flux config initialized.',
    '',
    `Home: ${result.paths.homeDir}`,
    '',
    `Providers: ${result.providers.created ? '✓ created' : '○ exists'} - ${result.providers.path}`,
    `State:    ${result.state.created ? '✓ created' : '○ exists'} - ${result.state.path}`,
    '',
    'Next steps:',
    `  1. Edit ${result.paths.providersPath} to add your API key`,
    '  2. Run: cc-flux start',
    '  3. Run: cc-flux doctor'
  ];
  return lines.join('\n');
}

module.exports = {
  DEFAULT_PROFILES,
  buildDoctorReport,
  formatDoctorReport,
  formatInitResult,
  initializeConfig,
  resolveSetupPaths,
  validateProfile,
  validateProfiles
};
