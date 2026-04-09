# Cross-Platform Native Binaries + CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish node-pty native binaries for 5 platform targets via GitHub Actions, and update the native-loader to download, extract, and verify zip archives at runtime.

**Architecture:** CI workflow builds node-pty against Electron ABI on 5 runners (matrix strategy), packages platform-specific files into zips, and publishes them as GitHub Release assets with checksums. The native-loader downloads the zip + checksums at runtime, verifies integrity, extracts with yauzl, and generates the existing shim.

**Tech Stack:** GitHub Actions, @electron/rebuild, yauzl (zip extraction), Node.js crypto (SHA256)

**Spec:** `docs/superpowers/specs/2026-04-09-cross-platform-binaries-design.md`

---

### Task 1: Create GitHub Actions CI Workflow

**Files:**
- Create: `.github/workflows/build-natives.yml`

- [ ] **Step 1: Create workflow directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create `.github/workflows/build-natives.yml`**

```yaml
name: Build Native Binaries

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      electron_version:
        description: 'Electron version to build against'
        required: false
        default: '39.6.0'
      node_pty_version:
        description: 'node-pty version'
        required: false
        default: '1.1.0'

env:
  ELECTRON_VERSION: ${{ inputs.electron_version || '39.6.0' }}
  NODE_PTY_VERSION: ${{ inputs.node_pty_version || '1.1.0' }}

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - name: win-x64
            runner: windows-latest
            triple: win32-x64
            files: |
              node_modules/node-pty/build/Release/pty.node
              node_modules/node-pty/build/Release/winpty.dll
              node_modules/node-pty/build/Release/winpty-agent.exe

          - name: mac-arm64
            runner: macos-latest
            triple: darwin-arm64
            files: |
              node_modules/node-pty/build/Release/pty.node
              node_modules/node-pty/build/Release/spawn-helper

          - name: mac-x64
            runner: macos-13
            triple: darwin-x64
            files: |
              node_modules/node-pty/build/Release/pty.node
              node_modules/node-pty/build/Release/spawn-helper

          - name: linux-x64
            runner: ubuntu-latest
            triple: linux-x64
            files: |
              node_modules/node-pty/build/Release/pty.node

          - name: linux-arm64
            runner: ubuntu-24.04-arm
            triple: linux-arm64
            files: |
              node_modules/node-pty/build/Release/pty.node

    runs-on: ${{ matrix.runner }}
    name: Build ${{ matrix.name }}

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install node-pty
        run: |
          npm init -y
          npm install node-pty@${{ env.NODE_PTY_VERSION }}

      - name: Rebuild for Electron
        run: npx @electron/rebuild --version ${{ env.ELECTRON_VERSION }} --module-dir . --which-module node-pty

      - name: Ensure executable permissions (Unix)
        if: runner.os != 'Windows'
        run: |
          for f in ${{ matrix.files }}; do
            if [ -f "$f" ]; then
              chmod +x "$f"
            fi
          done

      - name: Package zip
        shell: bash
        run: |
          mkdir -p staging
          for f in ${{ matrix.files }}; do
            if [ -f "$f" ]; then
              cp "$f" staging/
            fi
          done
          cd staging
          zip ../node-pty-${{ matrix.triple }}.zip *

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: node-pty-${{ matrix.triple }}
          path: node-pty-${{ matrix.triple }}.zip

  release:
    needs: build
    runs-on: ubuntu-latest
    if: startsWith(github.ref, 'refs/tags/v')

    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true

      - name: Generate checksums
        run: |
          cd artifacts
          echo '{' > checksums.json
          first=true
          for f in *.zip; do
            hash=$(sha256sum "$f" | cut -d' ' -f1)
            if [ "$first" = true ]; then
              first=false
            else
              echo ',' >> checksums.json
            fi
            printf '  "%s": "%s"' "$f" "$hash" >> checksums.json
          done
          echo '' >> checksums.json
          echo '}' >> checksums.json
          cat checksums.json

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            artifacts/*.zip
            artifacts/checksums.json
          generate_release_notes: true
```

