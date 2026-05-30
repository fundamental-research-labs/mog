# Design Token System

## Principles

1. **Single Source of Truth** - All tokens defined in `globals.css`, never hardcode values elsewhere
2. **Semantic Naming** - Tokens describe purpose, not appearance (`bg-primary` not `bg-blue`)
3. **Context-Aware Typography** - Different size scales for grid, UI, and toolbar contexts
4. **Excel-Compatible Theming** - Workbook themes with 12 OOXML color slots for cell formatting
5. **Tailwind v4 Integration** - Tokens exposed as utility classes via `@theme inline`
6. **UI Primitives First** - Always use primitives from `components/ui/` before building custom

## Architecture

```
UI Components → UI Primitives → Semantic Tokens → Tailwind v4 @theme → CSS Variables
                                                                     ↓
                                                           Workbook Themes (Rust/Yrs)
```

## Key Files

| File                                                                                 | Purpose                                               |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| [`apps/spreadsheet/src/infra/styles/globals.css`](../../apps/spreadsheet/src/infra/styles/globals.css) | **Single source of truth** - spreadsheet design tokens |
| [`apps/spreadsheet/src/infra/styles/built-in-themes.ts`](../../apps/spreadsheet/src/infra/styles/built-in-themes.ts) | 8 Excel-compatible workbook themes |
| [`contracts/src/formatting/theme.ts`](../../contracts/src/formatting/theme.ts)       | Theme type definitions and color resolution utilities |
| [`shell/src/components/ui/`](../../shell/src/components/ui/)                         | **UI primitives** - use these, don't build custom     |
| [`infra/icons/src/`](../../infra/icons/src/)                                         | **Single source of truth** - all SVG icons            |

## Icons

All icons live in the `@mog/icons` package. Never use inline SVGs or external icon libraries.

```tsx
// ✅ Correct - import from @mog/icons
import { BoldIcon, ItalicIcon, UndoIcon } from '@mog/icons';

// ❌ Wrong - inline SVG
<svg viewBox="0 0 24 24">...</svg>;

// ❌ Wrong - external library
import { Bold } from '@fluentui/react-icons';
```

### Icon Guidelines

- **175 icons** organized by category (text-formatting, alignment, clipboard, etc.)
- **24×24 canonical size** with `currentColor` for theming
- **Viewer**: Open `icons/viewer.html` to see all icons
- **Design spec**: See [`infra/icons/spec.md`](../../infra/icons/spec.md) for design rules

---

## Token Categories

### Colors

| Category                   | Tokens                                                                                                                     | Usage                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Primary**                | `--color-primary`, `--color-primary-hover`, `--color-primary-light`                                                        | Interactive elements, links, focus states |
| **Surface**                | `--color-surface`, `--color-surface-secondary`, `--color-surface-hover`                                                    | Backgrounds, panels                       |
| **Text**                   | `--color-text`, `--color-text-secondary`, `--color-text-disabled`                                                          | Typography                                |
| **Border**                 | `--color-border`, `--color-border-light`, `--color-border-focus`                                                           | Dividers, input borders                   |
| **Status**                 | `--color-success`, `--color-warning`, `--color-error`, `--color-info`                                                      | Icons, badges, alerts                     |
| **Status Backgrounds**     | `--color-success-bg`, `--color-warning-bg`, `--color-error-bg`, `--color-info-bg`                                          | Alert/badge backgrounds                   |
| **Status Text**            | `--color-success-text`, `--color-warning-text`, `--color-error-text`, `--color-info-text`                                  | Text on status backgrounds                |
| **Connection States**      | `--color-state-idle`, `--color-state-connecting`, `--color-state-connected`, `--color-state-synced`, `--color-state-error` | Real-time connection indicators           |
| **Diff/Changes**           | `--color-diff-added`, `--color-diff-modified`, `--color-diff-removed`, `--color-diff-direct`, `--color-diff-indirect`      | Review mode, cell changes                 |
| **Conditional Formatting** | `--color-cf-positive`, `--color-cf-neutral`, `--color-cf-negative`, `--color-cf-blue`                                      | Excel-compatible color scales             |
| **Data Bars**              | `--color-databar-blue`, `--color-databar-green`, `--color-databar-red`, `--color-databar-orange`                           | Excel-compatible data bars                |
| **Brand**                  | `--color-brand`, `--color-brand-hover`, `--color-brand-light`                                                              | Marketing pages, branded elements         |

### Typography

