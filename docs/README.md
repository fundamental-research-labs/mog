# Mog documentation

Mog is a native spreadsheet CLI. Its primary scripting interface is the
Office.js Excel API, evaluated inside the Rust binary.

## Use Mog

- [Installation](guides/installation.md)
- [Quickstart](guides/quickstart.md)
- [CLI and sessions](guides/cli.md)
- [Office.js scripting and compatibility](guides/officejs.md)
- [Supported workbook functions](../compute/officejs/FUNCTIONS.md)
- [Migrating to 1.0](guides/migrating-to-1.md)
- [Native diagnostics](guides/diagnostics.md)

## Develop and release

- [Architecture](guides/architecture-overview.md)
- [Undo and redo](guides/undo-redo.md)
- [Verification and benchmarks](guides/verification.md)
- [Release process](releasing.md)
- [Native storage vs Yrs baseline](guides/remove-yrs-bench.md)
- [Storage model memory and speed comparison](guides/storage-model-bench.md)
- [SUM range preparation and streaming benchmarks](guides/sum-aggregation-bench.md)
- [Typed property access and A1 resolution](guides/typed-property-access-bench.md)
- [Trademark notices](../TRADEMARKS.md)
