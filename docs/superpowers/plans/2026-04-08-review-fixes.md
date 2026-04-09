# Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical and high-severity findings from the Codex adversarial review and superpowers code review.

**Architecture:** Eight focused fixes across the existing codebase — no new features, no structural changes. Fixes touch native-loader (integrity + async I/O), pty-bridge + platform (WSL cwd), terminal-view + new modal (close warning), and constants extraction. Each task is independently committable.

**Tech Stack:** TypeScript, Obsidian API, Node.js `fs.promises`, `child_process.execFile`

**Spec:** `docs/superpowers/specs/2026-04-08-review-fixes-design.md`

---

### Task 1: Extract Terminal String Constants

**Files:**
- Modify: `src/constants.ts`
- Modify: `src/terminal/pty-bridge.ts:48-49`
- Modify: `src/terminal/terminal-session.ts:38` (the `allowProposedApi` block, `name` field reference in pty options)

Small, zero-risk task to warm up and establish constants used by later tasks.

- [ ] **Step 1: Add constants to `src/constants.ts`**

Add these two lines after the existing constants:

```typescript
export const TERM_TYPE = "xterm-256color";
export const COLOR_TERM = "truecolor";
```

- [ ] **Step 2: Replace raw strings in `src/terminal/pty-bridge.ts`**

Add import at top:

```typescript
import { TERM_TYPE, COLOR_TERM } from "../constants";
```

Replace lines 48-49:

```typescript
// Before:
env["TERM"] = "xterm-256color";
env["COLORTERM"] = "truecolor";

// After:
env["TERM"] = TERM_TYPE;
env["COLORTERM"] = COLOR_TERM;
```

Replace `name` in `ptyOptions` (line 52):

```typescript
// Before:
name: "xterm-256color",

// After:
name: TERM_TYPE,
```

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/constants.ts src/terminal/pty-bridge.ts
git commit -m "refactor: extract xterm-256color and truecolor to shared constants"
```

---

### Task 2: Cache Shell Detection

**Files:**
- Modify: `src/utils/platform.ts:13-18`

- [ ] **Step 1: Add cache variable and modify `detectShell()`**

In `src/utils/platform.ts`, add a cache variable above `detectShell` and modify the function:

```typescript
let cachedShell: ShellInfo | null = null;

export function detectShell(): ShellInfo {
	if (cachedShell) return cachedShell;

	if (IS_WIN) {
		cachedShell = detectWindowsShell();
	} else {
		cachedShell = detectUnixShell();
	}
	return cachedShell;
}
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/platform.ts
git commit -m "perf: cache shell detection result for process lifetime"
```

---

### Task 3: Add node-pty as devDependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install node-pty as devDependency**

```bash
npm install --save-dev node-pty
```

Note: This will also install the native build tools. If the install fails due to missing build tools, add it manually to `package.json` devDependencies without installing:

```json
"node-pty": "^1.0.0"
```

- [ ] **Step 2: Verify build still works**

Run: `npm run build`
Expected: Clean build. node-pty is externalized in esbuild config so it won't be bundled.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add node-pty as devDependency for type information"
```

---

### Task 4: Mandatory Binary Integrity Verification

**Files:**
- Modify: `src/terminal/native-loader.ts:29-37,40-85,87-94`

This task converts the optional checksum check into a mandatory gate and converts sync I/O to async (Fix 6 from the spec) in the same pass since the same lines are being rewritten.

- [ ] **Step 1: Replace fs sync imports with async**

In `src/terminal/native-loader.ts`, change the fs import:

```typescript
// Before:
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

// After:
import { access, readFile, writeFile, mkdir } from "fs/promises";
```

- [ ] **Step 2: Add async file existence helper**

Add below the import block:

```typescript
async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}
```

- [ ] **Step 3: Rewrite `loadNodePty()` with async I/O**

```typescript
export async function loadNodePty(pluginDir: string): Promise<NodePtyModule> {
	if (cachedModule) {
		return cachedModule;
	}

	const nativeDir = path.join(pluginDir, NATIVE_DIR_NAME);
	const triple = getPlatformTriple();
	const binaryPath = path.join(nativeDir, triple, BINARY_NAME);

	if (!(await fileExists(binaryPath))) {
		await downloadBinary(pluginDir, triple);
	}

	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const pty = require(binaryPath) as NodePtyModule;

	if (typeof pty.spawn !== "function") {
		throw new Error(
			"oterm: native module loaded but does not export spawn(). " +
			"The binary may be incompatible. Try reinstalling the plugin."
		);
	}

	cachedModule = pty;
	return pty;
}
```