| Token                    | Size | Usage                                                      |
| ------------------------ | ---- | ---------------------------------------------------------- |
| **Grid Context**         |      |                                                            |
| `--text-cell`            | 13px | Cell content                                               |
| `--text-cell-header`     | 12px | Column/row headers                                         |
| `--text-row-number`      | 11px | Row numbers                                                |
| **UI Context**           |      |                                                            |
| `--text-title`           | 22px | Page titles                                                |
| `--text-subtitle`        | 18px | Section titles                                             |
| `--text-section`         | 16px | Subsection titles                                          |
| `--text-body`            | 14px | Body text                                                  |
| `--text-body-sm`         | 13px | Compact body text                                          |
| `--text-label`           | 13px | Form labels                                                |
| `--text-caption`         | 12px | Captions, help text                                        |
| `--text-hint`            | 11px | Subtle hints                                               |
| **Toolbar Context**      |      |                                                            |
| `--text-tab`             | 12px | Ribbon tab headers (Home, Insert...)                       |
| `--text-ribbon`          | 11px | Ribbon button labels                                       |
| `--text-ribbon-compact`  | 10px | Compact ribbon labels, kbd shortcuts, tooltip descriptions |
| `--text-ribbon-group`    | 9px  | Group labels (Clipboard, Font...)                          |
| `--text-dropdown`        | 13px | Dropdown menu items                                        |
| `--text-dropdown-header` | 11px | Dropdown section headers                                   |

### Other Categories

- **Spacing**: 4px base scale (`--spacing-1` through `--spacing-8`)
- **Layout**: Runtime variables for ribbon/tabbar dimensions
- **Effects**: Shadows, border radius, z-index, transitions

## Usage Pattern

```tsx
// Components use semantic Tailwind classes
<button className="bg-primary text-text-inverse hover:bg-primary-hover" />
<span className="text-ribbon">Bold</span>           // Toolbar context
<span className="text-ribbon-compact">Define</span> // Compact ribbon labels
<p className="text-body">Content</p>                // UI context

// Status indicators
<div className="bg-success-bg text-success-text">Connected</div>
<div className="bg-state-connected-bg text-state-connected">Online</div>

// Diff highlighting
<span className="bg-diff-added-bg text-diff-added">Added</span>

// Brand elements (marketing, not UI chrome)
<button className="bg-brand hover:bg-brand-hover">Get Started</button>
```

## Typography Rules

**NEVER use in toolbar/ribbon components:**

- `text-xs`, `text-sm`, `text-base` (Tailwind defaults - wrong sizes)
- `text-[12px]` (arbitrary values - not from source of truth)
- `font-size: 12px` (inline styles - not from source of truth)

**ALWAYS use semantic tokens:**

- `text-tab`, `text-ribbon`, `text-ribbon-compact`, `text-ribbon-group`, `text-dropdown`, etc.

## Workbook Themes

Cell formats can reference theme colors: `'theme:accent1'` or `'theme:accent1:0.4'` (with tint).

See [`contracts/src/formatting/theme.ts`](../../contracts/src/formatting/theme.ts) for `resolveColor()` and `resolveThemeColors()`.

---

## UI Primitives

Always use these primitives instead of building custom implementations. They enforce design tokens and accessibility patterns.

### Form Elements

| Primitive    | Import         | Usage                                                                     |
| ------------ | -------------- | ------------------------------------------------------------------------- |
| `Button`     | `from '../ui'` | All buttons - supports `primary`, `secondary`, `ghost`, `danger` variants |
| `Input`      | `from '../ui'` | Single-line text inputs                                                   |
| `Textarea`   | `from '../ui'` | Multi-line text inputs - supports `resize` option                         |
| `Select`     | `from '../ui'` | Dropdown selections                                                       |
| `Checkbox`   | `from '../ui'` | Boolean toggles                                                           |
| `RadioGroup` | `from '../ui'` | Single selection from options - supports descriptions                     |
| `ColorInput` | `from '../ui'` | Color picker input                                                        |
| `Label`      | `from '../ui'` | Form labels                                                               |
| `FormField`  | `from '../ui'` | Label + input + error wrapper                                             |

### Layout Components

