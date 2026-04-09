import { App, PluginSettingTab, Setting } from "obsidian";
import type OtermPlugin from "./main";
import { getPresetsForPlatform, validateShell } from "./terminal/shell-registry";

export class OtermSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: OtermPlugin
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "oterm" });
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Full terminal emulator for Obsidian.",
		});

		// Shell selection
		const shellSetting = new Setting(containerEl)
			.setName("Default shell")
			.setDesc("Shell to launch when opening a terminal.");

		const presets = getPresetsForPlatform();
		const systemPresets = presets.filter((p) => p.category === "system");
		const aiPresets = presets.filter((p) => p.category === "ai");

		const currentShell = this.plugin.settings.defaultShell;
		const isPreset =
			currentShell === "auto" ||
			presets.some((p) => p.id === currentShell);
		let lastValidShell = currentShell;

		// Detection status indicator
		const statusEl = containerEl.createSpan({ cls: "oterm-shell-status" });
		this.updateShellStatus(statusEl, currentShell);

		shellSetting.addDropdown((dropdown) => {
			dropdown.addOption("auto", "Auto-detect (recommended)");

			// System Shells group
			if (systemPresets.length > 0) {
				dropdown.addOption("_sep_system", "── System Shells ──");
				for (const preset of systemPresets) {
					dropdown.addOption(preset.id, preset.name);
				}
			}

			// AI Tools group
			if (aiPresets.length > 0) {
				dropdown.addOption("_sep_ai", "── AI Tools ──");
				for (const preset of aiPresets) {
					dropdown.addOption(preset.id, preset.name);
				}
			}

			dropdown.addOption("custom", "Custom...");

			dropdown.setValue(isPreset ? currentShell : "custom");
			dropdown.onChange(async (value) => {
				// Ignore separator selections
				if (value.startsWith("_sep_")) {
					dropdown.setValue(lastValidShell);
					return;
				}
				if (value !== "custom") {
					this.plugin.settings.defaultShell = value;
					lastValidShell = value;
					await this.plugin.saveSettings();
					customShellInput.settingEl.toggle(false);
				} else {
					customShellInput.settingEl.toggle(true);
				}
				this.updateShellStatus(statusEl, value);
			});
		});

		const customShellInput = new Setting(containerEl)
			.setName("Custom shell path")
			.setDesc("Full path to shell executable.")
			.addText((text) =>
				text
					.setPlaceholder("/usr/bin/zsh")
					.setValue(
						isPreset ? "" : this.plugin.settings.defaultShell
					)
					.onChange(async (value) => {
						this.plugin.settings.defaultShell = value;
						await this.plugin.saveSettings();
						this.updateShellStatus(statusEl, value);
					})
			);
		customShellInput.settingEl.toggle(!isPreset);

		// Working directory
		new Setting(containerEl)
			.setName("Default working directory")
			.setDesc("Where the terminal starts.")
			.addDropdown((dropdown) => {
				dropdown.addOption("vault", "Vault root");
				dropdown.addOption("home", "Home directory");
				dropdown.setValue(
					this.plugin.settings.defaultCwd === "vault" ||
						this.plugin.settings.defaultCwd === "home"
						? this.plugin.settings.defaultCwd
						: "home"
				);
				dropdown.onChange(async (value) => {
					this.plugin.settings.defaultCwd = value;
					await this.plugin.saveSettings();
				});
			});

		// Open location
		new Setting(containerEl)
			.setName("Open location")
			.setDesc("Where new terminals appear.")
			.addDropdown((dropdown) => {
				dropdown.addOption("right", "Right sidebar");
				dropdown.addOption("bottom", "Bottom panel");
				dropdown.addOption("tab", "Editor tab");
				dropdown.setValue(this.plugin.settings.openLocation);
				dropdown.onChange(async (value: "bottom" | "right" | "tab") => {
					this.plugin.settings.openLocation = value;
					await this.plugin.saveSettings();
				});
			});

		containerEl.createEl("h2", { text: "Appearance" });

		// Font family
		new Setting(containerEl)
			.setName("Font family")
			.setDesc(
				"Use a Nerd Font (e.g. MesloLGS NF) for powerlevel10k support."
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.fontFamily)
					.onChange(async (value) => {
						this.plugin.settings.fontFamily = value;
						await this.plugin.saveSettings();
					})
			);

		// Font size
		new Setting(containerEl)
			.setName("Font size")
			.addSlider((slider) =>
				slider
					.setLimits(8, 32, 1)
					.setValue(this.plugin.settings.fontSize)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.fontSize = value;
						await this.plugin.saveSettings();
					})
			);

		// Cursor style
		new Setting(containerEl)
			.setName("Cursor style")
			.addDropdown((dropdown) => {
				dropdown.addOption("block", "Block");
				dropdown.addOption("underline", "Underline");
				dropdown.addOption("bar", "Bar");
				dropdown.setValue(this.plugin.settings.cursorStyle);
				dropdown.onChange(
					async (value: "block" | "underline" | "bar") => {
						this.plugin.settings.cursorStyle = value;
						await this.plugin.saveSettings();
					}
				);
			});

		// Cursor blink
		new Setting(containerEl)
			.setName("Cursor blink")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.cursorBlink)
					.onChange(async (value) => {
						this.plugin.settings.cursorBlink = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h2", { text: "Advanced" });

		// Scrollback
		new Setting(containerEl)
			.setName("Scrollback lines")
			.setDesc("Number of lines kept in the scrollback buffer.")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.scrollback))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.scrollback = num;
							await this.plugin.saveSettings();
						}
					})
			);

		// WebGL rendering
		new Setting(containerEl)
			.setName("GPU-accelerated rendering")
			.setDesc(
				"Uses WebGL for faster terminal rendering. Disable if you see visual glitches."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useWebGL)
					.onChange(async (value) => {
						this.plugin.settings.useWebGL = value;
						await this.plugin.saveSettings();
					})
			);

		// Copy on select
		new Setting(containerEl)
			.setName("Copy on select")
			.setDesc("Automatically copy selected text to clipboard.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.copyOnSelect)
					.onChange(async (value) => {
						this.plugin.settings.copyOnSelect = value;
						await this.plugin.saveSettings();
					})
			);
	}

	private updateShellStatus(el: HTMLSpanElement, shellId: string): void {
		if (shellId === "custom" || shellId.startsWith("_sep_")) {
			el.setText("");
			return;
		}
		const result = validateShell(shellId);
		if (result.valid) {
			el.setText("✓ Detected");
			el.className = "oterm-shell-status oterm-shell-detected";
		} else {
			el.setText("⚠ Not found");
			el.className = "oterm-shell-status oterm-shell-missing";
		}
	}
}
