# Design Token System

This is a workspace-internal guide for spreadsheet app, shell, and bundle-composition
contributors. It is not a public UI package guide.

## Current Status

| Surface | Status | Notes |
| ------- | ------ | ----- |
| `apps/spreadsheet/src/infra/styles/globals.css` and `tokens.css` | workspace-internal source | Spreadsheet app token sources. `tokens.css` mirrors the token set without shell/global imports for source-level integration and build contexts. |
| `@mog-sdk/spreadsheet-app/styles.css` and `@mog-sdk/spreadsheet-app/mog-embed.css` | public-experimental | Shipped stylesheet entry points for the public full-app embed package. |
| `@mog/shell` | reserved | Private workspace package. Use its primitives in repo-local apps and bundle composition, but do not document it as a direct public dependency. |
| `@mog/icons` | workspace-internal generated asset | Private workspace package generated from 256 SVG source assets. |
| `@mog-sdk/contracts/theme` and `@mog-sdk/contracts/formatting/theme` | public-experimental | Public theme type exports; source lives under `types/formatting`. |

## Principles

1. **Spreadsheet Token Source** - Spreadsheet tokens live in `globals.css`; `tokens.css` mirrors them without shell/global imports for source-level integration and build contexts
2. **Semantic Naming** - Tokens describe purpose, not appearance (`bg-ss-primary` not `bg-blue`)
3. **Context-Aware Typography** - Different size scales for UI, content, and toolbar contexts
4. **Excel-Compatible Theming** - Workbook themes use 12 OOXML color slots for cell formatting; app source includes 8 color themes and 8 font themes
5. **Tailwind v4 Integration** - Tokens exposed as utility classes via `@theme inline`
6. **UI Primitives First** - In repo-local UI, prefer `@mog/shell` / `components/ui/` primitives before building custom controls

## Architecture

```
Repo-local UI -> @mog/shell primitives -> Semantic tokens -> Tailwind v4 @theme -> CSS variables/classes
                                                          |
                                              Workbook ThemeData via Rust bridge
```

## Key Files

| File                                                                                 | Purpose                                               |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| [`apps/spreadsheet/src/infra/styles/globals.css`](../../../apps/spreadsheet/src/infra/styles/globals.css) | Spreadsheet app design tokens, shell global import, local font faces, and app utilities |
| [`apps/spreadsheet/src/infra/styles/tokens.css`](../../../apps/spreadsheet/src/infra/styles/tokens.css) | Source token mirror without shell/base/font imports; not a package export |
| [`runtime/spreadsheet-app/package.json`](../../../runtime/spreadsheet-app/package.json) | Public full-app package manifest with public-experimental `./styles.css` and `./mog-embed.css` exports |
| [`apps/spreadsheet/src/infra/styles/built-in-themes.ts`](../../../apps/spreadsheet/src/infra/styles/built-in-themes.ts) | 8 workbook color themes and 8 built-in font themes |
| [`contracts/src/formatting/theme.ts`](../../../contracts/src/formatting/theme.ts) | Public-experimental theme type re-export via `@mog-sdk/contracts` |
| [`types/formatting/src/formatting/theme.ts`](../../../types/formatting/src/formatting/theme.ts) | Source theme type definitions |
| [`spreadsheet-utils/src/formatting/theme.ts`](../../../spreadsheet-utils/src/formatting/theme.ts) | Workspace-internal theme color/font resolution utilities |
| [`shell/src/components/ui/`](../../../shell/src/components/ui/)                         | Reserved workspace UI primitives for repo-local use |
| [`infra/icons/src/`](../../../infra/icons/src/)                                         | Workspace-internal SVG icon source of truth |

## Icons

Repo-local spreadsheet toolbar and app chrome icons should come from `@mog/icons` when
an icon exists. `@mog/icons` is a private generated-asset package today, so public
docs should not tell external consumers to depend on it directly.

Avoid adding new inline SVGs or external icon-library imports for reusable spreadsheet
toolbar icons when an `@mog/icons` source asset exists. Existing app areas may still
use `lucide-react` or `react-icons` for non-toolbar or not-yet-migrated icons; do not
treat those as precedent for reusable spreadsheet chrome.

