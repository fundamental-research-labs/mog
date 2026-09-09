# Architecture

Mog is a headless spreadsheet engine:

1. **Compute core** (`compute/core`) owns formula evaluation, sparse cells, UUID identities, and native workbook metadata.
2. **Compute API** (`compute/api`) provides the Rust workbook/sheet facade for native callers and the scripting host.
3. **Office.js host** (`compute/officejs`) embeds QuickJS and exposes `Excel.run` / `load` / `sync` on that facade.
4. **CLI** (`mog`) evaluates a script file or `--eval` source through the same entry as the tests.

The native cell store is the source of truth for authored values and formulas.
Compact ranges share immutable value buffers; individual edits remain sparse.
`SheetStore` owns the sparse bijection between authored cell IDs and stable
`(RowId, ColId)` pairs. `GridIndex` shares the compact row and column axes and
owns no cell mappings. Inserting an axis changes order without rekeying surviving
cells. Blank grid slots have no cell entry; formula and metadata anchors acquire
identities only when needed.

Shared `AxisIndex` instances cache encoded identity spans per compact segment,
so cell lookups do not hash the same sheet/run seed for every read. Explicit
axes retain a reverse lookup table. These indexes are derived from native axes.

Imported range offsets use compact run arithmetic, with explicit lookup tables
for scrambled identities. Compact row ownership is tracked per run;
`row_to_sheet` contains only explicit row IDs. Formula ASTs live in a sparse
sidecar beside authored values. Workbook and worksheet metadata use typed native
structures, and mutations return `MutationResult` directly.

`DimensionState` owns custom sizes and visibility. `PixelLayout` derives geometry
lazily from those records using sparse delta prefixes. Fonts load on the first
autofit or screenshot request. Formula-only workbooks allocate neither pixel
layouts nor font data. Merge rectangles are held in a `MergeList` and queried
by linear scan.

Undo/redo stores typed inverses for touched native entities at user-action
grain. Replay restores authored state and recalculates dependents; it does not
reconstruct another document. Rust callers use `Workbook::history()`, and each
mutating Office.js `context.sync()` forms one action. See the
[history contract](undo-redo.md) for grouping and failure behavior.

Yrs and collaboration are removed. The public scripting boundary remains
Office.js; the repository contains no UI, Node N-API host, or custom `wb`/`ws`
scripting API.

The before/after workloads and measurement method are documented in
[the storage benchmark report](remove-yrs-bench.md). A review of in-memory
indexes versus the Cells engine is in [storage model review](storage-model-review.md).
The subsequent storage changes are measured in the
[memory and speed comparison](storage-model-bench.md).
