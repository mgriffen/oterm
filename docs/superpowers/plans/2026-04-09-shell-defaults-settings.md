# Shell Defaults & Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded shell presets with a data-driven registry, add shell validation with clear error messages, and support Windows/macOS/Linux out of the box.

**Architecture:** New `shell-registry.ts` defines all shell presets as data objects with detect/validate functions. Settings tab renders from the registry. Terminal view resolves shells via registry lookup and validates before spawning.

**Tech Stack:** TypeScript, Obsidian API, esbuild, node-pty

**Spec:** `docs/superpowers/specs/2026-04-09-shell-defaults-settings-design.md`

---

### Task 1: Create Shell Preset Registry

**Files:**
- Create: `src/terminal/shell-registry.ts`
- Modify: `src/utils/platform.ts` (export `canResolveShell`)

- [ ] **Step 1: Export `canResolveShell` from platform.ts**

In `src/utils/platform.ts`, change the existing `canResolveShell` function from a private function to an exported function:

```typescript
export function canResolveShell(shell: string): boolean {
```

No other changes to the function body. It's currently used internally by `detectWindowsShell` and `detectUnixShell` — those still work since the function stays in the same file.

- [ ] **Step 2: Create `src/terminal/shell-registry.ts`**

```typescript
import { existsSync } from "fs";
import * as path from "path";
import { IS_WIN, canResolveShell, isWSLShell, buildWSLCommand } from "../utils/platform";

export interface ShellPreset {
  id: string;
  name: string;
  category: "system" | "ai";
  platforms: ("win32" | "darwin" | "linux")[];
  shell: string;
  args: string[];
  detect: () => boolean;
  buildCommand?: (cwd: string) => { shell: string; args: string[] };
}

export interface ShellValidationResult {
  valid: boolean;
  error?: string;
}

const PRESETS: ShellPreset[] = [
  // ── Windows ──
  {
    id: "wsl-ubuntu",
    name: "WSL (Ubuntu)",
    category: "system",
    platforms: ["win32"],
    shell: "wsl.exe",
    args: [],
    detect: () => canResolveShell("wsl.exe"),
    buildCommand: (cwd: string) => buildWSLCommand(undefined, cwd),
  },
  {
    id: "pwsh",
    name: "PowerShell 7",
    category: "system",
    platforms: ["win32"],
    shell: "pwsh.exe",
    args: [],
    detect: () => {
      const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
      const fullPath = path.join(programFiles, "PowerShell", "7", "pwsh.exe");
      return existsSync(fullPath) || canResolveShell("pwsh.exe");
    },
  },
  {
    id: "powershell",
    name: "Windows PowerShell",
    category: "system",
    platforms: ["win32"],
    shell: "powershell.exe",
    args: [],
    detect: () => true, // Always available on Windows
  },
  {
    id: "cmd",
    name: "CMD",
    category: "system",
    platforms: ["win32"],
    shell: "cmd.exe",
    args: [],
    detect: () => true, // Always available on Windows
  },
  {
    id: "git-bash",
    name: "Git Bash",
    category: "system",
    platforms: ["win32"],
    shell: "bash.exe",
    args: [],
    detect: () => {
      const gitPaths = [
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
      ];
      return gitPaths.some((p) => existsSync(p)) || canResolveShell("bash.exe");
    },
    buildCommand: (cwd: string) => {
      const gitPaths = [
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
      ];
      const found = gitPaths.find((p) => existsSync(p));
      return { shell: found ?? "bash.exe", args: [] };
    },
  },
  // ── macOS / Linux ──
  {
    id: "zsh",
    name: "zsh",
    category: "system",
    platforms: ["darwin", "linux"],
    shell: "/bin/zsh",
    args: [],
    detect: () => existsSync("/bin/zsh") || existsSync("/usr/bin/zsh"),
  },
  {
    id: "bash",
    name: "bash",
    category: "system",
    platforms: ["darwin", "linux"],
    shell: "/bin/bash",
    args: [],
    detect: () => existsSync("/bin/bash"),
  },
  {
    id: "sh",
    name: "sh",
    category: "system",
    platforms: ["darwin", "linux"],
    shell: "/bin/sh",
    args: [],
    detect: () => existsSync("/bin/sh"),
  },
  // ── AI Tools (empty for v1) ──
];

const platform = process.platform as "win32" | "darwin" | "linux";

export function getPresetsForPlatform(): ShellPreset[] {
  return PRESETS.filter((p) => p.platforms.includes(platform));
}

export function getPresetById(id: string): ShellPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function autoDetect(): ShellPreset | null {
  // On Unix, check $SHELL first — it may match a preset
  if (!IS_WIN) {
    const userShell = process.env["SHELL"];
    if (userShell) {
      const shellName = path.basename(userShell);
      const match = PRESETS.find(
        (p) => p.platforms.includes(platform) && path.basename(p.shell) === shellName
      );
      if (match) return match;
      // $SHELL exists but doesn't match a preset — still valid
      // Return a synthetic preset for it
      if (existsSync(userShell)) {
        return {
          id: "_env_shell",
          name: path.basename(userShell),
          category: "system",
          platforms: [platform],
          shell: userShell,
          args: [],
          detect: () => true,
        };
      }
    }
  }

  // Walk presets in order, return first detected
  const platformPresets = getPresetsForPlatform();
  for (const preset of platformPresets) {
    if (preset.detect()) return preset;
  }
  return null;
}

export function validateShell(
  idOrPath: string
): ShellValidationResult {
  if (idOrPath === "auto") {
    const detected = autoDetect();
    if (detected) return { valid: true };
    return { valid: false, error: "No supported shell found. Set a shell manually in Settings → oterm." };
  }

  const preset = getPresetById(idOrPath);
  if (preset) {
    if (preset.detect()) return { valid: true };
    return {
      valid: false,
      error: `${preset.name} not found. Check that it is installed, or change your shell in Settings → oterm.`,
    };
  }

  // Custom shell path
  if (canResolveShell(idOrPath)) return { valid: true };
  return {
    valid: false,
    error: `Shell not found at ${idOrPath}. Check the path in Settings → oterm.`,
  };
}

export function resolveShellCommand(
  idOrPath: string,
  shellArgs: string[],
  cwd: string
): { shell: string; args: string[] } {
  if (idOrPath === "auto") {
    const detected = autoDetect();
    if (!detected) throw new Error("No supported shell found.");
    if (detected.buildCommand) return detected.buildCommand(cwd);
    if (isWSLShell(detected.shell)) return buildWSLCommand(undefined, cwd);
    return { shell: detected.shell, args: detected.args };
  }

  const preset = getPresetById(idOrPath);
  if (preset) {
    if (preset.buildCommand) return preset.buildCommand(cwd);
    if (isWSLShell(preset.shell)) return buildWSLCommand(undefined, cwd);
    return { shell: preset.shell, args: preset.args };
  }

  // Custom shell path
  if (isWSLShell(idOrPath)) return buildWSLCommand(undefined, cwd);
  return { shell: idOrPath, args: shellArgs };
}
```

