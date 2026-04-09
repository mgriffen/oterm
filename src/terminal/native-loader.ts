import { Notice } from "obsidian";
import { createHash } from "crypto";
import { access, chmod, readFile, writeFile, mkdir, rm } from "fs/promises";
import { createWriteStream } from "fs";
import * as https from "https";
import * as path from "path";
import * as yauzl from "yauzl";
import { getPlatformTriple, IS_WIN } from "../utils/platform";

const GITHUB_OWNER = "mgriffen";
const GITHUB_REPO = "oterm";
const NATIVE_DIR_NAME = "native";
const BINARY_NAME = "pty.node";
const SHIM_NAME = "node-pty.js";
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// node-pty is loaded at runtime from prebuilt binaries, not bundled
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NodePtyModule = any;

let cachedModule: NodePtyModule | null = null;
let downloadPromise: Promise<void> | null = null;

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
			// Race guard: reuse in-flight download if another tab triggered one
			if (!downloadPromise) {
				downloadPromise = downloadAndExtract(pluginDir, triple);
			}
			try {
				await downloadPromise;
			} finally {
				downloadPromise = null;
			}
		}

		if (!(await fileExists(shimPath))) {
			await writeShim(shimPath);
		}

		try {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			pty = require(shimPath) as NodePtyModule;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("NODE_MODULE_VERSION")) {
				throw new Error(
					"oterm: binary is incompatible with this Obsidian version. " +
					"Please update the plugin or reinstall."
				);
			}
			throw err;
		}
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

async function downloadAndExtract(
	pluginDir: string,
	triple: string
): Promise<void> {
	const notice = new Notice("oterm: downloading terminal binary...", 0);

	try {
		const version = await getPluginVersion(pluginDir);
		const zipName = `node-pty-${triple}.zip`;
		const baseUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}`;

		// Download checksums first
		notice.setMessage("oterm: verifying binary integrity...");
		const checksumsData = await httpGetWithRetry(`${baseUrl}/checksums.json`);
		const checksums = JSON.parse(checksumsData.toString("utf-8"));
		const expectedHash = checksums[zipName];
		if (!expectedHash) {
			throw new Error(
				`oterm: no checksum entry for ${zipName}. ` +
				"Cannot verify binary integrity."
			);
		}

		// Download zip
		notice.setMessage("oterm: downloading terminal binary...");
		const zipData = await httpGetWithRetry(`${baseUrl}/${zipName}`);

		// Verify checksum
		const actualHash = createHash("sha256").update(zipData).digest("hex");
		if (actualHash !== expectedHash) {
			throw new Error(
				`oterm: checksum mismatch for ${zipName}. ` +
				`Expected ${expectedHash}, got ${actualHash}.`
			);
		}

		// Extract zip
		notice.setMessage("oterm: installing terminal binary...");
		const targetDir = path.join(pluginDir, NATIVE_DIR_NAME, triple);

		// Clean up any partial previous extraction
		if (await fileExists(targetDir)) {
			await rm(targetDir, { recursive: true });
		}
		await mkdir(targetDir, { recursive: true });

		await extractZip(zipData, targetDir);

		// Ensure executable permissions on Unix
		if (!IS_WIN) {
			const execFiles = [BINARY_NAME, "spawn-helper"];
			for (const name of execFiles) {
				const filePath = path.join(targetDir, name);
				if (await fileExists(filePath)) {
					await chmod(filePath, 0o755);
				}
			}
		}

		notice.setMessage("oterm: terminal binary installed.");
		setTimeout(() => notice.hide(), 3000);
	} catch (err) {
		notice.hide();
		try { await rm(targetDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
		const msg = err instanceof Error ? err.message : "unknown error";
		new Notice(`oterm: failed to download binary — ${msg}`, 10000);
		throw err;
	}
}

function extractZip(zipData: Buffer, targetDir: string): Promise<void> {
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(zipData, { lazyEntries: true }, (err, zipfile) => {
			if (err || !zipfile) {
				reject(err ?? new Error("Failed to open zip"));
				return;
			}

			zipfile.readEntry();

			zipfile.on("entry", (entry: yauzl.Entry) => {
				// Skip directories
				if (entry.fileName.endsWith("/")) {
					zipfile.readEntry();
					return;
				}

				const outputPath = path.join(targetDir, path.basename(entry.fileName));

				zipfile.openReadStream(entry, (streamErr, readStream) => {
					if (streamErr || !readStream) {
						reject(streamErr ?? new Error("Failed to read zip entry"));
						return;
					}

					const writeStream = createWriteStream(outputPath);
					readStream.pipe(writeStream);

					writeStream.on("finish", () => {
						zipfile.readEntry();
					});

					writeStream.on("error", reject);
				});
			});

			zipfile.on("end", resolve);
			zipfile.on("error", reject);
		});
	});
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
		"    useConpty: options && options.useConpty !== undefined ? options.useConpty : false,",
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

async function httpGetWithRetry(url: string): Promise<Buffer> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			return await httpGet(url);
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			if (attempt < MAX_RETRIES) {
				await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
			}
		}
	}
	throw lastError;
}

function httpGet(url: string, redirectsLeft = 5): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		https.get(url, (res) => {
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

			let totalBytes = 0;
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => {
				totalBytes += chunk.length;
				if (totalBytes > MAX_DOWNLOAD_BYTES) {
					res.destroy();
					reject(new Error(`oterm: download exceeds ${MAX_DOWNLOAD_BYTES / 1024 / 1024}MB limit — aborting`));
					return;
				}
				chunks.push(chunk);
			});
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
