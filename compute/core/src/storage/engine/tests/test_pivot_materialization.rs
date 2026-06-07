use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellData, SheetSnapshot};
use serde_json::json;
use value_types::{CellValue, FiniteF64};

fn stored_number_format_at(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    let cell_id = engine
        .mirror()
        .resolve_cell_id(sheet_id, SheetPos::new(row, col))
        .expect("cell allocated");
    engine
        .get_cell_format(sheet_id, &cell_id, row, col)
        .number_format
}

fn pivot_history_snapshot(sid: SheetId) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440201".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Text("Region".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440202".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::Text("Sales".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440203".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Text("North".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440204".to_string(),
                    row: 1,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(100.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440205".to_string(),
                    row: 2,
                    col: 0,
                    value: CellValue::Text("South".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440206".to_string(),
                    row: 2,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(300.0)),
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
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

#[test]
fn percent_show_values_as_materializes_percent_display_format() {
    let sid = sheet_id();
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440101".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Text("Region".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440102".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::Text("Revenue".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440103".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Text("North".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440104".to_string(),
                    row: 1,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(250.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440105".to_string(),
                    row: 2,
                    col: 0,
                    value: CellValue::Text("South".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440106".to_string(),
                    row: 2,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(500.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440107".to_string(),
                    row: 3,
                    col: 0,
                    value: CellValue::Text("East".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440108".to_string(),
                    row: 3,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(250.0)),
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
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    engine
        .pivot_create(json!({
            "id": "percent-pivot",
            "name": "PercentPivot",
            "sourceSheetId": sid.to_uuid_string(),
            "sourceSheetName": "Sheet1",
            "sourceRange": { "startRow": 0, "startCol": 0, "endRow": 3, "endCol": 1 },
            "outputSheetName": "Sheet1",
            "outputLocation": { "row": 0, "col": 4 },
            "fields": [
                { "id": "Region", "name": "Region", "sourceColumn": 0, "dataType": "string" },
                { "id": "Revenue", "name": "Revenue", "sourceColumn": 1, "dataType": "number" }
            ],
            "placements": [
                { "fieldId": "Region", "area": "row", "position": 0 },
                {
                    "fieldId": "Revenue",
                    "area": "value",
                    "position": 0,
                    "aggregateFunction": "sum",
                    "showValuesAs": { "type": "percentOfGrandTotal" }
                }
            ],
            "filters": []
        }))
        .expect("create percent pivot");
    engine.recalculate().expect("materialize pivot");

    assert_eq!(cell_value_at(&engine, &sid, 1, 5), num(0.25));
    assert_eq!(engine.format_cell_display(&sid, 1, 5), "25%");
    assert_eq!(engine.format_cell_display(&sid, 2, 5), "25%");
    assert_eq!(engine.format_cell_display(&sid, 3, 5), "50%");
    assert_eq!(engine.format_cell_display(&sid, 4, 5), "100%");
}

#[test]
fn pivot_value_format_materialization_does_not_clear_redo_stack() {
    let sid = sheet_id();
    let snap = pivot_history_snapshot(sid);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sales_cell = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440204").unwrap();

    engine
        .pivot_create(json!({
            "id": "redo-pivot",
            "name": "RedoPivot",
            "sourceSheetId": sid.to_uuid_string(),
            "sourceSheetName": "Sheet1",
            "sourceRange": { "startRow": 0, "startCol": 0, "endRow": 2, "endCol": 1 },
            "outputSheetName": "Sheet1",
            "outputLocation": { "row": 0, "col": 4 },
            "fields": [
                { "id": "Region", "name": "Region", "sourceColumn": 0, "dataType": "string" },
                { "id": "Sales", "name": "Sales", "sourceColumn": 1, "dataType": "number" }
            ],
            "placements": [
                { "fieldId": "Region", "area": "row", "position": 0 },
                {
                    "fieldId": "Sales",
                    "area": "value",
                    "position": 0,
                    "aggregateFunction": "sum"
                }
            ],
            "filters": []
        }))
        .expect("create pivot");
    let pivot_id = engine
        .pivot_get_all(&sid)
        .into_iter()
        .find(|config| config.name == "RedoPivot")
        .expect("created pivot")
        .id;
    engine.recalculate().expect("initial pivot materialization");
    assert_eq!(
        stored_number_format_at(&engine, &sid, 1, 5),
        None,
        "ordinary pivot values should not materialize an explicit General format"
    );
    engine.flush_undo_capture().expect("seal pivot setup");
    engine.mutation.undo_manager.clear();
    engine.flush_undo_capture().expect("reset cleared history");

    engine
        .set_cell(
            &sid,
            sales_cell,
            1,
            1,
            crate::bridge_types::CellInput::Parse { text: "150".into() },
        )
        .expect("edit pivot source");
    engine.flush_undo_capture().expect("separate source edit");

    engine.undo().expect("undo source edit");
    assert_eq!(cell_value_at(&engine, &sid, 1, 1), num(100.0));
    assert!(
        engine.can_redo(),
        "source edit should be redoable after undo"
    );

    engine
        .pivot_materialize(&sid, &pivot_id, None)
        .expect("materialize pivot after undo");

    assert!(
        engine.can_redo(),
        "automatic pivot materialization must not clear redo"
    );
    engine.redo().expect("redo source edit");
    assert_eq!(cell_value_at(&engine, &sid, 1, 1), num(150.0));
}

#[test]
fn pivot_percent_format_materialization_does_not_clear_redo_stack() {
    let sid = sheet_id();
    let snap = pivot_history_snapshot(sid);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sales_cell = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440204").unwrap();

    engine
        .pivot_create(json!({
            "id": "redo-percent-pivot",
            "name": "RedoPercentPivot",
            "sourceSheetId": sid.to_uuid_string(),
            "sourceSheetName": "Sheet1",
            "sourceRange": { "startRow": 0, "startCol": 0, "endRow": 2, "endCol": 1 },
            "outputSheetName": "Sheet1",
            "outputLocation": { "row": 0, "col": 4 },
            "fields": [
                { "id": "Region", "name": "Region", "sourceColumn": 0, "dataType": "string" },
                { "id": "Sales", "name": "Sales", "sourceColumn": 1, "dataType": "number" }
            ],
            "placements": [
                { "fieldId": "Region", "area": "row", "position": 0 },
                {
                    "fieldId": "Sales",
                    "area": "value",
                    "position": 0,
                    "aggregateFunction": "sum",
                    "showValuesAs": { "type": "percentOfGrandTotal" }
                }
            ],
            "filters": []
        }))
        .expect("create percent pivot");
    let pivot_id = engine
        .pivot_get_all(&sid)
        .into_iter()
        .find(|config| config.name == "RedoPercentPivot")
        .expect("created percent pivot")
        .id;
    engine
        .recalculate()
        .expect("initial percent pivot materialization");
    assert_eq!(
        stored_number_format_at(&engine, &sid, 1, 5).as_deref(),
        Some("0%")
    );
    engine
        .flush_undo_capture()
        .expect("seal percent pivot setup");
    engine.mutation.undo_manager.clear();
    engine
        .flush_undo_capture()
        .expect("reset cleared percent history");

    engine
        .set_cell(
            &sid,
            sales_cell,
            1,
            1,
            crate::bridge_types::CellInput::Parse { text: "150".into() },
        )
        .expect("edit pivot source");
    engine.flush_undo_capture().expect("separate source edit");

    engine.undo().expect("undo source edit");
    assert_eq!(cell_value_at(&engine, &sid, 1, 1), num(100.0));
    assert!(
        engine.can_redo(),
        "source edit should be redoable after undo"
    );

    engine
        .pivot_materialize(&sid, &pivot_id, None)
        .expect("materialize percent pivot after undo");

    assert!(
        engine.can_redo(),
        "derived pivot number-format materialization must not clear redo"
    );
    engine.redo().expect("redo source edit");
    assert_eq!(cell_value_at(&engine, &sid, 1, 1), num(150.0));
}
