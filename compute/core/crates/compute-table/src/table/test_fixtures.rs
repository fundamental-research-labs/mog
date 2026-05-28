use super::super::types::{Table, TableRange};
use super::{CreateTableOptions, create_table};

/// Helper: create a simple table with header row, no totals, starting at (0,0).
pub(super) fn make_test_table() -> Table {
    create_table(
        "TestTable",
        "sheet1",
        TableRange::new(0, 0, 10, 2),
        &["Name", "Age", "City"],
        None,
    )
    .expect("valid range")
}
