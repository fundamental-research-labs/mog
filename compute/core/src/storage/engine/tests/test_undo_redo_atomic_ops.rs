//! Atomic undo behavior for multi-cell operations.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellData, SheetSnapshot};
use value_types::CellValue;

#[test]
fn bulk_set_cells_by_position_undoes_atomically() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .batch_set_cells_by_position(
            vec![
                (
                    sid,
                    0,
                    0,
                    crate::storage::engine::mutation::CellInput::Parse { text: "100".into() },
                ),
                (
                    sid,
                    0,
                    1,
                    crate::storage::engine::mutation::CellInput::Parse { text: "200".into() },
                ),
                (
                    sid,
                    0,
                    2,
                    crate::storage::engine::mutation::CellInput::Parse { text: "300".into() },
                ),
            ],
            true,
        )
        .unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(100.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 1), num(200.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 2), num(300.0));

    engine.undo().unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(10.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 1), num(20.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 2), CellValue::Null);
    assert!(
        !engine.can_undo(),
        "bulk set-by-position must be one undo stack item, not one item per cell"
    );
}

#[test]
fn text_to_columns_undoes_atomically_and_reports_stats() {
    let sid = sheet_id();
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440011".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Text("John,Doe".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440012".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Text("Jane,Smith".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440013".to_string(),
                    row: 2,
                    col: 0,
                    value: CellValue::Text("Bob,Jones".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
            ],
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
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let result = engine
        .text_to_columns(
            &sid,
            0,
            2,
            0,
            0,
            0,
            serde_json::json!({
                "splitType": "delimited",
                "delimiters": {
                    "tab": false,
                    "comma": true,
                    "semicolon": false,
                    "space": false,
                },
                "treatConsecutiveAsOne": false,
                "textQualifier": "none",
            }),
        )
        .unwrap()
        .1;

    assert_eq!(
        result.data,
        Some(serde_json::json!({ "rowsProcessed": 3, "columnsCreated": 2 }))
    );
    assert_eq!(engine.get_undo_state().undo_depth, 1);
    assert_eq!(
        cell_value_at(&engine, &sid, 0, 0),
        CellValue::Text("John".into())
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 0, 1),
        CellValue::Text("Doe".into())
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 1, 0),
        CellValue::Text("Jane".into())
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 1, 1),
        CellValue::Text("Smith".into())
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 2, 0),
        CellValue::Text("Bob".into())
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 2, 1),
        CellValue::Text("Jones".into())
    );

    engine.undo().unwrap();

    assert_eq!(
        cell_value_at(&engine, &sid, 0, 0),
        CellValue::Text("John,Doe".into())
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 1, 0),
        CellValue::Text("Jane,Smith".into())
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 2, 0),
        CellValue::Text("Bob,Jones".into())
    );
    assert_eq!(cell_value_at(&engine, &sid, 0, 1), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 1, 1), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 2, 1), CellValue::Null);
    assert!(
        !engine.can_undo(),
        "text-to-columns must be one undo stack item, not one item per written cell"
    );
}

#[test]
fn autofill_undoes_atomically() {
    let sid = sheet_id();
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440021".to_string(),
                    row: 0,
                    col: 0,
                    value: num(1.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440022".to_string(),
                    row: 1,
                    col: 0,
                    value: num(2.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
            ],
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
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let request = crate::engine_types::fill::BridgeAutoFillRequest {
        source_range: crate::engine_types::fill::BridgeFillRangeSpec {
            start_row: 0,
            start_col: 0,
            end_row: 1,
            end_col: 0,
        },
        target_range: crate::engine_types::fill::BridgeFillRangeSpec {
            start_row: 2,
            start_col: 0,
            end_row: 4,
            end_col: 0,
        },
        direction: "down".to_string(),
        mode: "series".to_string(),
        include_formulas: true,
        include_values: true,
        include_formats: false,
        step_value: 1.0,
    };

    engine.auto_fill(&sid, request).unwrap();

    for row in 0..5 {
        assert_eq!(cell_value_at(&engine, &sid, row, 0), num((row + 1) as f64));
    }

    engine.undo().unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(1.0));
    assert_eq!(cell_value_at(&engine, &sid, 1, 0), num(2.0));
    for row in 2..5 {
        assert_eq!(cell_value_at(&engine, &sid, row, 0), CellValue::Null);
    }
    assert!(
        !engine.can_undo(),
        "autofill must be one undo stack item, not one item per filled cell"
    );
}