- [ ] **Step 3: Verify YAML syntax**

Run: `cd /home/griffen/projects/oterm && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build-natives.yml'))"`

If python3/yaml not available: `npx yaml-lint .github/workflows/build-natives.yml` or manually review indentation.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/build-natives.yml
git commit -m "ci: add GitHub Actions workflow to build node-pty for 5 platform targets"
```

---

### Task 2: Add yauzl Dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install yauzl and its types**

```bash
cd /home/griffen/projects/oterm
npm install yauzl@^3.2.0
npm install --save-dev @types/yauzl@^2.10.0
```

- [ ] **Step 2: Add yauzl to esbuild externals**

In `esbuild.config.mjs`, yauzl is pure JS and should be bundled (not externalized). However, check that the build still works — yauzl uses Node.js `zlib` which is already in the externals as a builtin.

Run: `cd /home/griffen/projects/oterm && node esbuild.config.mjs production`
Expected: Build succeeds.

If yauzl causes bundling issues (unlikely since it's pure JS), add it to the external list in esbuild.config.mjs alongside `node-pty`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add yauzl for zip extraction in native-loader"
```

---

### Task 3: Rewrite Native Loader for Zip Downloads

**Files:**
- Modify: `src/terminal/native-loader.ts`

This is the largest task. The file goes from 226 lines to roughly 300 lines. The changes are:
1. Download zips instead of single .node files
2. Fetch checksums.json from release at runtime
3. Extract with yauzl
4. Fix shim useConpty default
5. Add download size limit, ABI detection, race guard, retry, chmod, cleanup

- [ ] **Step 1: Replace the entire `src/terminal/native-loader.ts` file**

