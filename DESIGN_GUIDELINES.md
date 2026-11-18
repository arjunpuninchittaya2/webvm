# Universal UI & Design Guidelines: Apple / Claude Matte Minimal Dark

> **Document Purpose**: This is a strict design manual for coding agents and frontend engineers. It establishes universal design principles, layout standards, token architectures, and component styling rules to deliver a high-end, matte minimal dark user interface (inspired by Apple macOS native dark controls, Claude Desktop, and Linear).
>
> Any coding agent creating, refactoring, or auditing UI components must adhere strictly to these rules.

---

## 1. Core Aesthetic: Matte Minimal Dark

The aesthetic is **understated, architectural, and tactile**. It avoids loud neon accents, glossy skeuomorphism, and low-contrast muddy greys in favor of crisp, layered neutrals with precise border delineations.

### 1.1 Layered Neutrals Over Saturated Color
- **Deep Base Canvas**: Use deep, neutral dark backgrounds (`#09090b` / `bg-zinc-950`).
- **Elevated Surfaces**: Modals, dropdowns, popovers, and floating toolbars use elevated semi-translucent zinc:
  - Cards & panels: `bg-zinc-900/60` or `bg-neutral-900/70` with `backdrop-blur-sm` or `backdrop-blur-md`.
  - Floating menus & dialogs: `bg-zinc-900/95` or `bg-zinc-950/95` with `backdrop-blur-md` and `shadow-2xl`.
- **Refined Border Geometry**:
  - Never use solid opaque borders for dark-mode separation.
  - Standard container borders: `border border-white/10`.
  - Subtle separators & dividers: `border-white/5`.
  - Focused / active borders: `border-white/20` or a muted, controlled ring (`focus-visible:ring-1 focus-visible:ring-white/20`).

### 1.2 Translucent Neutral Selection (No Neon Clashes)
- Selected items, active tabs, and filter pills must use **translucent neutral fills**:
  ```tsx
  // Active selection
  "bg-white/10 text-white font-medium"
  // Hover state
  "hover:bg-white/5 hover:text-white transition-colors"
  ```
- Do **not** use saturated full-bleed accent fills (e.g. bright blue or purple solid backgrounds) for ordinary list selections or menu items. Reserve colored badges strictly for explicit status or semantic meaning.

### 1.3 Strict Zero-Emoji Policy
- **No emojis anywhere in the UI.** No exceptions (no 🚀, 💡, 🔥, ⚠️, ❌, etc.).
- Use exclusively clean, lightweight SVG icons (recommended: **Lucide** / `lucide-react`).
- Maintain consistent icon sizing:
  - Mini / inline with text: `h-3 w-3` or `h-3.5 w-3.5` (stroke width: 1.5–2px).
  - Standard action button / navigation: `h-4 w-4`.
  - Card header / modal hero: `h-5 w-5`.
- Always pair icons with clean typography or explicit accessible labels (`aria-label`, `title`).

### 1.4 Zero-Clutter Host Policy
- When building extensions, embedded widgets, or in-page tools, **never inject persistent floating HUDs, sticky banners, or obtrusive overlays** into the host environment or canvas.
- UI must remain localized to its own dedicated container, side panel, or modal view.
- Ephemeral inspection states (such as element highlights or bounding boxes) must be applied surgically and cleared immediately upon dismissal, deletion, or action completion.

---

## 2. Typography & Hierarchy Standards

Maintain strict proportional sizing. Professional tools look crisp because their body copy and controls are compact, readable, and information-dense.

| Role | Tailwind Class | Size / Leading | Weight | Color Token | Notes |
|---|---|---|---|---|---|
| **View / Modal Title** | `text-sm font-semibold` | 14px / 20px | `600` | `text-zinc-100` | Concise, title case |
| **Section Header** | `text-xs font-semibold` | 12px / 16px | `600` | `text-foreground` / `text-zinc-200` | Used on card & group headers |
| **Primary Body** | `text-xs font-normal` | 12px / 18px | `400` | `text-zinc-200` | Default reading text |
| **Secondary / Subtitle** | `text-[11px] leading-relaxed` | 11px / 16px | `400` | `text-zinc-400` / `text-muted-foreground` | Descriptions, helper labels |
| **Group / Category** | `text-[10px] uppercase tracking-wider` | 10px / 14px | `600` | `text-zinc-500` | Menu headers, metadata dividers |
| **Code / Numbers / Math** | `text-[10px] font-mono` | 10px / 14px | `400` | `text-zinc-400` / `text-zinc-300` | Equations, IDs, stats, tokens |

