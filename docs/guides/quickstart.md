# Quickstart

Run Office.js against the native Mog spreadsheet engine.

## Prerequisites

[Install Mog](installation.md). To run directly from this repository, install
stable Rust and a C compiler so QuickJS can build.

## Run a script

From the repository root:

```bash
cargo run -p mog -- -f compute/officejs/examples/formula.js
```

Expected output:

```text
20
```

## Write your own script

Save a `.js` file and run it with `mog -f script.js`:

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

`Range.values` and `Range.formulas` writes are queued until `context.sync()`.
The assigning proxy caches the assigned value immediately. To read the engine's
result, obtain a fresh proxy and call `load` plus `sync`, as above. Reading an
unloaded property on a fresh proxy throws.

All edits in one mutating `context.sync()` share one undo action. A Rust host
can call `workbook.history().undo()` or `redo()` on the workbook used by the
script. Read-only syncs do not add history. See [undo and redo](undo-redo.md).

## Tests

```bash
cargo test -p mog --test officejs
```
