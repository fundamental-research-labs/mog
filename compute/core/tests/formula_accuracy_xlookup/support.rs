use cell_types::SheetId;
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use formula_types::TableDef;
use value_types::CellValue;

pub fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

pub fn sheet_id(idx: u32) -> SheetId {
    SheetId::from_uuid_str(&sheet_uuid(idx)).unwrap()
}

pub fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

pub fn build_snapshot<F: Into<String>>(
    sheets: Vec<(&str, u32, u32, Vec<(u32, u32, CellValue, Option<F>)>)>,
    tables: Vec<TableDef>,
) -> WorkbookSnapshot {
    workbook_snapshot(sheets, tables)
}

pub fn workbook_snapshot<F: Into<String>>(
    sheets: Vec<(&str, u32, u32, Vec<(u32, u32, CellValue, Option<F>)>)>,
    tables: Vec<TableDef>,
) -> WorkbookSnapshot {
    let sheet_snapshots = sheets
        .into_iter()
        .enumerate()
        .map(|(si, (name, rows, cols, cells))| {
            let si = si as u32;
            let cell_data: Vec<CellData> = cells
                .into_iter()
                .map(|(row, col, value, formula)| CellData {
                    cell_id: cell_uuid(si, row, col),
                    row,
                    col,
                    value,
                    formula: formula.map(Into::into),
                    identity_formula: None,
                    array_ref: None,
                })
                .collect();
            SheetSnapshot {
                id: sheet_uuid(si),
                name: name.to_string(),
                rows,
                cols,
                cells: cell_data,
                ranges: vec![],
            }
        })
        .collect();

    WorkbookSnapshot {
        sheets: sheet_snapshots,
        named_ranges: vec![],
        tables,
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

pub fn single_sheet_lookup_snapshot<F: Into<String>>(
    formulas: Vec<(u32, u32, F)>,
) -> WorkbookSnapshot {
    let mut cells: Vec<(u32, u32, CellValue, Option<String>)> = vec![
        (0, 0, CellValue::number(10.0), None),
        (1, 0, CellValue::number(20.0), None),
        (2, 0, CellValue::number(30.0), None),
        (0, 1, CellValue::number(100.0), None),
        (1, 1, CellValue::number(200.0), None),
        (2, 1, CellValue::number(300.0), None),
    ];

    cells.extend(
        formulas
            .into_iter()
            .map(|(row, col, formula)| (row, col, CellValue::Null, Some(formula.into()))),
    );

    workbook_snapshot(vec![("Sheet1", 10, 10, cells)], vec![])
}

pub fn investments_table(sheet_idx: u32) -> TableDef {
    TableDef {
        name: "Investments9".to_string(),
        sheet: sheet_id(sheet_idx),
        start_row: 0,
        start_col: 0,
        end_row: 3,
        end_col: 2,
        columns: vec![
            "Account".to_string(),
            "Deal".to_string(),
            "Base%".to_string(),
        ],
        has_headers: true,
        has_totals: false,
    }
}

pub fn investments_cells() -> Vec<(u32, u32, CellValue, Option<String>)> {
    vec![
        (0, 0, CellValue::Text("Account".into()), None),
        (0, 1, CellValue::Text("Deal".into()), None),
        (0, 2, CellValue::Text("Base%".into()), None),
        (1, 0, CellValue::Text("AcctA".into()), None),
        (1, 1, CellValue::Text("Deal1".into()), None),
        (1, 2, CellValue::number(0.05), None),
        (2, 0, CellValue::Text("AcctB".into()), None),
        (2, 1, CellValue::Text("Deal2".into()), None),
        (2, 2, CellValue::number(0.08), None),
        (3, 0, CellValue::Text("AcctA".into()), None),
        (3, 1, CellValue::Text("Deal3".into()), None),
        (3, 2, CellValue::number(0.03), None),
    ]
}

pub fn query_plus_investments_snapshot(
    query_cells: Vec<(u32, u32, CellValue, Option<String>)>,
) -> WorkbookSnapshot {
    workbook_snapshot(
        vec![
            ("Query", 10, 10, query_cells),
            ("Investments", 10, 10, investments_cells()),
        ],
        vec![investments_table(1)],
    )
}

pub fn recalc_snapshot(snapshot: WorkbookSnapshot) -> compute_core::RecalcResult {
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed")
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
        .find(|err| err.cell_id == target_cell_id)
        .map(|err| err.error.clone())
}

pub fn format_recalc_diagnostics(result: &compute_core::RecalcResult) -> String {
    let mut diagnostics = format!("changed_cells: {}", result.changed_cells.len());
    for cc in &result.changed_cells {
        diagnostics.push_str(&format!("\n  cell_id={} value={:?}", cc.cell_id, cc.value));
    }
    if !result.errors.is_empty() {
        diagnostics.push_str("\nerrors:");
        for error in &result.errors {
            diagnostics.push_str(&format!(
                "\n  cell_id={} error={}",
                error.cell_id, error.error
            ));
        }
    }
    if !result.projection_changes.is_empty() {
        diagnostics.push_str(&format!(
            "\nprojection_changes: {}",
            result.projection_changes.len()
        ));
        for change in &result.projection_changes {
            diagnostics.push_str(&format!("\n  source_cell_id={}", change.source_cell_id));
            for cell in &change.projection_cells {
                diagnostics.push_str(&format!(
                    "\n    proj cell_id={} row={} col={} value={:?}",
                    cell.cell_id, cell.row, cell.col, cell.value
                ));
            }
        }
    }
    diagnostics
}

fn cell_context(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    context: &str,
) -> String {
    format!(
        "{} at sheet {} row {} col {}{}; actual={:?}; error={:?}\n{}",
        context,
        sheet_idx,
        row,
        col,
        a1_suffix(row, col),
        find_changed_value(result, sheet_idx, row, col),
        find_error(result, sheet_idx, row, col),
        format_recalc_diagnostics(result)
    )
}

fn a1_suffix(row: u32, col: u32) -> String {
    format!(" ({})", a1_address(row, col))
}

fn a1_address(row: u32, col: u32) -> String {
    let mut n = col + 1;
    let mut letters = String::new();
    while n > 0 {
        let rem = (n - 1) % 26;
        letters.insert(0, (b'A' + rem as u8) as char);
        n = (n - 1) / 26;
    }
    format!("{}{}", letters, row + 1)
}

pub fn assert_number(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    expected: f64,
    context: &str,
) {
    match find_changed_value(result, sheet_idx, row, col) {
        Some(CellValue::Number(n)) => assert!(
            (n.get() - expected).abs() < 1e-10,
            "{} expected {}, got {}",
            cell_context(result, sheet_idx, row, col, context),
            expected,
            n.get()
        ),
        other => panic!(
            "{} expected Number({}), got {:?}",
            cell_context(result, sheet_idx, row, col, context),
            expected,
            other
        ),
    }
}

pub fn assert_text(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    expected: &str,
    context: &str,
) {
    match find_changed_value(result, sheet_idx, row, col) {
        Some(CellValue::Text(text)) => assert_eq!(
            text.as_ref(),
            expected,
            "{} expected text {}",
            cell_context(result, sheet_idx, row, col, context),
            expected
        ),
        other => panic!(
            "{} expected Text({}), got {:?}",
            cell_context(result, sheet_idx, row, col, context),
            expected,
            other
        ),
    }
}

pub fn assert_error_debug(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    expected_debug: &str,
    context: &str,
) {
    match find_changed_value(result, sheet_idx, row, col) {
        Some(CellValue::Error(error, _)) => assert_eq!(
            format!("{:?}", error),
            expected_debug,
            "{} expected error {}",
            cell_context(result, sheet_idx, row, col, context),
            expected_debug
        ),
        other => panic!(
            "{} expected Error({}), got {:?}",
            cell_context(result, sheet_idx, row, col, context),
            expected_debug,
            other
        ),
    }
}

pub fn assert_array_or_first_text(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    expected: &[&str],
    context: &str,
) {
    match find_changed_value(result, sheet_idx, row, col) {
        Some(CellValue::Array(array)) => {
            assert!(
                array.rows() >= expected.len(),
                "{} expected at least {} array rows, got {}",
                cell_context(result, sheet_idx, row, col, context),
                expected.len(),
                array.rows()
            );
            for (row_idx, expected_text) in expected.iter().enumerate() {
                match array.get(row_idx, 0).unwrap() {
                    CellValue::Text(text) => assert_eq!(
                        text.as_ref(),
                        *expected_text,
                        "{} array row {} mismatch",
                        cell_context(result, sheet_idx, row, col, context),
                        row_idx
                    ),
                    other => panic!(
                        "{} expected Text({}) at array row {}, got {:?}",
                        cell_context(result, sheet_idx, row, col, context),
                        expected_text,
                        row_idx,
                        other
                    ),
                }
            }
        }
        Some(CellValue::Text(text)) => assert_eq!(
            text.as_ref(),
            expected[0],
            "{} implicit-intersection scalar mismatch",
            cell_context(result, sheet_idx, row, col, context)
        ),
        Some(CellValue::Error(error, _)) => panic!(
            "{} array concatenation returned error {:?}",
            cell_context(result, sheet_idx, row, col, context),
            error
        ),
        other => panic!(
            "{} expected array or first text value, got {:?}",
            cell_context(result, sheet_idx, row, col, context),
            other
        ),
    }
}

pub fn assert_array_or_first_number(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    expected: f64,
    context: &str,
) {
    match find_changed_value(result, sheet_idx, row, col) {
        Some(CellValue::Number(number)) => assert!(
            (number.get() - expected).abs() < 1e-10,
            "{} expected {}, got {}",
            cell_context(result, sheet_idx, row, col, context),
            expected,
            number.get()
        ),
        Some(CellValue::Array(array)) => match array.get(0, 0).unwrap() {
            CellValue::Number(number) => assert!(
                (number.get() - expected).abs() < 1e-10,
                "{} expected first array value {}, got {}",
                cell_context(result, sheet_idx, row, col, context),
                expected,
                number.get()
            ),
            other => panic!(
                "{} expected first array value Number({}), got {:?}",
                cell_context(result, sheet_idx, row, col, context),
                expected,
                other
            ),
        },
        other => panic!(
            "{} expected Number({}) or Array, got {:?}",
            cell_context(result, sheet_idx, row, col, context),
            expected,
            other
        ),
    }
}

pub fn assert_null_or_zero_or_non_error(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    context: &str,
) {
    match find_changed_value(result, sheet_idx, row, col) {
        Some(CellValue::Error(error, _)) => panic!(
            "{} expected graceful non-error result, got {:?}",
            cell_context(result, sheet_idx, row, col, context),
            error
        ),
        Some(CellValue::Number(number)) => assert!(
            (number.get() - 0.0).abs() < 1e-10,
            "{} expected zero or another non-error out-of-bounds value, got {}",
            cell_context(result, sheet_idx, row, col, context),
            number.get()
        ),
        Some(CellValue::Null) | Some(_) => {}
        None => panic!(
            "{} expected cell in changed_cells",
            cell_context(result, sheet_idx, row, col, context)
        ),
    }
}
