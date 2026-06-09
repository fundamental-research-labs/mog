use cell_types::{SheetId, SheetPos};
use compute_core::data_table::CreateDataTableInput;
use compute_core::storage::engine::YrsComputeEngine;
use formula_types::CellRef;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, ComputeError, FiniteF64};

const SHEET_UUID: &str = "000000000000000000000000000000aa";

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
            rows: 20,
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

fn two_variable_workbook() -> WorkbookSnapshot {
    workbook(vec![
        number_cell(1, 0, 0, 2.0),       // A1 row input ref
        number_cell(2, 1, 0, 3.0),       // A2 column input ref
        formula_cell(3, 1, 1, "=A1*A2"), // B2 master formula
        number_cell(4, 1, 2, 10.0),      // C2 top-row value
        number_cell(5, 1, 3, 20.0),      // D2 top-row value
        number_cell(6, 2, 1, 30.0),      // B3 left-column value
        number_cell(7, 3, 1, 40.0),      // B4 left-column value
    ])
}

fn create_two_variable(engine: &mut YrsComputeEngine) -> Result<(), ComputeError> {
    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let input = CreateDataTableInput {
        sheet_id,
        table_range: "B2:D4".to_string(),
        row_input_cell: Some("A1".to_string()),
        col_input_cell: Some("A2".to_string()),
    };
    let (_patches, result) = engine.create_data_table(&sheet_id, 1, 1, 3, 3, &input)?;
    let data = result.data.expect("create result data");
    assert_eq!(data["bodyRange"], "C3:D4");
    assert_eq!(data["rowsComputed"], 2);
    assert_eq!(data["colsComputed"], 2);
    assert_eq!(data["cellCount"], 4);
    Ok(())
}

fn expect_invalid_code(err: ComputeError, code: &str) {
    assert!(
        matches!(&err, ComputeError::InvalidInput { message } if message.contains(code)),
        "expected {code}, got {err:?}"
    );
}

fn assert_number_at(engine: &YrsComputeEngine, row: u32, col: u32, expected: f64) {
    let sheet_id = SheetId::from_uuid_str(SHEET_UUID).unwrap();
    assert_eq!(
        engine
            .mirror()
            .get_cell_value_at(&sheet_id, SheetPos::new(row, col)),
        Some(&CellValue::Number(FiniteF64::must(expected)))
    );
}

#[test]
fn create_data_table_persists_region_to_yrs_and_hydrates_from_state() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(two_variable_workbook()).unwrap();

    create_two_variable(&mut engine).unwrap();

    let regions = engine.mirror().all_data_table_regions();
    assert_eq!(regions.len(), 1);
    let region = &regions[0];
    assert_eq!((region.start_row, region.start_col), (2, 2));
    assert_eq!((region.end_row, region.end_col), (3, 3));
    assert!(matches!(
        region.col_input_ref,
        Some(CellRef::Positional { row: 0, col: 0, .. })
    ));
    assert!(matches!(
        region.row_input_ref,
        Some(CellRef::Positional { row: 1, col: 0, .. })
    ));

    let state = engine.sync_full_state();
    let (hydrated, _) = YrsComputeEngine::from_yrs_state(&state).unwrap();
    let hydrated_regions = hydrated.mirror().all_data_table_regions();
    assert_eq!(hydrated_regions.len(), 1);
    assert_eq!(hydrated_regions[0].start_row, 2);
    assert_eq!(hydrated_regions[0].start_col, 2);
}

#[test]
fn create_data_table_materializes_two_variable_body_formulas_and_values() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(two_variable_workbook()).unwrap();
    let sheet_id = SheetId::from_uuid_str(SHEET_UUID).unwrap();

    create_two_variable(&mut engine).unwrap();

    assert_eq!(engine.get_raw_value(&sheet_id, 2, 2), "=TABLE($A$2,$A$1)");
    assert_eq!(engine.get_raw_value(&sheet_id, 3, 3), "=TABLE($A$2,$A$1)");
    assert_number_at(&engine, 2, 2, 300.0);
    assert_number_at(&engine, 2, 3, 600.0);
    assert_number_at(&engine, 3, 2, 400.0);
    assert_number_at(&engine, 3, 3, 800.0);
}