- [ ] **Step 4: Rewrite `downloadBinary()` with mandatory checksums and async I/O**

```typescript
async function downloadBinary(
	pluginDir: string,
	triple: string
): Promise<void> {
	const notice = new Notice("oterm: downloading terminal binary...", 0);

	try {
		const version = await getPluginVersion(pluginDir);
		const assetName = `node-pty-${triple}.node`;
		const url = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}/${assetName}`;

		const checksumsPath = path.join(pluginDir, "checksums.json");
		if (!(await fileExists(checksumsPath))) {
			throw new Error(
				"oterm: checksums.json not found. " +
				"Cannot verify binary integrity. Reinstall the plugin."
			);
		}

		const checksums = JSON.parse(await readFile(checksumsPath, "utf-8"));
		const expectedHash = checksums[assetName];
		if (!expectedHash) {
			throw new Error(
				`oterm: no checksum entry for ${assetName} in checksums.json. ` +
				`Cannot verify binary integrity.`
			);
		}

		const data = await httpGet(url);

		const actualHash = createHash("sha256").update(data).digest("hex");
		if (actualHash !== expectedHash) {
			throw new Error(
				`oterm: checksum mismatch for ${assetName}. ` +
				`Expected ${expectedHash}, got ${actualHash}.`
			);
		}

		const nativeDir = path.join(pluginDir, NATIVE_DIR_NAME, triple);
		await mkdir(nativeDir, { recursive: true });
		await writeFile(path.join(nativeDir, BINARY_NAME), data);

		notice.setMessage("oterm: terminal binary installed.");
		setTimeout(() => notice.hide(), 3000);
	} catch (err) {
		notice.hide();
		const msg = err instanceof Error ? err.message : "unknown error";
		new Notice(`oterm: failed to download binary — ${msg}`, 10000);
		throw err;
	}
}
```

- [ ] **Step 5: Rewrite `getPluginVersion()` as async**

```typescript
async function getPluginVersion(pluginDir: string): Promise<string> {
	const manifestPath = path.join(pluginDir, "manifest.json");
	try {
		const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
		return manifest.version ?? "0.1.0";
	} catch {
		return "0.1.0";
	}
}
```

- [ ] **Step 6: Update `isBinaryInstalled()` to async**

```typescript
export async function isBinaryInstalled(pluginDir: string): Promise<boolean> {
	const triple = getPlatformTriple();
	return fileExists(
		path.join(pluginDir, NATIVE_DIR_NAME, triple, BINARY_NAME)
	);
}
```

- [ ] **Step 7: Build to verify**

Run: `npm run build`
Expected: Clean build. If `isBinaryInstalled` is called elsewhere, update callers to await it. Check with `grep -r "isBinaryInstalled" src/`.

- [ ] **Step 8: Commit**

```bash
git add src/terminal/native-loader.ts
git commit -m "security: make binary checksum verification mandatory, convert to async I/O"
```

---

### Task 5: Fix WSL Working Directory

**Files:**
- Modify: `src/utils/platform.ts:70-78` (`buildWSLCommand`)
- Modify: `src/terminal/pty-bridge.ts:89-106` (remove `resolveCwd` WSL branch, move `translateToWSLPath`)
- Modify: `src/terminal/terminal-view.ts:104-122` (`resolveShell`)

- [ ] **Step 1: Move `translateToWSLPath` to `platform.ts` and update `buildWSLCommand`**

Add `translateToWSLPath` to `src/utils/platform.ts` (move from pty-bridge.ts) and update `buildWSLCommand` to accept an optional `cwd`:

```typescript
export function translateToWSLPath(windowsPath: string): string {
	const match = windowsPath.match(/^([A-Za-z]):(.*)/);
	if (match) {
		const drive = match[1].toLowerCase();
		const rest = match[2].replace(/\\/g, "/");
		return `/mnt/${drive}${rest}`;
	}
	return windowsPath;
}

