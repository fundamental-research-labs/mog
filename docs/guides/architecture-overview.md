# Architecture

Mog is a headless spreadsheet engine:

1. **Compute core** (`compute/core`) owns formula evaluation, sparse cells, UUID identities, and native workbook metadata.
2. **Compute API** (`compute/api`) provides the Rust workbook/sheet facade for native callers and the scripting host.
3. **Office.js host** (`compute/officejs`) embeds QuickJS and exposes `Excel.run` / `load` / `sync` on that facade.
4. **CLI** (`mog`) evaluates a script file or `--eval` source through the same entry as the tests.

The native cell store is the source of truth for authored values and formulas.
Compact ranges share immutable value buffers; individual edits remain sparse.
Rows, columns, cells, and sheets have stable UUID identities, while position and
layout indexes refer to those identities. Workbook and worksheet metadata use
typed native structures, and mutations schedule dependent formulas directly.

Undo/redo stores typed inverses for touched native entities at user-action
grain. Replay restores authored state and recalculates dependents; it does not
reconstruct another document. Rust callers use `Workbook::history()`, and each
mutating Office.js `context.sync()` forms one action. See the
[history contract](undo-redo.md) for grouping and failure behavior.

Yrs and collaboration are removed. The public scripting boundary remains
Office.js; the repository contains no UI, Node N-API host, or custom `wb`/`ws`
scripting API.

The before/after workloads and measurement method are documented in
[the storage benchmark report](remove-yrs-bench.md).