- [ ] **Step 3: Verify build**

Run: `cd /home/griffen/projects/oterm && node esbuild.config.mjs production`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/terminal/shell-registry.ts src/utils/platform.ts
git commit -m "feat: add shell preset registry with platform detection and validation"
```

---

### Task 2: Update Settings Tab to Use Registry

**Files:**
- Modify: `src/settings-tab.ts`

- [ ] **Step 1: Rewrite settings-tab.ts to use registry**

Replace the entire contents of `src/settings-tab.ts`:

```typescript
import { App, PluginSettingTab, Setting } from "obsidian";
import type OtermPlugin from "./main";
import { getPresetsForPlatform, getPresetById, validateShell } from "./terminal/shell-registry";

export class OtermSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: OtermPlugin
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "oterm" });
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Full terminal emulator for Obsidian.",
		});

		// Shell selection
		const shellSetting = new Setting(containerEl)
			.setName("Default shell")
			.setDesc("Shell to launch when opening a terminal.");

		const presets = getPresetsForPlatform();
		const systemPresets = presets.filter((p) => p.category === "system");
		const aiPresets = presets.filter((p) => p.category === "ai");

		const currentShell = this.plugin.settings.defaultShell;
		const isPreset =
			currentShell === "auto" ||
			presets.some((p) => p.id === currentShell);

		// Detection status indicator
		const statusEl = containerEl.createSpan({ cls: "oterm-shell-status" });
		this.updateShellStatus(statusEl, currentShell);

		shellSetting.addDropdown((dropdown) => {
			dropdown.addOption("auto", "Auto-detect (recommended)");

			// System Shells group
			if (systemPresets.length > 0) {
				dropdown.addOption("_sep_system", "── System Shells ──");
				for (const preset of systemPresets) {
					dropdown.addOption(preset.id, preset.name);
				}
			}

			// AI Tools group
			if (aiPresets.length > 0) {
				dropdown.addOption("_sep_ai", "── AI Tools ──");
				for (const preset of aiPresets) {
					dropdown.addOption(preset.id, preset.name);
				}
			}

			dropdown.addOption("custom", "Custom...");

			dropdown.setValue(isPreset ? currentShell : "custom");
			dropdown.onChange(async (value) => {
				// Ignore separator selections
				if (value.startsWith("_sep_")) {
					dropdown.setValue(currentShell);
					return;
				}
				if (value !== "custom") {
					this.plugin.settings.defaultShell = value;
					await this.plugin.saveSettings();
					customShellInput.settingEl.toggle(false);
				} else {
					customShellInput.settingEl.toggle(true);
				}
				this.updateShellStatus(statusEl, value);
			});
		});

		const customShellInput = new Setting(containerEl)
			.setName("Custom shell path")
			.setDesc("Full path to shell executable.")
			.addText((text) =>
				text
					.setPlaceholder("/usr/bin/zsh")
					.setValue(
						isPreset ? "" : this.plugin.settings.defaultShell
					)
					.onChange(async (value) => {
						this.plugin.settings.defaultShell = value;
						await this.plugin.saveSettings();
						this.updateShellStatus(statusEl, value);
					})
			);
		customShellInput.settingEl.toggle(!isPreset);

		// Working directory
		new Setting(containerEl)
			.setName("Default working directory")
			.setDesc("Where the terminal starts.")
			.addDropdown((dropdown) => {
				dropdown.addOption("vault", "Vault root");
				dropdown.addOption("home", "Home directory");
				dropdown.setValue(
					this.plugin.settings.defaultCwd === "vault" ||
						this.plugin.settings.defaultCwd === "home"
						? this.plugin.settings.defaultCwd
						: "home"
				);
				dropdown.onChange(async (value) => {
					this.plugin.settings.defaultCwd = value;
					await this.plugin.saveSettings();
				});
			});

		// Open location
		new Setting(containerEl)
			.setName("Open location")
			.setDesc("Where new terminals appear.")
			.addDropdown((dropdown) => {
				dropdown.addOption("right", "Right sidebar");
				dropdown.addOption("bottom", "Bottom panel");
				dropdown.addOption("tab", "Editor tab");
				dropdown.setValue(this.plugin.settings.openLocation);
				dropdown.onChange(async (value: "bottom" | "right" | "tab") => {
					this.plugin.settings.openLocation = value;
					await this.plugin.saveSettings();
				});
			});

		containerEl.createEl("h2", { text: "Appearance" });

		// Font family
		new Setting(containerEl)
			.setName("Font family")
			.setDesc(
				"Use a Nerd Font (e.g. MesloLGS NF) for powerlevel10k support."
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.fontFamily)
					.onChange(async (value) => {
						this.plugin.settings.fontFamily = value;
						await this.plugin.saveSettings();
					})
			);

		// Font size
		new Setting(containerEl)
			.setName("Font size")
			.addSlider((slider) =>
				slider
					.setLimits(8, 32, 1)
					.setValue(this.plugin.settings.fontSize)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.fontSize = value;
						await this.plugin.saveSettings();
					})
			);

		// Cursor style
		new Setting(containerEl)
			.setName("Cursor style")
			.addDropdown((dropdown) => {
				dropdown.addOption("block", "Block");
				dropdown.addOption("underline", "Underline");
				dropdown.addOption("bar", "Bar");
				dropdown.setValue(this.plugin.settings.cursorStyle);
				dropdown.onChange(
					async (value: "block" | "underline" | "bar") => {
						this.plugin.settings.cursorStyle = value;
						await this.plugin.saveSettings();
					}
				);
			});

		// Cursor blink
		new Setting(containerEl)
			.setName("Cursor blink")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.cursorBlink)
					.onChange(async (value) => {
						this.plugin.settings.cursorBlink = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h2", { text: "Advanced" });

		// Scrollback
		new Setting(containerEl)
			.setName("Scrollback lines")
			.setDesc("Number of lines kept in the scrollback buffer.")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.scrollback))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.scrollback = num;
							await this.plugin.saveSettings();
						}
					})
			);

		// WebGL rendering
		new Setting(containerEl)
			.setName("GPU-accelerated rendering")
			.setDesc(
				"Uses WebGL for faster terminal rendering. Disable if you see visual glitches."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useWebGL)
					.onChange(async (value) => {
						this.plugin.settings.useWebGL = value;
						await this.plugin.saveSettings();
					})
			);

		// Copy on select
		new Setting(containerEl)
			.setName("Copy on select")
			.setDesc("Automatically copy selected text to clipboard.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.copyOnSelect)
					.onChange(async (value) => {
						this.plugin.settings.copyOnSelect = value;
						await this.plugin.saveSettings();
					})
			);
	}

	private updateShellStatus(el: HTMLSpanElement, shellId: string): void {
		if (shellId === "custom" || shellId.startsWith("_sep_")) {
			el.setText("");
			return;
		}
		const result = validateShell(shellId);
		if (result.valid) {
			el.setText("✓ Detected");
			el.className = "oterm-shell-status oterm-shell-detected";
		} else {
			el.setText("⚠ Not found");
			el.className = "oterm-shell-status oterm-shell-missing";
		}
	}
}
```

- [ ] **Step 2: Verify build**

Run: `cd /home/griffen/projects/oterm && node esbuild.config.mjs production`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/settings-tab.ts
git commit -m "feat: rewrite settings tab to use shell preset registry with categorized dropdown"
```

