use compute_core::data_table::CreateDataTableInput;
use compute_core::storage::engine::YrsComputeEngine;
use serde_json::Value;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

const SHEET_UUID: &str = "000000000000000000000000000000aa";
const TABLE_START_ROW: u32 = 65; // C66:L75
const TABLE_START_COL: u32 = 2;
const TABLE_END_ROW: u32 = 74;
const TABLE_END_COL: u32 = 11;
const BODY_START_ROW: u32 = 66; // D67:L75
const BODY_START_COL: u32 = 3;

fn cell_uuid(suffix: u32) -> String {
    format!("{:020x}{:012x}", 0u128, suffix)
}

fn number_cell(id_suffix: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: cell_uuid(id_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn formula_cell(id_suffix: u32, row: u32, col: u32, formula: &str) -> CellData {
    CellData {
        cell_id: cell_uuid(id_suffix),
        row,
        col,
        value: CellValue::Null,
        formula: Some(formula.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

fn workbook(cells: Vec<CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 20,
            cells,
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

fn repro_workbook() -> WorkbookSnapshot {
    let mut cells = vec![
        number_cell(1, 8, 4, 10.0), // E9 col input cell
        number_cell(2, 20, 9, 1.0), // J21 row input cell
        formula_cell(3, TABLE_START_ROW, TABLE_START_COL, "=E9*J21"), // C66 formula source
    ];

    for offset in 0..9 {
        cells.push(number_cell(
            10 + offset,
            TABLE_START_ROW,
            BODY_START_COL + offset,
            (offset + 1) as f64,
        ));
        cells.push(number_cell(
            30 + offset,
            BODY_START_ROW + offset,
            TABLE_START_COL,
            ((offset + 1) * 10) as f64,
        ));
    }

    workbook(cells)
}

fn create_repro_data_table(engine: &mut YrsComputeEngine) {
    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let input = CreateDataTableInput {
        sheet_id,
        table_range: "C66:L75".to_string(),
        row_input_cell: Some("J21".to_string()),
        col_input_cell: Some("E9".to_string()),
    };
    let (_patches, result) = engine
        .create_data_table(
            &sheet_id,
            TABLE_START_ROW,
            TABLE_START_COL,
            TABLE_END_ROW,
            TABLE_END_COL,
            &input,
        )
        .expect("createDataTable should either materialize results or return an explicit error");

    let data = result
        .data
        .expect("createDataTable should return result metadata");
    assert_eq!(data["bodyRange"], "D67:L75");
    assert_eq!(data["rowsComputed"], 9);
    assert_eq!(data["colsComputed"], 9);
    assert_eq!(data["cellCount"], 81);
}

fn cell_json_number(data: &Value) -> Option<f64> {
    if data.get("type").and_then(Value::as_str) == Some("number") {
        return data.get("value").and_then(Value::as_f64);
    }

    ["computed", "value", "raw"]
        .iter()
        .filter_map(|key| data.get(*key))
        .find_map(|value| {
            (value.get("type").and_then(Value::as_str) == Some("number"))
                .then(|| value.get("value").and_then(Value::as_f64))
                .flatten()
        })
}

#[test]
fn create_data_table_materializes_body_values_or_reports_unsupported() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(repro_workbook()).unwrap();
    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();

    create_repro_data_table(&mut engine);

    let d67_raw = engine.get_raw_value(&sheet_id, BODY_START_ROW, BODY_START_COL);
    assert_eq!(d67_raw, "=TABLE($E$9,$J$21)");
    let d67 = engine.get_effective_value(&sheet_id, BODY_START_ROW, BODY_START_COL);
    assert_eq!(
        d67.as_ref().and_then(cell_json_number),
        Some(10.0),
        "createDataTable returned success for C66:L75 and D67 reads as {d67_raw}, but D67 did not contain the computed body value; effective value was {d67:?}, cell data was {:?}",
        engine.get_cell_data(&sheet_id, BODY_START_ROW, BODY_START_COL)
    );

    let l75_raw = engine.get_raw_value(&sheet_id, TABLE_END_ROW, TABLE_END_COL);
    assert_eq!(l75_raw, "=TABLE($E$9,$J$21)");
    let l75 = engine.get_effective_value(&sheet_id, TABLE_END_ROW, TABLE_END_COL);
    assert_eq!(
        l75.as_ref().and_then(cell_json_number),
        Some(810.0),
        "createDataTable returned success for C66:L75 and L75 reads as {l75_raw}, but L75 did not contain the computed body value; effective value was {l75:?}, cell data was {:?}",
        engine.get_cell_data(&sheet_id, TABLE_END_ROW, TABLE_END_COL)
    );
}

#[test]
fn created_data_table_can_be_removed_and_former_body_accepts_scalar_writes() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(repro_workbook()).unwrap();
    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();

    create_repro_data_table(&mut engine);
    assert_eq!(engine.mirror().all_data_table_regions().len(), 1);

    engine
        .clear_range_by_position(
            sheet_id,
            TABLE_START_ROW,
            TABLE_START_COL,
            TABLE_END_ROW,
            TABLE_END_COL,
        )
        .expect("clearing the full Data Table selection should be the API-supported teardown path");
    assert!(
        engine.mirror().all_data_table_regions().is_empty(),
        "full-range clear should remove the persisted Data Table region"
    );

    engine
        .set_cell_value_parsed(&sheet_id, BODY_START_ROW, BODY_START_COL, "123")
        .expect("former Data Table body cell should accept ordinary scalar writes after teardown");
    let d67 = engine
        .get_cell_data(&sheet_id, BODY_START_ROW, BODY_START_COL)
        .expect("D67 should contain the scalar written after teardown");
    assert_eq!(cell_json_number(&d67), Some(123.0));
    assert!(
        d67.get("formula").and_then(Value::as_str).is_none(),
        "former Data Table body cell should not continue to expose TABLE() formula metadata"
    );
}

#[test]
fn full_range_clear_unblocks_scalar_writes_into_former_data_table_body() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(repro_workbook()).unwrap();
    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();

    create_repro_data_table(&mut engine);
    engine
        .clear_range_by_position(
            sheet_id,
            TABLE_START_ROW,
            TABLE_START_COL,
            TABLE_END_ROW,
            TABLE_END_COL,
        )
        .expect("clearing the full Data Table selection should be the API-supported teardown path");

    engine
        .set_cell_value_parsed(&sheet_id, BODY_START_ROW, BODY_START_COL, "123")
        .expect("former Data Table body cell should accept ordinary scalar writes after teardown");
    let d67 = engine
        .get_cell_data(&sheet_id, BODY_START_ROW, BODY_START_COL)
        .expect("D67 should contain the scalar written after teardown");
    assert_eq!(cell_json_number(&d67), Some(123.0));
    assert!(
        d67.get("formula").and_then(Value::as_str).is_none(),
        "former Data Table body cell should not continue to expose TABLE() formula metadata"
    );
}
