# Sub-Project 3: Cross-Platform Native Binaries + CI

**Date:** 2026-04-09
**Status:** Approved
**Goal:** Automate building and publishing node-pty native binaries for all desktop platforms so users get automatic binary downloads on first terminal open.

## Distribution Strategy

**Initial launch:** BRAT (Obsidian42 beta plugin manager) — no policy constraints, available immediately.

**Parallel:** Submit to Obsidian community plugin store. Runtime binary downloads are not explicitly banned by Obsidian's developer policies, but no plugin has been approved with this pattern yet. Termy (PR #10022 on obsidianmd/obsidian-releases) is attempting the same approach and is in review. If approved, it sets precedent for oterm. If rejected, BRAT users are already served.

**README disclosure required:** Network use (binary download from GitHub Releases) and file system access (writing to plugin directory) must be documented per Obsidian developer policies.

## Scope

1. GitHub Actions workflow to build node-pty for 5 platform/arch targets
2. Zip packaging per platform with checksums
3. Update native-loader to download and extract zips
4. Tag-triggered releases + manual dispatch for testing
5. Hardening: download size limit, ABI mismatch detection, file permissions, race condition guard

Out of scope: signing binaries, auto-update mechanism, building from a node-pty fork.

## Platform Targets

| Entry | Runner | Platform Triple | Files in Zip |
|---|---|---|---|
| win-x64 | `windows-latest` | `win32-x64` | `pty.node`, `winpty.dll`, `winpty-agent.exe` |
| mac-arm64 | `macos-latest` | `darwin-arm64` | `pty.node`, `spawn-helper` |
| mac-x64 | `macos-13` | `darwin-x64` | `pty.node`, `spawn-helper` |
| linux-x64 | `ubuntu-latest` | `linux-x64` | `pty.node` |
| linux-arm64 | `ubuntu-24.04-arm` | `linux-arm64` | `pty.node` |

## Design

### CI Workflow

Single file: `.github/workflows/build-natives.yml`

**Triggers:**
- `push` tag matching `v*` — builds binaries and creates a GitHub Release with assets
- `workflow_dispatch` with `electron_version` (default: `39.6.0`) and `node_pty_version` (default: `1.1.0`) inputs — for testing builds without creating a release

**Matrix strategy:** 5 explicit entries, each defining runner, platform triple, and which files to collect.

**Per-matrix-job steps:**
1. Checkout repo
2. Setup Node 20
3. `npm install node-pty@$NODE_PTY_VERSION`
4. `npx @electron/rebuild --version $ELECTRON_VERSION --module-dir . --which-module node-pty`
5. Collect platform-specific files into `node-pty-{triple}.zip` (ensure executable permissions on Unix binaries before zipping)
6. Upload zip as workflow artifact

**Release job** (runs after all matrix jobs complete, on `ubuntu-latest`):
1. Download all 5 zip artifacts
2. Generate `checksums.json` — SHA256 of each zip, keyed by zip filename:
   ```json
   {
     "node-pty-win32-x64.zip": "abc123...",
     "node-pty-darwin-arm64.zip": "def456...",
     "node-pty-darwin-x64.zip": "...",
     "node-pty-linux-x64.zip": "...",
     "node-pty-linux-arm64.zip": "..."
   }
   ```
3. On tag push: create GitHub Release at that tag, attach all 5 zips + `checksums.json`
4. On manual dispatch: upload artifacts only (no release)

### Checksums Distribution

`checksums.json` is attached as a release asset. The native-loader fetches `checksums.json` from the same GitHub Release at runtime alongside the binary zip. This eliminates the manual "download and commit checksums" step — the loader always gets the checksums that match the binaries it's downloading. No `checksums.json` file in the repo.

### Electron Version

Pinned to 39.6.0 (matches current Obsidian) as workflow default. Parameterized via `workflow_dispatch` input so it can be changed without editing the workflow file. When Obsidian bumps Electron, update the default and re-release.

### worker_threads Patch — Not Needed in CI

The production loading path uses a generated shim that calls the native binding directly, bypassing node-pty's JS layer entirely. Combined with `useConpty: false` in `pty-bridge.ts`, the `worker_threads`-dependent `windowsConoutConnection.js` is never loaded. The patch remains in `scripts/dev-install.sh` for local development only.

### Native Loader Updates

`src/terminal/native-loader.ts` changes:

**Download changes:**
1. Download URL: `node-pty-{triple}.node` → `node-pty-{triple}.zip`
2. Also download `checksums.json` from the same release
3. Verify zip SHA256 against fetched checksums
4. Max download size: 20MB hard limit — abort if exceeded

**Zip extraction:**
Use `yauzl` (zero-dependency pure JS zip reader, added as dependency) instead of shelling out to system commands. This avoids platform-specific `unzip`/`Expand-Archive` fragility and works identically everywhere.

After extraction:
- On Unix: `chmod +x` on `pty.node` and `spawn-helper` (if present) to ensure executable permissions
- Delete the zip file after successful extraction
- Clean up partial extraction on failure (delete target directory, re-attempt next time)

**Shim fix:**
Change the shim's `useConpty` default from `true` to `false` — matches `pty-bridge.ts` behavior and prevents a latent bug.

**macOS spawn-helper resolution:**
The native `UnixTerminal` binding resolves `spawn-helper` relative to the `.node` file's location. Since both `pty.node` and `spawn-helper` are extracted to the same directory (`native/{triple}/`), this works as long as they're siblings. Verify this empirically during implementation on macOS — if the binding uses a different resolution strategy, the shim may need to set a helper path.

**Race condition guard:**
Cache the download promise in memory. If `loadNodePty` is called concurrently (e.g., two terminal tabs opening simultaneously), the second call awaits the first's download rather than starting a duplicate.

**ABI mismatch detection:**
Wrap `require(shimPath)` in a try-catch. If the error message contains `NODE_MODULE_VERSION`, show: "oterm binary is incompatible with this Obsidian version. Please update the plugin or reinstall." Otherwise rethrow.

**Retry on transient failure:**
Retry download up to 3 times with 2-second delay on HTTP errors. Show progress in the Notice.

### Install Flow

1. User installs oterm (via BRAT or community browser) → gets `main.js`, `manifest.json`, `styles.css`
2. User opens terminal for the first time → native-loader downloads `checksums.json` + platform-specific zip from GitHub Release, verifies, extracts
3. User sees "oterm: downloading terminal binary..." notice
4. All subsequent opens use cached binary — no download

**Offline/manual fallback:** Users behind corporate proxies can download the zip manually from GitHub Releases and place the contents in `<vault>/.obsidian/plugins/oterm/native/<triple>/`. Document this in README.

### Files Changed

**New:**
- `.github/workflows/build-natives.yml` — CI workflow

**Modified:**
- `src/terminal/native-loader.ts` — zip download, yauzl extraction, checksums from release, hardening
- `package.json` — add `yauzl` dependency

**Removed:**
- Checksums.json is no longer a repo file — fetched at runtime from release assets

**Untouched:** All other source files.
