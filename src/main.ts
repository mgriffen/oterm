import { addIcon, Platform, Plugin, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_TERMINAL, OTERM_ICON_SVG } from "./constants";
import { OtermSettings, DEFAULT_SETTINGS } from "./settings";
import { OtermSettingTab } from "./settings-tab";
import { TerminalView } from "./terminal/terminal-view";
import { ConfirmModal } from "./ui/confirm-modal";

export default class OtermPlugin extends Plugin {
	settings: OtermSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		if (Platform.isMobile) return;

		await this.loadSettings();

		addIcon("oterm-icon", OTERM_ICON_SVG);

		this.registerView(
			VIEW_TYPE_TERMINAL,
			(leaf) => new TerminalView(leaf, this)
		);

		this.addCommand({
			id: "open-terminal",
			name: "Open terminal",
			callback: () => this.openTerminal(),
		});

		this.addCommand({
			id: "new-terminal",
			name: "New terminal tab",
			checkCallback: (checking) => {
				const view = this.getActiveTerminalView();
				if (!view) return false;
				if (!checking) view.createNewSession();
				return true;
			},
		});

		this.addCommand({
			id: "next-terminal",
			name: "Next terminal tab",
			checkCallback: (checking) => {
				const view = this.getActiveTerminalView();
				if (!view) return false;
				if (!checking) view.manager.nextSession();
				return true;
			},
		});

		this.addCommand({
			id: "prev-terminal",
			name: "Previous terminal tab",
			checkCallback: (checking) => {
				const view = this.getActiveTerminalView();
				if (!view) return false;
				if (!checking) view.manager.prevSession();
				return true;
			},
		});

		this.addCommand({
			id: "close-terminal",
			name: "Close terminal tab",
			checkCallback: (checking) => {
				const view = this.getActiveTerminalView();
				if (!view) return false;
				if (!checking) {
					const activeId = view.manager.getActiveId();
					if (activeId) {
						void this.closeSessionWithConfirm(view, activeId);
					}
				}
				return true;
			},
		});

		this.addCommand({
			id: "search-terminal",
			name: "Find in terminal",
			checkCallback: (checking) => {
				const view = this.getActiveTerminalView();
				if (!view) return false;
				if (!checking) view.toggleSearch();
				return true;
			},
		});

		this.addRibbonIcon("oterm-icon", "Oterm", () => {
			void this.openTerminal();
		});

		this.addSettingTab(new OtermSettingTab(this.app, this));

		// Ensure the terminal view exists in the right sidebar on startup
		// so its icon is always visible in the sidebar tab strip
		this.app.workspace.onLayoutReady(() => {
			if (this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL).length === 0) {
				const leaf = this.app.workspace.getRightLeaf(false);
				void leaf?.setViewState({
					type: VIEW_TYPE_TERMINAL,
					active: false,
				});
			}
		});
	}

	onunload(): void {
		// Obsidian detaches the plugin's views automatically; explicit detach here
		// would reset the leaf to its default location on next load.
	}

	async openTerminal(): Promise<void> {
		// If a terminal view already exists, just reveal it
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);
		if (existing.length > 0) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf = this.getTerminalLeaf();
		await leaf.setViewState({
			type: VIEW_TYPE_TERMINAL,
			active: true,
		});
		await this.app.workspace.revealLeaf(leaf);

		// Ensure right sidebar is expanded when opening there
		if (this.settings.openLocation === "right") {
			(this.app.workspace.rightSplit as unknown as { expand(): void }).expand();
		}
	}

	private getActiveTerminalView(): TerminalView | null {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);
		if (leaves.length === 0) return null;
		return leaves[0].view as TerminalView;
	}

	private getTerminalLeaf(): WorkspaceLeaf {
		switch (this.settings.openLocation) {
			case "bottom": {
				const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);
				if (existing.length > 0) return existing[0];
				return this.app.workspace.getLeaf("split", "horizontal");
			}
			case "right":
				return this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("tab");
			case "tab":
			default:
				return this.app.workspace.getLeaf("tab");
		}
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<OtermSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async closeSessionWithConfirm(view: TerminalView, id: string): Promise<void> {
		const hasActive = await view.manager.sessionHasActiveProcess(id);
		if (hasActive) {
			const confirmed = await new ConfirmModal(
				this.app,
				"Close terminal?",
				"This terminal session has running processes. Close anyway?"
			).openAndWait();
			if (!confirmed) return;
		}
		view.manager.closeSession(id);
	}
}