```tsx
// Preferred in repo-local toolbar code - import SVG components from @mog/icons
import { BoldSvg, ItalicSvg, UndoSvg, wrapIcon } from '@mog/icons';

const BoldIcon = wrapIcon(BoldSvg);

// Avoid for reusable toolbar icons when @mog/icons has the asset
<svg viewBox="0 0 24 24">...</svg>;

// Avoid adding another icon source for an existing @mog/icons asset
import { Bold } from '@fluentui/react-icons';
```

### Icon Guidelines

- **256 icons** organized by category (text-formatting, alignment, clipboard, etc.)
- **24px source assets** whose primary strokes use `currentColor`; limited accent fills/strokes follow the icon spec
- **`wrapIcon` sizing** defaults to 16px toolbar icons and supports `toolbarLarge`, `menu`, and `dialog` sizes
- **Viewer**: Open `infra/icons/viewer.html` to see all icons
- **Design spec**: See [`infra/icons/spec.md`](../../../infra/icons/spec.md) for design rules

---

## Token Categories

This section summarizes the common tokens. The source files also define specialized
tokens for trace arrows, resize/drag feedback, row selection, overlays, animation,
and dark-mode overrides.

### Colors

| Category                   | Tokens                                                                                                                     | Usage                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Primary**                | `--color-ss-primary`, `--color-ss-primary-hover`, `--color-ss-primary-light`                                                        | Interactive elements, links, focus states |
| **Surface**                | `--color-ss-surface`, `--color-ss-surface-secondary`, `--color-ss-surface-hover`                                                    | Backgrounds, panels                       |
| **Text**                   | `--color-ss-text`, `--color-ss-text-secondary`, `--color-ss-text-disabled`                                                          | Typography                                |
| **Border**                 | `--color-ss-border`, `--color-ss-border-light`, `--color-ss-border-focus`                                                           | Dividers, input borders                   |
| **Status**                 | `--color-ss-success`, `--color-ss-warning`, `--color-ss-error`, `--color-ss-info`                                                      | Icons, badges, alerts                     |
| **Status Backgrounds**     | `--color-ss-success-bg`, `--color-ss-warning-bg`, `--color-ss-error-bg`, `--color-ss-info-bg`                                          | Alert/badge backgrounds                   |
| **Status Text**            | `--color-ss-success-text`, `--color-ss-warning-text`, `--color-ss-error-text`, `--color-ss-info-text`                                  | Text on status backgrounds                |
| **Connection States**      | `--color-ss-state-idle`, `--color-ss-state-connecting`, `--color-ss-state-connected`, `--color-ss-state-synced`, `--color-ss-state-error` | Real-time connection indicators           |
| **Diff/Changes**           | `--color-ss-diff-added`, `--color-ss-diff-modified`, `--color-ss-diff-removed`, `--color-ss-diff-direct`, `--color-ss-diff-indirect`      | Review mode, cell changes                 |
| **Conditional Formatting** | `--color-ss-cf-positive`, `--color-ss-cf-neutral`, `--color-ss-cf-negative`, `--color-ss-cf-blue`                                      | Excel-compatible color scales             |
| **Data Bars**              | `--color-ss-databar-blue`, `--color-ss-databar-green`, `--color-ss-databar-red`, `--color-ss-databar-orange`                           | Excel-compatible data bars                |
| **Trace/Drag/Resize**      | `--color-ss-trace-*`, `--color-ss-drag-*`, `--color-ss-resize-*`                                                              | Grid overlays and interaction feedback    |
| **Selection/Overlay**      | `--color-ss-row-selected`, `--color-ss-overlay`, `--color-ss-overlay-heavy`                                                    | Selected rows and modal backdrops         |
| **Brand**                  | `--color-ss-brand`, `--color-ss-brand-hover`, `--color-ss-brand-light`                                                              | Marketing pages, branded elements         |

### Typography