| Primitive         | Import         | Usage                                                                 |
| ----------------- | -------------- | --------------------------------------------------------------------- |
| `Dialog`          | `from '../ui'` | Modal dialogs - use with `DialogHeader`, `DialogBody`, `DialogFooter` |
| `DialogHeader`    | `from '../ui'` | Dialog title bar with close button                                    |
| `DialogBody`      | `from '../ui'` | Dialog content area                                                   |
| `DialogFooter`    | `from '../ui'` | Dialog action buttons                                                 |
| `Tabs`            | `from '../ui'` | Tab navigation - full keyboard accessibility                          |
| `TabPanel`        | `from '../ui'` | Tab content panels                                                    |
| `Dropdown`        | `from '../ui'` | Menu dropdowns                                                        |
| `DropdownItem`    | `from '../ui'` | Menu items                                                            |
| `DropdownDivider` | `from '../ui'` | Menu separators                                                       |
| `ContextMenu`     | `from '../ui'` | Right-click menus                                                     |

### Status & Feedback

| Primitive         | Import         | Usage                                                             |
| ----------------- | -------------- | ----------------------------------------------------------------- |
| `StatusBadge`     | `from '../ui'` | Status indicators - `success`, `warning`, `error`, `info`, `idle` |
| `ConnectionBadge` | `from '../ui'` | Connection status - `connected`, `connecting`, `synced`, `error`  |
| `Tooltip`         | `from '../ui'` | Hover tooltips with keyboard shortcut support                     |

### Picker Helpers

| Primitive      | Import         | Usage                             |
| -------------- | -------------- | --------------------------------- |
| `ColorSwatch`  | `from '../ui'` | Color preview squares             |
| `SectionLabel` | `from '../ui'` | Section headers in pickers/panels |

### Example Usage

```tsx
import {
  Button,
  Input,
  Textarea,
  Select,
  Checkbox,
  RadioGroup,
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
  Tabs,
  TabPanel,
  StatusBadge,
  FormField
} from '../ui';

function SettingsDialog({ open, onClose }) {
  const [activeTab, setActiveTab] = useState('general');
  const [name, setName] = useState('');

  return (
    <Dialog open={open} onClose={onClose} dialogId="settings">
      <DialogHeader onClose={onClose}>Settings</DialogHeader>
      <DialogBody>
        <Tabs
          tabs={[
            { id: 'general', label: 'General' },
            { id: 'advanced', label: 'Advanced' }
          ]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
        <TabPanel id="general" activeTab={activeTab}>
          <FormField label="Name" required>
            <Input value={name} onChange={setName} />
          </FormField>
        </TabPanel>
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
| Primary button       | `bg-primary hover:bg-primary-hover` | `--color-primary`           |
| Secondary background | `bg-surface-secondary`              | `--color-surface-secondary` |
| Text                 | `text-text`                         | `--color-text`              |
| Secondary text       | `text-text-secondary`               | `--color-text-secondary`    |
| Disabled text        | `text-text-disabled`                | `--color-text-disabled`     |
| Border               | `border-border`                     | `--color-border`            |
| Light border         | `border-border-light`               | `--color-border-light`      |
| Focus ring           | `border-border-focus`               | `--color-border-focus`      |

### Status Colors

| Status  | Background      | Text                | Border           |
| ------- | --------------- | ------------------- | ---------------- |
| Success | `bg-success-bg` | `text-success-text` | `border-success` |
| Warning | `bg-warning-bg` | `text-warning-text` | `border-warning` |
| Error   | `bg-error-bg`   | `text-error-text`   | `border-error`   |
| Info    | `bg-info-bg`    | `text-info-text`    | `border-info`    |

### Connection States

| State      | Background               | Text                    |
| ---------- | ------------------------ | ----------------------- |
| Idle       | `bg-state-idle-bg`       | `text-state-idle`       |
| Connecting | `bg-state-connecting-bg` | `text-state-connecting` |
| Connected  | `bg-state-connected-bg`  | `text-state-connected`  |
| Synced     | `bg-state-synced-bg`     | `text-state-synced`     |
| Error      | `bg-state-error-bg`      | `text-state-error`      |

### Diff/Change Tracking

| Change Type         | Background            | Text                 |
| ------------------- | --------------------- | -------------------- |
| Added               | `bg-diff-added-bg`    | `text-diff-added`    |
| Modified            | `bg-diff-modified-bg` | `text-diff-modified` |
| Removed             | `bg-diff-removed-bg`  | `text-diff-removed`  |
| Direct dependency   | `bg-diff-direct-bg`   | `text-diff-direct`   |
| Indirect dependency | `bg-diff-indirect-bg` | `text-diff-indirect` |

### Typography

| Context           | Token Class            | Size |
| ----------------- | ---------------------- | ---- |
| **Grid**          |                        |      |
| Cell content      | `text-cell`            | 13px |
| Column/row header | `text-cell-header`     | 12px |
| Row number        | `text-row-number`      | 11px |
| **UI**            |                        |      |
| Page title        | `text-title`           | 22px |
| Section title     | `text-subtitle`        | 18px |
| Subsection        | `text-section`         | 16px |
| Body text         | `text-body`            | 14px |
| Compact body      | `text-body-sm`         | 13px |
| Form label        | `text-label`           | 13px |
| Caption           | `text-caption`         | 12px |
| Hint              | `text-hint`            | 11px |
| **Toolbar**       |                        |      |
| Tab header        | `text-tab`             | 12px |
| Ribbon button     | `text-ribbon`          | 11px |
| Compact label/kbd | `text-ribbon-compact`  | 10px |
| Group label       | `text-ribbon-group`    | 9px  |
| Dropdown item     | `text-dropdown`        | 13px |
| Dropdown header   | `text-dropdown-header` | 11px |

### Spacing

| Token               | Value | Usage         |
| ------------------- | ----- | ------------- |
| `gap-0.5` / `p-0.5` | 2px   | Tight spacing |
| `gap-1` / `p-1`     | 4px   | Minimal       |
| `gap-1.5` / `p-1.5` | 6px   | Compact       |
| `gap-2` / `p-2`     | 8px   | Standard      |
| `gap-3` / `p-3`     | 12px  | Comfortable   |
| `gap-4` / `p-4`     | 16px  | Spacious      |
| `gap-6` / `p-6`     | 24px  | Section       |

### Z-Index

| Token        | Value | Usage               |
| ------------ | ----- | ------------------- |
| `z-dropdown` | 100   | Dropdown menus      |
| `z-sticky`   | 200   | Sticky headers      |
| `z-overlay`  | 300   | Overlays            |
| `z-modal`    | 1000  | Modal dialogs       |
| `z-toast`    | 1100  | Toast notifications |
| `z-tooltip`  | 1200  | Tooltips            |

### Shadows

| Token             | Usage                   |
| ----------------- | ----------------------- |
| `shadow-sm`       | Subtle elevation        |
| `shadow`          | Standard elevation      |
| `shadow-md`       | Medium elevation        |
| `shadow-lg`       | High elevation (modals) |
| `shadow-dropdown` | Dropdown menus          |

---

## When Inline Styles Are Acceptable

Inline styles bypass the token system and should be avoided. However, these cases are **acceptable exceptions**:

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

### ❌ Never Acceptable

1. **Static colors that should be tokens**

   ```tsx
   // ❌ Wrong
   <div style={{ backgroundColor: '#e6f4ea' }} />
   // ✅ Right
   <div className="bg-success-bg" />
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

