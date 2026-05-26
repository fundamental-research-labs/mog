use std::sync::Arc;

use super::helpers::*;
use domain_types::{TableColumnSpec, TableSpec, TotalsFunction};
use value_types::{CellValue, FiniteF64};

#[test]
fn roundtrip_table_basic() {
    let mut output = make_single_sheet(
        "TableSheet",
        vec![
            // Header row
            cell(0, 0, CellValue::Text(Arc::from("Name"))),
            cell(0, 1, CellValue::Text(Arc::from("Age"))),
            cell(0, 2, CellValue::Text(Arc::from("Score"))),
            // Data rows
            cell(1, 0, CellValue::Text(Arc::from("Alice"))),
            cell(1, 1, CellValue::Number(FiniteF64::new(30.0).unwrap())),
            cell(1, 2, CellValue::Number(FiniteF64::new(95.0).unwrap())),
            cell(2, 0, CellValue::Text(Arc::from("Bob"))),
            cell(2, 1, CellValue::Number(FiniteF64::new(25.0).unwrap())),
            cell(2, 2, CellValue::Number(FiniteF64::new(88.0).unwrap())),
        ],
    );
    output.sheets[0].rows = 3;
    output.sheets[0].cols = 3;
    output.sheets[0].tables = vec![TableSpec {
        id: 1,
        name: "Table1".to_string(),
        display_name: "Table1".to_string(),
        range_ref: "A1:C3".to_string(),
        has_headers: true,
        has_totals: false,
        style_name: Some("TableStyleMedium2".to_string()),
        row_stripes: true,
        col_stripes: false,
        first_col_highlight: false,
        last_col_highlight: false,
        auto_filter_ref: Some("A1:C3".to_string()),
        columns: vec![
            TableColumnSpec {
                name: "Name".to_string(),
                ..Default::default()
            },
            TableColumnSpec {
                name: "Age".to_string(),
                ..Default::default()
            },
            TableColumnSpec {
                name: "Score".to_string(),
                ..Default::default()
            },
        ],
        ..Default::default()
    }];

    let rt = roundtrip(&output);
    assert!(
        !rt.sheets[0].tables.is_empty(),
        "Tables should survive round-trip"
    );

    let t = &rt.sheets[0].tables[0];
    assert_eq!(t.name, "Table1", "Table name should be preserved");
    assert_eq!(t.display_name, "Table1", "Display name should be preserved");
    assert_eq!(t.range_ref, "A1:C3", "Range ref should be preserved");
    assert_eq!(t.has_headers, true, "has_headers should be preserved");
    assert_eq!(t.columns.len(), 3, "Should have 3 columns");
    assert_eq!(t.columns[0].name, "Name");
    assert_eq!(t.columns[1].name, "Age");
    assert_eq!(t.columns[2].name, "Score");
}

#[test]
fn roundtrip_table_with_totals() {
    let mut output = make_single_sheet(
        "TableTotals",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Item"))),
            cell(0, 1, CellValue::Text(Arc::from("Amount"))),
            cell(1, 0, CellValue::Text(Arc::from("A"))),
            cell(1, 1, CellValue::Number(FiniteF64::new(100.0).unwrap())),
            cell(2, 0, CellValue::Text(Arc::from("Total"))),
            cell(2, 1, CellValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
    );
    output.sheets[0].rows = 3;
    output.sheets[0].cols = 2;
    output.sheets[0].tables = vec![TableSpec {
        id: 1,
        name: "TotalsTable".to_string(),
        display_name: "TotalsTable".to_string(),
        range_ref: "A1:B3".to_string(),
        has_headers: true,
        has_totals: true,
        style_name: Some("TableStyleLight1".to_string()),
        row_stripes: true,
        col_stripes: false,
        first_col_highlight: false,
        last_col_highlight: false,
        auto_filter_ref: Some("A1:B2".to_string()),
        columns: vec![
            TableColumnSpec {
                name: "Item".to_string(),
                totals_label: Some("Total".to_string()),
                ..Default::default()
            },
            TableColumnSpec {
                name: "Amount".to_string(),
                totals_function: Some(TotalsFunction::Sum),
                ..Default::default()
            },
        ],
        ..Default::default()
    }];

    let rt = roundtrip(&output);
    assert!(
        !rt.sheets[0].tables.is_empty(),
        "Table with totals should survive"
    );

    let t = &rt.sheets[0].tables[0];
    assert_eq!(t.name, "TotalsTable");
    assert_eq!(t.has_totals, true, "has_totals should be preserved");
    assert_eq!(t.columns.len(), 2);
}
