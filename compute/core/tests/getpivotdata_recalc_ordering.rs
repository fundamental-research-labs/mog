//! Behavioral regression tests for GETPIVOTDATA / pivot-materialization ordering.
//!
//! `YrsComputeEngine::recalculate*()` must materialize stored pivot output before
//! full formula recalculation. GETPIVOTDATA reads the rendered pivot region
//! through the cell mirror, so stale or absent pivot output would make the
//! formula evaluate to the wrong value.

use cell_types::{SheetId, SheetPos};
use compute_core::storage::engine::YrsComputeEngine;
use serde_json::json;
use snapshot_types::{CellData, RecalcOptions, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

const DATA_SHEET_ID: &str = "550e8400-e29b-41d4-a716-446655440000";
const PIVOT_SHEET_ID: &str = "550e8400-e29b-41d4-a716-446655440100";

fn cell_uuid(sheet_digit: u8, row: u32, col: u32) -> String {
    format!("c0000000{sheet_digit:04x}{row:04x}{col:04x}000000000000")
}

fn text_cell(sheet_digit: u8, row: u32, col: u32, text: &str) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_digit, row, col),
        row,
        col,
        value: CellValue::Text(text.into()),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn number_cell(sheet_digit: u8, row: u32, col: u32, value: f64) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_digit, row, col),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(value)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn formula_cell(sheet_digit: u8, row: u32, col: u32, formula: &str) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_digit, row, col),
        row,
        col,
        value: CellValue::Null,
        formula: Some(formula.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

fn workbook_with_getpivotdata_formula() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: DATA_SHEET_ID.to_string(),
                name: "Data".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![
                    text_cell(0, 0, 0, "Category"),
                    text_cell(0, 0, 1, "Amount"),
                    text_cell(0, 1, 0, "A"),
                    number_cell(0, 1, 1, 10.0),
                    text_cell(0, 2, 0, "A"),
                    number_cell(0, 2, 1, 20.0),
                    text_cell(0, 3, 0, "B"),
                    number_cell(0, 3, 1, 7.0),
                ],
                ranges: vec![],
            },
            SheetSnapshot {
                id: PIVOT_SHEET_ID.to_string(),
                name: "Pivot".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![formula_cell(
                    1,
                    0,
                    6,
                    r#"=GETPIVOTDATA("Sum of Amount",$A$1,"Category","A")"#,
                )],
                ranges: vec![],
            },
        ],
        ..Default::default()
    }
}

fn create_pivot(engine: &mut YrsComputeEngine) {
    let config = json!({
        "id": "pivot-getpivotdata-ordering",
        "name": "PivotForGetPivotData",
        "sourceSheetId": DATA_SHEET_ID,
        "sourceSheetName": "Data",
        "sourceRange": { "startRow": 0, "startCol": 0, "endRow": 3, "endCol": 1 },
        "outputSheetName": "Pivot",
        "outputLocation": { "row": 0, "col": 0 },
        "fields": [
            { "id": "Category", "name": "Category", "sourceColumn": 0, "dataType": "string" },
            { "id": "Amount", "name": "Amount", "sourceColumn": 1, "dataType": "number" }
        ],
        "placements": [
            { "fieldId": "Category", "area": "row", "position": 0 },
            { "fieldId": "Amount", "area": "value", "position": 0, "aggregateFunction": "sum" }
        ],
        "filters": []
    });

    engine.pivot_create(config).expect("pivot_create");
}

fn pivot_sheet_id() -> SheetId {
    SheetId::from_uuid_str(PIVOT_SHEET_ID).unwrap()
}

fn getpivotdata_value(engine: &YrsComputeEngine) -> f64 {
    match engine
        .mirror()
        .get_cell_value_at(&pivot_sheet_id(), SheetPos::new(0, 6))
    {
        Some(CellValue::Number(n)) => n.get(),
        other => {
            let pivot_cells: Vec<_> = (0..6)
                .map(|row| {
                    (0..3)
                        .map(|col| {
                            engine
                                .mirror()
                                .get_cell_value_at(&pivot_sheet_id(), SheetPos::new(row, col))
                                .cloned()
                        })
                        .collect::<Vec<_>>()
                })
                .collect();
            panic!(
                "expected GETPIVOTDATA formula to evaluate to 30, got {other:?}; pivot cells: {pivot_cells:?}; pivot defs: {:?}",
                engine.mirror().all_pivot_tables()
            );
        }
    }
}

#[test]
fn recalculate_materializes_pivots_before_full_recalc() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_with_getpivotdata_formula()).unwrap();
    create_pivot(&mut engine);

    engine.recalculate().expect("recalculate");

    assert_eq!(getpivotdata_value(&engine), 30.0);
}

#[test]
fn recalculate_with_options_materializes_pivots_before_full_recalc() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_with_getpivotdata_formula()).unwrap();
    create_pivot(&mut engine);

    engine
        .recalculate_with_options(&RecalcOptions::default())
        .expect("recalculate_with_options");

    assert_eq!(getpivotdata_value(&engine), 30.0);
}