export function buildWSLCommand(
	distro?: string,
	cwd?: string
): ShellInfo {
	const args: string[] = [];
	if (cwd) {
		args.push("--cd", translateToWSLPath(cwd));
	}
	if (distro) {
		args.push("-d", distro);
	}
	return { shell: "wsl.exe", args };
}
```

- [ ] **Step 2: Remove WSL path translation from `pty-bridge.ts`**

In `src/terminal/pty-bridge.ts`, remove the `resolveCwd` function and the `translateToWSLPath` function. Replace `resolveCwd(options)` call with `options.cwd` directly:

Remove the `isWSLShell` import:

```typescript
// Before:
import { isWSLShell, IS_WIN } from "../utils/platform";

// After:
import { IS_WIN } from "../utils/platform";
```

Replace the cwd line in `ptyOptions`:

```typescript
// Before:
cwd: resolveCwd(options),

// After:
cwd: options.cwd,
```

Delete the `resolveCwd` function (lines 89-95) and `translateToWSLPath` function (lines 97-106) entirely.

- [ ] **Step 3: Update `resolveShell()` in `terminal-view.ts` to pass cwd to WSL**

In `src/terminal/terminal-view.ts`, update the WSL branch of `resolveShell()`. First update the import:

```typescript
// Before:
import { detectShell, buildWSLCommand, resolveDefaultCwd } from "../utils/platform";

// After:
import { detectShell, buildWSLCommand, resolveDefaultCwd, isWSLShell } from "../utils/platform";
```

Then refactor `createNewSession` and `resolveShell` so the cwd is available to the shell resolution:

```typescript
createNewSession(): void {
	if (!this.terminalArea || !this.ptyModule) return;

	const cwd = resolveDefaultCwd(
		this.plugin.settings.defaultCwd,
		this.getVaultPath()
	);
	const shellInfo = this.resolveShell(cwd);

	this.manager.createSession(this.terminalArea, {
		shell: shellInfo.shell,
		args: shellInfo.args,
		cwd,
		settings: this.plugin.settings,
		ptyModule: this.ptyModule,
	});
}

private resolveShell(cwd: string): { shell: string; args: string[] } {
	const settings = this.plugin.settings;

	if (settings.defaultShell === "auto") {
		return detectShell();
	}

	if (
		settings.defaultShell === "wsl" ||
		settings.defaultShell === "wsl.exe"
	) {
		return buildWSLCommand(undefined, cwd);
	}

	return {
		shell: settings.defaultShell,
		args: settings.shellArgs,
	};
}
```

- [ ] **Step 4: Build to verify**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/platform.ts src/terminal/pty-bridge.ts src/terminal/terminal-view.ts
git commit -m "fix: pass WSL cwd via --cd flag instead of translating spawn cwd"
```

---

### Task 6: Create Confirmation Modal

**Files:**
- Create: `src/ui/confirm-modal.ts`

- [ ] **Step 1: Create `src/ui/confirm-modal.ts`**