#[test]
fn create_data_table_materializes_one_variable_column_layout() {
    let snapshot = workbook(vec![
        number_cell(1, 0, 0, 2.0),       // A1 input ref
        formula_cell(2, 0, 2, "=A1*10"), // C1 formula source
        number_cell(3, 1, 1, 3.0),       // B2 left-column value
        number_cell(4, 2, 1, 4.0),       // B3 left-column value
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let input = CreateDataTableInput {
        sheet_id,
        table_range: "B1:C3".to_string(),
        row_input_cell: None,
        col_input_cell: Some("A1".to_string()),
    };

    let (_patches, result) = engine
        .create_data_table(&sheet_id, 0, 1, 2, 2, &input)
        .unwrap();

    let data = result.data.expect("create result data");
    assert_eq!(data["bodyRange"], "C2:C3");
    assert_eq!(engine.get_raw_value(&sheet_id, 1, 2), "=TABLE($A$1,)");
    assert_eq!(engine.get_raw_value(&sheet_id, 2, 2), "=TABLE($A$1,)");
    assert_number_at(&engine, 1, 2, 30.0);
    assert_number_at(&engine, 2, 2, 40.0);
}

#[test]
fn create_data_table_rejects_overlap_atomically() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(two_variable_workbook()).unwrap();
    create_two_variable(&mut engine).unwrap();

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let input = CreateDataTableInput {
        sheet_id,
        table_range: "B2:D4".to_string(),
        row_input_cell: Some("A1".to_string()),
        col_input_cell: Some("A2".to_string()),
    };
    let err = engine
        .create_data_table(&sheet_id, 1, 1, 3, 3, &input)
        .unwrap_err();
    expect_invalid_code(err, "DATA_TABLE_REGION_OVERLAP");
    assert_eq!(engine.mirror().all_data_table_regions().len(), 1);
}

#[test]
fn create_data_table_rejects_non_empty_body_atomically() {
    let mut snapshot = two_variable_workbook();
    snapshot.sheets[0].cells.push(number_cell(8, 2, 2, 99.0)); // C3 body
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let input = CreateDataTableInput {
        sheet_id,
        table_range: "B2:D4".to_string(),
        row_input_cell: Some("A1".to_string()),
        col_input_cell: Some("A2".to_string()),
    };
    let err = engine
        .create_data_table(&sheet_id, 1, 1, 3, 3, &input)
        .unwrap_err();
    expect_invalid_code(err, "DATA_TABLE_BODY_NOT_EMPTY");
    assert!(engine.mirror().all_data_table_regions().is_empty());
}

#[test]
fn create_data_table_rejects_input_refs_inside_table_range() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(two_variable_workbook()).unwrap();

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let input = CreateDataTableInput {
        sheet_id,
        table_range: "B2:D4".to_string(),
        row_input_cell: Some("C2".to_string()),
        col_input_cell: Some("A2".to_string()),
    };
    let err = engine
        .create_data_table(&sheet_id, 1, 1, 3, 3, &input)
        .unwrap_err();
    expect_invalid_code(err, "DATA_TABLE_INPUT_INSIDE_TABLE");
    assert!(engine.mirror().all_data_table_regions().is_empty());
}

#[test]
fn create_data_table_requires_at_least_one_input_ref() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(two_variable_workbook()).unwrap();

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let input = CreateDataTableInput {
        sheet_id,
        table_range: "B2:D4".to_string(),
        row_input_cell: None,
        col_input_cell: None,
    };
    let err = engine
        .create_data_table(&sheet_id, 1, 1, 3, 3, &input)
        .unwrap_err();
    expect_invalid_code(err, "DATA_TABLE_INPUT_REQUIRED");
    assert!(engine.mirror().all_data_table_regions().is_empty());
}

#[test]
fn create_data_table_rejects_selection_without_body() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(two_variable_workbook()).unwrap();

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let input = CreateDataTableInput {
        sheet_id,
        table_range: "B2:D2".to_string(),
        row_input_cell: Some("A1".to_string()),
        col_input_cell: Some("A2".to_string()),
    };
    let err = engine
        .create_data_table(&sheet_id, 1, 1, 1, 3, &input)
        .unwrap_err();
    expect_invalid_code(err, "DATA_TABLE_INVALID_LAYOUT");
    assert!(engine.mirror().all_data_table_regions().is_empty());
}

#[test]
fn create_data_table_rejects_duplicate_input_refs() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(two_variable_workbook()).unwrap();

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let input = CreateDataTableInput {
        sheet_id,
        table_range: "B2:D4".to_string(),
        row_input_cell: Some("A1".to_string()),
        col_input_cell: Some("A1".to_string()),
    };
    let err = engine
        .create_data_table(&sheet_id, 1, 1, 3, 3, &input)
        .unwrap_err();
    expect_invalid_code(err, "DATA_TABLE_INPUT_DUPLICATE");
    assert!(engine.mirror().all_data_table_regions().is_empty());
}

#[test]
fn create_data_table_requires_layout_specific_formula_sources() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(two_variable_workbook()).unwrap();

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let input = CreateDataTableInput {
        sheet_id,
        table_range: "B2:D4".to_string(),
        row_input_cell: None,
        col_input_cell: Some("A2".to_string()),
    };
    let err = engine
        .create_data_table(&sheet_id, 1, 1, 3, 3, &input)
        .unwrap_err();
    expect_invalid_code(err, "DATA_TABLE_FORMULA_REQUIRED");
    assert!(engine.mirror().all_data_table_regions().is_empty());
}
