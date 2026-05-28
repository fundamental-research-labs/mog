use cell_types::{
    CellId, ColId, PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId, SheetId, SheetPos,
};
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{CellData, RangeData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

pub(super) fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

pub(super) fn sheet_id(idx: u32) -> SheetId {
    SheetId::from_uuid_str(&sheet_uuid(idx)).expect("valid sheet uuid")
}

pub(super) fn cell_id(sheet_idx: u32, row: u32, col: u32) -> CellId {
    CellId::from_uuid_str(&cell_uuid(sheet_idx, row, col)).expect("valid cell uuid")
}

pub(super) fn value_cell(sheet_idx: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

pub(super) fn formula_cell(sheet_idx: u32, row: u32, col: u32, formula: &str) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value: CellValue::Null,
        formula: Some(formula.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

pub(super) fn sheet_snap(idx: u32, name: &str, cells: Vec<CellData>) -> SheetSnapshot {
    SheetSnapshot {
        id: sheet_uuid(idx),
        name: name.to_string(),
        rows: 100,
        cols: 26,
        cells,
        ranges: vec![],
    }
}

pub(super) fn cell_at(engine: &YrsComputeEngine, sid: &SheetId, row: u32, col: u32) -> CellValue {
    engine
        .mirror()
        .get_cell_value_at(sid, SheetPos::new(row, col))
        .cloned()
        .unwrap_or(CellValue::Null)
}

pub(super) fn as_f64(cv: &CellValue) -> f64 {
    match cv {
        CellValue::Number(n) => n.get(),
        _ => f64::NAN,
    }
}

pub(super) fn workbook_10_rows() -> WorkbookSnapshot {
    let mut cells = Vec::new();
    for r in 0..10u32 {
        cells.push(value_cell(0, r, 0, (r + 1) as f64));
    }
    cells.push(formula_cell(0, 0, 1, "SUM(A1:A10)"));
    WorkbookSnapshot {
        sheets: vec![sheet_snap(0, "Data", cells)],
        ..Default::default()
    }
}

pub(super) fn yrs_row_id(row_index: usize) -> RowId {
    RowId::from_raw((row_index + 1) as u128)
}

pub(super) fn yrs_col_id(sheet_rows: usize, col_index: usize) -> ColId {
    ColId::from_raw((sheet_rows + col_index + 1) as u128)
}

pub(super) fn range_uuid(idx: u32) -> String {
    format!("b0000000-0000-4000-8000-{:012x}", idx as u64)
}

pub(super) fn range_backed_workbook(
    sheet_rows: u32,
    sheet_cols: u32,
    range_rows: u32,
    range_cols: u32,
    value_fn: impl Fn(u32, u32) -> f64,
    formula_cells: Vec<CellData>,
) -> WorkbookSnapshot {
    let mut payload = Vec::with_capacity((range_rows * range_cols) as usize * 8);
    for r in 0..range_rows {
        for c in 0..range_cols {
            payload.extend_from_slice(&value_fn(r, c).to_le_bytes());
        }
    }

    let row_ids: Vec<RowId> = (0..range_rows as usize).map(yrs_row_id).collect();
    let col_ids: Vec<ColId> = (0..range_cols as usize)
        .map(|i| yrs_col_id(sheet_rows as usize, i))
        .collect();

    let range_data = RangeData {
        range_id: RangeId::from_uuid_str(&range_uuid(0)).unwrap(),
        kind: RangeKind::Data,
        anchor: RangeAnchor::Elastic {
            start_row: row_ids[0],
            end_row: *row_ids.last().unwrap(),
            start_col: col_ids[0],
            end_col: *col_ids.last().unwrap(),
        },
        encoding: PayloadEncoding::F64Le,
        payload,
        row_axis: None,
        col_axis: None,
        row_ids: row_ids.to_vec(),
        col_ids: col_ids.to_vec(),
    };

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(0),
            name: "Data".to_string(),
            rows: sheet_rows,
            cols: sheet_cols,
            cells: formula_cells,
            ranges: vec![range_data],
        }],
        ..Default::default()
    }
}

pub(super) fn assert_number_at(
    engine: &YrsComputeEngine,
    sid: &SheetId,
    row: u32,
    col: u32,
    expected: f64,
    scenario: &str,
) {
    let value = cell_at(engine, sid, row, col);
    assert_eq!(
        as_f64(&value),
        expected,
        "{scenario} at ({row}, {col}) should be {expected}, got {value:?}"
    );
}

pub(super) fn assert_null_at(
    engine: &YrsComputeEngine,
    sid: &SheetId,
    row: u32,
    col: u32,
    scenario: &str,
) {
    let value = cell_at(engine, sid, row, col);
    assert!(
        value.is_null(),
        "{scenario} at ({row}, {col}) should be Null, got {value:?}"
    );
}

pub(super) fn assert_column_values(
    engine: &YrsComputeEngine,
    sid: &SheetId,
    col: u32,
    values: &[(u32, f64)],
    scenario: &str,
) {
    for &(row, expected) in values {
        assert_number_at(engine, sid, row, col, expected, scenario);
    }
}

pub(super) fn assert_sum_at(
    engine: &YrsComputeEngine,
    sid: &SheetId,
    row: u32,
    col: u32,
    expected: f64,
    scenario: &str,
) {
    let value = cell_at(engine, sid, row, col);
    assert!(
        (as_f64(&value) - expected).abs() < 1e-9,
        "{scenario} at ({row}, {col}) should be {expected}, got {value:?}"
    );
}
