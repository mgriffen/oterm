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
