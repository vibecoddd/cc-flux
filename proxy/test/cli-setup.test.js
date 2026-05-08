const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildDoctorReport,
  formatDoctorReport,
  initializeConfig,
  resolveSetupPaths
} = require('../src/cli/setup-command');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-flux-setup-'));
}

test('resolveSetupPaths honors CC_FLUX_HOME and explicit file overrides', () => {
  const home = tempDir();
  const paths = resolveSetupPaths({
    CC_FLUX_HOME: home,
    CC_FLUX_PROVIDERS_PATH: path.join(home, 'custom-providers.json')
  });

  assert.equal(paths.homeDir, home);
  assert.equal(paths.providersPath, path.join(home, 'custom-providers.json'));
  assert.equal(paths.statePath, path.join(home, 'state.json'));
});

test('initializeConfig creates default provider and state files without overwriting', () => {
  const home = tempDir();
  const env = { CC_FLUX_HOME: home };
  const first = initializeConfig({ env });

  assert.equal(first.providers.created, true);
  assert.equal(first.state.created, true);
  assert.equal(JSON.parse(fs.readFileSync(first.paths.providersPath, 'utf8'))[0].id, 'openai-gpt4o');
  assert.deepEqual(JSON.parse(fs.readFileSync(first.paths.statePath, 'utf8')), {
    activeProviderId: 'openai-gpt4o'
  });

  fs.writeFileSync(first.paths.statePath, JSON.stringify({ activeProviderId: 'custom' }, null, 2));
  const second = initializeConfig({ env });
  assert.equal(second.providers.created, false);
  assert.equal(second.state.created, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(first.paths.statePath, 'utf8')), {
    activeProviderId: 'custom'
  });
});

test('buildDoctorReport validates providers and state json files', async () => {
  const home = tempDir();
  const providersPath = path.join(home, 'providers.json');
  const statePath = path.join(home, 'state.json');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(providersPath, '{not-json');
  fs.writeFileSync(statePath, JSON.stringify({ activeProviderId: 'openai-gpt4o' }, null, 2));

  const report = await buildDoctorReport({ env: { CC_FLUX_HOME: home } });
  assert.equal(report.providers.status, 'invalid');
  assert.equal(report.state.status, 'ok');
  assert.equal(report.ok, false);

  const output = formatDoctorReport(report);
  assert.match(output, /Providers: invalid/);
  assert.match(output, /state\.json/);
});