| Token/Class              | Size | Usage                                                      |
| ------------------------ | ---- | ---------------------------------------------------------- |
| **UI Context**           |      |                                                            |
| `.text-subtitle`         | 18px | Section titles                                             |
| `.text-section`          | 16px | Subsection titles                                          |
| `.text-body`             | 14px | Body text                                                  |
| `.text-body-sm`          | 13px | Compact body text                                          |
| `.text-body-lg`          | 16px | Larger body text                                           |
| `.text-label`            | 13px | Form labels                                                |
| `.text-caption`          | 12px | Captions, help text                                        |
| `.text-hint`             | 11px | Subtle hints                                               |
| **Toolbar Context**      |      |                                                            |
| `--text-tab`             | 12px | Ribbon tab headers (Home, Insert...)                       |
| `--text-ribbon`          | 11px | Ribbon button labels                                       |
| `--text-ribbon-compact`  | 10px | Compact ribbon labels, kbd shortcuts, tooltip descriptions |
| `--text-ribbon-group`    | 9px  | Group labels (Clipboard, Font...)                          |
| `--text-ribbon-chip`     | 7px  | Style preview chips                                        |
| `--text-dropdown`        | 13px | Dropdown menu items                                        |
| `--text-dropdown-header` | 11px | Dropdown section headers                                   |
| `--text-sheet-tab`       | 13px | Sheet tabs                                                 |

### Other Categories

- **Spacing**: 4px base scale with half steps where needed (`--spacing-ss-0_5`, `--spacing-ss-1`, `--spacing-ss-1_5`, `--spacing-ss-2`, `--spacing-ss-2_5`, `--spacing-ss-3`, `--spacing-ss-4`, `--spacing-ss-5`, `--spacing-ss-6`, `--spacing-ss-8`)
- **Layout**: Runtime variables for ribbon/tabbar dimensions
- **Effects**: Shadows, border radius, z-index, transitions

## Usage Pattern

```tsx
// Components use semantic Tailwind classes
<button className="bg-ss-primary text-ss-text-inverse hover:bg-ss-primary-hover" />
<span className="text-ribbon">Bold</span>           // Toolbar context
<span className="text-ribbon-compact">Define</span> // Compact ribbon labels
<p className="text-body">Content</p>                // UI context

// Status indicators
<div className="bg-ss-success-bg text-ss-success-text">Connected</div>
<div className="bg-ss-state-connected-bg text-ss-state-connected">Online</div>

// Diff highlighting
<span className="bg-ss-diff-added-bg text-ss-diff-added">Added</span>

// Brand elements (marketing, not UI chrome)
<button className="bg-ss-brand hover:bg-ss-brand-hover">Get Started</button>
```

## Typography Rules

These are target rules for new or touched toolbar/ribbon components. Some legacy,
collaboration, and specialty chrome still uses Tailwind defaults or arbitrary values;
do not copy those patterns when updating spreadsheet chrome.

**Avoid in toolbar/ribbon components:**

- `text-xs`, `text-sm`, `text-base` (Tailwind defaults - wrong sizes)
- `text-[12px]` (arbitrary values - not from source of truth)
- `font-size: 12px` (inline styles - not from source of truth)

**Use semantic tokens instead:**

- `text-tab`, `text-ribbon`, `text-ribbon-compact`, `text-ribbon-group`, `text-dropdown`, etc.

## Workbook Themes

Cell formats can reference theme colors: `'theme:accent1'` or `'theme:accent1:0.4'` (with tint).

The public-experimental type export is `@mog-sdk/contracts/theme` (also available as
`@mog-sdk/contracts/formatting/theme`). The source type file is
[`types/formatting/src/formatting/theme.ts`](../../../types/formatting/src/formatting/theme.ts).

Runtime workbook theme APIs are async through the Rust bridge
(`getWorkbookTheme()` / `setWorkbookTheme()`), while chrome theme APIs are TS-only
session state (`getChromeTheme()` / `setChromeTheme()`). See
[`kernel/src/api/workbook/theme.ts`](../../../kernel/src/api/workbook/theme.ts) for
the bridge conversion and [`spreadsheet-utils/src/formatting/theme.ts`](../../../spreadsheet-utils/src/formatting/theme.ts)
for `resolveColor()`, `resolveThemeColors()`, and font resolution helpers.

