import { Terminal } from "@xterm/xterm";
import { loadAddons, disposeAddons, LoadedAddons } from "./addons";
import { spawnPty, PtyHandle, SpawnOptions } from "./pty-bridge";
import { OtermSettings } from "../settings";

// Imported as text via esbuild loader — see esbuild.config.mjs
import xtermCssText from "@xterm/xterm/css/xterm.css";

function injectXtermCss(): void {
	if (document.getElementById("oterm-xterm-css")) return;

	const style = document.createElement("style");
	style.id = "oterm-xterm-css";
	style.textContent = xtermCssText;
	document.head.appendChild(style);
}

export interface SessionOptions {
	shell: string;
	args: string[];
	cwd: string;
	settings: OtermSettings;
	ptyModule: unknown;
}

export class TerminalSession {
	private terminal: Terminal;
	addons: LoadedAddons | null = null;
	private ptyHandle: PtyHandle | null = null;
	private disposed = false;

	constructor(
		private container: HTMLElement,
		private options: SessionOptions
	) {
		injectXtermCss();

		this.terminal = new Terminal({
			fontFamily: options.settings.fontFamily,
			fontSize: options.settings.fontSize,
			scrollback: options.settings.scrollback,
			cursorStyle: options.settings.cursorStyle,
			cursorBlink: options.settings.cursorBlink,
			allowProposedApi: true,
			theme: {
				background: "#1e1e2e",
				foreground: "#cdd6f4",
				cursor: "#f5e0dc",
				selectionBackground: "#585b70",
				black: "#45475a",
				red: "#f38ba8",
				green: "#a6e3a1",
				yellow: "#f9e2af",
				blue: "#89b4fa",
				magenta: "#f5c2e7",
				cyan: "#94e2d5",
				white: "#bac2de",
				brightBlack: "#585b70",
				brightRed: "#f38ba8",
				brightGreen: "#a6e3a1",
				brightYellow: "#f9e2af",
				brightBlue: "#89b4fa",
				brightMagenta: "#f5c2e7",
				brightCyan: "#94e2d5",
				brightWhite: "#a6adc8",
			},
		});
	}

	open(): void {
		this.terminal.open(this.container);

		// fit must be loaded after open
		this.addons = loadAddons(this.terminal, this.options.settings.useWebGL);
		this.addons.fit.fit();

		const spawnOptions: SpawnOptions = {
			shell: this.options.shell,
			args: this.options.args,
			cwd: this.options.cwd,
			cols: this.terminal.cols,
			rows: this.terminal.rows,
		};

		this.ptyHandle = spawnPty(
			this.options.ptyModule as Parameters<typeof spawnPty>[0],
			spawnOptions
		);

		this.ptyHandle.onData((data) => {
			if (!this.disposed) {
				this.terminal.write(data);
			}
		});

		this.terminal.onData((data) => {
			if (!this.disposed) {
				this.ptyHandle?.write(data);
			}
		});

		this.terminal.onResize(({ cols, rows }) => {
			if (!this.disposed) {
				this.ptyHandle?.resize(cols, rows);
			}
		});

		this.ptyHandle.onExit(() => {
			if (!this.disposed) {
				this.terminal.write("\r\n[Process exited]\r\n");
			}
		});
	}

	fit(): void {
		if (this.addons?.fit && !this.disposed) {
			this.addons.fit.fit();
		}
	}

	focus(): void {
		if (!this.disposed) {
			this.terminal.focus();
		}
	}

	getPid(): number | null {
		return this.ptyHandle?.pid ?? null;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;

		this.ptyHandle?.kill();
		this.ptyHandle = null;

		if (this.addons) {
			disposeAddons(this.addons);
			this.addons = null;
		}

		this.terminal.dispose();
	}
}
