import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";

export interface LoadedAddons {
	fit: FitAddon;
	search: SearchAddon;
	serialize: SerializeAddon;
	webgl: WebglAddon | null;
	unicode11: Unicode11Addon;
	webLinks: WebLinksAddon;
}

export function loadAddons(
	terminal: Terminal,
	useWebGL: boolean
): LoadedAddons {
	const fit = new FitAddon();
	terminal.loadAddon(fit);

	const unicode11 = new Unicode11Addon();
	terminal.loadAddon(unicode11);
	terminal.unicode.activeVersion = "11";

	const webLinks = new WebLinksAddon();
	terminal.loadAddon(webLinks);

	const search = new SearchAddon();
	terminal.loadAddon(search);

	const serialize = new SerializeAddon();
	terminal.loadAddon(serialize);

	const addons: LoadedAddons = { fit, search, serialize, webgl: null, unicode11, webLinks };

	if (useWebGL) {
		try {
			const webgl = new WebglAddon();
			webgl.onContextLoss(() => {
				addons.webgl?.dispose();
				addons.webgl = null;
			});
			terminal.loadAddon(webgl);
			addons.webgl = webgl;
		} catch {
			addons.webgl = null;
		}
	}

	return addons;
}

export function disposeAddons(addons: LoadedAddons): void {
	addons.webgl?.dispose();
	addons.webLinks.dispose();
	addons.unicode11.dispose();
	addons.search.dispose();
	addons.serialize.dispose();
	addons.fit.dispose();
}
