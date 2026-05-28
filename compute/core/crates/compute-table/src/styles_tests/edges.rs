use super::fixtures::{TableOverrides, make_table};
use crate::styles::resolve_table_cell_format;
use crate::types::{TableColumn, TableRange};

#[test]
fn single_cell_table() {
    let table = make_table(Some(TableOverrides {
        range: Some(TableRange::new(0, 0, 0, 0)),
        columns: Some(vec![TableColumn {
            id: "c".to_string(),
            name: "X".to_string(),
            index: 0,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
        }]),
        has_header_row: Some(false),
        has_totals_row: Some(false),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 0, 0);
    assert!(fmt.is_some());
}

#[test]
fn table_at_non_zero_origin() {
    let table = make_table(Some(TableOverrides {
        range: Some(TableRange::new(100, 50, 105, 52)),
        has_header_row: Some(true),
        has_totals_row: Some(false),
        ..Default::default()
    }));
    assert!(resolve_table_cell_format(&table, 0, 0).is_none());
    let fmt = resolve_table_cell_format(&table, 100, 50).unwrap();
    assert_eq!(fmt.font_bold, Some(true));
    let fmt_data = resolve_table_cell_format(&table, 101, 51);
    assert!(fmt_data.is_some());
    assert!(fmt_data.unwrap().fill.is_some());
}

#[test]
fn one_row_range_with_header_and_totals_returns_none_for_data() {
    // A 1-row range where both has_header_row and has_totals_row are true
    // means the header *is* the totals row (row 0 is claimed by header).
    // data_start_row = 0 + 1 = 1, data_end_row = saturating_sub(0, 1) = 0.
    // So there is NO valid data area. Querying row 0 should match header,
    // not panic from u32 underflow.
    let table = make_table(Some(TableOverrides {
        range: Some(TableRange::new(0, 0, 0, 0)),
        columns: Some(vec![TableColumn {
            id: "c".to_string(),
            name: "X".to_string(),
            index: 0,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
        }]),
        has_header_row: Some(true),
        has_totals_row: Some(true),
        ..Default::default()
    }));

    // Row 0 is the header row (header takes priority over totals).
    let fmt = resolve_table_cell_format(&table, 0, 0);
    assert!(fmt.is_some());
    // It must be treated as header (bold, header fill)
    let fmt = fmt.unwrap();
    assert_eq!(fmt.font_bold, Some(true));

    // Outside the table: no format
    assert!(resolve_table_cell_format(&table, 1, 0).is_none());
}
