import { App, setIcon } from "obsidian";
import { TerminalManager, SessionEntry } from "../terminal/terminal-manager";
import { ConfirmModal } from "./confirm-modal";

export class TabBar {
	private containerEl: HTMLElement;

	constructor(
		parentEl: HTMLElement,
		private manager: TerminalManager,
		private onNewTab: () => void,
		private app: App
	) {
		this.containerEl = parentEl.createDiv({ cls: "oterm-tab-bar" });

		// Re-render when sessions change
		manager.onChange(() => this.render());

		this.render();
	}

	render(): void {
		this.containerEl.empty();

		const tabsEl = this.containerEl.createDiv({ cls: "oterm-tabs" });
		const sessions = this.manager.list();
		const activeId = this.manager.getActiveId();

		for (const entry of sessions) {
			this.renderTab(tabsEl, entry, entry.id === activeId);
		}

		const newBtn = this.containerEl.createDiv({
			cls: "oterm-tab-new",
		});
		setIcon(newBtn, "plus");
		newBtn.setAttribute("aria-label", "New terminal");
		newBtn.addEventListener("click", () => this.onNewTab());
	}

	private renderTab(
		parent: HTMLElement,
		entry: SessionEntry,
		isActive: boolean
	): void {
		const tabEl = parent.createDiv({
			cls: `oterm-tab ${isActive ? "oterm-tab-active" : ""}`,
		});

		const labelEl = tabEl.createSpan({
			cls: "oterm-tab-label",
			text: entry.name,
		});
		labelEl.setAttribute("title", "Double-click to rename");

		labelEl.addEventListener("dblclick", (e) => {
			e.stopPropagation();
			this.startRename(labelEl, entry);
		});

		tabEl.addEventListener("click", () => {
			if (entry.id !== this.manager.getActiveId()) {
				this.manager.switchTo(entry.id);
			}
		});

		if (this.manager.count() > 1) {
			const closeBtn = tabEl.createSpan({ cls: "oterm-tab-close" });
			setIcon(closeBtn, "x");
			closeBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				void this.closeWithConfirm(entry.id);
			});
		}
	}

	private startRename(labelEl: HTMLSpanElement, entry: SessionEntry): void {
		labelEl.empty();
		const input = labelEl.createEl("input", {
			cls: "oterm-tab-rename",
			attr: { type: "text", value: entry.name },
		});

		const finish = () => {
			const newName = input.value.trim();
			if (newName) {
				this.manager.rename(entry.id, newName);
			}
			this.render();
		};

		input.addEventListener("blur", finish);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				finish();
			} else if (e.key === "Escape") {
				this.render();
			}
		});

		input.focus();
		input.select();
	}

	destroy(): void {
		this.containerEl.remove();
	}

	private async closeWithConfirm(id: string): Promise<void> {
		const hasActive = await this.manager.sessionHasActiveProcess(id);
		if (hasActive) {
			const confirmed = await new ConfirmModal(
				this.app,
				"Close terminal?",
				"This terminal session has running processes. Close anyway?"
			).openAndWait();
			if (!confirmed) return;
		}
		this.manager.closeSession(id);
	}
}
