use super::super::types::TableRange;
use super::test_fixtures::make_test_table;
use super::*;

// ---- Add Column ----

#[test]
fn add_column_at_end() {
    let t = make_test_table();
    let t2 = add_column(&t, "Score", None);
    assert_eq!(t2.columns.len(), 4);
    assert_eq!(t2.columns[3].name, "Score");
    assert_eq!(t2.columns[3].index, 3);
    assert_eq!(t2.range.end_col(), t.range.end_col() + 1);
}

#[test]
fn add_column_at_beginning() {
    let t = make_test_table();
    let t2 = add_column(&t, "ID", Some(0));
    assert_eq!(t2.columns.len(), 4);
    assert_eq!(t2.columns[0].name, "ID");
    assert_eq!(t2.columns[0].index, 0);
    assert_eq!(t2.columns[1].name, "Name");
    assert_eq!(t2.columns[1].index, 1);
}

#[test]
fn add_column_on_first_column() {
    let t = make_test_table();
    let t2 = add_column(&t, "ID", Some(0));
    assert_eq!(t2.columns.len(), 4);
    assert_eq!(t2.columns[0].name, "ID");
    assert_eq!(t2.columns[0].index, 0);
    assert_eq!(t2.columns[1].name, "Name");
    assert_eq!(t2.columns[1].index, 1);
    assert_eq!(t2.columns[2].name, "Age");
    assert_eq!(t2.columns[2].index, 2);
    assert_eq!(t2.columns[3].name, "City");
    assert_eq!(t2.columns[3].index, 3);
    assert_eq!(t2.range.end_col(), t.range.end_col() + 1);
}

#[test]
fn add_column_on_last_column() {
    let t = make_test_table();
    let last_idx = t.columns.len();
    let t2 = add_column(&t, "Score", Some(last_idx));
    assert_eq!(t2.columns.len(), 4);
    assert_eq!(t2.columns[3].name, "Score");
    assert_eq!(t2.columns[3].index, 3);
    assert_eq!(t2.columns[0].name, "Name");
    assert_eq!(t2.columns[1].name, "Age");
    assert_eq!(t2.columns[2].name, "City");
    assert_eq!(t2.range.end_col(), t.range.end_col() + 1);
}

#[test]
fn add_column_dedup_incrementing_counter() {
    // BUG FIX TEST: Name dedup must use incrementing counter
    let t = make_test_table(); // has "Name", "Age", "City"
    let t2 = add_column(&t, "Name", None); // should become "Name2"
    assert_eq!(t2.columns[3].name, "Name2");

    let t3 = add_column(&t2, "Name", None); // should become "Name3", NOT "Name22"
    assert_eq!(t3.columns[4].name, "Name3");

    let t4 = add_column(&t3, "Name", None); // should become "Name4", NOT "Name222"
    assert_eq!(t4.columns[5].name, "Name4");
}

#[test]
fn add_column_dedup_case_insensitive() {
    let t = make_test_table(); // has "Name"
    let t2 = add_column(&t, "name", None); // "name" collides with "Name"
    assert_eq!(t2.columns[3].name, "name2");
}

#[test]
fn add_column_position_clamped() {
    let t = make_test_table(); // 3 columns
    let t2 = add_column(&t, "X", Some(999));
    assert_eq!(t2.columns.last().unwrap().name, "X");
}

// ---- Remove Column ----

#[test]
fn remove_column_basic() {
    let t = make_test_table();
    let col_id = t.columns[1].id.clone();
    let t2 = remove_column(&t, &col_id);
    assert_eq!(t2.columns.len(), 2);
    assert_eq!(t2.columns[0].name, "Name");
    assert_eq!(t2.columns[0].index, 0);
    assert_eq!(t2.columns[1].name, "City");
    assert_eq!(t2.columns[1].index, 1);
    assert_eq!(t2.range.end_col(), t.range.end_col() - 1);
}

