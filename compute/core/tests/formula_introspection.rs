use cell_types::SheetId;
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue};

const SHEET_ID: &str = "10000000000000000000000000000000";

fn cell_id(row: u32, col: u32) -> String {
    format!("100000000000000000000000{:04x}{:04x}", row, col)
}

fn sid() -> SheetId {
    SheetId::from_uuid_str(SHEET_ID).unwrap()
}

fn snapshot(cells: Vec<CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_ID.to_string(),
            name: "Sheet1".to_string(),
            rows: 50,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn value_cell(row: u32, col: u32, value: CellValue) -> CellData {
    CellData {
        cell_id: cell_id(row, col),
        row,
        col,
        value,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn formula_cell(row: u32, col: u32, formula: &str) -> CellData {
    CellData {
        cell_id: cell_id(row, col),
        row,
        col,
        value: CellValue::Null,
        formula: Some(formula.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

fn cell_value(engine: &YrsComputeEngine, row: u32, col: u32) -> CellValue {
    engine
        .query_range(&sid(), row, col, row, col)
        .cells
        .first()
        .map(|c| c.value.clone())
        .unwrap_or(CellValue::Null)
}

#[test]
fn formulatext_returns_user_entered_formula_text() {
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot(vec![
        value_cell(0, 0, CellValue::number(1.0)),
        formula_cell(0, 1, "=A1+1"),
        formula_cell(0, 2, "=FORMULATEXT(B1)"),
    ]))
    .unwrap();

    assert_eq!(cell_value(&engine, 0, 2), CellValue::Text("=A1+1".into()));
}

#[test]
fn formulatext_errors_for_non_formula_blank_scalar_and_external() {
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot(vec![
        value_cell(0, 0, CellValue::number(1.0)),
        formula_cell(0, 1, "=FORMULATEXT(A1)"),
        formula_cell(0, 2, "=FORMULATEXT(Z1)"),
        formula_cell(0, 3, "=FORMULATEXT(42)"),
        formula_cell(0, 4, "=FORMULATEXT([1]Sheet1!A1)"),
    ]))
    .unwrap();

    assert_eq!(
        cell_value(&engine, 0, 1),
        CellValue::Error(CellError::Na, None)
    );
    assert_eq!(
        cell_value(&engine, 0, 2),
        CellValue::Error(CellError::Na, None)
    );
    assert_eq!(
        cell_value(&engine, 0, 3),
        CellValue::Error(CellError::Value, None)
    );
    assert_eq!(
        cell_value(&engine, 0, 4),
        CellValue::Error(CellError::Na, None)
    );
}

#[test]
fn formulatext_range_whole_row_and_column_use_upper_left() {
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot(vec![
        formula_cell(0, 0, "=1+1"),
        formula_cell(1, 0, "=2+2"),
        formula_cell(0, 1, "=3+3"),
        formula_cell(2, 0, "=FORMULATEXT(A1:B2)"),
        formula_cell(2, 1, "=FORMULATEXT(B2:A1)"),
        formula_cell(2, 2, "=FORMULATEXT(2:2)"),
        formula_cell(2, 3, "=FORMULATEXT(B:B)"),
    ]))
    .unwrap();

    assert_eq!(cell_value(&engine, 2, 0), CellValue::Text("=1+1".into()));
    assert_eq!(cell_value(&engine, 2, 1), CellValue::Text("=1+1".into()));
    assert_eq!(cell_value(&engine, 2, 2), CellValue::Text("=2+2".into()));
    assert_eq!(cell_value(&engine, 2, 3), CellValue::Text("=3+3".into()));
}

#[test]
fn formulatext_dirty_on_formula_text_change_without_value_change() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot(vec![
        formula_cell(0, 0, "=1+1"),
        formula_cell(0, 1, "=FORMULATEXT(A1)"),
    ]))
    .unwrap();

    assert_eq!(cell_value(&engine, 0, 1), CellValue::Text("=1+1".into()));

    engine.set_cell_value_parsed(&sid(), 0, 0, "=2+0").unwrap();

    assert_eq!(cell_value(&engine, 0, 1), CellValue::Text("=2+0".into()));
}

#[test]
fn formulatext_self_reference_returns_own_text() {
    let (engine, _) =
        YrsComputeEngine::from_snapshot(snapshot(vec![formula_cell(0, 0, "=FORMULATEXT(A1)")]))
            .unwrap();

    assert_eq!(
        cell_value(&engine, 0, 0),
        CellValue::Text("=FORMULATEXT(A1)".into())
    );
}

#[test]
fn formulatext_wrong_arity_returns_value_error() {
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot(vec![
        formula_cell(0, 0, "=FORMULATEXT()"),
        formula_cell(0, 1, "=FORMULATEXT(A1,A2)"),
    ]))
    .unwrap();

    assert_eq!(
        cell_value(&engine, 0, 0),
        CellValue::Error(CellError::Value, None)
    );
    assert_eq!(
        cell_value(&engine, 0, 1),
        CellValue::Error(CellError::Value, None)
    );
}

#[test]
fn formulatext_over_8192_chars_returns_na() {
    let long_formula = format!("={}", "1+".repeat(4097));
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot(vec![
        formula_cell(0, 0, &long_formula),
        formula_cell(0, 1, "=FORMULATEXT(A1)"),
    ]))
    .unwrap();

    assert_eq!(
        cell_value(&engine, 0, 1),
        CellValue::Error(CellError::Na, None)
    );
}