### Mathematical & Equation Formatting
- When rendering math equations or expressions, always use monospace styling with wrap-anywhere capabilities:
  ```tsx
  "font-mono text-[11px] break-all select-text text-zinc-200"
  ```
- Always display full equations (e.g. `12.7% * 10! = 460857.6`) rather than only isolated scalar outputs.

---

## 3. Dropdowns, Menus & Overlay Physics

Overlays must feel physically connected to their triggers rather than floating disconnectedly or opening disruptive full-screen drawers.

### 3.1 Dropdown & Popover Motion Curves
All popover surfaces (dropdowns, selectors, context menus) should use snappy, spring-damped easing curves (`cubic-bezier(0.16, 1, 0.3, 1)`):

```css
@keyframes menu-show {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@keyframes menu-hide {
  from {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
  to {
    opacity: 0;
    transform: scale(0.96) translateY(-4px);
  }
}
```

- **Duration**: `0.15s` to `0.18s`.
- **Menu Surface Shell**:
  ```tsx
  "rounded-xl border border-white/10 bg-zinc-900/95 p-1.5 shadow-xl backdrop-blur-md"
  ```
- **Menu Item Styling**:
  ```tsx
  // Default item
  "flex items-center justify-between py-1.5 px-2 text-xs rounded-md cursor-pointer text-zinc-300 hover:bg-white/5 hover:text-white transition-colors"
  
  // Active item
  "bg-white/10 text-white font-medium"
  ```

### 3.2 Contextual Anchoring Over Drawers
- Contextual actions (model switching, filter lists, action menus, session selectors) must attach directly to their trigger element via anchor-positioned popovers or dropdown menus.
- Avoid full-height sliding side drawers for lightweight secondary options.

---

## 4. Input Fields, Composer Cards & Attachment Strips

### 4.1 Composer Card Container
Input composers (chat boxes, prompt bars, search consoles) should be styled as unified, tactile cards:
```tsx
<div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-2.5 shadow-xs transition-all focus-within:border-white/20">
  {/* Attachment strip (if any) */}
  {/* Textarea / ContentEditable */}
  {/* Bottom action bar */}
</div>
```

### 4.2 Single Unified Action Trigger
- Group related secondary actions (file upload, element picking, scraping) into a single subtle `+` (`Plus`) icon dropdown button on the bottom left.
- Avoid spreading multiple one-off icon buttons across the action row. Keep the composer uncluttered.

### 4.3 Thumbnail Previews & Media Strips
- **In-Composer Attachment Strip**:
  - Appears smoothly above the input area.
  - Image preview thumbnails: `h-12 w-12 rounded-lg overflow-hidden border border-white/10 bg-zinc-800/80` with a hover `X` (`X`) dismiss button.
  - File / document previews: `h-12 px-2.5 rounded-lg border border-white/10 bg-zinc-800/80 flex items-center gap-2 text-xs text-zinc-300`.
- **Sent Message Previews**:
  - Image grids render as compact rounded square cards (`h-14 w-14 rounded-lg overflow-hidden border border-white/10 bg-zinc-800/80`) positioned above prompt text.

---

## 5. Inline Interactive Reference Pills (Tags & Targets)

When a prompt or message references an external entity (such as a DOM node, code symbol, file path, database record, or memory item), render an **inline interactive pill** rather than unformatted raw strings:

1. **Visual Structure**:
   - Background & Border: `bg-zinc-800/90 border border-white/10 text-zinc-200 text-xs font-mono`.
   - Prefix Badge / Bracket: Subtle warm amber/gold bracket or glyph (`text-amber-400 font-bold font-mono text-[11px]`).
   - Label: Monospace truncated label (`font-mono text-zinc-200 truncate max-w-[180px]`).
   - Dismiss / Remove: Subtle `×` button (`text-zinc-400 hover:text-white transition-colors`).
2. **Atomic Behavior**:
   - When placed inside contenteditable fields, pills must delete **atomically** (one backspace or delete keypress deletes the entire token, never leaving half-broken text fragments).
   - Any active highlighting or external association connected to the pill must be cleaned up immediately upon deletion.
