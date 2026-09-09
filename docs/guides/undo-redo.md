# Undo and redo

Mog keeps local undo/redo in the native engine. History records typed inverses
for touched cells, metadata, and structural changes. Undo restores authored
state and recalculates dependent formulas; redo reapplies the action. Yrs and
collaboration are not part of this implementation.

## Rust API

Call `workbook.history()` on a `compute_api::Workbook`. The returned handle
shares history with other handles to that workbook.

| Method | Result |
| --- | --- |
| `undo()` / `redo()` | Apply one action and return its `MutationResult` |
| `can_undo()` / `can_redo()` | Report whether an action is available |
| `get_undo_state()` | Return availability and `undo_depth` / `redo_depth` |
| `begin_undo_group()` / `end_undo_group()` | Group multiple operations into one action; groups nest |

A single-cell edit is one action. A bulk write, paste, format change, or
structural command is also one action, regardless of how many cells it touches.
Explicit groups can combine several calls:

```rust
use compute_api::{ComputeApiError, Workbook};

fn grouped_edit(workbook: &Workbook) -> Result<(), ComputeApiError> {
    let sheet = workbook.sheet_by_name("Sheet1")?;
    let history = workbook.history();
    history.begin_undo_group()?;
    let edits = (|| -> Result<(), ComputeApiError> {
        sheet.set_cell("A1", "10")?;
        sheet.set_cell("A2", "=A1*2")?;
        Ok(())
    })();
    let closed = history.end_undo_group();
    edits?;
    closed?;
    history.undo()?; // Restores both cells together.
    history.redo()?; // Restores the formula and recalculates A2 to 20.
    Ok(())
}
```

Always close a group, including when an operation returns an error. A group
collects applied edits; it is not a rollback transaction. A later failure does
not discard earlier successful edits. Those edits remain one reversible
action. An empty group adds no action. Undo or redo on an empty stack succeeds
with an empty mutation result.

## Office.js grouping

All authored edits applied by one `context.sync()` belong to one action:

```js
await Excel.run(async (context) => {
  const sheet = context.workbook.worksheets.getItem("Sheet1");
  sheet.getRange("A1").values = [[10]];
  sheet.getRange("A2").formulas = [["=A1*2"]];
  await context.sync();
});
```

The Rust host can undo both edits with `workbook.history().undo()` on the
workbook passed to `mog::run_office_js_with_workbook`. Reload the ranges through
Office.js to observe the result. No custom JavaScript history API is required.

Separate mutating syncs create separate actions. Read-only and empty syncs add
none. Automatic flushing at the end of `Excel.run` follows the same rule.
An explicit Rust history group can combine multiple syncs or script calls.

If a sync fails after applying some queued operations, its successful prefix
remains applied and undoable as one action. The host closes the sync's group,
so a later script creates its own action. A rejected batch that applies
nothing creates no history entry and does not discard redo.

## State that history preserves

A new authored edit after undo clears redo. Recalculation results, loads,
bootstrap, viewport registration, selection, scrolling, transient UI formats,
and principal/session security state do not create actions or clear redo.
Undoing authored workbook settings preserves later selection and custom UI
settings. Formula source, including invalid source that evaluates to an error,
remains reversible; calculated spill values are derived again during replay.

Importing selected sheets is an authored action. Successful whole-workbook
replacement starts a new history. Initial construction and deferred loading
are bootstrap work. Undo history is local runtime state and is not serialized
into XLSX or native workbook snapshots.

Coverage includes the core `test_undo_redo_*` and `test_native_history*` suites,
[`compute-api` history tests](../../compute/api/tests/history.rs), and
[Office.js history tests](../../compute/officejs/tests/history.rs).
