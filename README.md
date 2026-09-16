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

The example writes `10` to `A1`, `=A1*2` to `A2`, loads the computed value,
prints `20`, and saves `workbook.xlsx` in the current directory (or the next
available `workbook-2.xlsx`, `workbook-3.xlsx`, and so on).

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

## CLI

Running `mog` with no arguments shows help without creating a file.
For workbook operations, Mog starts blank unless `-i` / `--input` is supplied. It saves
in place when an input is supplied; `-o` / `--output` chooses another destination.
Without either path, it saves in the current directory with the first available
name: `workbook.xlsx`, `workbook-2.xlsx`, `workbook-3.xlsx`, and so on. Existing
automatic filenames are never overwritten, including concurrent invocations.

```bash
mog                                      # show help
mog -o workbook.xlsx                     # create a blank workbook
mog -i input.xlsx                         # open and save in place
mog -i input.xlsx -o copy.xlsx            # save a copy
mog -i input.xlsx -r                      # recalculate and save in place
mog -i input.xlsx script.js               # run a script file, then save
mog -e 'console.log("hello")' -o new.xlsx  # run inline JavaScript
mog --help
```

`-e` / `--eval` takes inline JavaScript; a positional filename loads a script.
Use `--` before a script filename beginning with `-`. Opening and saving without
a script preserves imported formula caches. `-r` / `--recalculate` evaluates
formulas before export. Scripts automatically trigger full recalculation after
they finish, including workbooks imported in manual calculation mode. Within a
script, `context.sync()` retains the Office.js calculation behavior.

Exports complete before replacing an explicit destination, so a failed export
does not truncate the input. Script failures do not save the workbook. Script
console output is printed once; a non-null return value is printed as JSON if
there was no console output.

### Sessions

Start a session with `-s` / `--session`. This launches
a detached background process that keeps the workbook in memory and prints its
ID. Pass the ID to later invocations:

```bash
ID=$(mog -s -i input.xlsx)
mog -s "$ID" -e 'await Excel.run(async c => {
  c.workbook.worksheets.getItem("Sheet1").getRange("A1").values = [[42]];
  await c.sync();
});'
mog -s "$ID" another-script.js
mog -s "$ID" --close                       # save and end the session
```

| Action | Command |
| --- | --- |
| Save to another path and end | `mog -s ID --close -o result.xlsx` |
| End without saving | `mog -s ID --close --discard` |
| Save and end every session | `mog --close-all` |
| End every session without saving | `mog --close-all --discard` |

A session writes no workbook file until closed. Its default output is the input
path, or an available `workbook*.xlsx` in the directory where it started. `-o`
changes the session's destination; relative paths are resolved from the caller's
current directory. The automatic filename is selected at save time. `--input`
is only valid when starting a session. A script may also run during startup;
its output goes to stderr so stdout contains only the ID.

Requests to a session run sequentially. Workbook state persists; each script has
a fresh JavaScript scope. A script error leaves the session alive, and earlier
successful `context.sync()` calls remain applied. A failed save also leaves the
session alive so you can retry with another output path. Closing all sessions
attempts each one and reports failures without discarding unsaved workbooks.
Sessions survive the launching shell, but their unsaved contents do not survive
a process crash or reboot.

Sessions use authenticated loopback connections and a private registry under
`~/.mog/sessions` (`%USERPROFILE%\.mog\sessions` on Windows). `MOG_SESSION_DIR`
can select another private directory, including for isolated test runs.
`--close-all` covers sessions in that registry. Stale records from crashed
workers are removed when a connection is refused.

## Scripting surface

Random, clock, path, and platform-dependent results require controlled inputs
or separate assertions, including dependent cells and spill ranges, when
comparing against an Excel-generated workbook. Exact cached-value equality
does not verify calculation accuracy.

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

Excel is desktop `Excel.Application` via COM plus a sideloaded Office.js add-in
(not AppSource / Office Scripts). The repository runners build a small native
adapter from Calipers' pinned `save` / `run` protocol to Mog's flags; `mog` itself
has no subcommands. The HTML also reports Office.js Excel API coverage
(Microsoft method catalog vs Mog host vs verification scripts). See
`vendor/calipers` `bench` / `bench-report` and `scripts/officejs-coverage`.

## Tests

```bash
cargo test -p mog
cargo test -p compute-api
```

Pull requests and `main` run `cargo build -p mog --locked` and
`cargo test --workspace --locked` on GitHub Actions.

## License

Apache-2.0. See [LICENSE](LICENSE).
