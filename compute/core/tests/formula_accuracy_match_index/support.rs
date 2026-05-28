use cell_types::SheetPos;
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue};

pub const SHEET1_UUID: &str = "10000000000000000000000000000001";
pub const SHEET2_UUID: &str = "10000000000000000000000000000002";

pub fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!(
        "{:08x}0000{:04x}0000{:012x}",
        0x20000000 + sheet_idx,
        col,
        row as u64
    )
}

pub fn val_cell(sheet_idx: u32, row: u32, col: u32, value: CellValue) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

pub fn formula_cell(sheet_idx: u32, row: u32, col: u32, formula: &str) -> CellData {
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

pub fn sheet_snapshot(
    id: &str,
    name: &str,
    rows: u32,
    cols: u32,
    cells: Vec<CellData>,
) -> SheetSnapshot {
    SheetSnapshot {
        id: id.to_string(),
        name: name.to_string(),
        rows,
        cols,
        cells,
        ranges: vec![],
    }
}

pub fn workbook_snapshot(sheets: Vec<SheetSnapshot>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets,
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

pub fn init_core(
    snapshot: WorkbookSnapshot,
) -> (CellMirror, ComputeCore, compute_core::RecalcResult) {
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init_from_snapshot failed");
    (mirror, core, result)
}

pub fn mirror_value(mirror: &CellMirror, sheet_uuid: &str, row: u32, col: u32) -> CellValue {
    let sheet_id = compute_core::SheetId::from_uuid_str(sheet_uuid).unwrap();
    mirror
        .get_cell_value_at(&sheet_id, SheetPos::new(row, col))
        .cloned()
        .unwrap_or(CellValue::Null)
}

pub fn format_recalc_diagnostics(result: &compute_core::RecalcResult) -> String {
    format!("{:?}", result.errors)
}

pub fn assert_no_recalc_errors(result: &compute_core::RecalcResult, context: &str) {
    assert!(
        result.errors.is_empty(),
        "{}: expected no recalc errors, got {}",
        context,
        format_recalc_diagnostics(result)
    );
}

pub fn assert_number_value(
    mirror: &CellMirror,
    result: &compute_core::RecalcResult,
    sheet_uuid: &str,
    row: u32,
    col: u32,
    expected: f64,
    context: &str,
) {
    assert_cell_value(
        mirror,
        result,
        sheet_uuid,
        row,
        col,
        CellValue::number(expected),
        context,
    );
}

pub fn assert_text_value(
    mirror: &CellMirror,
    result: &compute_core::RecalcResult,
    sheet_uuid: &str,
    row: u32,
    col: u32,
    expected: &str,
    context: &str,
) {
    assert_cell_value(
        mirror,
        result,
        sheet_uuid,
        row,
        col,
        CellValue::Text(expected.into()),
        context,
    );
}

pub fn assert_error_value(
    mirror: &CellMirror,
    result: &compute_core::RecalcResult,
    sheet_uuid: &str,
    row: u32,
    col: u32,
    expected: CellError,
    context: &str,
) {
    assert_cell_value(
        mirror,
        result,
        sheet_uuid,
        row,
        col,
        CellValue::Error(expected, None),
        context,
    );
}

fn assert_cell_value(
    mirror: &CellMirror,
    result: &compute_core::RecalcResult,
    sheet_uuid: &str,
    row: u32,
    col: u32,
    expected: CellValue,
    context: &str,
) {
    let actual = mirror_value(mirror, sheet_uuid, row, col);
    assert_eq!(
        actual,
        expected,
        "{} at sheet {} row {} col {}: expected {:?}, actual {:?}; recalc errors: {}",
        context,
        sheet_uuid,
        row,
        col,
        expected,
        actual,
        format_recalc_diagnostics(result)
    );
}