---

## UI Primitives

Use shell primitives instead of building custom implementations in repo-local code.
They centralize token usage and, for Radix-backed controls, accessibility behavior.
`@mog/shell` is a reserved/private workspace package, not a shipped public UI
library. Spreadsheet code typically imports these from `@mog/shell` or
`@mog/shell/components/ui`; public hosts should use the shipped embed/app packages
instead of importing shell directly.

### Form Elements

| Primitive          | Import              | Usage                                                                     |
| ------------------ | ------------------- | ------------------------------------------------------------------------- |
| `Button`           | `from '@mog/shell'` | All buttons - supports `primary`, `secondary`, `ghost`, `danger` variants |
| `Input`            | `from '@mog/shell'` | Single-line text inputs                                                   |
| `Textarea`         | `from '@mog/shell'` | Multi-line text inputs - supports `resize` option                         |
| `Select`           | `from '@mog/shell'` | Dropdown selections                                                       |
| `Checkbox`         | `from '@mog/shell'` | Boolean toggles                                                           |
| `RadioGroup`       | `from '@mog/shell'` | Single selection from options - supports descriptions                     |
| `Switch`           | `from '@mog/shell'` | Toggle switch                                                             |
| `SegmentedControl` | `from '@mog/shell'` | Single-choice segmented control                                           |
| `ColorInput`       | `from '@mog/shell'` | Color picker input                                                        |
| `Label`            | `from '@mog/shell'` | Form labels                                                               |
| `FormField`        | `from '@mog/shell'` | Label + input + error/help wrapper                                        |

### Layout Components

| Primitive            | Import              | Usage                                                                 |
| -------------------- | ------------------- | --------------------------------------------------------------------- |
| `Dialog`             | `from '@mog/shell'` | Modal dialogs - use with `DialogHeader`, `DialogBody`, `DialogFooter` |
| `DialogHeader`       | `from '@mog/shell'` | Dialog title bar with close button                                    |
| `DialogBody`         | `from '@mog/shell'` | Dialog content area                                                   |
| `DialogFooter`       | `from '@mog/shell'` | Dialog action buttons                                                 |
| `Tabs`               | `from '@mog/shell'` | Tab navigation - keyboard accessibility via Radix                     |
| `TabPanel`           | `from '@mog/shell'` | Tab content panels                                                    |
| `Popover`            | `from '@mog/shell'` | Anchored floating content                                             |
| `DropdownMenu`       | `from '@mog/shell'` | Menu dropdowns - use with trigger/content/item/separator exports      |
| `ContextMenu`        | `from '@mog/shell'` | Right-click menus - use with trigger/content/item/separator exports   |
| `AccordionRoot`      | `from '@mog/shell'` | Collapsible sections                                                  |
| `Listbox`            | `from '@mog/shell'` | Single-select listbox                                                 |

### Status & Feedback

| Primitive         | Import              | Usage                                                                            |
| ----------------- | ------------------- | -------------------------------------------------------------------------------- |
| `StatusBadge`     | `from '@mog/shell'` | Status indicators - `success`, `warning`, `error`, `info`, `idle`                |
| `ConnectionBadge` | `from '@mog/shell'` | Connection status - `idle`, `connecting`, `connected`, `synced`, `refreshing`, `stale`, `error` |
| `Tooltip`         | `from '@mog/shell'` | Hover tooltips with keyboard shortcut support                                    |
| `EmptyState`      | `from '@mog/shell'` | Empty/loading/error panels                                                       |

### Picker Helpers

| Primitive      | Import              | Usage                             |
| -------------- | ------------------- | --------------------------------- |
| `ColorSwatch`  | `from '@mog/shell'` | Color preview squares             |
| `SectionLabel` | `from '@mog/shell'` | Section headers in pickers/panels |
| `Icon`         | `from '@mog/shell'` | Common shell icons sourced from `@mog/icons` |
| `IconButton`   | `from '@mog/shell'` | Icon-only buttons                 |

### Example Usage

