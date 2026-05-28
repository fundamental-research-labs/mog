use super::support::{make_cell_id, make_sheet_id};
use super::*;

#[test]
fn test_named_ranges() {
    let _storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let def = NamedRangeDef::from_positions(
        "Revenue".to_string(),
        formula_types::Scope::Workbook,
        make_cell_id(5001),
        make_cell_id(5002),
        0,
        0,
        9,
        0,
    );

    mirror.set_named_range("Revenue".to_string(), def);

    assert!(mirror.get_named_range("revenue").is_some());
    assert!(mirror.get_named_range("REVENUE").is_some());

    let nr = mirror.get_named_range("revenue").unwrap();
    assert_eq!(nr.refers_to.refs.len(), 1);

    mirror.remove_named_range("Revenue");
    assert!(mirror.get_named_range("revenue").is_none());
}

#[test]
fn test_tables() {
    let _storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let table = domain_types::domain::table::Table {
        id: "Sales".to_string(),
        name: "Sales".to_string(),
        display_name: "Sales".to_string(),
        sheet_id: make_sheet_id(1).to_uuid_string(),
        range: cell_types::SheetRange::new(0, 0, 10, 3),
        columns: vec![
            domain_types::domain::table::TableColumn {
                id: "1".into(),
                name: "Date".into(),
                index: 0,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
            domain_types::domain::table::TableColumn {
                id: "2".into(),
                name: "Product".into(),
                index: 1,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
            domain_types::domain::table::TableColumn {
                id: "3".into(),
                name: "Amount".into(),
                index: 2,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
            domain_types::domain::table::TableColumn {
                id: "4".into(),
                name: "Total".into(),
                index: 3,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
        ],
        has_header_row: true,
        has_totals_row: false,
        style: "TableStyleMedium2".to_string(),
        banded_rows: true,
        banded_columns: false,
        emphasize_first_column: false,
        emphasize_last_column: false,
        show_filter_buttons: false,
        auto_expand: true,
        auto_calculated_columns: true,
    };

    mirror.set_table(table);
    assert!(mirror.get_table("Sales").is_some());
    assert!(mirror.get_table("NotExist").is_none());

    let t = mirror.get_table("Sales").unwrap();
    assert_eq!(t.columns.len(), 4);

    assert!(mirror.get_table_def("Sales").is_some());
    assert_eq!(mirror.get_table_def("Sales").unwrap().columns.len(), 4);

    mirror.remove_table("Sales");
    assert!(mirror.get_table("Sales").is_none());
    assert!(mirror.get_table_def("Sales").is_none());
}