```typescript
import { Notice } from "obsidian";
import { createHash } from "crypto";
import { access, chmod, readFile, writeFile, mkdir, unlink, rm } from "fs/promises";
import { createWriteStream } from "fs";
import * as https from "https";
import * as path from "path";
import * as yauzl from "yauzl";
import { getPlatformTriple } from "../utils/platform";
import { IS_WIN } from "../utils/platform";

const GITHUB_OWNER = "mgriffen";
const GITHUB_REPO = "oterm";
const NATIVE_DIR_NAME = "native";
const BINARY_NAME = "pty.node";
const SHIM_NAME = "node-pty.js";
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// node-pty is loaded at runtime from prebuilt binaries, not bundled
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NodePtyModule = any;

let cachedModule: NodePtyModule | null = null;
let downloadPromise: Promise<void> | null = null;

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function loadNodePty(pluginDir: string): Promise<NodePtyModule> {
	if (cachedModule) {
		return cachedModule;
	}

	const nativeDir = path.join(pluginDir, NATIVE_DIR_NAME);
	const triple = getPlatformTriple();

	// Dev install: full node-pty module directory (JS API + native bindings)
	const modulePath = path.join(nativeDir, triple, "node-pty");
	// Production: single binary + generated shim
	const binaryPath = path.join(nativeDir, triple, BINARY_NAME);
	const shimPath = path.join(nativeDir, triple, SHIM_NAME);

	let pty: NodePtyModule;

	if (await fileExists(path.join(modulePath, "package.json"))) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		pty = require(modulePath) as NodePtyModule;
	} else {
		if (!(await fileExists(binaryPath))) {
			// Race guard: reuse in-flight download if another tab triggered one
			if (!downloadPromise) {
				downloadPromise = downloadAndExtract(pluginDir, triple);
			}
			try {
				await downloadPromise;
			} finally {
				downloadPromise = null;
			}
		}

		if (!(await fileExists(shimPath))) {
			await writeShim(shimPath);
		}

		try {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			pty = require(shimPath) as NodePtyModule;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("NODE_MODULE_VERSION")) {
				throw new Error(
					"oterm: binary is incompatible with this Obsidian version. " +
					"Please update the plugin or reinstall."
				);
			}
			throw err;
		}
	}

	if (typeof pty.spawn !== "function") {
		throw new Error(
			"oterm: native module loaded but does not export spawn(). " +
			"The binary may be incompatible. Try reinstalling the plugin."
		);
	}

	cachedModule = pty;
	return pty;
}

async function downloadAndExtract(
	pluginDir: string,
	triple: string
): Promise<void> {
	const notice = new Notice("oterm: downloading terminal binary...", 0);

	try {
		const version = await getPluginVersion(pluginDir);
		const zipName = `node-pty-${triple}.zip`;
		const baseUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}`;

		// Download checksums first
		notice.setMessage("oterm: verifying binary integrity...");
		const checksumsData = await httpGetWithRetry(`${baseUrl}/checksums.json`);
		const checksums = JSON.parse(checksumsData.toString("utf-8"));
		const expectedHash = checksums[zipName];
		if (!expectedHash) {
			throw new Error(
				`oterm: no checksum entry for ${zipName}. ` +
				"Cannot verify binary integrity."
			);
		}

		// Download zip
		notice.setMessage("oterm: downloading terminal binary...");
		const zipData = await httpGetWithRetry(`${baseUrl}/${zipName}`);

		// Verify checksum
		const actualHash = createHash("sha256").update(zipData).digest("hex");
		if (actualHash !== expectedHash) {
			throw new Error(
				`oterm: checksum mismatch for ${zipName}. ` +
				`Expected ${expectedHash}, got ${actualHash}.`
			);
		}

		// Extract zip
		notice.setMessage("oterm: installing terminal binary...");
		const targetDir = path.join(pluginDir, NATIVE_DIR_NAME, triple);

		// Clean up any partial previous extraction
		if (await fileExists(targetDir)) {
			await rm(targetDir, { recursive: true });
		}
		await mkdir(targetDir, { recursive: true });

		await extractZip(zipData, targetDir);

		// Ensure executable permissions on Unix
		if (!IS_WIN) {
			const execFiles = [BINARY_NAME, "spawn-helper"];
			for (const name of execFiles) {
				const filePath = path.join(targetDir, name);
				if (await fileExists(filePath)) {
					await chmod(filePath, 0o755);
				}
			}
		}

		notice.setMessage("oterm: terminal binary installed.");
		setTimeout(() => notice.hide(), 3000);
	} catch (err) {
		notice.hide();
		const msg = err instanceof Error ? err.message : "unknown error";
		new Notice(`oterm: failed to download binary — ${msg}`, 10000);
		throw err;
	}
}

function extractZip(zipData: Buffer, targetDir: string): Promise<void> {
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(zipData, { lazyEntries: true }, (err, zipfile) => {
			if (err || !zipfile) {
				reject(err ?? new Error("Failed to open zip"));
				return;
			}

			zipfile.readEntry();

			zipfile.on("entry", (entry: yauzl.Entry) => {
				// Skip directories
				if (entry.fileName.endsWith("/")) {
					zipfile.readEntry();
					return;
				}

				const outputPath = path.join(targetDir, path.basename(entry.fileName));

				zipfile.openReadStream(entry, (streamErr, readStream) => {
					if (streamErr || !readStream) {
						reject(streamErr ?? new Error("Failed to read zip entry"));
						return;
					}

					const writeStream = createWriteStream(outputPath);
					readStream.pipe(writeStream);

					writeStream.on("finish", () => {
						zipfile.readEntry();
					});

					writeStream.on("error", reject);
				});
			});

			zipfile.on("end", resolve);
			zipfile.on("error", reject);
		});
	});
}

