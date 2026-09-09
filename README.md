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

The engine exposes the Office.js Excel application-specific API:

- `Excel.run` with a `RequestContext`
- Proxy objects that queue work until `await context.sync()`
- `load(...)` before reading proxy properties
- `context.workbook.worksheets.getItem` / `add`
- `worksheet.getRange`
- `Range.values` (2-D get/set)
- `Range.formulas` writes, with computed values readable after `load` + `sync`

Unloaded proxy properties throw; they are not live values.

Each mutating `context.sync()` is one native undo action. Rust callers use
`workbook.history().undo()` / `redo()` and can group multiple operations with
`begin_undo_group()` / `end_undo_group()`. See [undo and redo](docs/guides/undo-redo.md)
for grouping, error handling, and redo behavior.

This is not a Microsoft Office compatibility layer beyond the Excel JS mechanics
above. Charts, pivots, tables, Word, PowerPoint, and Office dialogs are out of
scope.

## Tests

```bash
cargo test -p mog
cargo test -p compute-api
```

Pull requests and `main` run `cargo build -p mog --locked` and
`cargo test --workspace --locked` on GitHub Actions.

## License

Apache-2.0. See [LICENSE](LICENSE).
