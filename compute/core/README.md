# Compute core

The native Rust spreadsheet engine owns workbook state, formula parsing and
evaluation, dependency tracking, recalculation, and data transforms.

- `src/` orchestrates workbook operations and the evaluation pipeline.
- `crates/` contains the supporting type, storage, formula, and domain crates.
- [`compute-api`](../api/README.md) provides the Rust workbook facade.
- [`mog`](../officejs/) embeds QuickJS and exposes the Office.js Excel API.
- [`file-io`](../../file-io/) reads and writes XLSX files.

Authored values and formulas live in a sparse native store. Stable cell and axis
identities preserve references through structural edits. Typed metadata holds
workbook features, and local undo/redo records inverse mutations.

See [architecture](../../docs/guides/architecture-overview.md),
[undo and redo](../../docs/guides/undo-redo.md), the
[dependency graph](crates/compute-graph/README.md), and the
[wire format](crates/compute-wire/README.md) for implementation details.

Run from the repository root:

```sh
cargo test -p compute-core --locked
cargo test -p compute-api --locked
```

For performance measurements, see
[verification and benchmarks](../../docs/guides/verification.md).
