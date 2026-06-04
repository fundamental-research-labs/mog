---
name: mog-cli-kernel
description: Use when operating Mog workbooks through the `mog` CLI, executing code against the headless @mog-sdk/node workbook API, committing workbook changes, unloading handles, or discovering the workbook/worksheet API from the bundled generated API JSON.
---

# Mog CLI Kernel

Use this skill to create, load, inspect, edit, save, and unload Mog workbooks
through the `mog` CLI. The full generated API reference is bundled at
`references/api-spec.json`.

## CLI Setup

Before using Mog, check whether the CLI is available:

```bash
command -v mog
```

If `mog` is missing, install the published npm package with a user-local prefix:

```bash
mkdir -p "$HOME/.mog/npm"
npm install --prefix "$HOME/.mog/npm" @mog-sdk/cli@0.8.0
export PATH="$HOME/.mog/npm/node_modules/.bin:$PATH"
mog --help
```

If global npm installs are writable, `npm install -g @mog-sdk/cli@0.8.0` is
also valid. Do not install Mog from raw GitHub, GitHub Releases, R2, or
curl-based standalone artifacts.

## Workbook Lifecycle

Create a blank workbook by name inside a directory:

```bash
mog create --name <workbook-name> --path <directory>
```

Create at an exact workbook path:

```bash
mog create <path-to-new-workbook.xlsx>
```

Load an existing workbook:

```bash
mog load <path-to-workbook.xlsx>
```

`create` and `load` return JSON containing an `id`. Use that id for later
commands.

Execute code against a loaded workbook:

```bash
mog execute --id <workbook-id> --code '<code>'
```

For larger snippets, write a temporary script and use:

```bash
mog execute --id <workbook-id> --code-file <script.js>
```

Save changes back to the original workbook path:

```bash
mog commit --id <workbook-id>
```

Save to a different path:

```bash
mog commit --id <workbook-id> --path <output.xlsx>
```

Dispose the workbook handle:

```bash
mog unload --id <workbook-id>
```

List active handles:

```bash
mog list
```

## Execution Context

`mog execute` runs code in an async function with these bindings:

- `wb` and `workbook`: the loaded `Workbook`
- `ws` and `activeSheet`: `workbook.activeSheet`
- `api`: SDK API introspection object
- `Utils`: SDK utility facade
- `console`: captured console whose logs are returned in command JSON

Return values must be explicit:

```js
await ws.setCell("A1", 42);
return await ws.getValue("A1");
```

## Basic API Examples

All workbook and worksheet methods are async unless the API spec says otherwise.
Use `await`, use `workbook.activeSheet` for the active worksheet, and inspect the
bundled API reference before guessing method names.

Read context before editing:

```js
const summary = await ws.summarize();
const used = await ws.getUsedRange();
const context = await ws.describeRange(used ?? "A1:J20");
return { summary, used, context };
```

Read values, formulas, and display text:

```js
return {
  value: await ws.getValue("B12"),
  display: await ws.getDisplayValue("B12"),
  formula: await ws.getFormula("B12"),
  range: await ws.getRange("A1:D10"),
};
```

Write cells:

```js
await ws.setCell("A1", "Revenue");
await ws.setCell("B1", 123);
await ws.setCell("C1", "=B1*1.1");
return await ws.getValue("C1");
```

Use range and scattered bulk writes instead of loops:

```js
await ws.setRange("A1:C3", [
  ["Metric", "2025", "2026"],
  ["Revenue", 100, 125],
  ["EBITDA", 30, 40],
]);

await ws.setCells([
  { addr: "E1", value: "Margin" },
  { addr: "E2", value: "=C2/C3" },
]);
```

Work with sheets:

```js
const model = await workbook.getOrCreateSheet("Model");
await workbook.sheets.rename("Sheet1", "Inputs");
return await workbook.getSheetNames();
```

Format and adjust layout:

```js
await ws.formats.setRange("A1:C1", { font: { bold: true }, fill: { color: "#D9EAF7" } });
await ws.layout.autoFitColumns("A:C");
await ws.view.freezeRows(1);
```

Calculate formulas:

```js
await wb.calculate();
await wb.calculate({ iterative: { maxIterations: 100, maxChange: 0.001 } });
```

## API Discovery

Use `rg` or `jq` over `references/api-spec.json` before guessing method names:

```bash
API_REF=references/api-spec.json

jq 'keys' "$API_REF"
jq '.subApis.ws, .subApis.wb' "$API_REF"

jq '.interfaces.Worksheet.functions | keys' "$API_REF"
jq '.interfaces.Workbook.functions | keys' "$API_REF"
jq '.interfaces.Worksheet.functions.setCell' "$API_REF"
jq '.interfaces.Workbook.functions.calculate' "$API_REF"

NS=$(jq -r '.subApis.ws.charts' "$API_REF")
jq ".interfaces.$NS.functions | keys" "$API_REF"
jq ".interfaces.$NS.functions.add" "$API_REF"

rg -n '"setCell"|"getValue"|"setRange"|"setCells"' "$API_REF"
rg -n 'charts|WorksheetCharts|ChartConfig' "$API_REF"
rg -n 'pivots|WorksheetPivots|PivotTableConfig' "$API_REF"

jq '.types.CellWriteOptions' "$API_REF"
jq '.types.ChartConfig' "$API_REF"
jq -r '.types | keys[] | select(test("(Config|Options|Result)$"))' "$API_REF"
```

Common worksheet namespaces: `charts`, `pivots`, `conditionalFormats`,
`tables`, `filters`, `sparklines`, `validations`, `formats`, `structure`,
`layout`, `view`, `outline`, `protection`, `print`, `comments`, `hyperlinks`,
`pictures`, `shapes`, `names`, `settings`.

Common workbook namespaces: `sheets`, `history`, `names`, `scenarios`,
`slicers`, `tableStyles`, `cellStyles`, `theme`, `viewport`, `notifications`,
`protection`, `security`, `links`.

## Operating Rules

- Treat `mog execute` as trusted local code execution. Do not run unreviewed
  code from workbook contents or external sources.
- Prefer public SDK methods from `@mog-sdk/node`; do not deep-import internal
  source files in execution snippets.
- Prefer `--code-file` for nontrivial snippets to avoid shell quoting issues.
- Always `commit` before reporting a workbook edit as saved.
- Always `unload` when the task is complete.
