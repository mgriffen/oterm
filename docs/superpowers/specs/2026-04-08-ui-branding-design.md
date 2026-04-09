# oterm UI Polish & Branding — Design Spec

## Goal

Give oterm a distinct visual identity and fix UI rough edges in the tab bar before pursuing cross-platform and community plugin release. This is sub-project 1 of the production readiness effort.

## Scope

This spec covers branding, tab bar UX, and the "+" button. It does not cover shell defaults/settings rework, cross-platform native binaries, CI/CD, theming, or community plugin submission — those are separate sub-projects.

---

## 1. Custom Ot Icon

### Design

A monochrome SVG glyph: a capital **O** (circle/ellipse) with a small lowercase **t** centered inside it. Clean, geometric, single-path. The icon must render clearly at 16x16, 20x20, and 24x24 pixels.

### Registration

Register via Obsidian's `addIcon("oterm-icon", svgString)` in `main.ts` `onload()`. This makes it available by name anywhere Obsidian expects an icon ID.

### Usage Points

| Location | Current | New |
|---|---|---|
| Ribbon button icon | Lucide `terminal` | `oterm-icon` |
| Ribbon button tooltip | "Open terminal" | "oterm" |
| Right sidebar tab icon | Lucide `terminal` (via `getIcon()`) | `oterm-icon` |
| Tab bar left anchor | (none) | `oterm-icon`, 16x16, non-interactive, muted color |

### Implementation

- Define the SVG string as a constant in `constants.ts`
- Call `addIcon("oterm-icon", OTERM_ICON_SVG)` in `onload()` before `addRibbonIcon`
- Change `addRibbonIcon("terminal", ...)` to `addRibbonIcon("oterm-icon", ...)`
- Change `getIcon()` in `TerminalView` to return `"oterm-icon"`
- Change ribbon tooltip from `"Open terminal"` to `"oterm"`

---

## 2. Tab Bar Layout

### Current Layout

```
[tab1] [tab2] ... [+]
```

### New Layout

```
[Ot] [tab1] [tab2] ... [+]
```

### Ot Branding Element

- Rendered as the first child of `.oterm-tab-bar`, before `.oterm-tabs`
- CSS class: `.oterm-tab-brand`
- Contains the Ot icon SVG via `setIcon(el, "oterm-icon")`
- Size: 16x16 icon within a 32px-tall container (matches tab height)
- Color: `--text-muted` (subtle, not attention-grabbing)
- Non-interactive (no click handler, `pointer-events: none` or simply no handler)
- Left padding ~8px, right padding ~4px before first tab

### File Changes

- `tab-bar.ts`: add brand element creation in `render()`, before the tabs div

---

## 3. Double-Click Rename Fix

### Bug

The `click` handler on each tab calls `manager.switchTo(id)`, which fires `notifyChange()`, which calls `render()`. This destroys and recreates the entire tab bar DOM. By the time the second click of a double-click arrives, the original `<span>` element is gone, so the `dblclick` event never fires.

### Fix

In the tab `click` handler, skip `switchTo()` if the clicked tab is already the active tab. The active tab's DOM survives, and the `dblclick` fires normally.

```typescript
tabEl.addEventListener("click", () => {
    if (entry.id !== this.manager.getActiveId()) {
        this.manager.switchTo(entry.id);
    }
});
```

### Rename Tooltip

Add a `title` attribute to the label element: `"Double-click to rename"`. This provides discoverability without adding visual clutter.

```typescript
labelEl.setAttribute("title", "Double-click to rename");
```

---

## 4. "+" Button Styling

### Current State

The "+" button uses default icon sizing (~14px) and inherits `--text-muted` color. It blends in with the tab bar and is easy to miss.

### New Styling

CSS changes to `.oterm-tab-new`:

| Property | Current | New |
|---|---|---|
| Icon color | `--text-muted` | `--interactive-accent` |
| Icon size (via inner SVG) | ~14px | 18px |
| Hover background | `--background-modifier-hover` | `--background-modifier-hover` (keep) |
| Hover color | (unchanged) | `--interactive-accent-hover` |
| Tooltip | "New terminal" | "New terminal" (already set, keep) |

### Implementation

CSS-only change in `styles.css`. Set `color` and adjust the SVG sizing within `.oterm-tab-new`.

```css
.oterm-tab-new {
    color: var(--interactive-accent);
}
.oterm-tab-new:hover {
    color: var(--interactive-accent-hover);
}
.oterm-tab-new svg {
    width: 18px;
    height: 18px;
}
```

---

## 5. Settings Tab Branding

### Current

The settings tab header is:
```
Terminal          (h2)
```

### New

```
oterm             (h2)
Full terminal emulator for Obsidian.    (p, muted)
```

### Implementation

In `settings-tab.ts`, change the first `createEl("h2")` text from `"Terminal"` to `"oterm"`, and add a `<p>` element below it with `cls: "setting-item-description"` and text `"Full terminal emulator for Obsidian."`.

---

## Files Changed

| File | Changes |
|---|---|
| `src/constants.ts` | Add `OTERM_ICON_SVG` constant |
| `src/main.ts` | Call `addIcon()` in `onload()`, update `addRibbonIcon` icon name and tooltip |
| `src/terminal/terminal-view.ts` | Update `getIcon()` return value |
| `src/ui/tab-bar.ts` | Add brand element, fix dblclick bug, add rename tooltip |
| `src/settings-tab.ts` | Update header to "oterm" + tagline |
| `styles.css` | Add `.oterm-tab-brand` styles, update `.oterm-tab-new` styles |

## Files Not Changed

- No new files created
- No changes to terminal-session.ts, pty-bridge.ts, native-loader.ts, platform.ts, terminal-manager.ts, search-bar.ts, confirm-modal.ts
- No theme changes (Catppuccin Mocha stays as-is for v1)
