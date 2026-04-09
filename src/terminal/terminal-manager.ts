import * as path from "path";
import { TerminalSession, SessionOptions } from "./terminal-session";
import { hasRunningChildren } from "../utils/platform";

let nextId = 1;

export interface SessionEntry {
	id: string;
	name: string;
	session: TerminalSession;
	containerEl: HTMLElement;
}

export class TerminalManager {
	private sessions: Map<string, SessionEntry> = new Map();
	private activeId: string | null = null;
	private onChangeCallbacks: Array<() => void> = [];

	createSession(
		parentEl: HTMLElement,
		options: SessionOptions,
		name?: string
	): string {
		const id = String(nextId++);
		const containerEl = parentEl.createDiv({ cls: "oterm-terminal" });
		containerEl.hide();

		const session = new TerminalSession(containerEl, options);
		session.open();

		const entry: SessionEntry = {
			id,
			name: name ?? this.defaultName(options.shell),
			session,
			containerEl,
		};

		this.sessions.set(id, entry);
		this.switchTo(id);

		return id;
	}

	switchTo(id: string): void {
		const entry = this.sessions.get(id);
		if (!entry) return;

		// Hide current
		if (this.activeId && this.activeId !== id) {
			const current = this.sessions.get(this.activeId);
			current?.containerEl.hide();
		}

		// Show target
		entry.containerEl.show();
		entry.session.fit();
		entry.session.focus();
		this.activeId = id;
		this.notifyChange();
	}

	closeSession(id: string): string | null {
		const entry = this.sessions.get(id);
		if (!entry) return this.activeId;

		entry.session.dispose();
		entry.containerEl.remove();
		this.sessions.delete(id);

		// If we closed the active session, switch to another
		if (this.activeId === id) {
			this.activeId = null;
			const remaining = this.list();
			if (remaining.length > 0) {
				this.switchTo(remaining[remaining.length - 1].id);
			}
		}

		this.notifyChange();
		return this.activeId;
	}

	closeAll(): void {
		for (const [, entry] of this.sessions) {
			entry.session.dispose();
			entry.containerEl.remove();
		}
		this.sessions.clear();
		this.activeId = null;
		this.notifyChange();
		this.onChangeCallbacks.length = 0;
	}

	getActive(): SessionEntry | null {
		if (!this.activeId) return null;
		return this.sessions.get(this.activeId) ?? null;
	}

	getActiveId(): string | null {
		return this.activeId;
	}

	get(id: string): SessionEntry | undefined {
		return this.sessions.get(id);
	}

	list(): SessionEntry[] {
		return Array.from(this.sessions.values());
	}

	count(): number {
		return this.sessions.size;
	}

	rename(id: string, name: string): void {
		const entry = this.sessions.get(id);
		if (entry) {
			entry.name = name;
			this.notifyChange();
		}
	}

	nextSession(): void {
		const ids = Array.from(this.sessions.keys());
		if (ids.length <= 1) return;
		const idx = ids.indexOf(this.activeId ?? "");
		const nextIdx = (idx + 1) % ids.length;
		this.switchTo(ids[nextIdx]);
	}

	prevSession(): void {
		const ids = Array.from(this.sessions.keys());
		if (ids.length <= 1) return;
		const idx = ids.indexOf(this.activeId ?? "");
		const prevIdx = (idx - 1 + ids.length) % ids.length;
		this.switchTo(ids[prevIdx]);
	}

	fitActive(): void {
		this.getActive()?.session.fit();
	}

	async hasActiveProcesses(): Promise<boolean> {
		for (const [, entry] of this.sessions) {
			const pid = entry.session.getPid();
			if (pid !== null && await hasRunningChildren(pid)) {
				return true;
			}
		}
		return false;
	}

	async sessionHasActiveProcess(id: string): Promise<boolean> {
		const entry = this.sessions.get(id);
		if (!entry) return false;
		const pid = entry.session.getPid();
		if (pid === null) return false;
		return hasRunningChildren(pid);
	}

	onChange(callback: () => void): () => void {
		this.onChangeCallbacks.push(callback);
		return () => {
			const idx = this.onChangeCallbacks.indexOf(callback);
			if (idx >= 0) this.onChangeCallbacks.splice(idx, 1);
		};
	}

	private notifyChange(): void {
		for (const cb of this.onChangeCallbacks) {
			cb();
		}
	}

	private defaultName(shell: string): string {
		return path.basename(shell).replace(/\.exe$/i, "");
	}
}
