import { App, Modal } from "obsidian";

export class ConfirmModal extends Modal {
	private resolved = false;
	private resolve: (value: boolean) => void = () => {};

	constructor(
		app: App,
		private title: string,
		private message: string
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h3", { text: this.title });
		contentEl.createEl("p", { text: this.message });

		const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });

		buttonRow
			.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => {
				this.resolved = true;
				this.resolve(false);
				this.close();
			});

		const confirmBtn = buttonRow.createEl("button", {
			text: "Close anyway",
			cls: "mod-warning",
		});
		confirmBtn.addEventListener("click", () => {
			this.resolved = true;
			this.resolve(true);
			this.close();
		});
	}

	onClose(): void {
		if (!this.resolved) {
			this.resolve(false);
		}
		this.contentEl.empty();
	}

	openAndWait(): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}
}