---

### Task 3: Update Terminal View to Use Registry + Validation

**Files:**
- Modify: `src/terminal/terminal-view.ts`

- [ ] **Step 1: Replace resolveShell with registry-based resolution and validation**

In `src/terminal/terminal-view.ts`, replace the imports:

Old:
```typescript
import { detectShell, buildWSLCommand, resolveDefaultCwd, isWSLShell } from "../utils/platform";
```

New:
```typescript
import { resolveDefaultCwd } from "../utils/platform";
import { validateShell, resolveShellCommand } from "./shell-registry";
```

- [ ] **Step 2: Update `createNewSession` to validate before spawning**

Replace the `createNewSession` method:

Old:
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
```

New:
```typescript
	createNewSession(): void {
		if (!this.terminalArea || !this.ptyModule) return;

		const cwd = resolveDefaultCwd(
			this.plugin.settings.defaultCwd,
			this.getVaultPath()
		);

		const validation = validateShell(this.plugin.settings.defaultShell);
		if (!validation.valid) {
			new Notice(`oterm: ${validation.error}`, 10000);
			return;
		}

		const shellInfo = resolveShellCommand(
			this.plugin.settings.defaultShell,
			this.plugin.settings.shellArgs,
			cwd
		);

		this.manager.createSession(this.terminalArea, {
			shell: shellInfo.shell,
			args: shellInfo.args,
			cwd,
			settings: this.plugin.settings,
			ptyModule: this.ptyModule,
		});
	}
