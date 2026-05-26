# Excel Parity Test Corpus

Programmatically generated XLSX fixtures for visual and behavioral parity testing between mog and Excel Online.

## Quick Start

```bash
# Regenerate all fixtures
python3 generate_corpus.py

# Regenerate a single category
python3 generate_corpus.py --category cells

# List categories
python3 generate_corpus.py --list
```

**Dependencies:** `openpyxl`, `Pillow`, `xlsxwriter` (see `requirements.txt`)

## Categories

| Category | Dir | Files | What It Tests |
|---|---|---|---|
| cells | `cells/` | 10 | Formatting, borders, number formats, merges, frozen panes, rich text, hyperlinks, validation, alignment, sizing |
| floating-objects | `floating-objects/` | 6 | PNG/JPG images, shape/textbox placeholders (shapes need hand-crafted XML) |
| charts | `charts/` | 9 | Bar, stacked bar, line, pie, scatter, area, combo, legend, mini |
| controls | `controls/` | 7 | Button, checkbox, dropdown, spinner, scrollbar, radio, listbox (xlsxwriter-based) |
| overlays | `overlays/` | 1 | Cell comments/notes |
| advanced | `advanced/` | 6 | Conditional formatting (color scales, data bars, icon sets, highlight rules), tables |
| behaviors | `behaviors/` | 13 + JSON | Navigation, selection, editing, clipboard, undo/redo, delete, fill handle, sort/filter, sheet tabs |
| composite | `composite/` | 1 | Kitchen-sink multi-sheet file combining all features |

## Behavioral Test Sequences

`behaviors/test-sequences.json` contains machine-readable test sequences for each behavioral fixture. Each entry defines:
- `start_cell` — where to position the cursor
- `steps` — array of actions (`key`, `type`, `click`, `fill_drag`, `sort`) with expected outcomes (`expect_active`, `expect_value`, `expect_selection`, `expect_sheet`)

These are designed to be consumed directly by an automated test harness.

## Limitations

**Shapes, textboxes, connectors, grouped shapes:** openpyxl doesn't support creating freeform drawing shapes. The generated files contain placeholder text. To create true shape fixtures, hand-craft the `xl/drawings/drawing1.xml` and `xl/drawings/_rels/drawing1.xml.rels` inside the XLSX zip.

**Sparklines:** Not supported by openpyxl. Requires `xlsxwriter` or hand-crafted `x14:sparklineGroups` XML.

**Form controls (buttons, checkboxes, etc.):** Not supported by openpyxl. Requires `xlsxwriter` or hand-crafted VML XML.

**Slicers, SmartArt, ink, equations:** No Python library support. Must be created manually in Excel and committed as static fixtures.

## Rust Parser Test

`tests/corpus_tests.rs` includes `test_parity_corpus` which iterates all `.xlsx` files in this directory and verifies the mog parser handles them without panics.