3. **Serialization Protocol**:
   - Always define a clean serialization syntax for storage and API transmission (e.g. `[entityType: <id>] ("<label>")`) so backend systems and LLMs can parse them unambiguously.

---

## 6. Semantic Notices, Alerts & State Indicators

Always separate semantic notifications into calm, purpose-built states. Never throw raw unformatted JSON or unhandled exceptions onto the user screen.

### 6.1 Clean Error Presentation
- **Never display raw upstream JSON blobs** (e.g. `{"error": {"code": 500, "message": "..."}}`).
- Strip boilerplate prefixes (`Error: `, `API Error: `, `Provider returned error: `).
- Format actionable, readable text explaining what failed and what the user can do to fix it.

### 6.2 Semantic Alert Color Palette
Alerts must use soft, translucent tints with crisp borders rather than blinding solid backgrounds:

| State | Container Styling | Icon & Text Accent |
|---|---|---|
| **Critical Error / Destructive** | `border border-rose-500/20 bg-rose-500/10 text-rose-300` | Rose (`text-rose-400`) |
| **Warning / Limit Approaching** | `border border-amber-500/20 bg-amber-500/10 text-amber-300` | Amber (`text-amber-400`) |
| **Success / Connected** | `border border-emerald-500/20 bg-emerald-500/10 text-emerald-300` | Emerald (`text-emerald-400`) |
| **Neutral Info / Context** | `border border-white/10 bg-white/5 text-zinc-300` | Zinc (`text-zinc-400`) |

### 6.3 Proportional Warning Thresholds
- Informational dialogs (e.g., context capacity, storage usage, memory monitors) must default to **calm neutral styling** when usage is within healthy limits (< 80%).
- Reserve amber/rose warning states strictly for high usage (>= 80%) or exhausted limits (>= 95%). Do not show alarming warnings prematurely.

---

## 7. Interactive Controls & Dashboard Uniformity

All settings views, dashboards, tool tabs, and configuration cards must share unified control primitives:

### 7.1 Buttons
- **Standard Action**: `h-8 px-3 rounded-lg text-xs font-medium transition-all active:scale-[0.97]`
- **Primary Fill**: `bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs`
- **Ghost / Neutral**: `text-zinc-400 hover:text-white hover:bg-white/5`
- **Outline**: `border border-white/10 bg-transparent hover:bg-white/5 text-zinc-200`

### 7.2 Form Inputs & Textareas
- Base: `rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none`
- Textareas: Same border and background rules, with `resize-none` or controlled vertical resize and custom subtle scrollbars.

### 7.3 Switches & Toggles (Apple-Style)
- **Track**: `h-5 w-9 rounded-full transition-colors border border-white/10`
  - Unchecked: `bg-zinc-800`
  - Checked: `bg-white/25` or primary theme accent
- **Thumb**: `h-4 w-4 rounded-full bg-white shadow-xs transition-transform` (translate 16px when checked).

### 7.4 Modals & Dialogs
- **Backdrop**: `fixed inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-150`
- **Dialog Box**: `rounded-2xl border border-white/10 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-md animate-in zoom-in-95 duration-150`

---

## 8. Agent Pre-Commit Verification Checklist

Whenever generating or refactoring UI components, run through this checklist before marking work complete:

- [ ] **Zero-Emoji Check**: Did you use any unicode emojis? Replace them with Lucide SVG icons.
- [ ] **Neutral Matte Palette**: Are borders `border-white/10` or `border-white/5`? Are active fills translucent neutrals (`bg-white/10`)?
- [ ] **Typography Scale**: Are labels `text-xs` (12px), metadata `text-[11px]` (11px), or badges `text-[10px]` (10px)?
- [ ] **No In-Host Clutter**: Are there any unnecessary floating badges or sticky overlays injected into the main view?
- [ ] **Math & Data Wrap**: Do equations, tokens, and code snippets use monospace styling and `break-all` without clipping?
- [ ] **Clean Errors**: Are error states parsed into human-friendly strings without raw JSON payloads?
- [ ] **Motion & Feedback**: Do dropdowns, popovers, and buttons have subtle transitions (`active:scale-[0.97]`, smooth opacity/scale)?
- [ ] **Accessibility**: Do icon-only buttons include `aria-label` or `title` tooltips?
- [ ] **Semantic Color Discipline**: Are rose and amber colors reserved strictly for actual errors and critical thresholds?
