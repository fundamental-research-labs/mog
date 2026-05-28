use compute_core::snapshot::{CellData, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

pub(crate) fn sheet_uuid() -> String {
    "a0000000000000000000000000000001".to_string()
}

pub(crate) fn cell_uuid(row: u32, col: u32) -> String {
    format!("c0000000{:04x}{:04x}0000000000000000", row, col)
}

pub(crate) fn build_snapshot(
    rows: u32,
    cols: u32,
    cells: Vec<(u32, u32, CellValue, Option<&str>)>,
) -> WorkbookSnapshot {
    let cell_data: Vec<CellData> = cells
        .into_iter()
        .map(|(row, col, value, formula)| CellData {
            cell_id: cell_uuid(row, col),
            row,
            col,
            value,
            formula: formula.map(|s| s.to_string()),
            identity_formula: None,
            array_ref: None,
        })
        .collect();

    WorkbookSnapshot {
        sheets: vec![compute_core::snapshot::SheetSnapshot {
            id: sheet_uuid(),
            name: "Sheet1".to_string(),
            rows,
            cols,
            cells: cell_data,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

/// Builds a workbook with numeric data in A1:A5 and B1:B5, plus formulas:
/// C1 = SUM(A1:A5) and D1 = VLOOKUP(3,A1:B5,2,FALSE).
pub(crate) fn fixture_with_formulas() -> WorkbookSnapshot {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();
    for i in 0..5u32 {
        cells.push((
            i,
            0,
            CellValue::Number(FiniteF64::must((i + 1) as f64)),
            None,
        ));
        cells.push((
            i,
            1,
            CellValue::Number(FiniteF64::must(((i + 1) * 10) as f64)),
            None,
        ));
    }
    cells.push((0, 2, CellValue::Null, Some("SUM(A1:A5)")));
    cells.push((0, 3, CellValue::Null, Some("VLOOKUP(3,A1:B5,2,FALSE)")));
    build_snapshot(100, 10, cells)
}

/// Builds a workbook identical to `fixture_with_formulas`, with E1 =
/// SUM(B1:B5) for per-column validation.
pub(crate) fn fixture_with_column_formulas() -> WorkbookSnapshot {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();
    for i in 0..5u32 {
        cells.push((
            i,
            0,
            CellValue::Number(FiniteF64::must((i + 1) as f64)),
            None,
        ));
        cells.push((
            i,
            1,
            CellValue::Number(FiniteF64::must(((i + 1) * 10) as f64)),
            None,
        ));
    }
    cells.push((0, 2, CellValue::Null, Some("SUM(A1:A5)")));
    cells.push((0, 3, CellValue::Null, Some("VLOOKUP(3,A1:B5,2,FALSE)")));
    cells.push((0, 4, CellValue::Null, Some("SUM(B1:B5)")));
    build_snapshot(100, 10, cells)
}
