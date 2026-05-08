# Phase 6 Productization and DX Implementation Plan

**Goal:** Turn the current working tool into something a developer can install, diagnose, and update without reading the codebase.

**Architecture:** Keep setup, doctor, and release improvements in existing CLI and docs modules. No new sensitive state.

---

## Task 1: Enhance cc-flux doctor

**Files:**
- Modify: `proxy/src/cli/setup-command.js`
- Modify: `proxy/bin/cc-flux.js`

- [ ] **Step 1: Add port conflict detection**

Add a function to check if the configured port is already in use:

```js
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
```

- [ ] **Step 2: Add profile validation**

Add validation for each profile in providers.json:

```js
function validateProfiles(profiles) {
  return profiles.map(profile => {
    const issues = [];
    if (!profile.apiKey) issues.push('missing API key');
    if (!profile.model) issues.push('missing model');
    if (!profile.baseUrl) issues.push('missing baseUrl');
    return {
      id: profile.id,
      name: profile.name,
      valid: issues.length === 0,
      issues
    };
  });
}
```

- [ ] **Step 3: Add active profile validation**

Check if the active profile ID in state.json exists in providers.json.

- [ ] **Step 4: Add Admin token mismatch detection**

When Admin API is unreachable, check if CC_FLUX_ADMIN_TOKEN is set locally but proxy might have a different value.

- [ ] **Step 5: Add optional checks**

Add flag support for optional checks:
- `--with-tui`: Check Go availability and TUI binary path
- `--with-claude`: Check Claude Code CLI availability

- [ ] **Step 6: Update formatDoctorReport**

Make output more actionable with repair suggestions:

```js
function formatDoctorReport(report) {
  const lines = ['CC-Flux doctor'];

  // Required checks
  lines.push('\n[Required]');
  lines.push(`  Node.js: ${report.nodeVersion} (${semver.valid(report.nodeVersion) ? 'ok' : 'upgrade recommended'})`);

  // File checks
  for (const check of ['providers', 'state']) {
    const status = report[check];
    const icon = status.status === 'ok' ? '✓' : '✗';
    lines.push(`  ${icon} ${capitalize(check)}: ${status.path}`);
    if (status.status === 'invalid') {
      lines.push(`    → Fix: Edit the file to fix JSON syntax error`);
      lines.push(`    → Error: ${status.error}`);
    } else if (status.status === 'missing') {
      lines.push(`    → Fix: Run 'cc-flux init' to create`);
    }
  }

  // Port check
  const portCheck = report.portCheck;
  if (portCheck) {
    const icon = portCheck.available ? '✓' : '✗';
    lines.push(`  ${icon} Port ${portCheck.port}: ${portCheck.available ? 'available' : 'in use'}`);
    if (!portCheck.available) {
      lines.push(`    → Fix: Set PORT env var or stop the conflicting process`);
    }
  }

  // Admin API
  lines.push('\n[Admin API]');
  lines.push(`  URL: ${report.adminUrl}`);
  lines.push(`  Token: ${report.adminTokenConfigured ? 'configured' : 'not configured'}`);
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
  }

  // Optional checks
  if (report.optional) {
    lines.push('\n[Optional]');
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

  return lines.join('\n');
}
```

- [ ] **Step 7: Update CLI doctor command**

Wire in the new checks and add optional flags:

```js
async function runDoctor(args) {
  const options = {
    withTui: args.includes('--with-tui') || args.includes('-t'),
    withClaude: args.includes('--with-claude') || args.includes('-c')
  };

  const report = await buildDoctorReport(options);
  console.log(formatDoctorReport(report));

  if (!report.ok) {
    process.exitCode = 1;
  }
}
```

- [ ] **Step 8: Test enhanced doctor**

Run `node proxy/bin/cc-flux.js doctor` and verify output format.

---

## Task 2: Improve README Quick Start

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Reorganize README around user intent**

Reorganize sections in this order:
1. Quick Start (shortest path first)
2. Install Options
3. Configure Providers
4. Connect Claude Code
5. Daily Commands
6. Troubleshooting
7. Development
8. Release Process

- [ ] **Step 2: Make Quick Start more actionable**

Add a numbered quick start that ends with a verification step:

```markdown
## Quick Start

1. Install dependencies:
   ```bash
   cd proxy && npm install
   cd ../tui && go build -o cc-flux .
   ```

2. Initialize config:
   ```bash
   cc-flux init
   ```

3. Edit `~/.cc-flux/providers.json` to add your API key.

4. Start the proxy:
   ```bash
   cc-flux start
   ```

5. Connect Claude Code:
   ```bash
   export ANTHROPIC_BASE_URL=http://localhost:8080
   claude
   ```

6. Verify everything works:
   ```bash
   cc-flux doctor
   ```
```

- [ ] **Step 3: Add troubleshooting section**

```markdown
## Troubleshooting

### Proxy not reachable

Start the proxy first:
```bash
cc-flux start
```

### Doctor shows "not reachable"

1. Check the proxy is running on the expected port
2. Verify PORT matches between proxy and CLI
3. Check for port conflicts: `cc-flux doctor --verbose`

### Missing API key

Edit your providers file and add your API key:
```bash
# Find your providers file:
cc-flux doctor | grep providers
# Then edit:
nano ~/.cc-flux/providers.json
```

### Claude Code not connecting

1. Verify the base URL: `/status` inside Claude Code
2. Make sure ANTHROPIC_BASE_URL is set correctly
3. Check `cc-flux health` to see if proxy is running
```

---

## Task 3: Create Release Checklist

**Files:**
- Create: `docs/superpowers/release-checklist.md`

- [ ] **Step 1: Create release checklist document**

Document the release process:
1. Run local CI: `./scripts/ci.sh`
2. Update version in `package.json`
3. Update changelog
4. Verify README quick-start commands
5. Run npm package contents check
6. Build TUI
7. Run local smoke tests
8. Create GitHub release notes

---

## Task 4: Final Verification

- [ ] **Step 1: Run proxy tests**

```bash
cd proxy && npm test
```

- [ ] **Step 2: Run TUI tests and build**

```bash
cd tui && go test -count=1 ./...
go build -o cc-flux .
```

- [ ] **Step 3: Manual smoke test**

```bash
cc-flux doctor
cc-flux init
cc-flux profiles
cc-flux current
cc-flux health
```

- [ ] **Step 4: Commit Phase 6**

```bash
git add -A
git commit -m "feat: phase 6 productization and dx improvements"
```
