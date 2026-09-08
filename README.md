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

## Tests

```bash
cargo test -p mog
cargo test -p compute-api
```

## License

Apache-2.0. See [LICENSE](LICENSE).
