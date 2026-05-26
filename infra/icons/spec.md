# Icon Design Specification

**Status**: Initial Draft (will evolve through iteration)
**Last Updated**: 2025-12-30

This spec defines the design rules for our icon set. It starts with industry-standard values and will be refined through the two-level iteration process.

---

## Color Palette

Icons use a consistent color palette. Colors are defined as CSS custom properties with hardcoded fallbacks for standalone viewing.

| Token         | Value          | CSS Variable           | Usage                                     |
| ------------- | -------------- | ---------------------- | ----------------------------------------- |
| Primary       | `currentColor` | (inherits)             | Main icon strokes, adapts to UI context   |
| Accent Blue   | `#2563eb`      | `--icon-accent-blue`   | Interactive elements, handles, highlights |
| Accent Green  | `#16a34a`      | `--icon-accent-green`  | Success, positive actions                 |
| Accent Red    | `#dc2626`      | `--icon-accent-red`    | Destructive actions, errors               |
| Accent Orange | `#ea580c`      | `--icon-accent-orange` | Warnings, attention                       |
| Accent Purple | `#9333ea`      | `--icon-accent-purple` | Special features, AI                      |

### Usage in SVG

```svg
<!-- Primary color (inherits from UI) -->
<path stroke="currentColor" d="..." />

<!-- Accent color with fallback -->
<path fill="var(--icon-accent-blue, #2563eb)" d="..." />
```

### Color Application Guidelines

- **Handles & grips**: Use accent blue for interactive affordances
- **Status indicators**: Green for success, red for error, orange for warning
- **Blades & tools**: Keep as `currentColor` for the functional part
- **Keep it subtle**: Most of the icon should be `currentColor`; accents are highlights

---

## Core Constraints

| Property        | Value                            | Notes                                         |
| --------------- | -------------------------------- | --------------------------------------------- |
| Canvas          | 24×24px                          | Industry standard (matches Lucide, Heroicons) |
| Padding         | 1px minimum                      | Icons must not touch edges                    |
| Stroke Width    | 2px                              | Start here, may adjust per iteration          |
| Stroke Caps     | Round                            | `stroke-linecap="round"`                      |
| Stroke Joins    | Round                            | `stroke-linejoin="round"`                     |
| Corner Radius   | 2px (shapes ≥8px), 1px (smaller) |                                               |
| Element Spacing | 2px minimum                      | Between distinct elements                     |

---

## Rendering Sizes

| Context         | Render Size | Notes              |
| --------------- | ----------- | ------------------ |
| Toolbar buttons | 16px        | Primary use case   |
| Menu icons      | 24px        | Native canvas size |
| Dialogs/modals  | 32px        | For emphasis       |

All icons are designed at 24×24 and scaled down. Never design at target size.

---

## SVG Template

```svg
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <!-- paths here -->
</svg>
```

### Attributes

- `fill="none"` - Default to stroke-based icons
- `stroke="currentColor"` - Inherit color from CSS
- `stroke-width="2"` - Match spec value
- `stroke-linecap="round"` - Round line endings
- `stroke-linejoin="round"` - Round corners where lines meet

### Filled Elements

When an icon needs filled shapes (not just strokes):

- Use `fill="currentColor"` on specific paths
- Keep `stroke="none"` on filled elements to avoid double rendering
- Maintain same visual weight as stroke-based icons

---

## Optical Balance

### Visual Centering

Icons must be **visually** balanced, not mathematically centered:

- **Play buttons**: Triangle shifts toward the point
- **Arrows**: Balance the visual weight of the head
- **Asymmetric shapes**: Center by visual weight, not geometry

### Size Compensation

Different shapes need different bounding boxes to appear equal:

| Shape         | Compensation                    |
| ------------- | ------------------------------- |
| Square        | Reference (no adjustment)       |
| Circle        | Extend ~3% beyond square bounds |
| Triangle      | Extend ~5% beyond square bounds |
| Vertical line | Fill more vertical space        |

### Visual Weight

All icons should have similar "ink density" when viewed at thumbnail size. Use the squint test in the viewer.

---

## Icon Families

Related icons share visual DNA within their category:

| Category        | Shared Elements                          |
| --------------- | ---------------------------------------- |
| Text formatting | Letter forms (B, I, U, S)                |
| Alignment       | Horizontal lines with consistent spacing |
| Clipboard       | Document/page metaphor                   |
| Borders         | Grid/cell reference                      |
| Cell operations | Plus/minus indicators                    |
| Sort            | Arrow + text lines                       |
| Navigation      | Arrow direction                          |

When creating a new icon in a family, study existing members first.

---

## Naming Convention

```
{action}-{object}.svg
{object}-{modifier}.svg
{category-prefix}-{name}.svg
```

Examples:

- `align-left.svg`
- `text-bold.svg`
- `sort-ascending.svg`
- `border-bottom.svg`
- `cell-merge.svg`

Use kebab-case. Be descriptive but concise.

---

## Quality Checklist

Before committing an icon:

- [ ] 24×24 viewBox
- [ ] 1px minimum padding from edges
- [ ] Uses `currentColor` for stroke/fill
- [ ] Correct stroke-width (2px default)
- [ ] Round caps and joins
- [ ] Visually centered
- [ ] Tested at 16px, 24px, 32px
- [ ] Squint test passed (similar weight to siblings)
- [ ] No stray points or artifacts
- [ ] Clean paths (no unnecessary nodes)

---

## Iteration Notes

_This section captures learnings from set-wide reviews._

### Review 1: TBD

- Date:
- Icons reviewed:
- Observations:
- Spec changes:

---

## Reference: Path Commands

| Command                       | Description     | Example                   |
| ----------------------------- | --------------- | ------------------------- |
| `M x y`                       | Move to         | `M8 3`                    |
| `L x y`                       | Line to         | `L8 13`                   |
| `H x`                         | Horizontal line | `H12`                     |
| `V y`                         | Vertical line   | `V10`                     |
| `A rx ry rot large sweep x y` | Arc             | `A2.5 2.5 0 0 1 5.3 10.7` |
| `Q cx cy x y`                 | Quadratic curve | `Q9 11 6.5 11`            |
| `C x1 y1 x2 y2 x y`           | Cubic curve     | `C10 4 14 8 12 12`        |
| `Z`                           | Close path      | `Z`                       |

Lowercase = relative coordinates, Uppercase = absolute.
