import { Notice } from "obsidian";
import { createHash } from "crypto";
import { access, readFile, writeFile, mkdir } from "fs/promises";
import * as https from "https";
import * as path from "path";
import { getPlatformTriple } from "../utils/platform";

const GITHUB_OWNER = "mgriffen";
const GITHUB_REPO = "oterm";
const NATIVE_DIR_NAME = "native";
const BINARY_NAME = "pty.node";
const SHIM_NAME = "node-pty.js";

// node-pty is loaded at runtime from prebuilt binaries, not bundled
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NodePtyModule = any;

let cachedModule: NodePtyModule | null = null;

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function loadNodePty(pluginDir: string): Promise<NodePtyModule> {
	if (cachedModule) {
		return cachedModule;
	}

	const nativeDir = path.join(pluginDir, NATIVE_DIR_NAME);
	const triple = getPlatformTriple();

	// Dev install: full node-pty module directory (JS API + native bindings)
	const modulePath = path.join(nativeDir, triple, "node-pty");
	// Production: single binary + generated shim
	const binaryPath = path.join(nativeDir, triple, BINARY_NAME);
	const shimPath = path.join(nativeDir, triple, SHIM_NAME);

	let pty: NodePtyModule;

	if (await fileExists(path.join(modulePath, "package.json"))) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		pty = require(modulePath) as NodePtyModule;
	} else {
		if (!(await fileExists(binaryPath))) {
			await downloadBinary(pluginDir, triple);
		}

		if (!(await fileExists(shimPath))) {
			await writeShim(shimPath);
		}

		// eslint-disable-next-line @typescript-eslint/no-var-requires
		pty = require(shimPath) as NodePtyModule;
	}

	if (typeof pty.spawn !== "function") {
		throw new Error(
			"oterm: native module loaded but does not export spawn(). " +
			"The binary may be incompatible. Try reinstalling the plugin."
		);
	}

	cachedModule = pty;
	return pty;
}

async function downloadBinary(
	pluginDir: string,
	triple: string
): Promise<void> {
	const notice = new Notice("oterm: downloading terminal binary...", 0);

	try {
		const version = await getPluginVersion(pluginDir);
		const assetName = `node-pty-${triple}.node`;
		const url = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}/${assetName}`;

		const checksumsPath = path.join(pluginDir, "checksums.json");
		if (!(await fileExists(checksumsPath))) {
			throw new Error(
				"oterm: checksums.json not found. " +
				"Cannot verify binary integrity. Reinstall the plugin."
			);
		}

		const checksums = JSON.parse(await readFile(checksumsPath, "utf-8"));
		const expectedHash = checksums[assetName];
		if (!expectedHash) {
			throw new Error(
				`oterm: no checksum entry for ${assetName} in checksums.json. ` +
				`Cannot verify binary integrity.`
			);
		}

		const data = await httpGet(url);

		const actualHash = createHash("sha256").update(data).digest("hex");
		if (actualHash !== expectedHash) {
			throw new Error(
				`oterm: checksum mismatch for ${assetName}. ` +
				`Expected ${expectedHash}, got ${actualHash}.`
			);
		}

		const nativeDir = path.join(pluginDir, NATIVE_DIR_NAME, triple);
		await mkdir(nativeDir, { recursive: true });
		await writeFile(path.join(nativeDir, BINARY_NAME), data);

		notice.setMessage("oterm: terminal binary installed.");
		setTimeout(() => notice.hide(), 3000);
	} catch (err) {
		notice.hide();
		const msg = err instanceof Error ? err.message : "unknown error";
		new Notice(`oterm: failed to download binary — ${msg}`, 10000);
		throw err;
	}
}

async function writeShim(shimPath: string): Promise<void> {
	const shimCode = [
		"// Auto-generated shim — loads the native pty.node binding",
		"// and re-exports the node-pty JS API",
		"const path = require('path');",
		"const nativePath = path.join(__dirname, 'pty.node');",
		"const binding = require(nativePath);",
		"",
		"// node-pty's native binding exports ConptyProcess/UnixTerminal constructors",
		"// Wrap them in a spawn() function matching the node-pty public API",
		"const os = require('os');",
		"const isWin = os.platform() === 'win32';",
		"",
		"function spawn(file, args, options) {",
		"  const TerminalCtor = isWin ? binding.ConptyProcess : (binding.UnixTerminal || binding.Pty);",
		"  if (!TerminalCtor) {",
		"    throw new Error('oterm: native binding does not export a terminal constructor');",
		"  }",
		"  const cols = (options && options.cols) || 80;",
		"  const rows = (options && options.rows) || 24;",
		"  return new TerminalCtor(file, args || [], {",
		"    name: (options && options.name) || 'xterm-256color',",
		"    cols: cols,",
		"    rows: rows,",
		"    cwd: (options && options.cwd) || process.cwd(),",
		"    env: (options && options.env) || process.env,",
		"    useConpty: options && options.useConpty !== undefined ? options.useConpty : true,",
		"  });",
		"}",
		"",
		"module.exports = { spawn: spawn };",
	].join("\n");
	await writeFile(shimPath, shimCode, "utf-8");
}

async function getPluginVersion(pluginDir: string): Promise<string> {
	const manifestPath = path.join(pluginDir, "manifest.json");
	try {
		const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
		if (!manifest.version) {
			throw new Error("no version field in manifest.json");
		}
		return manifest.version;
	} catch (err) {
		throw new Error(
			`oterm: cannot determine plugin version — ${err instanceof Error ? err.message : "manifest.json unreadable"}. ` +
			"Reinstall the plugin."
		);
	}
}

function httpGet(url: string, redirectsLeft = 5): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const get = https.get;
		get(url, (res) => {
			if (
				res.statusCode &&
				res.statusCode >= 300 &&
				res.statusCode < 400 &&
				res.headers.location
			) {
				if (redirectsLeft <= 0) {
					res.resume();
					reject(new Error("Too many redirects"));
					return;
				}
				if (!res.headers.location.startsWith("https://")) {
					res.resume();
					reject(new Error("oterm: redirect to non-HTTPS URL rejected"));
					return;
				}
				res.resume();
				httpGet(res.headers.location, redirectsLeft - 1).then(resolve, reject);
				return;
			}

			if (res.statusCode !== 200) {
				res.resume();
				reject(
					new Error(`HTTP ${res.statusCode} fetching ${url}`)
				);
				return;
			}

			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => resolve(Buffer.concat(chunks)));
			res.on("error", reject);
		}).on("error", reject);
	});
}

export function getNativeDir(pluginDir: string): string {
	return path.join(pluginDir, NATIVE_DIR_NAME);
}

export async function isBinaryInstalled(pluginDir: string): Promise<boolean> {
	const triple = getPlatformTriple();
	return fileExists(
		path.join(pluginDir, NATIVE_DIR_NAME, triple, BINARY_NAME)
	);
}
