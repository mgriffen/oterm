# Sub-Project 2: Shell Defaults & Settings

**Date:** 2026-04-09
**Status:** Approved
**Goal:** Harden shell detection and settings for community release across Windows, macOS, and Linux.

## Audience

Obsidian users who want an in-context terminal — primarily Claude Code users who don't want to switch to VS Code or a standalone terminal. Technical enough to have CLI tools installed, but not necessarily terminal power users.

## Scope

1. Data-driven shell preset registry with platform filtering and detection
2. Categorized dropdown in settings (System Shells / AI Tools)
3. Shell validation with clear error messages on failure (no silent fallback)
4. Cross-platform support: Windows, macOS, Linux

Out of scope: AI tool presets (Claude Code, Codex), startup commands, terminal theme selection. These are future sub-projects that the registry architecture is designed to accommodate.

## Design

### Shell Preset Registry

New file: `src/terminal/shell-registry.ts`

Each preset is a data object:

```typescript
interface ShellPreset {
  id: string;                          // "wsl-ubuntu", "pwsh", "zsh", etc.
  name: string;                        // Display name: "WSL (Ubuntu)"
  category: "system" | "ai";           // Groups in dropdown
  platforms: ("win32" | "darwin" | "linux")[];
  shell: string;                       // Executable: "wsl.exe", "/bin/zsh"
  args: string[];                      // Default args
  detect: () => boolean;               // Can this shell be found right now?
  buildCommand?: (cwd: string) => { shell: string; args: string[] };
}
```

#### Initial Presets

| Category | ID | Name | Platforms | Shell | Detect Logic |
|---|---|---|---|---|---|
| system | `zsh` | zsh | mac, linux | `/bin/zsh` or `$SHELL` | Check `$SHELL` or `/bin/zsh` exists |
| system | `bash` | bash | mac, linux | `/bin/bash` | `/bin/bash` exists |
| system | `sh` | sh | mac, linux | `/bin/sh` | `/bin/sh` exists |
| system | `pwsh` | PowerShell 7 | win | `pwsh.exe` | Check Program Files or PATH |
| system | `powershell` | Windows PowerShell | win | `powershell.exe` | Always available on Windows |
| system | `cmd` | CMD | win | `cmd.exe` | Always available on Windows |
| system | `wsl-ubuntu` | WSL (Ubuntu) | win | `wsl.exe` | `wsl.exe` in PATH |
| system | `git-bash` | Git Bash | win | `bash.exe` | Check common Git Bash install paths |

The AI Tools category is empty for v1 — reserved for future Claude Code / Codex entries.

#### Registry API

- `getPresetsForPlatform()` — returns presets filtered to current OS
- `getPresetById(id)` — lookup by ID
- `autoDetect()` — walks presets in priority order, returns first where `detect()` is true
- `validateShell(id | customPath)` — checks if shell is available, returns `{ valid: boolean; error?: string }`

#### Auto-Detect Priority

- **Windows:** wsl-ubuntu → pwsh → powershell → cmd
- **macOS/Linux:** `$SHELL` env var → zsh → bash → sh

### Settings Tab — Categorized Dropdown

The dropdown renders from the registry, filtered by current platform:

```
Shell
├─ Auto-detect (recommended)
├─ ── System Shells ──
│   ├─ WSL (Ubuntu)          ← Windows only
│   ├─ PowerShell 7          ← Windows only
│   ├─ Windows PowerShell    ← Windows only
│   ├─ CMD                   ← Windows only
│   ├─ Git Bash              ← Windows only
│   ├─ zsh                   ← macOS/Linux only
│   ├─ bash                  ← macOS/Linux only
│   └─ sh                    ← macOS/Linux only
├─ ── AI Tools ──
│   └─ (empty for v1)
└─ Custom...
```

- Selecting a preset hides the shell args field (preset handles args)
- Selecting "Custom..." shows shell path + args text inputs
- Detection status indicator (checkmark/warning) next to dropdown shows whether selected shell is available

`defaultShell` in settings stores a preset ID string (`"auto"`, `"zsh"`, `"wsl-ubuntu"`, `"custom"`, etc.). No interface shape change needed.

### Shell Validation & Error Handling

**Validation point:** Before `ptyModule.spawn()` in terminal-view's `resolveShell()`.

**On failure — no fallback.** Terminal does not open. An Obsidian `Notice` shows a specific message:

- Preset shell: *"WSL (Ubuntu) not found. Check that WSL is installed, or change your shell in Settings → oterm."*
- Custom shell: *"Shell not found at /path/to/shell. Check the path in Settings → oterm."*
- Auto-detect exhausted: *"No supported shell found. Set a shell manually in Settings → oterm."*

### Files Changed

**New:**
- `src/terminal/shell-registry.ts` — preset definitions, registry API, detect/validate functions

**Modified:**
- `src/settings.ts` — no shape change; `defaultShell` stores preset IDs
- `src/settings-tab.ts` — rewrite dropdown to render from registry; add detection indicator
- `src/terminal/terminal-view.ts` — `resolveShell()` uses registry lookup; adds validation before spawn
- `src/utils/platform.ts` — existing helpers (`canResolveShell`, `isWSLShell`, `translateToWSLPath`, `buildWSLCommand`) stay; top-level `detectShell()` replaced by registry auto-detect

**Untouched:**
- `pty-bridge.ts`, `terminal-session.ts`, `terminal-manager.ts`, `tab-bar.ts`, `search-bar.ts`, `native-loader.ts`, `addons.ts`, `constants.ts`, `main.ts`