async function writeShim(shimPath: string): Promise<void> {
	const shimCode = [
		"// Auto-generated shim — loads the native pty.node binding",
		"// and re-exports the node-pty JS API",
		"const path = require('path');",
		"const nativePath = path.join(__dirname, 'pty.node');",
		"const binding = require(nativePath);",
		"",
		"// node-pty's native binding exports ConptyProcess/UnixTerminal constructors",
		"// Wrap them in a spawn() function matching the node-pty public API",
		"const os = require('os');",
		"const isWin = os.platform() === 'win32';",
		"",
		"function spawn(file, args, options) {",
		"  const TerminalCtor = isWin ? binding.ConptyProcess : (binding.UnixTerminal || binding.Pty);",
		"  if (!TerminalCtor) {",
		"    throw new Error('oterm: native binding does not export a terminal constructor');",
		"  }",
		"  const cols = (options && options.cols) || 80;",
		"  const rows = (options && options.rows) || 24;",
		"  return new TerminalCtor(file, args || [], {",
		"    name: (options && options.name) || 'xterm-256color',",
		"    cols: cols,",
		"    rows: rows,",
		"    cwd: (options && options.cwd) || process.cwd(),",
		"    env: (options && options.env) || process.env,",
		"    useConpty: options && options.useConpty !== undefined ? options.useConpty : false,",
		"  });",
		"}",
		"",
		"module.exports = { spawn: spawn };",
	].join("\n");
	await writeFile(shimPath, shimCode, "utf-8");
}

async function getPluginVersion(pluginDir: string): Promise<string> {
	const manifestPath = path.join(pluginDir, "manifest.json");
	try {
		const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
		if (!manifest.version) {
			throw new Error("no version field in manifest.json");
		}
		return manifest.version;
	} catch (err) {
		throw new Error(
			`oterm: cannot determine plugin version — ${err instanceof Error ? err.message : "manifest.json unreadable"}. ` +
			"Reinstall the plugin."
		);
	}
}

async function httpGetWithRetry(url: string): Promise<Buffer> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			return await httpGet(url);
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			if (attempt < MAX_RETRIES) {
				await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
			}
		}
	}
	throw lastError;
}

function httpGet(url: string, redirectsLeft = 5): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		https.get(url, (res) => {
			if (
				res.statusCode &&
				res.statusCode >= 300 &&
				res.statusCode < 400 &&
				res.headers.location
			) {
				if (redirectsLeft <= 0) {
					res.resume();
					reject(new Error("Too many redirects"));
					return;
				}
				if (!res.headers.location.startsWith("https://")) {
					res.resume();
					reject(new Error("oterm: redirect to non-HTTPS URL rejected"));
					return;
				}
				res.resume();
				httpGet(res.headers.location, redirectsLeft - 1).then(resolve, reject);
				return;
			}

			if (res.statusCode !== 200) {
				res.resume();
				reject(
					new Error(`HTTP ${res.statusCode} fetching ${url}`)
				);
				return;
			}

			let totalBytes = 0;
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => {
				totalBytes += chunk.length;
				if (totalBytes > MAX_DOWNLOAD_BYTES) {
					res.destroy();
					reject(new Error(`oterm: download exceeds ${MAX_DOWNLOAD_BYTES / 1024 / 1024}MB limit — aborting`));
					return;
				}
				chunks.push(chunk);
			});
			res.on("end", () => resolve(Buffer.concat(chunks)));
			res.on("error", reject);
		}).on("error", reject);
	});
}

export function getNativeDir(pluginDir: string): string {
	return path.join(pluginDir, NATIVE_DIR_NAME);
}

