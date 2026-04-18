import { Notice } from "obsidian";
import { createHash } from "crypto";
import { access, chmod, readFile, mkdir, rm } from "fs/promises";
import { createWriteStream } from "fs";
import * as https from "https";
import * as path from "path";
import * as yauzl from "yauzl";
import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from "node-pty";
import { getPlatformTriple, IS_WIN } from "../utils/platform";

const GITHUB_OWNER = "mgriffen";
const GITHUB_REPO = "oterm";
const NATIVE_DIR_NAME = "native";
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export interface NodePtyModule {
	spawn(
		file: string,
		args: string[] | string,
		options: IPtyForkOptions | IWindowsPtyForkOptions
	): IPty;
}

// node-pty is loaded at runtime from prebuilt binaries via Electron's renderer
// require, not bundled by esbuild. Accessing require through the window object
// avoids the static import that would otherwise pull node-pty into the bundle.
function electronRequire(id: string): unknown {
	return (activeWindow as unknown as { require: (id: string) => unknown }).require(id);
}

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

	const triple = getPlatformTriple();
	const targetDir = path.join(pluginDir, NATIVE_DIR_NAME, triple);

	// Dev install: full node-pty module at native/<triple>/node-pty/
	// Production: node-pty module downloaded to native/<triple>/ (has package.json at root)
	const devModulePath = path.join(targetDir, "node-pty");
	const isDevInstall = await fileExists(path.join(devModulePath, "package.json"));
	const isProdInstall = await fileExists(path.join(targetDir, "package.json"));

	if (!isDevInstall && !isProdInstall) {
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

	const modulePath = isDevInstall ? devModulePath : targetDir;

	let pty: NodePtyModule;
	try {
		pty = electronRequire(modulePath) as NodePtyModule;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("NODE_MODULE_VERSION")) {
			throw new Error(
				"Oterm: binary is incompatible with this Obsidian version. " +
				"Please update the plugin or reinstall."
			);
		}
		throw err;
	}

	if (typeof pty.spawn !== "function") {
		throw new Error(
			"Oterm: native module loaded but does not export spawn(). " +
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
	const notice = new Notice("Oterm: downloading terminal binary...", 0);
	const targetDir = path.join(pluginDir, NATIVE_DIR_NAME, triple);

	try {
		const version = await getPluginVersion(pluginDir);
		const zipName = `node-pty-${triple}.zip`;
		const baseUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}`;

		// Download checksums first
		notice.setMessage("Oterm: verifying binary integrity...");
		const checksumsData = await httpGetWithRetry(`${baseUrl}/checksums.json`);
		const checksums = JSON.parse(checksumsData.toString("utf-8")) as Record<string, string>;
		const expectedHash: string | undefined = checksums[zipName];
		if (!expectedHash) {
			throw new Error(
				`Oterm: no checksum entry for ${zipName}. ` +
				"Cannot verify binary integrity."
			);
		}

		// Download zip
		notice.setMessage("Oterm: downloading terminal binary...");
		const zipData = await httpGetWithRetry(`${baseUrl}/${zipName}`);

		// Verify checksum
		const actualHash = createHash("sha256").update(zipData).digest("hex");
		if (actualHash !== expectedHash) {
			throw new Error(
				`Oterm: checksum mismatch for ${zipName}. ` +
				`Expected ${expectedHash}, got ${actualHash}.`
			);
		}

		// Extract zip
		notice.setMessage("Oterm: installing terminal binary...");

		// Clean up any partial previous extraction
		if (await fileExists(targetDir)) {
			await rm(targetDir, { recursive: true });
		}
		await mkdir(targetDir, { recursive: true });

		await extractZip(zipData, targetDir);

		// Ensure executable permissions on Unix
		if (!IS_WIN) {
			const execFiles = [
				path.join(targetDir, "build", "Release", "pty.node"),
				path.join(targetDir, "build", "Release", "spawn-helper"),
			];
			for (const filePath of execFiles) {
				if (await fileExists(filePath)) {
					await chmod(filePath, 0o755);
				}
			}
		}

		notice.setMessage("Oterm: terminal binary installed.");
		activeWindow.setTimeout(() => notice.hide(), 3000);
	} catch (err) {
		notice.hide();
		try { await rm(targetDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
		const msg = err instanceof Error ? err.message : "unknown error";
		new Notice(`Oterm: failed to download binary — ${msg}`, 10000);
		throw err;
	}
}

async function handleEntry(
	zipfile: yauzl.ZipFile,
	entry: yauzl.Entry,
	targetDir: string
): Promise<void> {
	if (entry.fileName.endsWith("/")) {
		zipfile.readEntry();
		return;
	}

	const normalized = path.normalize(entry.fileName);
	if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
		zipfile.readEntry();
		return;
	}
	const outputPath = path.join(targetDir, normalized);
	const parentDir = path.dirname(outputPath);
	await mkdir(parentDir, { recursive: true });

	await new Promise<void>((resolve, reject) => {
		zipfile.openReadStream(entry, (streamErr, readStream) => {
			if (streamErr || !readStream) {
				reject(streamErr ?? new Error("Failed to read zip entry"));
				return;
			}
			const writeStream = createWriteStream(outputPath);
			readStream.pipe(writeStream);
			writeStream.on("finish", () => {
				zipfile.readEntry();
				resolve();
			});
			writeStream.on("error", reject);
		});
	});
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
				void handleEntry(zipfile, entry, targetDir).catch(reject);
			});

			zipfile.on("end", resolve);
			zipfile.on("error", reject);
		});
	});
}

async function getPluginVersion(pluginDir: string): Promise<string> {
	const manifestPath = path.join(pluginDir, "manifest.json");
	try {
		const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as { version?: string };
		if (!manifest.version) {
			throw new Error("no version field in manifest.json");
		}
		return manifest.version;
	} catch (err) {
		throw new Error(
			`Oterm: cannot determine plugin version — ${err instanceof Error ? err.message : "manifest.json unreadable"}. ` +
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
				await new Promise((r) => activeWindow.setTimeout(r, RETRY_DELAY_MS));
			}
		}
	}
	throw lastError ?? new Error(`Oterm: request failed for ${url}`);
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
					reject(new Error("Oterm: redirect to non-HTTPS URL rejected"));
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
			let settled = false;
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => {
				totalBytes += chunk.length;
				if (totalBytes > MAX_DOWNLOAD_BYTES && !settled) {
					settled = true;
					res.destroy();
					reject(new Error(`Oterm: download exceeds ${MAX_DOWNLOAD_BYTES / 1024 / 1024}MB limit — aborting`));
					return;
				}
				chunks.push(chunk);
			});
			res.on("end", () => { if (!settled) resolve(Buffer.concat(chunks)); });
			res.on("error", (e) => { if (!settled) { settled = true; reject(e); } });
		}).on("error", reject);
	});
}

export function getNativeDir(pluginDir: string): string {
	return path.join(pluginDir, NATIVE_DIR_NAME);
}

export async function isBinaryInstalled(pluginDir: string): Promise<boolean> {
	const triple = getPlatformTriple();
	const targetDir = path.join(pluginDir, NATIVE_DIR_NAME, triple);
	// Check for production install (package.json) or dev install (node-pty subdir)
	return (
		(await fileExists(path.join(targetDir, "package.json"))) ||
		(await fileExists(path.join(targetDir, "node-pty", "package.json")))
	);
}