```tsx
import {
  Button,
  Input,
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
  Tabs,
  TabPanel,
  FormField
} from '@mog/shell';

function SettingsDialog({ open, onClose }) {
  const [activeTab, setActiveTab] = useState('general');
  const [name, setName] = useState('');

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} dialogId="settings">
      <DialogHeader onClose={onClose}>Settings</DialogHeader>
      <DialogBody>
        <Tabs
          tabs={[
            { id: 'general', label: 'General' },
            { id: 'advanced', label: 'Advanced' }
          ]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        >
          <TabPanel tabId="general">
            <FormField label="Name" required>
              <Input
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </FormField>
          </TabPanel>
        </Tabs>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave}>
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
```

---

## Token Cheat Sheet

Quick reference for common styling scenarios.

### Colors

| Need                 | Token Class                         | CSS Variable                |
| -------------------- | ----------------------------------- | --------------------------- |
| Primary button       | `bg-ss-primary hover:bg-ss-primary-hover` | `--color-ss-primary`           |
| Secondary background | `bg-ss-surface-secondary`              | `--color-ss-surface-secondary` |
| Text                 | `text-ss-text`                         | `--color-ss-text`              |
| Secondary text       | `text-ss-text-secondary`               | `--color-ss-text-secondary`    |
| Disabled text        | `text-ss-text-disabled`                | `--color-ss-text-disabled`     |
| Border               | `border-ss-border`                     | `--color-ss-border`            |
| Light border         | `border-ss-border-light`               | `--color-ss-border-light`      |
| Focus ring           | `border-ss-border-focus`               | `--color-ss-border-focus`      |

### Status Colors

| Status  | Background      | Text                | Border           |
| ------- | --------------- | ------------------- | ---------------- |
| Success | `bg-ss-success-bg` | `text-ss-success-text` | `border-ss-success` |
| Warning | `bg-ss-warning-bg` | `text-ss-warning-text` | `border-ss-warning` |
| Error   | `bg-ss-error-bg`   | `text-ss-error-text`   | `border-ss-error`   |
| Info    | `bg-ss-info-bg`    | `text-ss-info-text`    | `border-ss-info`    |

### Connection States

| State      | Background               | Text                    |
| ---------- | ------------------------ | ----------------------- |
| Idle       | `bg-ss-state-idle-bg`       | `text-ss-state-idle`       |
| Connecting | `bg-ss-state-connecting-bg` | `text-ss-state-connecting` |
| Connected  | `bg-ss-state-connected-bg`  | `text-ss-state-connected`  |
| Synced     | `bg-ss-state-synced-bg`     | `text-ss-state-synced`     |
| Error      | `bg-ss-state-error-bg`      | `text-ss-state-error`      |

### Diff/Change Tracking

| Change Type         | Background            | Text                 |
| ------------------- | --------------------- | -------------------- |
| Added               | `bg-ss-diff-added-bg`    | `text-ss-diff-added`    |
| Modified            | `bg-ss-diff-modified-bg` | `text-ss-diff-modified` |
| Removed             | `bg-ss-diff-removed-bg`  | `text-ss-diff-removed`  |
| Direct dependency   | `bg-ss-diff-direct-bg`   | `text-ss-diff-direct`   |
| Indirect dependency | `bg-ss-diff-indirect-bg` | `text-ss-diff-indirect` |

### Typography

| Context           | Token Class            | Size |
| ----------------- | ---------------------- | ---- |
| **UI**            |                        |      |
| Section title     | `text-subtitle`        | 18px |
| Subsection        | `text-section`         | 16px |
| Body text         | `text-body`            | 14px |
| Compact body      | `text-body-sm`         | 13px |
| Large body        | `text-body-lg`         | 16px |
| Form label        | `text-label`           | 13px |
| Caption           | `text-caption`         | 12px |
| Hint              | `text-hint`            | 11px |
| **Toolbar**       |                        |      |
| Tab header        | `text-tab`             | 12px |
| Ribbon button     | `text-ribbon`          | 11px |
| Compact label/kbd | `text-ribbon-compact`  | 10px |
| Group label       | `text-ribbon-group`    | 9px  |
| Style chip        | `text-ribbon-chip`     | 7px  |
| Dropdown item     | `text-dropdown`        | 13px |
| Dropdown header   | `text-dropdown-header` | 11px |
| Sheet tab         | `text-sheet-tab`       | 13px |