export async function isBinaryInstalled(pluginDir: string): Promise<boolean> {
	const triple = getPlatformTriple();
	return fileExists(
		path.join(pluginDir, NATIVE_DIR_NAME, triple, BINARY_NAME)
	);
}
```

- [ ] **Step 2: Verify build**

Run: `cd /home/griffen/projects/oterm && node esbuild.config.mjs production`
Expected: Build succeeds with no errors.

If yauzl causes bundling issues (e.g., esbuild can't resolve it), add `"yauzl"` to the `external` array in `esbuild.config.mjs`:

```javascript
external: [
    "obsidian",
    "electron",
    "@codemirror/*",
    "@lezer/*",
    "node-pty",
    "yauzl",
    ...builtins,
],
```

Then rebuild and verify.

- [ ] **Step 3: Commit**

```bash
git add src/terminal/native-loader.ts
git commit -m "feat: rewrite native-loader for zip downloads with yauzl extraction and hardening"
```

---

### Task 4: Test CI Workflow with Manual Dispatch

**Files:** None (CI test)

This task requires the workflow to be pushed to GitHub. It validates that the build matrix works on all 5 platforms.

- [ ] **Step 1: Push the branch to origin**

```bash
git push origin feat/shell-registry
```

- [ ] **Step 2: Trigger manual workflow dispatch**

Go to GitHub → mgriffen/oterm → Actions → "Build Native Binaries" → "Run workflow"

Select the `feat/shell-registry` branch. Use default inputs (Electron 39.6.0, node-pty 1.1.0).

- [ ] **Step 3: Monitor build results**

Watch all 5 matrix jobs. Expected: all 5 succeed and produce zip artifacts.

Common failure points:
- **linux-arm64:** `ubuntu-24.04-arm` runner may not be available on free tier. If it fails, change to `ubuntu-latest` with `qemu` cross-compilation, or remove linux-arm64 for now and add it later.
- **macos-13 (Intel):** may have issues with @electron/rebuild. Check logs.
- **windows-latest:** may need Visual Studio Build Tools pre-installed. GitHub's Windows runner includes them, but verify.

- [ ] **Step 4: Download and inspect artifacts**

From the Actions run, download each zip artifact. Verify contents:
- `node-pty-win32-x64.zip`: contains `pty.node`, `winpty.dll`, `winpty-agent.exe`
- `node-pty-darwin-arm64.zip`: contains `pty.node`, `spawn-helper`
- `node-pty-darwin-x64.zip`: contains `pty.node`, `spawn-helper`
- `node-pty-linux-x64.zip`: contains `pty.node`
- `node-pty-linux-arm64.zip`: contains `pty.node`

- [ ] **Step 5: Fix any CI issues and recommit**

If any jobs failed, fix the workflow YAML and push again. Common fixes:
- Adjust file paths in the `files` matrix field (node-pty build output may differ by platform)
- Add missing build tools installation steps
- Adjust runner names

```bash
git add .github/workflows/build-natives.yml
git commit -m "fix: address CI build issues found during manual dispatch"
git push origin feat/shell-registry
```

---

### Task 5: Create First Test Release

**Files:** None (release test)

This validates the full tag-triggered release flow including checksums generation.

- [ ] **Step 1: Create and push a test tag**

```bash
git tag v0.1.0-rc.1
git push origin v0.1.0-rc.1
```

- [ ] **Step 2: Monitor the release workflow**

Watch GitHub Actions. Expected: all 5 build jobs succeed, then the release job creates a GitHub Release at `v0.1.0-rc.1` with:
- 5 zip files
- `checksums.json`
- Auto-generated release notes

- [ ] **Step 3: Verify checksums.json content**

Download `checksums.json` from the release. Verify it contains SHA256 hashes for all 5 zips:

```bash
curl -sL https://github.com/mgriffen/oterm/releases/download/v0.1.0-rc.1/checksums.json | python3 -m json.tool
```

Expected: valid JSON with 5 entries keyed by zip filename.

- [ ] **Step 4: Verify end-to-end binary loading**

On your local machine, update `manifest.json` version to `0.1.0-rc.1` temporarily. Delete the `native/` directory in your vault's plugin folder. Open Obsidian, open the terminal. Expected:
- "oterm: downloading terminal binary..." notice appears
- Binary downloads, extracts, terminal opens normally
- `native/win32-x64/` directory contains `pty.node`, `winpty.dll`, `winpty-agent.exe`, `node-pty.js` (shim)

Revert `manifest.json` version after testing.

- [ ] **Step 5: Delete test release and tag if desired**

```bash
gh release delete v0.1.0-rc.1 --yes
git tag -d v0.1.0-rc.1
git push origin --delete v0.1.0-rc.1
```
