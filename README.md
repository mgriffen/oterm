# oterm

Full terminal emulator for Obsidian. Powered by the same technology as VS Code's terminal (xterm.js + node-pty).

Supports PowerShell, WSL, zsh, oh-my-zsh, tmux, powerlevel10k, and all rich CLI tools — including Claude Code.

## Features

- **Full terminal emulation** — xterm.js v6 with WebGL rendering, truecolor, Unicode 11
- **Multiple tabs** — create, switch, close, rename (double-click) terminal sessions
- **Cross-platform** — Windows (PowerShell, Git Bash, WSL), macOS (zsh, bash), Linux (zsh, bash)
- **Shell presets** — auto-detects available shells, categorized dropdown in settings
- **Find in terminal** — search through terminal output with next/previous navigation
- **Sidebar integration** — docks in the right sidebar with a persistent icon
- **Clickable links** — URLs in terminal output are clickable
- **Catppuccin Mocha theme** — dark theme that integrates with Obsidian's UI

## Installation

### BRAT (recommended for beta)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins
2. Open BRAT settings, click "Add Beta Plugin"
3. Enter: `mgriffen/oterm`
4. Enable oterm in Community Plugins

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/mgriffen/oterm/releases/latest)
2. Create `<vault>/.obsidian/plugins/oterm/` and place the files there
3. Enable oterm in Community Plugins

## First Launch

When you first open a terminal, oterm downloads a platform-specific native binary (~20-400 KB) from GitHub Releases. This is a one-time download — subsequent opens use the cached binary.

If you're behind a corporate proxy or firewall, you can download the binary manually:

1. Go to the [latest release](https://github.com/mgriffen/oterm/releases/latest)
2. Download `node-pty-<platform>.zip` for your platform
3. Extract to `<vault>/.obsidian/plugins/oterm/native/<platform>/`

Platform values: `win32-x64`, `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`

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

- **Shell** — choose from detected shells (PowerShell, WSL, Git Bash, zsh, bash, fish) or AI tools (Claude Code, Aider)
- **Font family** — default: MesloLGS NF, Consolas, Courier New
- **Font size** — default: 14
- **Cursor style** — block, underline, or bar
- **WebGL rendering** — hardware-accelerated rendering (disable if you see visual artifacts)

## Network Disclosure

This plugin makes network requests to **GitHub** (`github.com` and `objects.githubusercontent.com`) to download prebuilt native binaries on first terminal open. Specifically:

- `checksums.json` — SHA256 hashes for integrity verification
- `node-pty-<platform>.zip` — platform-specific native terminal binary

No telemetry, analytics, or other network requests are made. All downloads are over HTTPS with checksum verification.

## Desktop Only

This plugin requires Node.js APIs (node-pty) and only works on desktop platforms (Windows, macOS, Linux). It will not load on mobile.

## License

[MIT](LICENSE)
