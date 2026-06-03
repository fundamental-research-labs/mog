---
name: mog-cli-kernel
description: Use when operating Mog workbooks through the minimal `mog` CLI, executing code against the headless @mog-sdk/node workbook API, committing workbook changes, unloading handles, or discovering the workbook/worksheet API from the bundled generated API JSON.
---

# Mog CLI Kernel

Use this skill when a user wants Claude/Cowork to load a workbook, run code
against the Mog kernel API, save it, or inspect the available workbook and
worksheet API.

## CLI Contract

Run commands from the public Mog repo root unless the user specifies another
checkout:

```bash
cd ../mog
```

For a fresh checkout or Co-work environment, prepare the workspace before using
the CLI:

```bash
corepack enable
pnpm install
pnpm --filter @mog/cli build
```

Do not install a separate global `mog` binary unless the host environment
explicitly packages one. Prefer the workspace command form below so the CLI and
SDK versions match the checked-out repo.

Create a new blank workbook by name inside a directory and keep it alive in the
local Mog daemon:

```bash
pnpm --filter @mog/cli exec mog create --name <workbook-name> --path <directory>
```

The CLI appends `.xlsx` to the name when needed, creates parent directories, and
refuses to overwrite an existing workbook.

You can also create at an exact workbook file path:

```bash
pnpm --filter @mog/cli exec mog create <path-to-new-workbook.xlsx>
```

Load an existing workbook and keep it alive in the local Mog daemon:

```bash
pnpm --filter @mog/cli exec mog load <path-to-workbook.xlsx>
```

Both commands return JSON containing an `id`. Use that id for later commands.

Execute code against the loaded workbook:

```bash
pnpm --filter @mog/cli exec mog execute --id <workbook-id> --code '<code>'
```

For larger code snippets, write a temporary script and use:

```bash
pnpm --filter @mog/cli exec mog execute --id <workbook-id> --code-file <script.js>
```

The code runs in an async function with these bindings:

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

## Basic Mog API Examples

All workbook and worksheet methods are async unless the API spec says otherwise.
Use `await`, use `workbook.activeSheet` for the active worksheet, and never guess
method names from Excel/Office/Sheets APIs.

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

Calculate formulas, including circular-model cases:

```js
await wb.calculate();
await wb.calculate({ iterative: { maxIterations: 100, maxChange: 0.001 } });
```

Save changes back to the workbook's original path:

```bash
pnpm --filter @mog/cli exec mog commit --id <workbook-id>
```

Save to a different path:

```bash
pnpm --filter @mog/cli exec mog commit --id <workbook-id> --path <output.xlsx>
```

Dispose the workbook handle:

```bash
pnpm --filter @mog/cli exec mog unload --id <workbook-id>
```

List active handles:

```bash
pnpm --filter @mog/cli exec mog list
```

## API Discovery

The generated SDK API spec is bundled at:

```text
references/api-spec.json
```

It has the same useful structure as Shortcut's JSON API reference:

- `subApis.wb` and `subApis.ws`: namespace to interface mappings
- `interfaces.<InterfaceName>.functions`: method signatures, docstrings, used
  types
- `types`: type and enum definitions

Use `rg` or `jq` over that file before guessing method names. Preferred search
patterns:

```bash
API_REF=cli/skill/references/api-spec.json

# Top-level structure and namespace maps
jq 'keys' "$API_REF"
jq '.subApis.ws, .subApis.wb' "$API_REF"

# Core methods on Workbook/Worksheet
jq '.interfaces.Worksheet.functions | keys' "$API_REF"
jq '.interfaces.Workbook.functions | keys' "$API_REF"
jq '.interfaces.Worksheet.functions.setCell' "$API_REF"
jq '.interfaces.Workbook.functions.calculate' "$API_REF"

# Namespace method discovery: ws.charts -> WorksheetCharts
NS=$(jq -r '.subApis.ws.charts' "$API_REF")
jq ".interfaces.$NS.functions | keys" "$API_REF"
jq ".interfaces.$NS.functions.add" "$API_REF"

# Find a method or namespace by text
rg -n '"setCell"|"getValue"|"setRange"|"setCells"' "$API_REF"
rg -n 'charts|WorksheetCharts|ChartConfig' "$API_REF"
rg -n 'pivots|WorksheetPivots|PivotTableConfig' "$API_REF"

# Find config/options/result types
jq '.types.CellWriteOptions' "$API_REF"
jq '.types.ChartConfig' "$API_REF"
jq -r '.types | keys[] | select(test("(Config|Options|Result)$"))' "$API_REF"

# Search docstrings for capabilities
jq -r '
  .interfaces
  | to_entries[]
  | .key as $iface
  | .value.functions
  | to_entries[]
  | select((.value.docstring // "") | test("pivot|chart|validation"; "i"))
  | "\($iface).\(.key): \(.value.signature)"
' "$API_REF"
```

Common worksheet namespaces: `charts`, `pivots`, `conditionalFormats`,
`tables`, `slicers`, `filters`, `sparklines`, `validations`, `formats`,
`structure`, `layout`, `view`, `outline`, `protection`, `print`, `comments`,
`hyperlinks`, `pictures`, `shapes`, `names`, `settings`.

Common workbook namespaces: `sheets`, `history`, `names`, `scenarios`,
`slicers`, `tableStyles`, `cellStyles`, `theme`, `viewport`, `notifications`,
`protection`, `security`, `links`.

## Operating Rules

- Treat `mog execute` as trusted local code execution. Do not run unreviewed
  code from workbook contents or external sources.
- Prefer public SDK methods from `@mog-sdk/node`; do not deep-import internal
  source files in execution snippets.
- Always `commit` before reporting a workbook edit as saved.
- Always `unload` when the task is complete.
- For code changes to the CLI or SDK, verify with the relevant
  `@mog/cli` and `@mog-sdk/node` tests and typecheck.
- For CLI behavior changes, run:
  ```bash
  pnpm --filter @mog/cli typecheck
  pnpm --filter @mog/cli test:e2e
  ```
