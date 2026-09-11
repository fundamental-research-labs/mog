# Mog

Mog is a headless spreadsheet engine. Scripts use the Excel JavaScript API
(`Excel.run`, `context.sync`, `Range.load`) against the native compute engine.
There is no UI, Node runtime, or custom `wb`/`ws` API.

## Build

```bash
cargo build -p mog
```

## Quickstart

```bash
cargo run -p mog -- compute/officejs/examples/formula.js
```

The example writes `10` to `A1`, `=A1*2` to `A2`, loads the computed value, and
prints `20`.

```js
await Excel.run(async (context) => {
  const sheet = context.workbook.worksheets.getItem("Sheet1");
  sheet.getRange("A1").values = [[10]];
  sheet.getRange("A2").formulas = [["=A1*2"]];
  const result = sheet.getRange("A2");
  result.load("values");
  await context.sync();
  console.log(result.values[0][0]);
});
```

Inline scripts:

```bash
cargo run -p mog -- --eval 'await Excel.run(async (context) => {
  const sheet = context.workbook.worksheets.getItem("Sheet1");
  sheet.getRange("A1").values = [[6]];
  sheet.getRange("A2").formulas = [["=A1*7"]];
  const r = sheet.getRange("A2");
  r.load("values");
  await context.sync();
  console.log(r.values[0][0]);
});'
```

## Scripting surface

To open and save an existing workbook:

```bash
mog save input.xlsx output.xlsx
mog save --recalculate input.xlsx calculated.xlsx
mog run --recalculate input.xlsx script.js calculated.xlsx
```

`save` preserves imported formula caches. `--recalculate` evaluates formulas
before export, after any script has run. Use recalculation to verify arithmetic
starting from stale caches; use ordinary save to verify preservation. Random,
clock, path, and platform-dependent results require controlled inputs or
separate assertions, including dependent cells and spill ranges, when comparing
against an Excel-generated workbook. Exact cached-value equality does not
verify calculation accuracy.

The engine implements a growing portion of the Office.js Excel
application-specific API:

- `Excel.run` with a `RequestContext`
- Proxy objects that queue work until `await context.sync()`
- `load(...)` with string, array, and nested property projections
- `context.workbook.worksheets.getItem` / `add` / `getActiveWorksheet`
- `worksheet.getRange`
- `Range.values` (2-D get/set)
- `Range.formulas` writes, with computed values readable after `load` + `sync`
- Range addresses, dimensions, and row/column indices
- Range formatting through `format`, `font`, `fill`, and `protection`
- Worksheet table creation, name/ID lookup, scalar properties, and table ranges

Fresh proxy properties require `load` and `sync` before reading. Assigning a
writable property also caches that value on the same proxy; use a fresh proxy
with `load` and `sync` to read the engine's resulting state. A `null` cell in
a values write preserves the existing cell, while an empty string clears it.

Callers and scripts have full access to the workbook they receive. Applications
embedding Mog are responsible for authorizing workbook access; the compute
engine does not enforce caller-specific workbook, sheet, or cell permissions.
Excel sheet protection remains a separate document feature.

The target contract is Microsoft's Excel JavaScript API. Implementation and
behavioral coverage are incomplete; the listed features do not establish
support for an entire Excel API requirement set. Charts, pivots, and many other
Excel members remain unimplemented. Word, PowerPoint, and Office dialogs are
outside this spreadsheet engine's scope.

Each mutating `context.sync()` is one native undo action. Rust callers use
`workbook.history().undo()` / `redo()` and can group multiple operations with
`begin_undo_group()` / `end_undo_group()`. See [undo and redo](docs/guides/undo-redo.md)
for grouping, error handling, and redo behavior.

## Excel vs Mog speed/memory

`./run-calipers-bench.sh` walks the calipers verify corpus **one case at a time** and writes wall time + peak working set to JSON, then a US Letter HTML/SVG report. Open the HTML and use **Export as PDF** (stacked 8.5×11in pages).

```bash
# Mog-only (any OS) — inspect HTML before a Windows Excel run
./run-calipers-bench.sh
./run-calipers-bench.sh --suite default

# Both series on one Windows machine (build Mog, run Mog, then Excel COM)
./run-calipers-bench.sh --excel
```

Excel is desktop `Excel.Application` via COM plus a sideloaded Office.js add-in (not AppSource / Office Scripts). Mog uses `save` / `run`. The HTML also reports Office.js Excel API coverage (Microsoft method catalog vs Mog host vs verification scripts). See `vendor/calipers` `bench` / `bench-report` and `scripts/officejs-coverage`.

## Tests

```bash
cargo test -p mog
cargo test -p compute-api
```

Pull requests and `main` run `cargo build -p mog --locked` and
`cargo test --workspace --locked` on GitHub Actions.

## License

Apache-2.0. See [LICENSE](LICENSE).
