# CC-Flux Release Checklist

Use this checklist when preparing a new release of CC-Flux.

## Pre-Release

### 1. Run Local CI

```bash
./scripts/ci.sh
```

All tests must pass before proceeding.

### 2. Update Version

Update `version` in:
- `proxy/package.json`

### 3. Update Changelog

Add entry to `CHANGELOG.md` (create if missing):

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New feature descriptions

### Changed
- Changed behavior descriptions

### Fixed
- Bug fix descriptions
```

### 4. Review README Quick Start

Verify the Quick Start section commands work:

```bash
# Quick install path
cd proxy && npm install
cd ../tui && go build -o cc-flux .
cc-flux init
cc-flux doctor
```

### 5. Verify Package Contents

```bash
cd proxy && npm pack --dry-run
```

Verify the package contains:
- `package.json`
- `src/` directory
- `bin/` directory
- No unintended files (e.g., `node_modules`, test files)

### 6. Build TUI

```bash
cd tui && go build -o cc-flux .
ls -la cc-flux
```

Verify the binary exists and is executable.

## Smoke Testing

### 7. Start Proxy

```bash
cd proxy && PORT=18080 CC_FLUX_PROVIDERS_PATH=../tui/providers.json npm start
```

### 8. Run CLI Commands

```bash
# In another terminal
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js profiles
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js current
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js switch deepseek-reasoner
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js health
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js doctor
CC_FLUX_ADMIN_URL=http://127.0.0.1:18080 node proxy/bin/cc-flux.js metrics
```

### 9. Test TUI Build Path

```bash
cd tui && ./cc-flux --help
```

Verify TUI binary runs without errors.

## Git Operations

### 10. Commit Changes

```bash
git add -A
git commit -m "Release vX.Y.Z"
```

### 11. Create Git Tag

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

## GitHub Release

### 12. Create GitHub Release

1. Go to https://github.com/cc-flux/cc-flux/releases
2. Click "Draft a new release"
3. Select the tag created above
4. Title: `vX.Y.Z`
5. Copy release notes from CHANGELOG.md
6. Attach binaries if applicable

### 13. Publish npm Package

```bash
cd proxy && npm publish
```

## Post-Release

### 14. Verify npm Package

```bash
npm view cc-flux version
```

Verify the version matches the release.

### 15. Local Verification

Clone fresh and verify installation:

```bash
cd /tmp
git clone https://github.com/cc-flux/cc-flux.git
cd cc-flux
cd proxy && npm install
cd ../tui && go build -o cc-flux .
cc-flux doctor
```

## Quick Reference

| Step | Command |
|------|---------|
| Run CI | `./scripts/ci.sh` |
| Test proxy | `cd proxy && npm test` |
| Test TUI | `cd tui && go test -count=1 ./...` |
| Build TUI | `cd tui && go build -o cc-flux .` |
| Start proxy | `cd proxy && npm start` |
| Run doctor | `cc-flux doctor` |
| Publish npm | `cd proxy && npm publish` |