#[test]
fn remove_column_first() {
    let t = make_test_table();
    let first_col_id = t.columns[0].id.clone();
    let t2 = remove_column(&t, &first_col_id);
    assert_eq!(t2.columns.len(), 2);
    assert_eq!(t2.columns[0].name, "Age");
    assert_eq!(t2.columns[0].index, 0);
    assert_eq!(t2.columns[1].name, "City");
    assert_eq!(t2.columns[1].index, 1);
    assert_eq!(t2.range.end_col(), t.range.end_col() - 1);
}

#[test]
fn remove_column_last() {
    let t = make_test_table();
    let last_col_id = t.columns[2].id.clone();
    let t2 = remove_column(&t, &last_col_id);
    assert_eq!(t2.columns.len(), 2);
    assert_eq!(t2.columns[0].name, "Name");
    assert_eq!(t2.columns[0].index, 0);
    assert_eq!(t2.columns[1].name, "Age");
    assert_eq!(t2.columns[1].index, 1);
    assert_eq!(t2.range.end_col(), t.range.end_col() - 1);
}

#[test]
fn remove_column_not_found() {
    let t = make_test_table();
    let t2 = remove_column(&t, "nonexistent");
    assert_eq!(t2.columns.len(), t.columns.len());
}

#[test]
fn remove_column_last_column_prevented() {
    let t = create_table("T1", "s1", TableRange::new(0, 0, 5, 0), &["Only"], None).unwrap();
    let t2 = remove_column(&t, &t.columns[0].id);
    assert_eq!(t2.columns.len(), 1); // unchanged
}

#[test]
fn table_with_nonzero_start_col() {
    let t = create_table(
        "T1",
        "s1",
        TableRange::new(0, 5, 10, 7),
        &["A", "B", "C"],
        None,
    )
    .unwrap();
    assert_eq!(t.columns.len(), 3);
    assert_eq!(t.range.start_col(), 5);
    assert_eq!(t.range.end_col(), 7);

    let t2 = add_column(&t, "D", None);
    assert_eq!(t2.columns.len(), 4);
    assert_eq!(t2.range.end_col(), 8);

    let col_id = t2.columns[1].id.clone();
    let t3 = remove_column(&t2, &col_id);
    assert_eq!(t3.columns.len(), 3);
    assert_eq!(t3.range.end_col(), 7);
    for (i, col) in t3.columns.iter().enumerate() {
        assert_eq!(col.index, i as u32);
    }
}

// ---- Rename Column ----

#[test]
fn rename_column_basic() {
    let t = make_test_table();
    let t2 = rename_column(&t, &t.columns[0].id, "FullName").unwrap();
    assert_eq!(t2.columns[0].name, "FullName");
}

#[test]
fn rename_column_duplicate_name_errors() {
    let t = make_test_table(); // "Name", "Age", "City"
    let result = rename_column(&t, &t.columns[0].id, "Age");
    assert!(result.is_err());
}

#[test]
fn rename_column_duplicate_case_insensitive() {
    let t = make_test_table(); // "Name", "Age", "City"
    let result = rename_column(&t, &t.columns[0].id, "AGE");
    assert!(result.is_err());
}

#[test]
fn rename_column_not_found() {
    let t = make_test_table();
    let t2 = rename_column(&t, "nonexistent", "Whatever").unwrap();
    assert_eq!(t2.columns, t.columns); // unchanged
}

// ---- Immutability: original table is not modified ----

#[test]
fn operations_do_not_mutate_original() {
    let t = make_test_table();
    let _t2 = add_column(&t, "New", None);
    assert_eq!(t.columns.len(), 3); // original unchanged

    let _t3 = remove_column(&t, "TestTable-col-0");
    assert_eq!(t.columns.len(), 3); // original unchanged

    let _t4 = toggle_totals_row(&t);
    assert!(!t.has_totals_row); // original unchanged
}
