# Mog

**A native spreadsheet CLI, scripted with the Office.js Excel API.**

Mog opens, edits, recalculates, and saves `.xlsx` workbooks from your terminal.
The engine is written in Rust; JavaScript runs inside the binary through
QuickJS. No Excel installation, browser, or server is required.

The primary interface is Office.js: `Excel.run`, `context.workbook`,
`Range.load`, and `context.sync()`. Mog implements a growing subset of the
Excel JavaScript API, not a separate spreadsheet scripting language.

[Website](https://sheetmog.ai) · [Documentation](docs/README.md) ·
[Release preparation](docs/releasing.md)

## Install

Mog 1.0 is being prepared for release. Until it is published, build from source
with stable Rust and a C compiler:

```sh
cargo install --path compute/officejs --locked
mog --version
```

The 1.0 release will provide standalone binaries for macOS (Apple Silicon and
Intel), Linux (x64 and ARM64, glibc), and Windows (x64), plus npm distribution:

```sh
# Once 1.0 is published:
npm install -g @mog-sdk/cli@1
mog --help
```

The npm package only launches the native binary. It adds no JavaScript SDK,
Node bindings, or spreadsheet functionality. Standalone binaries do not need
Node.js. See [installation](docs/guides/installation.md) for platform requirements.

## Run an Office.js script

Save this as `formula.js`:

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

```sh
mog -f formula.js -o result.xlsx
# Prints 20 and saves result.xlsx
```

Writes queue until `context.sync()`. Load properties and sync before reading
results. The [quickstart](docs/guides/quickstart.md) explains this model.

## Work with files

```sh
mog -i input.xlsx -f script.js -o output.xlsx  # edit a copy
mog -i input.xlsx -r                          # recalculate in place
mog -o blank.xlsx                            # create a workbook
mog -e 'console.log("hello")' -o hello.xlsx   # inline JavaScript
```

With `-i` and no `-o`, Mog saves **in place**. Without either, it chooses an
unused `workbook.xlsx`, `workbook-2.xlsx`, and so on. Scripts trigger
recalculation before saving; a script failure does not save the workbook.
Running `mog` alone shows help.

For repeated edits, `mog -s -i input.xlsx` starts a background session and prints
an ID. Use `mog -s ID -f script.js` to edit, then `mog -s ID --close` to save and
exit. Sessions keep work in memory until closed. See the
[CLI reference](docs/guides/cli.md) for save behavior and session commands.

## Scope and compatibility

Mog is a headless, native CLI. There is no spreadsheet UI or browser runtime.
Office.js support includes ranges, formulas, formatting, tables, names, and
other worksheet operations. Coverage is incomplete: 1.0 does **not** mean full
Excel or Office.js compatibility. See [scripting support](docs/guides/officejs.md),
[supported workbook functions](compute/officejs/FUNCTIONS.md), and the
[verification corpus](vendor/calipers/verification/README.md).

Version 1 replaces the earlier `@mog-sdk/cli` SDK-based CLI. Its commands and
scripting interface are different; see [migration notes](docs/guides/migrating-to-1.md).

## Develop

```sh
cargo build -p mog --locked
cargo test -p mog --locked
cargo test -p compute-api --locked
```

Pull requests run the workspace tests and Calipers verification on GitHub
Actions. [Architecture](docs/guides/architecture-overview.md),
[benchmarks](docs/guides/verification.md), and
[native diagnostics](docs/guides/diagnostics.md) cover the internals.

## License

[Apache-2.0](LICENSE). See [trademark notices](TRADEMARKS.md).