### Spacing

| Token               | Value | Usage         |
| ------------------- | ----- | ------------- |
| `gap-ss-0_5` / `p-ss-0_5` | 2px   | Tight spacing |
| `gap-ss-1` / `p-ss-1`     | 4px   | Minimal       |
| `gap-ss-1_5` / `p-ss-1_5` | 6px   | Compact       |
| `gap-ss-2` / `p-ss-2`     | 8px   | Standard      |
| `gap-ss-2_5` / `p-ss-2_5` | 10px  | In-between    |
| `gap-ss-3` / `p-ss-3`     | 12px  | Comfortable   |
| `gap-ss-4` / `p-ss-4`     | 16px  | Spacious      |
| `gap-ss-5` / `p-ss-5`     | 20px  | Large gap     |
| `gap-ss-6` / `p-ss-6`     | 24px  | Section       |
| `gap-ss-8` / `p-ss-8`     | 32px  | Large section |

### Z-Index

| Token        | Value | Usage               |
| ------------ | ----- | ------------------- |
| `z-ss-sticky`  | 200   | Sticky headers      |
| `z-ss-overlay` | 300   | Overlays            |
| `z-ss-modal`   | 1000  | Modal dialogs       |
| `z-ss-popover` | 1050  | Popovers/dropdowns  |
| `z-ss-toast`   | 1100  | Toast notifications |
| `z-ss-tooltip` | 1200  | Tooltips            |

### Shadows

| Token             | Usage                   |
| ----------------- | ----------------------- |
| `shadow-ss-sm`       | Subtle elevation        |
| `shadow-ss`          | Standard elevation      |
| `shadow-ss-md`       | Medium elevation        |
| `shadow-ss-lg`       | High elevation (modals) |
| `shadow-ss-xl`       | Extra high elevation    |
| `shadow-ss-button-*` | Button hover/active/pressed feedback |
| `shadow-ss-dropdown` | Dropdown menus          |

---

## When Inline Styles Are Acceptable

Inline styles bypass the token system and should be avoided for static app chrome.
The current codebase still has legacy exceptions, but new or touched UI should keep
static styling token-based. These cases are acceptable exceptions:

### ✅ Acceptable

1. **User-provided dynamic values**

   ```tsx
   // User picks a color from a palette
   <div style={{ backgroundColor: userSelectedColor }} />
   ```

2. **Canvas rendering**

   ```tsx
   // Canvas API requires raw values
   ctx.fillStyle = '#FF0000';
   ```

3. **Theme/workbook colors from data**

   ```tsx
   // Cell formatting from spreadsheet data
   <td style={{ backgroundColor: cell.format.fill }} />
   ```

4. **Conditional formatting preview icons**

   ```tsx
   // CF rule thumbnails showing actual colors
   <div style={{ background: `linear-gradient(${cfColors})` }} />
   ```

5. **Computed layout values**
   ```tsx
   // Position based on calculations
   <div style={{ left: `${columnOffset}px`, width: `${cellWidth}px` }} />
   ```

### Avoid In New Or Touched App Chrome

1. **Static colors that should be tokens**

   ```tsx
   // ❌ Wrong
   <div style={{ backgroundColor: '#e6f4ea' }} />
   // ✅ Right
   <div className="bg-ss-success-bg" />
   ```

2. **Font sizes that should use typography tokens**

   ```tsx
   // ❌ Wrong
   <span style={{ fontSize: '12px' }}>Text</span>
   // ✅ Right
   <span className="text-caption">Text</span>
   ```

3. **Arbitrary Tailwind values**

   ```tsx
   // ❌ Wrong - arbitrary value
   <span className="text-[10px]">Text</span>
   // ✅ Right - semantic token
   <span className="text-ribbon-compact">Text</span>
   ```

4. **Tailwind default typography in UI components**
   ```tsx
   // ❌ Wrong - generic Tailwind
   <span className="text-xs">Label</span>
   // ✅ Right - semantic token
   <span className="text-caption">Label</span>
   ```

