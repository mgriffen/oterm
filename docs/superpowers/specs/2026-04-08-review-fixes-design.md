# oterm Review Fixes Design

Post-review fixes addressing findings from Codex adversarial review and superpowers code review. All changes target the existing Phase 2 codebase without introducing new features.

## Fix 1: Mandatory Binary Integrity Verification

**File:** `src/terminal/native-loader.ts`

**Problem:** Downloaded `.node` binaries are `require()`d at runtime. Checksum verification is optional — gated behind `if (existsSync(checksumsPath))`. A missing checksums file means zero integrity enforcement before executing native code inside Obsidian.

**Design:**

- Make `checksums.json` a required plugin artifact, shipped alongside `manifest.json` in every release.
- Remove the `existsSync(checksumsPath)` guard. If the file is missing, throw with a clear error message telling the user to reinstall the plugin.
- If the downloaded asset's key is missing from the checksums map, throw — do not silently skip verification.
- If the hash doesn't match, delete the downloaded file and throw.
- The `checksums.json` file format stays the same: `{ "node-pty-<triple>.node": "<sha256-hex>" }`.

**Affected code:**
- `downloadBinary()` lines 60-76 — remove existence guard, make both lookups throw on miss.
- Add cleanup (delete partial file) on checksum mismatch.

## Fix 2: WSL Working Directory

**Files:** `src/terminal/pty-bridge.ts`, `src/utils/platform.ts`

**Problem:** `resolveCwd()` translates Windows paths to Linux mount paths (`C:\...` to `/mnt/c/...`) for WSL shells, then passes the translated path as the PTY spawn `cwd`. But `wsl.exe` launches as a Windows process — the OS needs a valid Windows path for process creation. The `/mnt/c/...` path is only valid inside the Linux guest.

**Design:**

- `resolveCwd()` no longer translates paths for WSL. It always returns the original Windows cwd so the process spawn succeeds.
- Move the path translation to arg construction. `buildWSLCommand()` in `platform.ts` gains an optional `cwd` parameter. When provided, it prepends `--cd <translated-linux-path>` to the WSL args using the existing `translateToWSLPath()` function.
- `translateToWSLPath()` moves from `pty-bridge.ts` to `platform.ts` (it's a platform utility, not a PTY concern). Export it for testability.
- `terminal-view.ts` passes the resolved cwd to `buildWSLCommand()` when the shell is WSL.

**Flow after fix:**
1. `resolveShell()` detects WSL, calls `buildWSLCommand(cwd)` which returns `{ shell: "wsl.exe", args: ["--cd", "/mnt/c/Users/foo"] }`.
2. `spawnPty()` receives a valid Windows cwd and the `--cd` arg handles the Linux guest directory.

## Fix 3: Session Close Warning

**Files:** `src/terminal/terminal-view.ts`, `src/utils/platform.ts`, new file `src/ui/confirm-modal.ts`

**Problem:** `dispose()` unconditionally calls `kill()` on the PTY. Closing the pane or unloading the plugin silently terminates all running processes with no confirmation.

**Design:**

- Add `hasRunningChildren(pid: number): Promise<boolean>` to `platform.ts`.
  - Unix: `pgrep -P <pid>` — exit code 0 means children exist.
  - Windows: `wmic process where (ParentProcessId=<pid>) get ProcessId` or PowerShell equivalent.
  - Returns `false` on any error (fail-open — don't block close if the check fails).
- Add `ConfirmModal` extending Obsidian's `Modal` class in `src/ui/confirm-modal.ts`. Simple title + message + Confirm/Cancel buttons, returns a Promise<boolean>.
- `TerminalView.onClose()` becomes async-aware:
  1. Check each session for running children via `hasRunningChildren(session.ptyHandle.pid)`.
  2. If any session has active children, show `ConfirmModal` with a message like "N terminal session(s) have running processes. Close anyway?"
  3. If user confirms (or no children found), proceed with `manager.closeAll()`.
  4. If user cancels, abort the close.
- **Obsidian limitation:** `onClose()` is called after the leaf is already detaching — it cannot be cancelled. Therefore, the confirmation check runs at the point of user action that triggers close, not in `onClose()` itself. For the tab close button, intercept the click handler in `tab-bar.ts`. For pane close (X button on the leaf), use Obsidian's `workspace.on('layout-change')` or `before:` event if available; if no pre-close hook exists, degrade to a warning Notice shown during `onClose()` (informational, not blocking).
- `onunload()` (plugin disable / app quit) skips the check and kills immediately.
- Individual `closeSession()` via tab close button: check runs before calling `manager.closeSession()`, same modal.

**Scope boundary:** This is a best-effort warning. Full session persistence/reconnect is deferred to Phase 4 (addon-serialize work).

## Fix 4: Validate Native Module Loading Path

**File:** `src/terminal/native-loader.ts`

**Problem:** `require(binaryPath)` on a bare `.node` file may not produce the node-pty JS API. The `.node` file is a native C++ addon — it may export raw bindings rather than the `spawn()` function the codebase expects.

**Design:**

- After `require(binaryPath)`, validate that the loaded module has a `spawn` function: `if (typeof pty.spawn !== 'function') throw new Error(...)`.
- If validation fails, this means the binary distribution strategy needs a JS shim. In that case, ship a small `node-pty-shim.js` alongside the `.node` binary that loads the native binding and re-exports the expected API. The loader would then `require()` the shim instead of the binary directly.
- The shim approach is a fallback — implement the validation check first, test with an actual built binary, and only add the shim if needed.

## Fix 5: Add node-pty as devDependency

**File:** `package.json`

Add `node-pty` as a `devDependency` for type information during development. It's already externalized in the esbuild config so it won't be bundled.

## Fix 6: Convert Sync I/O to Async on Startup Path

**File:** `src/terminal/native-loader.ts`

**Problem:** `existsSync`, `readFileSync`, `mkdirSync`, `writeFileSync` block the renderer thread during `onOpen()`.

**Design:**

- Replace with `fs.promises` equivalents: `access()` (for existence), `readFile()`, `mkdir()`, `writeFile()`.
- `loadNodePty()` is already async, so the callers don't change.
- `getPluginVersion()` becomes async.
- `downloadBinary()` is already async.

**Not converting:** `existsSync` calls in `platform.ts` (`detectShell`, `canResolveShell`, `resolveDefaultCwd`) — these run once per session creation and are fast local stat calls. Converting them adds complexity for negligible gain, especially once shell detection is cached (Fix 7).

## Fix 7: Cache Shell Detection

**File:** `src/utils/platform.ts`

**Problem:** `detectShell()` does filesystem existence checks on every `createNewSession()`. The result is deterministic for the process lifetime.

**Design:**

- Add a module-level `let cachedShell: ShellInfo | null = null` in `platform.ts`.
- `detectShell()` checks the cache before doing any work.
- The cache is never invalidated — shell availability doesn't change during a single Obsidian session.

## Fix 8: Extract Terminal String Constants

**File:** `src/constants.ts`, `src/terminal/pty-bridge.ts`, `src/terminal/terminal-session.ts`

**Problem:** `"xterm-256color"` and `"truecolor"` appear as raw strings in both `pty-bridge.ts` and the terminal session options.

**Design:**

- Add `TERM_TYPE = "xterm-256color"` and `COLOR_TERM = "truecolor"` to `constants.ts`.
- Replace raw strings in `pty-bridge.ts` and `terminal-session.ts` (the `name` field in pty options and the `env` assignments).
