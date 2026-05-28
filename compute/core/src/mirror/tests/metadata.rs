use crate::mirror::CellMirror;
use crate::mirror::test_helpers::{make_cell_id, make_sheet_id};
use cell_types::SheetId;
use domain_types::domain::table::{Table as CanonicalTable, TableColumn};
use formula_types::{NamedRangeDef, Scope};

#[test]
fn test_named_range_crud() {
    let mut mirror = CellMirror::new();
    let def = NamedRangeDef::from_positions(
        "MyRange".to_string(),
        Scope::Sheet(make_sheet_id(1)),
        make_cell_id(901),
        make_cell_id(902),
        0,
        0,
        9,
        2,
    );

    mirror.set_named_range("MyRange".to_string(), def);

    // Case-insensitive lookup
    assert!(mirror.get_named_range("myrange").is_some());
    assert!(mirror.get_named_range("MYRANGE").is_some());
    assert!(mirror.get_named_range("MyRange").is_some());

    let nr = mirror.get_named_range("myrange").unwrap();
    assert_eq!(nr.refers_to.refs.len(), 1);

    // Remove
    mirror.remove_named_range("MYRANGE");
    assert!(mirror.get_named_range("myrange").is_none());
}
fn make_canonical_table(
    name: &str,
    sheet: SheetId,
    start_row: u32,
    end_row: u32,
    end_col: u32,
    col_names: &[&str],
    has_header_row: bool,
    has_totals_row: bool,
) -> CanonicalTable {
    CanonicalTable {
        id: name.to_string(),
        name: name.to_string(),
        display_name: name.to_string(),
        sheet_id: sheet.to_uuid_string(),
        range: cell_types::SheetRange::new(start_row, 0, end_row, end_col),
        columns: col_names
            .iter()
            .enumerate()
            .map(|(i, n)| TableColumn {
                id: format!("{}", i + 1),
                name: n.to_string(),
                index: i as u32,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            })
            .collect(),
        has_header_row,
        has_totals_row,
        style: "TableStyleMedium2".to_string(),
        banded_rows: true,
        banded_columns: false,
        emphasize_first_column: false,
        emphasize_last_column: false,
        show_filter_buttons: true,
        auto_expand: true,
        auto_calculated_columns: true,
    }
}

#[test]
fn test_table_crud() {
    let mut mirror = CellMirror::new();
    let table = make_canonical_table(
        "Sales",
        make_sheet_id(1),
        0,
        10,
        3,
        &["Date", "Product", "Amount", "Total"],
        true,
        false,
    );

    mirror.set_table(table);
    assert!(mirror.get_table("Sales").is_some());
    assert!(mirror.get_table("NotExist").is_none());

    let t = mirror.get_table("Sales").unwrap();
    assert_eq!(t.columns.len(), 4);
    assert_eq!(t.range.start_row(), 0);
    assert_eq!(t.range.end_row(), 10);

    // Update table
    let updated = make_canonical_table(
        "Sales",
        make_sheet_id(1),
        0,
        20,
        3,
        &["Date", "Product", "Amount", "Total"],
        true,
        true,
    );
    mirror.set_table(updated);
    let t = mirror.get_table("Sales").unwrap();
    assert_eq!(t.range.end_row(), 20);
    assert!(t.has_totals_row);

    // Remove
    mirror.remove_table("Sales");
    assert!(mirror.get_table("Sales").is_none());
}
#[test]
fn test_table_case_insensitive_set() {
    let mut mirror = CellMirror::new();
    let table1 = make_canonical_table("Sales", make_sheet_id(1), 0, 10, 3, &["A"], true, false);
    mirror.set_table(table1);

    // Setting with different casing should update, not create duplicate
    let table2 = make_canonical_table("SALES", make_sheet_id(1), 0, 20, 3, &["A"], true, true);
    mirror.set_table(table2);

    // Should only have one table
    let t = mirror.get_table("sales").unwrap();
    assert_eq!(
        t.range.end_row(),
        20,
        "set_table with different casing should update existing"
    );
    assert!(t.has_totals_row);
}
#[test]
fn test_table_case_insensitive_remove() {
    let mut mirror = CellMirror::new();
    let table = make_canonical_table("Sales", make_sheet_id(1), 0, 10, 3, &["A"], true, false);
    mirror.set_table(table);
    assert!(mirror.get_table("Sales").is_some());

    // Remove with different casing should work
    mirror.remove_table("SALES");
    assert!(
        mirror.get_table("Sales").is_none(),
        "remove_table with different casing should remove the table"
    );
}