When building new components, follow this checklist:

### 1. Check for Existing Primitives

Before writing custom UI:

- [ ] Is there a primitive in `components/ui/` that does this?
- [ ] Can an existing primitive be extended?
- [ ] Should a new primitive be created for reuse?

### 2. Use Semantic Tokens Only

- [ ] No hardcoded hex colors (`#ffffff`, `#1a73e8`)
- [ ] No arbitrary Tailwind values (`text-[10px]`, `bg-[#e6f4ea]`)
- [ ] No Tailwind default typography (`text-xs`, `text-sm`, `text-base`)
- [ ] No inline font sizes (`style={{ fontSize: '12px' }}`)

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
| Success state     | `bg-success-bg text-success-text`  | `bg-green-100 text-green-700` |
| Error state       | `bg-error-bg text-error-text`      | `bg-red-100 text-red-700`     |
| Connection status | `StatusBadge` or `ConnectionBadge` | custom colors                 |
| Diff highlighting | `bg-diff-added-bg text-diff-added` | hardcoded hex                 |

### 5. Dialog Structure

Always use the `Dialog` primitive:

```tsx
// ✅ Correct
<Dialog open={open} onClose={onClose} dialogId="my-dialog">
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
- [ ] Status: Use `StatusBadge` (handles ARIA attributes)

### 7. When to Create New Tokens

If no existing token fits your use case:

1. **Don't** add an arbitrary value - this defeats the system
2. **Do** ask: Is this a new semantic concept or should I use an existing one?
3. **Do** add a new token to `globals.css` if it represents a new semantic category
4. **Do** update this documentation when adding tokens

### Example Token Addition

```css
/* In globals.css @theme inline block */

/* Only add if this is a NEW semantic concept */
--color-new-semantic-thing: #hexvalue;
--color-new-semantic-thing-bg: rgba(hex, 0.1);
```

Then update the Tailwind utilities become available automatically: `bg-new-semantic-thing`, `text-new-semantic-thing-bg`, etc.
