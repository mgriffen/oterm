import { setIcon } from "obsidian";
import type { SearchAddon } from "@xterm/addon-search";

export class SearchBar {
	private containerEl: HTMLElement;
	private inputEl: HTMLInputElement;
	private visible = false;

	constructor(
		private parentEl: HTMLElement,
		private getSearchAddon: () => SearchAddon | null
	) {
		this.containerEl = parentEl.createDiv({ cls: "oterm-search-bar" });
		this.containerEl.hide();

		this.inputEl = document.createElement("input");
		this.inputEl.type = "text";
		this.inputEl.placeholder = "Search...";
		this.inputEl.className = "oterm-search-input";
		this.containerEl.appendChild(this.inputEl);

		const prevBtn = this.containerEl.createDiv({ cls: "oterm-search-btn" });
		setIcon(prevBtn, "chevron-up");
		prevBtn.setAttribute("aria-label", "Previous match");
		prevBtn.addEventListener("click", () => this.findPrevious());

		const nextBtn = this.containerEl.createDiv({ cls: "oterm-search-btn" });
		setIcon(nextBtn, "chevron-down");
		nextBtn.setAttribute("aria-label", "Next match");
		nextBtn.addEventListener("click", () => this.findNext());

		const closeBtn = this.containerEl.createDiv({ cls: "oterm-search-btn" });
		setIcon(closeBtn, "x");
		closeBtn.setAttribute("aria-label", "Close search");
		closeBtn.addEventListener("click", () => this.hide());

		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				if (e.shiftKey) {
					this.findPrevious();
				} else {
					this.findNext();
				}
				e.preventDefault();
			} else if (e.key === "Escape") {
				this.hide();
				e.preventDefault();
			}
		});
	}

	toggle(): void {
		if (this.visible) {
			this.hide();
		} else {
			this.show();
		}
	}

	show(): void {
		this.visible = true;
		this.containerEl.show();
		this.inputEl.focus();
		this.inputEl.select();
	}

	hide(): void {
		this.visible = false;
		this.containerEl.hide();
		this.getSearchAddon()?.clearDecorations();
	}

	isVisible(): boolean {
		return this.visible;
	}

	destroy(): void {
		this.containerEl.remove();
	}

	private findNext(): void {
		const query = this.inputEl.value;
		if (!query) return;
		this.getSearchAddon()?.findNext(query);
	}

	private findPrevious(): void {
		const query = this.inputEl.value;
		if (!query) return;
		this.getSearchAddon()?.findPrevious(query);
	}
}