```typescript
import { App, Modal } from "obsidian";

export class ConfirmModal extends Modal {
	private resolved = false;
	private resolve: (value: boolean) => void = () => {};

	constructor(
		app: App,
		private title: string,
		private message: string
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h3", { text: this.title });
		contentEl.createEl("p", { text: this.message });

		const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });

		buttonRow
			.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => {
				this.resolved = true;
				this.resolve(false);
				this.close();
			});

		const confirmBtn = buttonRow.createEl("button", {
			text: "Close anyway",
			cls: "mod-warning",
		});
		confirmBtn.addEventListener("click", () => {
			this.resolved = true;
			this.resolve(true);
			this.close();
		});
	}

	onClose(): void {
		if (!this.resolved) {
			this.resolve(false);
		}
		this.contentEl.empty();
	}

	openAndWait(): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}
}
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Clean build (file is imported nowhere yet, but should compile without errors via esbuild's tree-shaking).

- [ ] **Step 3: Commit**

```bash
git add src/ui/confirm-modal.ts
git commit -m "feat: add ConfirmModal component for close warnings"
```

---

### Task 7: Add `hasRunningChildren` Utility

**Files:**
- Modify: `src/utils/platform.ts`

- [ ] **Step 1: Add `hasRunningChildren` function to `src/utils/platform.ts`**

Add the import at the top of the file:

```typescript
import { execFile } from "child_process";
```

Add the function at the bottom, before the `export { IS_WIN, IS_MAC };` line:

```typescript
export function hasRunningChildren(pid: number): Promise<boolean> {
	return new Promise((resolve) => {
		if (IS_WIN) {
			execFile(
				"powershell.exe",
				["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | Select-Object -First 1`],
				{ timeout: 3000 },
				(err, stdout) => {
					if (err) {
						resolve(false);
						return;
					}
					resolve(stdout.trim().length > 0);
				}
			);
		} else {
			execFile(
				"pgrep",
				["-P", String(pid)],
				{ timeout: 3000 },
				(err) => {
					// pgrep exits 0 if matches found, 1 if none
					resolve(err === null);
				}
			);
		}
	});
}
```

- [ ] **Step 2: Expose PID from `TerminalSession`**

In `src/terminal/terminal-session.ts`, add a getter for the PTY PID:

```typescript
getPid(): number | null {
	return this.ptyHandle?.pid ?? null;
}
```

Add this method to the `TerminalSession` class, after the `focus()` method (after line 125).

- [ ] **Step 3: Add `hasActiveProcesses` to `TerminalManager`**

In `src/terminal/terminal-manager.ts`, add the import:

```typescript
import { hasRunningChildren } from "../utils/platform";
```

Add this method to the `TerminalManager` class, after `fitActive()`:

```typescript
async hasActiveProcesses(): Promise<boolean> {
	for (const [, entry] of this.sessions) {
		const pid = entry.session.getPid();
		if (pid !== null && await hasRunningChildren(pid)) {
			return true;
		}
	}
	return false;
}

async sessionHasActiveProcess(id: string): Promise<boolean> {
	const entry = this.sessions.get(id);
	if (!entry) return false;
	const pid = entry.session.getPid();
	if (pid === null) return false;
	return hasRunningChildren(pid);
}
```

- [ ] **Step 4: Build to verify**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/platform.ts src/terminal/terminal-session.ts src/terminal/terminal-manager.ts
git commit -m "feat: add child process detection for session close warnings"
```

---

### Task 8: Wire Close Warning Into Terminal View

**Files:**
- Modify: `src/terminal/terminal-view.ts:72-79` (`onClose`)
- Modify: `src/ui/tab-bar.ts:69-72` (close button handler)

- [ ] **Step 1: Update `onClose()` in `terminal-view.ts`**

Add the import:

```typescript
import { ConfirmModal } from "../ui/confirm-modal";
```

Replace the `onClose` method:

```typescript
async onClose(): Promise<void> {
	const hasActive = await this.manager.hasActiveProcesses();
	if (hasActive) {
		const confirmed = await new ConfirmModal(
			this.app,
			"Close terminal?",
			"One or more terminal sessions have running processes. Closing will terminate them."
		).openAndWait();

		if (!confirmed) return;
	}

	this.resizeObserver?.disconnect();
	this.resizeObserver = null;
	this.searchBar?.destroy();
	this.searchBar = null;
	this.tabBar?.destroy();
	this.tabBar = null;
	this.manager.closeAll();
}
```

- [ ] **Step 2: Update tab close button in `tab-bar.ts`**

In `src/ui/tab-bar.ts`, the close button click handler needs to check for active processes before closing. Update the import:

```typescript
import { setIcon, Notice } from "obsidian";
```

Replace the close button handler in `renderTab` (the `closeBtn.addEventListener` block):

```typescript
if (this.manager.count() > 1) {
	const closeBtn = tabEl.createSpan({ cls: "oterm-tab-close" });
	setIcon(closeBtn, "x");
	closeBtn.addEventListener("click", async (e) => {
		e.stopPropagation();
		const hasActive = await this.manager.sessionHasActiveProcess(entry.id);
		if (hasActive) {
			new Notice(
				"oterm: session has running processes — closing anyway.",
				3000
			);
		}
		this.manager.closeSession(entry.id);
	});
}
```

Note: For individual tab close we use a Notice rather than a blocking modal. This is a deliberate UX choice — the modal is for closing ALL sessions (view close), while individual tab close gets a non-blocking warning. The user explicitly clicked the X on a specific tab, so intent is clearer.

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/terminal/terminal-view.ts src/ui/tab-bar.ts
git commit -m "feat: warn before closing terminal sessions with running processes"
```
