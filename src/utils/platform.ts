import * as os from "os";
import * as path from "path";
import { existsSync } from "fs";

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
	// Prefer PowerShell 7+ (pwsh), then Windows PowerShell, then cmd
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

export function buildWSLCommand(
	distro?: string
): ShellInfo {
	const args: string[] = [];
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
			// Custom path — return as-is, fall back to home if invalid
			return existsSync(mode) ? mode : os.homedir();
	}
}

export function getPlatformTriple(): string {
	const platform = os.platform();
	const arch = os.arch();
	return `${platform}-${arch}`;
}

export { IS_WIN, IS_MAC };
