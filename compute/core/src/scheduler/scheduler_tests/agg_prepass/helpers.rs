use super::super::*;

const TOLERANCE: f64 = 1e-10;

pub(super) fn cell_id(counter: u128) -> String {
    format!("00000000-0000-0000-0000-{counter:012x}")
}

pub(super) fn text_cell(counter: &mut u128, row: u32, col: u32, value: &str) -> CellData {
    *counter += 1;
    CellData {
        cell_id: cell_id(*counter),
        row,
        col,
        value: CellValue::Text(value.into()),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

pub(super) fn number_cell(counter: &mut u128, row: u32, col: u32, value: f64) -> CellData {
    *counter += 1;
    CellData {
        cell_id: cell_id(*counter),
        row,
        col,
        value: CellValue::number(value),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

pub(super) fn formula_cell(counter: &mut u128, row: u32, col: u32, formula: String) -> CellData {
    *counter += 1;
    CellData {
        cell_id: cell_id(*counter),
        row,
        col,
        value: CellValue::number(0.0),
        formula: Some(formula),
        identity_formula: None,
        array_ref: None,
    }
}

pub(super) fn workbook_snapshot(sheets: Vec<SheetSnapshot>) -> WorkbookSnapshot {
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

pub(super) fn single_sheet_snapshot(
    name: &str,
    rows: u32,
    cols: u32,
    cells: Vec<CellData>,
) -> WorkbookSnapshot {
    workbook_snapshot(vec![SheetSnapshot {
        id: cell_id(1),
        name: name.to_string(),
        rows,
        cols,
        cells,
        ranges: vec![],
    }])
}

pub(super) fn init_core(snapshot: WorkbookSnapshot) -> (ComputeCore, CellMirror) {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    (core, mirror)
}

pub(super) fn value_at(
    core: &ComputeCore,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> CellValue {
    let cell_id = mirror
        .resolve_cell_id(sheet_id, cell_types::SheetPos::new(row, col))
        .unwrap_or_else(|| panic!("No cell at sheet {sheet_id:?}, row {row}, col {col}"));
    core.get_cell_value(mirror, &cell_id)
        .cloned()
        .unwrap_or(CellValue::Null)
}

pub(super) fn assert_number_at(
    core: &ComputeCore,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    expected: f64,
    label: &str,
) {
    match value_at(core, mirror, sheet_id, row, col) {
        CellValue::Number(actual) => assert!(
            (actual.get() - expected).abs() < TOLERANCE,
            "{label} row {row}: expected {expected}, got {}",
            actual.get()
        ),
        other => panic!("{label} row {row}: expected number, got {other:?}"),
    }
}

pub(super) fn assert_error_at(
    core: &ComputeCore,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    expected: CellError,
    label: &str,
) {
    let actual = value_at(core, mirror, sheet_id, row, col);
    assert_eq!(
        actual,
        CellValue::Error(expected, None),
        "{label} row {row}: expected error {expected:?}, got {actual:?}"
    );
}
