# oterm

> [!WARNING]
> **oterm is no longer maintained, and has been removed from the Obsidian community store.**
>
> If you already have it installed it will keep working — nothing is being taken away from you — but it will receive no further updates, fixes, or compatibility work.
>
> **Please switch to one of these instead. Both are actively maintained and do more than oterm ever did.**
>
> | If you want… | Use | |
> |---|---|---|
> | A terminal inside Obsidian | **[Lean Terminal](https://github.com/sdkasper/lean-obsidian-terminal)** | Same xterm.js + node-pty foundation, plus session persistence, themes, tab management, vault integration, and startup commands |
> | To run Claude Code, Codex or Gemini CLI in your vault | **[Agent Client](https://github.com/RAIT-09/obsidian-agent-client)** | Full ACP client with note mentions, permission prompts, and multi-agent sessions |
>
> Thanks to everyone who installed it. — [@mgriffen](https://github.com/mgriffen)

---

## What this was

A full terminal emulator for Obsidian, powered by the same technology as VS Code's terminal (xterm.js + node-pty). It supported PowerShell, WSL, zsh, oh-my-zsh, tmux, powerlevel10k, and rich CLI tools.

It was built over ten days in April 2026, published to the community store, and then — honestly — forgotten about. By the time I looked again, [Lean Terminal](https://github.com/sdkasper/lean-obsidian-terminal) had been started two weeks *earlier* on the same stack and had gone considerably further. There is no good reason to run two of these, so this one stops.

### What it did

- **Full terminal emulation** — xterm.js v6 with WebGL rendering, truecolor, Unicode 11
- **Multiple tabs** — create, switch, close, rename (double-click)
- **Cross-platform** — Windows (PowerShell, Git Bash, WSL), macOS (zsh, bash), Linux (zsh, bash)
- **Shell presets** — auto-detects available shells, categorized dropdown in settings
- **Find in terminal** — search through terminal output with next/previous navigation
- **Sidebar integration** — docks in the right sidebar with a persistent icon
- **Clickable links** — URLs in terminal output are clickable
- **Verified native binaries** — mandatory SHA256 checksum verification, HTTPS-only, redirect-downgrade rejection

## For anyone building something similar

The one hard-won thing worth passing on:

> **Obsidian's Electron blocks ConPTY worker threads.** On Windows the terminal must run with `useConpty: false` and fall back to winpty. Anyone attempting a PTY-backed Obsidian plugin will hit this.

The rest of the shape, if useful: xterm.js v6 + node-pty v1.1 (the VS Code pairing), esbuild bundling xterm.js, node-pty loaded at runtime from prebuilt binaries across five targets (`win32-x64`, `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`), macOS x64 cross-compiled on an ARM runner with `--arch x64`. Release tags must **not** carry a `v` prefix, or the community store won't match them — and if your native-binary workflow triggers on `v*` only, your releases will silently ship without binaries.

Source is MIT. Take whatever is useful.

## Existing installs

Nothing to do. Your copy keeps working.

If you want to remove it: **Settings → Community plugins → oterm → Uninstall.**

## Manual install (archival)

The releases remain downloadable for anyone who needs them.

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/mgriffen/oterm/releases/latest)
2. Create `<vault>/.obsidian/plugins/oterm/` and place the files there
3. Enable oterm in Community Plugins

On first terminal open, oterm downloads a platform-specific native binary (~20–400 KB) from GitHub Releases. Behind a proxy or firewall, fetch it manually: download `node-pty-<platform>.zip` from the release and extract to `<vault>/.obsidian/plugins/oterm/native/<platform>/`.

## Commands

| Command | Description |
|---------|-------------|
| Open terminal | Open or reveal the terminal panel |
| New terminal tab | Create a new terminal session |
| Next terminal tab | Switch to the next tab |
| Previous terminal tab | Switch to the previous tab |
| Close terminal tab | Close the active session (warns if processes running) |
| Find in terminal | Toggle the search bar |

## Settings

**Shell** (detected presets or a custom path) · **Working directory** (vault root or home) · **Open location** (right sidebar, bottom panel, editor tab) · **Font family** (a Nerd Font is needed for powerlevel10k) · **Font size** · **Cursor style** · **Cursor blink** · **Scrollback** · **WebGL rendering** · **Copy on select**

## Network disclosure

oterm made network requests to **GitHub** (`github.com`, `objects.githubusercontent.com`) to download prebuilt native binaries on first terminal open — `checksums.json` and `node-pty-<platform>.zip`. No telemetry, no analytics, no other requests. All downloads over HTTPS with mandatory checksum verification.

## Desktop only

Requires Node.js APIs (node-pty). Does not load on mobile.

## License

[MIT](LICENSE)
