import { IS_WIN } from "../utils/platform";
import { TERM_TYPE, COLOR_TERM } from "../constants";

// node-pty types — loaded dynamically via native-loader
interface IPty {
	onData: (callback: (data: string) => void) => { dispose(): void };
	onExit: (
		callback: (e: { exitCode: number; signal?: number }) => void
	) => { dispose(): void };
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(signal?: string): void;
	pid: number;
}

interface IPtySpawnFn {
	spawn(
		shell: string,
		args: string[],
		options: Record<string, unknown>
	): IPty;
}

export interface SpawnOptions {
	shell: string;
	args: string[];
	cwd: string;
	cols: number;
	rows: number;
	env?: Record<string, string>;
}

export interface PtyHandle {
	onData(callback: (data: string) => void): void;
	onExit(callback: (exitCode: number, signal?: number) => void): void;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(): void;
	readonly pid: number;
}

export function spawnPty(
	ptyModule: IPtySpawnFn,
	options: SpawnOptions
): PtyHandle {
	const env = options.env ?? { ...process.env } as Record<string, string>;

	// Set TERM for proper color/capability detection
	env["TERM"] = TERM_TYPE;
	env["COLORTERM"] = COLOR_TERM;
	// Let shell configs detect oterm (e.g., to skip tmux auto-attach)
	env["OTERM"] = "1";

	const ptyOptions: Record<string, unknown> = {
		name: TERM_TYPE,
		cols: options.cols,
		rows: options.rows,
		cwd: options.cwd,
		env,
	};

	// On Windows, disable ConPTY — Obsidian's Electron renderer blocks
	// the Worker threads it needs. winpty works reliably instead.
	if (IS_WIN) {
		ptyOptions["useConpty"] = false;
	}

	const proc = ptyModule.spawn(options.shell, options.args, ptyOptions);

	return {
		onData(callback: (data: string) => void) {
			proc.onData(callback);
		},
		onExit(callback: (exitCode: number, signal?: number) => void) {
			proc.onExit((e) => callback(e.exitCode, e.signal));
		},
		write(data: string) {
			proc.write(data);
		},
		resize(cols: number, rows: number) {
			proc.resize(cols, rows);
		},
		kill() {
			proc.kill();
		},
		get pid() {
			return proc.pid;
		},
	};
}

