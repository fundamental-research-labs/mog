use cell_types::{SheetId, SheetPos};
use compute_core::data_table::DataTableParams;
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

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

fn workbook() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 20,
            cols: 20,
            cells: vec![
                number_cell(1, 0, 0, 2.0),
                number_cell(2, 1, 0, 3.0),
                formula_cell(3, 1, 1, "=A1*A2"),
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

fn value_at(engine: &YrsComputeEngine, sheet_id: &SheetId, row: u32, col: u32) -> CellValue {
    engine
        .mirror()
        .get_cell_value_at(sheet_id, SheetPos::new(row, col))
        .cloned()
        .unwrap_or(CellValue::Null)
}

#[test]
fn data_table_is_transient_and_restores_input_cells() {
    let (engine, _) = YrsComputeEngine::from_snapshot(workbook()).unwrap();
    let sheet_id = SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let row_input_before = value_at(&engine, &sheet_id, 0, 0);
    let col_input_before = value_at(&engine, &sheet_id, 1, 0);

    let result = engine.data_table(&DataTableParams {
        formula_cell: cell_uuid(3),
        row_input_cell: Some(cell_uuid(1)),
        col_input_cell: Some(cell_uuid(2)),
        row_values: vec![
            CellValue::Number(FiniteF64::must(10.0)),
            CellValue::Number(FiniteF64::must(20.0)),
        ],
        col_values: vec![
            CellValue::Number(FiniteF64::must(30.0)),
            CellValue::Number(FiniteF64::must(40.0)),
        ],
    });

    assert_eq!(result.cell_count, 4);
    assert_eq!(
        result.results,
        vec![
            vec![
                CellValue::Number(FiniteF64::must(300.0)),
                CellValue::Number(FiniteF64::must(400.0)),
            ],
            vec![
                CellValue::Number(FiniteF64::must(600.0)),
                CellValue::Number(FiniteF64::must(800.0)),
            ],
        ]
    );
    assert_eq!(value_at(&engine, &sheet_id, 0, 0), row_input_before);
    assert_eq!(value_at(&engine, &sheet_id, 1, 0), col_input_before);
}