---

## Migration Guide for New Components

When building new components or materially touching existing spreadsheet chrome,
follow this checklist:

### 1. Check for Existing Primitives

Before writing custom UI:

- [ ] Is there a primitive in `@mog/shell` / `components/ui/` that does this?
- [ ] Can an existing primitive be extended?
- [ ] Should a new primitive be created for reuse?

### 2. Use Semantic Tokens Only

- [ ] Static app-chrome colors use tokens, not hardcoded hex (`#ffffff`, `#1a73e8`)
- [ ] Arbitrary Tailwind values are avoided when a semantic token exists (`text-[10px]`, `bg-[#e6f4ea]`)
- [ ] Toolbar/ribbon typography uses semantic token classes, not Tailwind defaults (`text-xs`, `text-sm`, `text-base`)
- [ ] Inline font sizes are avoided for static UI (`style={{ fontSize: '12px' }}`)
- [ ] Dynamic workbook, user palette, canvas, preview, and computed layout values are intentionally documented at the call site

### 3. Choose the Right Typography Token

| If you need...        | Use                   | Not                |
| --------------------- | --------------------- | ------------------ |
| Toolbar button label  | `text-ribbon`         | `text-xs`          |
| Compact toolbar label | `text-ribbon-compact` | `text-[10px]`      |
| Keyboard shortcut     | `text-ribbon-compact` | `text-[10px]`      |
| Tooltip description   | `text-ribbon-compact` | `fontSize: '10px'` |
| Dialog body text      | `text-body-sm`        | `text-sm`          |
| Form label            | `text-label`          | `text-[13px]`      |
| Help text             | `text-caption`        | `text-xs`          |

### 4. Use Status Tokens for State

| If showing...     | Use                                | Not                           |
| ----------------- | ---------------------------------- | ----------------------------- |
| Success state     | `bg-ss-success-bg text-ss-success-text`  | `bg-green-100 text-green-700` |
| Error state       | `bg-ss-error-bg text-ss-error-text`      | `bg-red-100 text-red-700`     |
| Connection status | `StatusBadge` or `ConnectionBadge` | custom colors                 |
| Diff highlighting | `bg-ss-diff-added-bg text-ss-diff-added` | hardcoded hex                 |

### 5. Dialog Structure

Always use the `Dialog` primitive:

```tsx
// ✅ Correct
<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} dialogId="my-dialog">
  <DialogHeader onClose={onClose}>Title</DialogHeader>
  <DialogBody>{content}</DialogBody>
  <DialogFooter>
    <Button variant="secondary" onClick={onClose}>Cancel</Button>
    <Button variant="primary" onClick={onSave}>Save</Button>
  </DialogFooter>
</Dialog>

// ❌ Wrong - custom modal implementation
<div className="fixed inset-0 bg-black/50">
  <div className="bg-white rounded-lg">...</div>
</div>
```

### 6. Accessibility

- [ ] Dialogs: Use `Dialog` primitive (handles focus trap, escape key)
- [ ] Tabs: Use `Tabs` primitive (handles keyboard navigation)
- [ ] Forms: Use `FormField` (handles label association)
- [ ] Status: Prefer `StatusBadge` / `ConnectionBadge` for shared badge behavior

### 7. When to Create New Tokens

If no existing token fits your use case:

1. **Don't** add an arbitrary value - this defeats the system
2. **Do** ask: Is this a new semantic concept or should I use an existing one?
3. **Do** add a new `ss` token to `globals.css` if it represents a new semantic category, and mirror it in `tokens.css` when source-level integration/build contexts need it
4. **Do** update this documentation when adding tokens

### Example Token Addition

```css
/* In globals.css @theme inline block */

/* Only add if this is a NEW semantic concept */
--color-ss-new-semantic-thing: #345c7c;
--color-ss-new-semantic-thing-bg: rgba(52, 92, 124, 0.1);
```

Then the Tailwind utilities become available when referenced: `bg-ss-new-semantic-thing`, `text-ss-new-semantic-thing`, etc.
