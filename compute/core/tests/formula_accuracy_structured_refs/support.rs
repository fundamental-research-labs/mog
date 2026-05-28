use cell_types::SheetId;
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use formula_types::TableDef;
use value_types::{CellError, CellValue};

pub fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

pub fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

pub fn sheet_id(idx: u32) -> SheetId {
    SheetId::from_uuid_str(&sheet_uuid(idx)).unwrap()
}

pub fn recalc_snapshot(snapshot: WorkbookSnapshot) -> compute_core::RecalcResult {
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed")
}

pub fn single_sheet_table_snapshot(
    sheet_name: &str,
    table_name: &str,
    col_names: &[&str],
    data_rows: Vec<Vec<CellValue>>,
    formula_cells: Vec<(u32, u32, &str)>,
) -> WorkbookSnapshot {
    let si = 0;
    let num_cols = col_names.len() as u32;
    let num_data_rows = data_rows.len() as u32;
    let total_rows = 1 + num_data_rows;
    let mut cells = table_cells(si, col_names, data_rows);

    for (data_row_offset, col_offset, formula) in formula_cells {
        let grid_row = data_row_offset + 1;
        if let Some(cell) = cells
            .iter_mut()
            .find(|c| c.row == grid_row && c.col == col_offset)
        {
            cell.formula = Some(formula.to_string());
            cell.value = CellValue::Null;
        }
    }

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(si),
            name: sheet_name.to_string(),
            rows: total_rows + 10,
            cols: num_cols + 5,
            cells,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![table_def(si, table_name, col_names, total_rows)],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

pub fn single_sheet_table_with_outside_formulas(
    sheet_name: &str,
    table_name: &str,
    col_names: &[&str],
    data_rows: Vec<Vec<CellValue>>,
    formula_cells: Vec<(u32, u32, &str)>,
) -> WorkbookSnapshot {
    let si = 0;
    let num_cols = col_names.len() as u32;
    let total_rows = 1 + data_rows.len() as u32;
    let mut cells = table_cells(si, col_names, data_rows);

    for (row, col, formula) in formula_cells {
        cells.push(CellData {
            cell_id: cell_uuid(si, row, col),
            row,
            col,
            value: CellValue::Null,
            formula: Some(formula.to_string()),
            identity_formula: None,
            array_ref: None,
        });
    }

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(si),
            name: sheet_name.to_string(),
            rows: 10,
            cols: num_cols + 3,
            cells,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![table_def(si, table_name, col_names, total_rows)],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

pub fn cross_sheet_table_summary_snapshot(
    data_sheet_name: &str,
    summary_sheet_name: &str,
    table_name: &str,
    col_names: &[&str],
    data_rows: Vec<Vec<CellValue>>,
    summary_formulas: Vec<(u32, u32, &str)>,
) -> WorkbookSnapshot {
    let si_data = 0;
    let si_formula = 1;
    let total_rows = 1 + data_rows.len() as u32;
    let data_cells = table_cells(si_data, col_names, data_rows);
    let formula_cells = summary_formulas
        .into_iter()
        .map(|(row, col, formula)| CellData {
            cell_id: cell_uuid(si_formula, row, col),
            row,
            col,
            value: CellValue::Null,
            formula: Some(formula.to_string()),
            identity_formula: None,
            array_ref: None,
        })
        .collect();

    WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: sheet_uuid(si_data),
                name: data_sheet_name.to_string(),
                rows: total_rows + 1,
                cols: col_names.len() as u32 + 1,
                cells: data_cells,
                ranges: vec![],
            },
            SheetSnapshot {
                id: sheet_uuid(si_formula),
                name: summary_sheet_name.to_string(),
                rows: 5,
                cols: 3,
                cells: formula_cells,
                ranges: vec![],
            },
        ],
        named_ranges: vec![],
        tables: vec![table_def(si_data, table_name, col_names, total_rows)],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

pub fn no_table_formula_snapshot(formulas: Vec<(u32, u32, &str)>) -> WorkbookSnapshot {
    let si = 0;
    let cells = formulas
        .into_iter()
        .map(|(row, col, formula)| CellData {
            cell_id: cell_uuid(si, row, col),
            row,
            col,
            value: CellValue::Null,
            formula: Some(formula.to_string()),
            identity_formula: None,
            array_ref: None,
        })
        .collect();

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(si),
            name: "Sheet1".to_string(),
            rows: 5,
            cols: 3,
            cells,
            ranges: vec![],
        }],
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

pub fn find_changed_value(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
) -> Option<CellValue> {
    let target_cell_id = cell_uuid(sheet_idx, row, col);
    result
        .changed_cells
        .iter()
        .find(|cc| cc.cell_id == target_cell_id)
        .map(|cc| cc.value.clone())
}

pub fn find_error(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
) -> Option<String> {
    let target_cell_id = cell_uuid(sheet_idx, row, col);
    result
        .errors
        .iter()
        .find(|e| e.cell_id == target_cell_id)
        .map(|e| e.error.clone())
}

pub fn format_recalc_diagnostics(result: &compute_core::RecalcResult) -> String {
    let mut out = format!("changed_cells: {}", result.changed_cells.len());
    for cc in &result.changed_cells {
        out.push_str(&format!("\n  cell_id={} value={:?}", cc.cell_id, cc.value));
    }
    if !result.errors.is_empty() {
        out.push_str(&format!("\nerrors: {}", result.errors.len()));
        for e in &result.errors {
            out.push_str(&format!("\n  cell_id={} error={}", e.cell_id, e.error));
        }
    }
    out
}

