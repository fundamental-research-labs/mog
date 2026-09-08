# Quickstart

Run Office.js against the Mog compute engine.

## Prerequisites

Rust (stable), including a C compiler so QuickJS can build.

## Run a script

From the repository root:

```bash
cargo run -p mog -- compute/officejs/examples/formula.js
```

Expected output:

```text
20
```

## Write your own script

Save a `.js` file and pass it to `mog`:

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

## Tests

```bash
cargo test -p mog --test officejs
```
