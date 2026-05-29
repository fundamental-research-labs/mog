use cell_types::SheetRange;

use crate::domain::table::{
    FilterColumnSpec, FilterSpec, Table, TableColumn, TableColumnSpec, TableSpec, TotalsFunction,
};
use crate::yrs_schema::table;

use super::support::roundtrip_map;

#[test]
fn table_spec_round_trips_ooxml_metadata() {
    let original = TableSpec {
        id: 1,
        name: "Table1".to_string(),
        display_name: "Sales Table".to_string(),
        range_ref: "A1:C10".to_string(),
        has_headers: true,
        has_totals: true,
        style_name: Some("TableStyleMedium2".to_string()),
        auto_filter_ref: Some("A1:C10".to_string()),
        columns: vec![TableColumnSpec {
            id: 1,
            name: "Amount".to_string(),
            totals_function: Some(TotalsFunction::Sum),
            calculated_formula: Some("[@Qty]*[@Price]".to_string()),
            ..Default::default()
        }],
        xr_uid: Some("{table-uid}".to_string()),
        ..Default::default()
    };

    assert_eq!(
        original,
        roundtrip_map(table::to_yrs_prelim(&original), |map, txn| {
            table::from_yrs_map(map, txn)
        })
    );
}

#[test]
fn canonical_table_round_trips_runtime_entrypoint() {
    let original = Table {
        id: "table-runtime-1".to_string(),
        name: "RuntimeTable".to_string(),
        display_name: "Runtime Table".to_string(),
        sheet_id: "sheet-1".to_string(),
        range: SheetRange::new(0, 0, 9, 2),
        columns: vec![TableColumn {
            id: "1".to_string(),
            name: "Amount".to_string(),
            index: 0,
            totals_function: Some(TotalsFunction::Sum),
            totals_label: Some("Total".to_string()),
            calculated_formula: Some("[@Qty]*[@Price]".to_string()),
        }],
        has_header_row: true,
        has_totals_row: true,
        style: "TableStyleMedium2".to_string(),
        banded_rows: true,
        banded_columns: false,
        emphasize_first_column: false,
        emphasize_last_column: true,
        show_filter_buttons: true,
        auto_expand: true,
        auto_calculated_columns: true,
    };

    assert_eq!(
        original,
        roundtrip_map(table::to_yrs_prelim_from_table(&original), |map, txn| {
            table::from_yrs_map_to_table(map, txn)
        },)
    );
}

#[test]
fn table_filter_show_button_default_true_survives_yrs_json_storage() {
    let original = TableSpec {
        id: 1,
        name: "Table1".to_string(),
        display_name: "Table1".to_string(),
        range_ref: "A1:A2".to_string(),
        columns: vec![TableColumnSpec {
            id: 1,
            name: "Status".to_string(),
            ..Default::default()
        }],
        filter_columns: vec![FilterColumnSpec {
            col_id: 0,
            hidden_button: false,
            show_button: true,
            filter: FilterSpec::Values {
                blank: false,
                values: vec!["Open".to_string()],
                calendar_type: None,
                date_group_items: Vec::new(),
            },
            ext_lst_raw: None,
        }],
        ..Default::default()
    };

    let round_tripped = roundtrip_map(table::to_yrs_prelim(&original), |map, txn| {
        table::from_yrs_map(map, txn)
    });

    assert!(round_tripped.filter_columns[0].show_button);
}

#[test]
fn table_filter_show_button_explicit_false_survives_yrs_json_storage() {
    let original = TableSpec {
        id: 1,
        name: "Table1".to_string(),
        display_name: "Table1".to_string(),
        range_ref: "A1:A2".to_string(),
        columns: vec![TableColumnSpec {
            id: 1,
            name: "Status".to_string(),
            ..Default::default()
        }],
        filter_columns: vec![FilterColumnSpec {
            col_id: 0,
            hidden_button: false,
            show_button: false,
            filter: FilterSpec::Values {
                blank: false,
                values: vec!["Open".to_string()],
                calendar_type: None,
                date_group_items: Vec::new(),
            },
            ext_lst_raw: None,
        }],
        ..Default::default()
    };

    let round_tripped = roundtrip_map(table::to_yrs_prelim(&original), |map, txn| {
        table::from_yrs_map(map, txn)
    });

    assert!(!round_tripped.filter_columns[0].show_button);
}