pub fn assert_cell_number(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    expected: f64,
) {
    assert_no_engine_error(result, sheet_idx, row, col);
    match changed_value_or_panic(result, sheet_idx, row, col) {
        CellValue::Number(n) => assert!(
            (n.get() - expected).abs() < 1e-10,
            "{} expected {}, got {}\n{}",
            address(sheet_idx, row, col),
            expected,
            n.get(),
            format_recalc_diagnostics(result)
        ),
        CellValue::Error(e, _) => panic!(
            "{} returned error {:?} instead of {}\n{}",
            address(sheet_idx, row, col),
            e,
            expected,
            format_recalc_diagnostics(result)
        ),
        other => panic!(
            "{} expected Number({}), got {:?}\n{}",
            address(sheet_idx, row, col),
            expected,
            other,
            format_recalc_diagnostics(result)
        ),
    }
}

pub fn assert_cell_number_allow_scalar_array(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    expected: f64,
) {
    assert_no_engine_error(result, sheet_idx, row, col);
    match changed_value_or_panic(result, sheet_idx, row, col) {
        CellValue::Number(n) => assert!(
            (n.get() - expected).abs() < 1e-10,
            "{} expected {}, got {}\n{}",
            address(sheet_idx, row, col),
            expected,
            n.get(),
            format_recalc_diagnostics(result)
        ),
        CellValue::Array(arr) if arr.rows() == 1 && arr.cols() == 1 => {
            match arr.get(0, 0).unwrap() {
                CellValue::Number(n) => assert!(
                    (n.get() - expected).abs() < 1e-10,
                    "{} expected {} inside 1x1 array, got {}\n{}",
                    address(sheet_idx, row, col),
                    expected,
                    n.get(),
                    format_recalc_diagnostics(result)
                ),
                other => panic!(
                    "{} expected Number({}) inside 1x1 array, got {:?}\n{}",
                    address(sheet_idx, row, col),
                    expected,
                    other,
                    format_recalc_diagnostics(result)
                ),
            }
        }
        other => panic!(
            "{} expected Number({}) or 1x1 array, got {:?}\n{}",
            address(sheet_idx, row, col),
            expected,
            other,
            format_recalc_diagnostics(result)
        ),
    }
}

pub fn assert_cell_boolean(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    expected: bool,
) {
    assert_no_engine_error(result, sheet_idx, row, col);
    match changed_value_or_panic(result, sheet_idx, row, col) {
        CellValue::Boolean(b) => assert_eq!(
            b,
            expected,
            "{} expected Boolean({}), got Boolean({})\n{}",
            address(sheet_idx, row, col),
            expected,
            b,
            format_recalc_diagnostics(result)
        ),
        other => panic!(
            "{} expected Boolean({}), got {:?}\n{}",
            address(sheet_idx, row, col),
            expected,
            other,
            format_recalc_diagnostics(result)
        ),
    }
}

pub fn assert_cell_error(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    expected: CellError,
) {
    match find_changed_value(result, sheet_idx, row, col) {
        Some(CellValue::Error(e, None)) => assert_eq!(
            e,
            expected,
            "{} expected {:?}\n{}",
            address(sheet_idx, row, col),
            expected,
            format_recalc_diagnostics(result)
        ),
        other => panic!(
            "{} expected Error({:?}), got {:?}\n{}",
            address(sheet_idx, row, col),
            expected,
            other,
            format_recalc_diagnostics(result)
        ),
    }
}

pub fn assert_no_engine_error(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
) {
    let err = find_error(result, sheet_idx, row, col);
    assert!(
        err.is_none(),
        "{} produced engine error: {:?}\n{}",
        address(sheet_idx, row, col),
        err,
        format_recalc_diagnostics(result)
    );
}

fn changed_value_or_panic(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
) -> CellValue {
    find_changed_value(result, sheet_idx, row, col).unwrap_or_else(|| {
        panic!(
            "{} missing from changed_cells\n{}",
            address(sheet_idx, row, col),
            format_recalc_diagnostics(result)
        )
    })
}

fn table_cells(si: u32, col_names: &[&str], data_rows: Vec<Vec<CellValue>>) -> Vec<CellData> {
    let mut cells = Vec::new();
    for (ci, col_name) in col_names.iter().enumerate() {
        cells.push(CellData {
            cell_id: cell_uuid(si, 0, ci as u32),
            row: 0,
            col: ci as u32,
            value: CellValue::Text((*col_name).to_string().into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    for (ri, row_data) in data_rows.iter().enumerate() {
        let grid_row = ri as u32 + 1;
        for (ci, val) in row_data.iter().enumerate() {
            cells.push(CellData {
                cell_id: cell_uuid(si, grid_row, ci as u32),
                row: grid_row,
                col: ci as u32,
                value: val.clone(),
                formula: None,
                identity_formula: None,
                array_ref: None,
            });
        }
    }
    cells
}

fn table_def(si: u32, table_name: &str, col_names: &[&str], total_rows: u32) -> TableDef {
    TableDef {
        name: table_name.to_string(),
        sheet: sheet_id(si),
        start_row: 0,
        start_col: 0,
        end_row: total_rows - 1,
        end_col: col_names.len() as u32 - 1,
        columns: col_names.iter().map(|s| s.to_string()).collect(),
        has_headers: true,
        has_totals: false,
    }
}

fn address(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("sheet {} row {} col {}", sheet_idx, row, col)
}
