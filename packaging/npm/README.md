# Mog CLI

A native spreadsheet CLI, scripted with the Office.js Excel API.

```sh
npm install -g @mog-sdk/cli@1
mog --help
mog -i input.xlsx -f script.js -o output.xlsx
```

This package only launches the Rust executable for your OS and CPU. Optional
platform packages contain the native binaries; keep optional dependencies
enabled. Node.js 22+ is required for the launcher. No Node bindings, SDK, or
install scripts are included. JavaScript scripts execute inside Mog's embedded
QuickJS runtime.

Use `Excel.run`,
`context.workbook`, `load`, and `context.sync()` to work with spreadsheets.
Office.js support is incomplete; 1.0 does not imply full Excel compatibility.

[Documentation](https://github.com/fundamental-research-labs/mog/tree/main/docs) ·
[Installation and platforms](https://github.com/fundamental-research-labs/mog/blob/main/docs/guides/installation.md)
