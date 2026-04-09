import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_TERMINAL, PLUGIN_ID } from "../constants";
import { TerminalManager } from "./terminal-manager";
import { loadNodePty } from "./native-loader";
import { detectShell, buildWSLCommand, resolveDefaultCwd, isWSLShell } from "../utils/platform";
import { TabBar } from "../ui/tab-bar";
import { SearchBar } from "../ui/search-bar";
import type OtermPlugin from "../main";

export class TerminalView extends ItemView {
	manager: TerminalManager;
	private tabBar: TabBar | null = null;
	private searchBar: SearchBar | null = null;
	private terminalArea: HTMLElement | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private ptyModule: unknown = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: OtermPlugin
	) {
		super(leaf);
		this.manager = new TerminalManager();
	}

	getViewType(): string {
		return VIEW_TYPE_TERMINAL;
	}

	getDisplayText(): string {
		const active = this.manager.getActive();
		return active ? `Terminal: ${active.name}` : "Terminal";
	}

	getIcon(): string {
		return "terminal";
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("oterm-container");

		try {
			this.ptyModule = await loadNodePty(this.getPluginDir());

			this.tabBar = new TabBar(container, this.manager, () => {
				this.createNewSession();
			});

			this.searchBar = new SearchBar(container, () => {
				return this.manager.getActive()?.session.addons?.search ?? null;
			});

			this.terminalArea = container.createDiv({ cls: "oterm-terminal-area" });

			this.resizeObserver = new ResizeObserver(() => {
				requestAnimationFrame(() => {
					this.manager.fitActive();
				});
			});
			this.resizeObserver.observe(this.terminalArea);

			this.createNewSession();
		} catch (err) {
			const msg = err instanceof Error ? err.message : "unknown error";
			new Notice(`oterm: failed to open terminal — ${msg}`, 10000);
			container.setText(`Terminal failed to start: ${msg}`);
		}
	}

	async onClose(): Promise<void> {
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.searchBar?.destroy();
		this.searchBar = null;
		this.tabBar?.destroy();
		this.tabBar = null;
		this.manager.closeAll();
	}

	createNewSession(): void {
		if (!this.terminalArea || !this.ptyModule) return;

		const cwd = resolveDefaultCwd(
			this.plugin.settings.defaultCwd,
			this.getVaultPath()
		);
		const shellInfo = this.resolveShell(cwd);

		this.manager.createSession(this.terminalArea, {
			shell: shellInfo.shell,
			args: shellInfo.args,
			cwd,
			settings: this.plugin.settings,
			ptyModule: this.ptyModule,
		});
	}

	toggleSearch(): void {
		this.searchBar?.toggle();
	}

	private resolveShell(cwd: string): { shell: string; args: string[] } {
		const settings = this.plugin.settings;

		if (settings.defaultShell === "auto") {
			return detectShell();
		}

		if (
			settings.defaultShell === "wsl" ||
			settings.defaultShell === "wsl.exe"
		) {
			return buildWSLCommand(undefined, cwd);
		}

		return {
			shell: settings.defaultShell,
			args: settings.shellArgs,
		};
	}

	private getPluginDir(): string {
		return `${this.getVaultPath()}/.obsidian/plugins/${PLUGIN_ID}`;
	}

	private getVaultPath(): string {
		const adapter = this.app.vault.adapter as unknown as { getBasePath(): string };
		return adapter.getBasePath();
	}
}
