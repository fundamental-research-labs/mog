# Version Control Rust Boundary

## Materialized merge audit

Version merge materialization currently builds a TypeScript replay plan from public
`VersionMergeChange` records, then applies that plan through the normal workbook
mutation APIs. This is acceptable as orchestration: TypeScript owns version-store
admission, preview artifacts, public diagnostics, operation contexts, and the
commit-capture wrapper around merge apply.

Rust remains the source of truth for workbook state transitions. Materialized
cell values, direct cell formats, row/column structural edits, sheet tab colors,
and frozen panes are applied through existing operation modules or
`computeBridge` methods. In particular, frozen-pane merge materialization only
validates the semantic record shape in TypeScript, then calls
`computeBridge.setFrozenPanes(sheetId, rows, cols)`. Rust still writes the sheet
metadata, derives pane config, and emits mutation results.

## Boundary rule

Keep TypeScript limited to:

- resolving version merge artifacts and saved resolutions;
- mapping public merge records to existing mutation entrypoints;
- attaching version operation context and capture metadata;
- returning public-facing unsupported-materialization diagnostics.

Move logic to Rust/compute when it determines workbook semantics that Rust
already owns, including:

- row/column index shifting and formula/reference updates;
- cell identity allocation or structural reindexing;
- formula parsing, recalculation, and value interpretation beyond scalar/formula
  dispatch;
- sheet view metadata normalization such as pane config derived from frozen
  rows/columns;
- format cascade/effective-format resolution.

## Current gap

The materialization planner and support inspector duplicate some semantic-record
shape checks in TypeScript. That is a drift risk, but there is not yet a narrow
existing Rust bridge endpoint for "plan/apply these version merge changes" that
can absorb it without introducing a new public wire contract across N-API, WASM,
and the generated TypeScript bridge.

Do not expand this duplication for additional domains. The next materialized
merge domain should first add a Rust-owned bridge contract that accepts normalized
merge-change records and returns either a typed materialization plan or an
unsupported-domain diagnostic. TypeScript should then keep ownership of version
artifact lookup and operation-context/capture wrapping only.
