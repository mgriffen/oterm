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
		detect: () => true,
	},
	{
		id: "cmd",
		name: "CMD",
		category: "system",
		platforms: ["win32"],
		shell: "cmd.exe",
		args: [],
		detect: () => true,
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

	const platformPresets = getPresetsForPlatform();
	for (const preset of platformPresets) {
		if (preset.detect()) return preset;
	}
	return null;
}

export function validateShell(idOrPath: string): ShellValidationResult {
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

	if (isWSLShell(idOrPath)) return buildWSLCommand(undefined, cwd);
	return { shell: idOrPath, args: shellArgs };
}
