import * as os from "os";
import * as path from "path";
import { existsSync } from "fs";
import { execFile } from "child_process";

const IS_WIN = os.platform() === "win32";
const IS_MAC = os.platform() === "darwin";

interface ShellInfo {
	shell: string;
	args: string[];
}

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

function detectWindowsShell(): ShellInfo {
	// Prefer WSL (Ubuntu/Linux shell) when available
	if (canResolveShell("wsl.exe")) {
		return { shell: "wsl.exe", args: [] };
	}

	// Fall back to PowerShell 7+ (pwsh), then Windows PowerShell
	const pwshPaths = [
		path.join(
			process.env["ProgramFiles"] ?? "C:\\Program Files",
			"PowerShell",
			"7",
			"pwsh.exe"
		),
		"pwsh.exe",
	];

	for (const p of pwshPaths) {
		if (canResolveShell(p)) {
			return { shell: p, args: [] };
		}
	}

	return { shell: "powershell.exe", args: [] };
}

function detectUnixShell(): ShellInfo {
	const userShell = process.env["SHELL"];
	if (userShell) {
		return { shell: userShell, args: [] };
	}

	for (const fallback of ["/bin/zsh", "/bin/bash", "/bin/sh"]) {
		if (existsSync(fallback)) {
			return { shell: fallback, args: [] };
		}
	}

	return { shell: "/bin/sh", args: [] };
}

function canResolveShell(shell: string): boolean {
	if (path.isAbsolute(shell)) {
		return existsSync(shell);
	}
	// For non-absolute paths on Windows, check PATH
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
): ShellInfo {
	const args: string[] = [];
	if (cwd) {
		args.push("--cd", translateToWSLPath(cwd));
	}
	if (distro) {
		args.push("-d", distro);
	}
	// Let WSL use its default login shell (don't force zsh — not all distros have it)
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
			// Custom path — return as-is, fall back to home if invalid
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
					// pgrep exits 0 if matches found, 1 if none
					resolve(err === null);
				}
			);
		}
	});
}

export { IS_WIN, IS_MAC };
