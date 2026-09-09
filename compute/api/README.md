# Compute API

`compute-api` provides the native Rust `Workbook` and `Sheet` facade used by
Mog's Office.js host. Workbook handles share their underlying engine and undo
history.

```rust
use compute_api::{ComputeApiError, Workbook};

fn example() -> Result<(), ComputeApiError> {
    let (workbook, _) = Workbook::blank()?;
    let sheet = workbook.sheet_by_name("Sheet1")?;
    let history = workbook.history();

    sheet.set_range("A1:A2", &[vec!["10".into()], vec!["=A1*2".into()]])?;
    assert_eq!(history.get_undo_state()?.undo_depth, 1);
    history.undo()?;
    history.redo()?;
    Ok(())
}
```

`history()` exposes `undo`, `redo`, `can_undo`, `can_redo`, `get_undo_state`,
`begin_undo_group`, and `end_undo_group`. Groups nest, and bulk writes create
one action. Undo and redo return mutation results with recalculated cells.

Each mutating Office.js `context.sync()` shares one history action. A failed
sync keeps its successfully applied prefix undoable and closes its group.
Rejected operations that change nothing preserve redo. A new authored edit
clears redo; reads and recalculation do not.

See [undo and redo](../../docs/guides/undo-redo.md) for explicit grouping and
failure handling. Run `cargo test -p compute-api` to verify the facade.