```

- [ ] **Step 3: Remove the private `resolveShell` method**

Delete the entire `resolveShell` method (lines 109-131 of the current file):

```typescript
	// DELETE this entire method — replaced by shell-registry.ts
	private resolveShell(cwd: string): { shell: string; args: string[] } {
		...
	}
```

- [ ] **Step 4: Verify build**

Run: `cd /home/griffen/projects/oterm && node esbuild.config.mjs production`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/terminal/terminal-view.ts
git commit -m "feat: use shell registry for resolution and validate before spawn"
```

---

### Task 4: Clean Up Dead Code in platform.ts

**Files:**
- Modify: `src/utils/platform.ts`

After the registry replaces the old detection flow, the top-level `detectShell` function and its private helpers (`detectWindowsShell`, `detectUnixShell`) are no longer called from anywhere. The shell cache (`cachedShell`) is also unused.

- [ ] **Step 1: Remove unused functions**

In `src/utils/platform.ts`, delete the following:
- The `ShellInfo` interface (lines 9-12)
- The `cachedShell` variable (line 14)
- The `detectShell` function (lines 16-25)
- The `detectWindowsShell` function (lines 27-51)
- The `detectUnixShell` function (lines 53-66)

Keep everything else: `canResolveShell` (now exported), `isWSLShell`, `translateToWSLPath`, `buildWSLCommand`, `resolveDefaultCwd`, `getPlatformTriple`, `hasRunningChildren`, `IS_WIN`, `IS_MAC`.

