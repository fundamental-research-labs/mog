use cell_types::SheetPos;
use compute_pivot::types::{
    FieldId, PivotColumnHeader, PivotGrandTotals, PivotHeader, PivotRenderedBounds, PivotRow,
    PivotTableResult,
};
use value_types::CellValue;

use super::helpers::make_mirror;

#[test]
fn clear_pivot_region_touches_only_existing_columns() {
    let (mut mirror, sheet_id) = make_mirror();
    mirror.apply_edit(
        &sheet_id,
        cell_types::CellId::from_raw(850),
        cell_types::SheetPos::new(2, 3),
        CellValue::number(9.0),
        None,
    );
    let before_existing = mirror.col_version(&sheet_id, 3);
    let before_missing = mirror.col_version(&sheet_id, 4);

    mirror.clear_pivot_region(&sheet_id, 2, 3, 2, 2);

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.col_data[&3][2], CellValue::Null);
    assert!(!sheet.col_data.contains_key(&4));
    assert_eq!(mirror.col_version(&sheet_id, 3), before_existing + 1);
    assert_eq!(mirror.col_version(&sheet_id, 4), before_missing);
}

#[test]
fn clear_pivot_region_removes_authored_overrides_that_mask_output() {
    let (mut mirror, sheet_id) = make_mirror();
    let pos = SheetPos::new(2, 3);
    mirror.apply_edit(
        &sheet_id,
        cell_types::CellId::from_raw(851),
        pos,
        CellValue::from("stale vendor"),
        None,
    );

    mirror.clear_pivot_region(&sheet_id, 2, 3, 1, 1);

    assert_eq!(
        mirror.get_cell_value_at(&sheet_id, pos),
        Some(&CellValue::Null)
    );

    mirror.materialize_pivot(
        &sheet_id,
        2,
        3,
        &PivotTableResult {
            column_headers: Vec::new(),
            rows: vec![PivotRow {
                key: "fresh".to_string(),
                headers: Vec::new(),
                values: vec![CellValue::from("fresh vendor")],
                depth: 0,
                is_subtotal: false,
                is_grand_total: false,
                source_row_indices: None,
            }],
            grand_totals: PivotGrandTotals {
                row: None,
                column: None,
                grand: None,
                row_label: None,
            },
            source_row_count: 1,
            rendered_bounds: PivotRenderedBounds {
                total_rows: 1,
                total_cols: 1,
                first_data_row: 0,
                first_data_col: 0,
                num_data_cols: 1,
            },
            measure_descriptors: Vec::new(),
            value_records: Vec::new(),
            errors: None,
        },
        &[],
    );

    assert_eq!(
        mirror.get_cell_value_at(&sheet_id, pos),
        Some(&CellValue::from("fresh vendor"))
    );
}

#[test]
fn materialized_pivot_output_is_identity_backed_without_overwriting_col_data() {
    let (mut mirror, sheet_id) = make_mirror();
    let id_alloc = cell_types::IdAllocator::new();
    let value_header = PivotHeader {
        key: "value_sales".to_string(),
        value: CellValue::from("Sum of Sales"),
        field_id: FieldId::from("__values__"),
        depth: 0,
        span: 1,
        is_expandable: false,
        is_expanded: true,
        is_subtotal: false,
        is_grand_total: false,
        parent_key: None,
        child_keys: None,
    };
    let row_header = PivotHeader {
        key: "North".to_string(),
        value: CellValue::from("North"),
        field_id: FieldId::from("Region"),
        depth: 0,
        span: 1,
        is_expandable: false,
        is_expanded: true,
        is_subtotal: false,
        is_grand_total: false,
        parent_key: None,
        child_keys: None,
    };
    let result = PivotTableResult {
        column_headers: vec![PivotColumnHeader {
            field_id: FieldId::from("__values__"),
            headers: vec![value_header],
        }],
        rows: vec![PivotRow {
            key: "North".to_string(),
            headers: vec![row_header],
            values: vec![CellValue::number(250.0)],
            depth: 0,
            is_subtotal: false,
            is_grand_total: false,
            source_row_indices: None,
        }],
        grand_totals: PivotGrandTotals {
            row: None,
            column: None,
            grand: None,
            row_label: None,
        },
        source_row_count: 1,
        rendered_bounds: PivotRenderedBounds {
            total_rows: 2,
            total_cols: 2,
            first_data_row: 1,
            first_data_col: 1,
            num_data_cols: 1,
        },
        measure_descriptors: Vec::new(),
        value_records: Vec::new(),
        errors: None,
    };

    mirror.materialize_pivot_with_identities(
        &sheet_id,
        0,
        4,
        &result,
        &["Region".to_string()],
        &id_alloc,
    );

    let value_pos = SheetPos::new(1, 5);
    assert!(mirror.resolve_cell_id(&sheet_id, value_pos).is_some());
    assert_eq!(
        mirror.get_cell_value_at(&sheet_id, value_pos),
        Some(&CellValue::number(250.0))
    );
}
