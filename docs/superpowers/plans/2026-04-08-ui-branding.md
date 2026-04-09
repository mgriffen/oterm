# oterm UI Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give oterm a distinct visual identity — custom Ot icon, branded tab bar, dblclick rename fix, "+" button accent styling, and settings header branding.

**Architecture:** All changes are UI/CSS layer. A new SVG constant is registered as a custom Obsidian icon and referenced from ribbon, sidebar tab, tab bar brand element, and settings. The tab bar gets a non-interactive brand anchor prepended before tabs. CSS changes restyle the "+" button to use accent color. A one-line fix in the tab click handler resolves the dblclick rename bug.

**Tech Stack:** TypeScript, Obsidian Plugin API (`addIcon`, `setIcon`, `getIcon`), CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-04-08-ui-branding-design.md`

---

### Task 1: Add Ot icon SVG constant and register it

**Files:**
- Modify: `src/constants.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Add OTERM_ICON_SVG to constants.ts**

Add after the existing constants:

```typescript
export const OTERM_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="8"/><text x="50" y="68" text-anchor="middle" font-family="sans-serif" font-size="52" font-weight="600" fill="currentColor">t</text></svg>`;
```

The icon is a circle (O) with a centered lowercase t inside. `currentColor` inherits from context so it works in all Obsidian themes. The viewBox is 100x100 for clean scaling.

- [ ] **Step 2: Register icon and update ribbon in main.ts**

In `src/main.ts`, add the import:

```typescript
import { OTERM_ICON_SVG } from "./constants";
```

Also add `addIcon` to the obsidian import:

```typescript
import { addIcon, Plugin, WorkspaceLeaf } from "obsidian";
```

At the top of `onload()`, before `this.registerView(...)`, add:

```typescript
addIcon("oterm-icon", OTERM_ICON_SVG);
```

Change the `addRibbonIcon` call (line 85) from:

```typescript
this.addRibbonIcon("terminal", "Open terminal", () => {
```

to:

```typescript
this.addRibbonIcon("oterm-icon", "oterm", () => {
```

- [ ] **Step 3: Update sidebar tab icon in terminal-view.ts**

In `src/terminal/terminal-view.ts`, change `getIcon()` (line 35-37) from:

```typescript
getIcon(): string {
    return "terminal";
}
```

to:

```typescript
getIcon(): string {
    return "oterm-icon";
}
```

- [ ] **Step 4: Verify in Obsidian**

Run `scripts/dev-install.sh` to deploy, reload Obsidian, confirm:
- Ribbon shows the Ot icon (circle with t) instead of the terminal icon
- Ribbon tooltip says "oterm"
- Right sidebar tab header shows the Ot icon

- [ ] **Step 5: Commit**

```bash
git add src/constants.ts src/main.ts src/terminal/terminal-view.ts
git commit -m "feat: add custom Ot icon, register via addIcon, use in ribbon and sidebar"
```

---

### Task 2: Add brand element to tab bar

**Files:**
- Modify: `src/ui/tab-bar.ts`
- Modify: `styles.css`

- [ ] **Step 1: Add brand element in tab-bar.ts render()**

In `src/ui/tab-bar.ts`, add `setIcon` is already imported. At the top of `render()`, after `this.containerEl.empty();` and **before** the `tabsEl` creation, add:

```typescript
const brandEl = this.containerEl.createDiv({ cls: "oterm-tab-brand" });
setIcon(brandEl, "oterm-icon");
```

The full `render()` method should now read:

```typescript
render(): void {
    this.containerEl.empty();

    const brandEl = this.containerEl.createDiv({ cls: "oterm-tab-brand" });
    setIcon(brandEl, "oterm-icon");

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
```

- [ ] **Step 2: Add .oterm-tab-brand CSS**

In `styles.css`, add after the `.oterm-tab-bar` block (after line 43):

```css
.oterm-tab-brand {
    display: flex;
    align-items: center;
    padding-left: 8px;
    padding-right: 4px;
    color: var(--text-muted);
    pointer-events: none;
    flex-shrink: 0;
}

.oterm-tab-brand svg {
    width: 16px;
    height: 16px;
}
```

- [ ] **Step 3: Verify in Obsidian**

Deploy and reload. Confirm:
- Ot icon appears as the leftmost element of the tab bar
- It is muted color, 16px, not clickable
- Tabs still render correctly to the right of it

- [ ] **Step 4: Commit**

```bash
git add src/ui/tab-bar.ts styles.css
git commit -m "feat: add Ot branding element to tab bar"
```

---

### Task 3: Fix double-click rename bug and add tooltip

**Files:**
- Modify: `src/ui/tab-bar.ts`

- [ ] **Step 1: Fix the click handler in renderTab()**

In `src/ui/tab-bar.ts`, in `renderTab()`, change the click handler from:

```typescript
tabEl.addEventListener("click", () => {
    this.manager.switchTo(entry.id);
});
```

to:

```typescript
tabEl.addEventListener("click", () => {
    if (entry.id !== this.manager.getActiveId()) {
        this.manager.switchTo(entry.id);
    }
});
```

This skips `switchTo()` (which triggers `render()` and destroys the DOM) when clicking the already-active tab, allowing the second click of a double-click to land on the same element and fire the `dblclick` event.

- [ ] **Step 2: Add rename tooltip to label**

In `renderTab()`, after the `labelEl` creation:

```typescript
const labelEl = tabEl.createSpan({
    cls: "oterm-tab-label",
    text: entry.name,
});
```

Add immediately after:

```typescript
labelEl.setAttribute("title", "Double-click to rename");
```

- [ ] **Step 3: Verify in Obsidian**

Deploy and reload. With 2+ tabs open:
- Double-click a tab label — rename input should appear
- Click an inactive tab — it switches (render fires)
- Click the already-active tab — nothing happens (no flicker), double-click works
- Hover over a tab label — tooltip "Double-click to rename" appears

- [ ] **Step 4: Commit**

```bash
git add src/ui/tab-bar.ts
git commit -m "fix: dblclick rename by skipping switchTo on active tab, add rename tooltip"
```

---

### Task 4: Style the "+" button with accent color

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Update .oterm-tab-new CSS**

In `styles.css`, replace the existing `.oterm-tab-new` rules (lines 96-111):

```css
.oterm-tab-new {
	display: flex;
	align-items: center;
	padding: 4px 8px;
	cursor: pointer;
	opacity: 0.5;
}

.oterm-tab-new:hover {
	opacity: 1;
}

.oterm-tab-new svg {
	width: 14px;
	height: 14px;
}
```

with:

```css
.oterm-tab-new {
	display: flex;
	align-items: center;
	padding: 4px 8px;
	cursor: pointer;
	color: var(--interactive-accent);
}

.oterm-tab-new:hover {
	color: var(--interactive-accent-hover);
	background: var(--background-modifier-hover);
}

.oterm-tab-new svg {
	width: 18px;
	height: 18px;
}
```

Changes: removed `opacity` approach, switched to `color: var(--interactive-accent)` for the icon, added hover color, bumped SVG from 14px to 18px.

- [ ] **Step 2: Verify in Obsidian**

Deploy and reload. Confirm:
- "+" button shows in accent color (blue/purple depending on theme)
- Hover brightens the color and shows background
- Icon is visibly larger than before (~18px vs ~14px)

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "style: accent-colored + button with larger icon"
```

---

### Task 5: Brand the settings tab

**Files:**
- Modify: `src/settings-tab.ts`

- [ ] **Step 1: Update the settings header**

In `src/settings-tab.ts`, change line 26:

```typescript
containerEl.createEl("h2", { text: "Terminal" });
```

to:

```typescript
containerEl.createEl("h2", { text: "oterm" });
containerEl.createEl("p", {
    cls: "setting-item-description",
    text: "Full terminal emulator for Obsidian.",
});
```

- [ ] **Step 2: Verify in Obsidian**

Deploy, open Settings > oterm. Confirm:
- Header reads "oterm" (not "Terminal")
- Tagline "Full terminal emulator for Obsidian." appears below in muted text
- Rest of settings UI unchanged

- [ ] **Step 3: Commit**

```bash
git add src/settings-tab.ts
git commit -m "style: brand settings tab with oterm header and tagline"
```

---

### Task 6: Final verification

- [ ] **Step 1: Full deploy and smoke test**

Run `scripts/dev-install.sh`, reload Obsidian. Walk through every change:

| Check | Expected |
|---|---|
| Ribbon icon | Ot (circle + t), tooltip "oterm" |
| Sidebar tab icon | Ot icon |
| Tab bar, leftmost | Ot brand icon, 16px, muted, non-interactive |
| Tab bar tabs | Render correctly next to brand icon |
| "+" button | Accent color, 18px, hover brightens |
| Double-click rename | Works on active tab (no DOM destruction) |
| Tab label tooltip | "Double-click to rename" on hover |
| Settings header | "oterm" h2 + tagline paragraph |
| Other functionality | Terminal opens, types, multiple tabs, search, close confirm |

- [ ] **Step 2: Commit any fixups if needed**

If anything needed adjustment, commit with:

```bash
git commit -m "fix: ui branding polish adjustments"
```
