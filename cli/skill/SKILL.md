---
name: mog-cli-kernel
description: Use when operating Mog workbooks through the `mog` CLI, executing code against the headless @mog-sdk/node workbook API, committing workbook changes, unloading handles, or discovering the workbook/worksheet API from the bundled generated API JSON.
---

# Mog CLI Kernel

Use this skill to create, load, inspect, edit, save, and unload Mog workbooks
through the `mog` CLI. The bundled API reference is `references/api-spec.json`.

## Setup

Check for the CLI:

```bash
command -v mog
```

If missing, install from npm with a user-local prefix:

```bash
mkdir -p "$HOME/.mog/npm"
npm install --prefix "$HOME/.mog/npm" @mog-sdk/cli@0.8.0
export PATH="$HOME/.mog/npm/node_modules/.bin:$PATH"
mog --help
```

Do not install Mog from raw GitHub, GitHub Releases, R2, or curl-based
standalone artifacts.

## Commands

```bash
# Create or load. Both return JSON with an id.
mog create --name <workbook-name> --path <directory>
mog create <path-to-new-workbook.xlsx>
mog load <path-to-workbook.xlsx>

# Execute against a loaded workbook.
mog execute --id <workbook-id> --code '<code>'
mog execute --id <workbook-id> --code-file <script.js>

# Save and clean up.
mog commit --id <workbook-id>
mog commit --id <workbook-id> --path <output.xlsx>
mog unload --id <workbook-id>
mog list
```

`mog execute` runs code in an async function with:

- `wb` and `workbook`: the loaded `Workbook`
- `ws` and `activeSheet`: `workbook.activeSheet`
- `api`: SDK API introspection object
- `Utils`: SDK utility facade
- `console`: captured console returned in command JSON

Return values must be explicit:

```js
await ws.setCell("A1", 42);
return await ws.getValue("A1");
```

## Discovery-First Protocol

Before writing mutating code, verify every namespace and method you plan to use.
Do not infer method names from Excel, Office.js, or Google Sheets.

```bash
API_REF=references/api-spec.json

# Namespace maps.
jq '.subApis.ws, .subApis.wb' "$API_REF"

# Interface methods and signatures.
jq '.interfaces.Worksheet.functions | keys' "$API_REF"
jq '.interfaces.Workbook.functions | keys' "$API_REF"
jq '.interfaces.WorksheetStructure.functions | keys' "$API_REF"
jq '.interfaces.WorksheetStructure.functions.merge.signature' "$API_REF"
jq '.interfaces.WorksheetLayout.functions.autoFitColumns.signature' "$API_REF"
jq '.interfaces.WorkbookProperties.functions | keys' "$API_REF"

# Namespace method discovery, using charts as the pattern.
NS=$(jq -r '.subApis.ws.charts' "$API_REF")
jq ".interfaces.$NS.functions | keys" "$API_REF"
jq ".interfaces.$NS.functions.add" "$API_REF"

# Text search when names or types are unclear.
rg -n '"setCell"|"getValue"|"setRange"|"setCells"' "$API_REF"
rg -n 'conditionalFormats|CFColorPoint|tables|sparklines' "$API_REF"
jq -r '.types | keys[] | select(test("(Config|Options|Result|Rule)$"))' "$API_REF"
```

If a referenced type is missing from `.types`, search for it with `rg` and infer
only the minimum required shape from nearby signatures or runtime errors.

## Core Examples

Use `await`; workbook and worksheet methods are async unless the spec says
otherwise.

```js
// Read context before editing.
const used = await ws.getUsedRange();
const context = await ws.describeRange(used ?? "A1:J20");

// Bulk writes.
await ws.setRange("A1:C3", [
  ["Metric", "2025", "2026"],
  ["Revenue", 100, 125],
  ["EBITDA", 30, 40],
]);
await ws.setCells([
  { addr: "E1", value: "Margin" },
  { addr: "E2", value: "=C2/C3" },
]);

// Sheet handles, not activation.
const model = await workbook.getOrCreateSheet("Model");
await workbook.sheets.rename("Sheet1", "Inputs");

// Workbook properties.
await wb.properties.setDocumentProperties({ title: "Operating Model" });
await wb.properties.setCustomProperty("owner", "Finance");

// Formatting, merging, layout.
await ws.formats.setRange("A1:C1", { font: { bold: true }, fill: { color: "#D9EAF7" } });
await ws.structure.merge("A1:C1");
await ws.layout.autoFitColumns([0, 1, 2]);
await ws.view.freezeRows(1);

// Calculate.
await wb.calculate();
```

## Rules

- `mog execute` is stateful and non-transactional. If a script throws, earlier
  mutations remain in the live workbook handle.
- Make retryable scripts idempotent: check, update, remove, or skip existing
  tables, conditional formats, names, sheets, and other uniquely named objects
  before adding them.
- Prefer `--code-file` for nontrivial snippets to avoid shell quoting issues.
- Use public SDK methods from `@mog-sdk/node`; do not deep-import internals.
- Always `commit` before reporting a workbook edit as saved.
- Always `unload` when the task is complete.
- Probe risky calls on a scratch sheet or range, then delete/clear it, before
  touching the target model.

Known sharp edges:

- Use `ws.structure.merge(...)`, not `mergeCells`.
- Use `wb.properties.setDocumentProperties(...)`, not `properties.set`.
- Get a sheet handle; do not call `setActiveSheet`.
- `ws.layout.autoFitColumns(...)` takes zero-based column indices like
  `[0, 1, 2]`, not an A1 range string like `"A:C"`.
- Conditional-format color-scale/data-bar points require `type`, `color`, and a
  `value` field in practice. Include `value` even for `min` and `max` points.