The file should now look like:

```typescript
import * as os from "os";
import * as path from "path";
import { existsSync } from "fs";
import { execFile } from "child_process";

const IS_WIN = os.platform() === "win32";
const IS_MAC = os.platform() === "darwin";

export function canResolveShell(shell: string): boolean {
	if (path.isAbsolute(shell)) {
		return existsSync(shell);
	}
	const pathDirs = (process.env["PATH"] ?? "").split(path.delimiter);
	return pathDirs.some((dir) => existsSync(path.join(dir, shell)));
}

export function isWSLShell(shell: string): boolean {
	const basename = path.basename(shell).toLowerCase();
	return basename === "wsl.exe" || basename === "wsl";
}

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
): { shell: string; args: string[] } {
	const args: string[] = [];
	if (cwd) {
		args.push("--cd", translateToWSLPath(cwd));
	}
	if (distro) {
		args.push("-d", distro);
	}
	return { shell: "wsl.exe", args };
}

export function resolveDefaultCwd(
	mode: "vault" | "home" | string,
	vaultPath: string
): string {
	switch (mode) {
		case "vault":
			return vaultPath;
		case "home":
			return os.homedir();
		default:
			return existsSync(mode) ? mode : os.homedir();
	}
}

export function getPlatformTriple(): string {
	const platform = os.platform();
	const arch = os.arch();
	return `${platform}-${arch}`;
}

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
					resolve(err === null);
				}
			);
		}
	});
}

export { IS_WIN, IS_MAC };
```

- [ ] **Step 2: Verify no other imports of `detectShell`**

Search the codebase for any remaining imports of `detectShell`. There should be none — `terminal-view.ts` was updated in Task 3 to import from `shell-registry` instead.

Run: `grep -r "detectShell" src/`
Expected: No matches.

- [ ] **Step 3: Verify build**

Run: `cd /home/griffen/projects/oterm && node esbuild.config.mjs production`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/utils/platform.ts
git commit -m "refactor: remove dead shell detection code replaced by registry"
```

---

### Task 5: Manual Verification in Obsidian

**Files:** None (manual test)

- [ ] **Step 1: Build and install**

Run: `cd /home/griffen/projects/oterm && bash scripts/dev-install.sh`
Expected: Plugin builds and copies to vault plugins directory.

- [ ] **Step 2: Reload Obsidian and verify settings tab**

Open Obsidian → Settings → oterm. Verify:
- Dropdown shows "Auto-detect (recommended)" selected by default
- "── System Shells ──" separator visible
- WSL (Ubuntu), PowerShell 7, Windows PowerShell, CMD, Git Bash listed (on Windows)
- "── AI Tools ──" separator visible (empty group for now)
- "Custom..." option at bottom
- Detection status indicator shows "✓ Detected" for the selected shell
- Selecting a shell that's not installed shows "⚠ Not found"
- Selecting "Custom..." reveals the text input
- All other settings (font, cursor, scrollback, etc.) unchanged

- [ ] **Step 3: Verify terminal opens with auto-detect**

Open terminal via sidebar icon. Verify it launches the correct shell (WSL on Windows, user's default shell on Unix).

- [ ] **Step 4: Verify validation error**

Temporarily change `defaultShell` in plugin settings data to a nonexistent shell (e.g., `"nonexistent"`). Open a new terminal tab. Verify:
- Terminal does NOT open
- An Obsidian notice appears: "oterm: Shell not found at nonexistent. Check the path in Settings → oterm."

Reset the setting back to `"auto"` after testing.

- [ ] **Step 5: Commit final state**

If any fixes were needed during manual testing, commit them:
```bash
git add -A
git commit -m "fix: address issues found during manual verification"
```
