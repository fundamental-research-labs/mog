//! Production-engine subtotal regressions.

use super::super::*;
use crate::snapshot::{CellData, SheetSnapshot};
use crate::storage::sheet::grouping::{SubtotalFunction, SubtotalOptions};
use value_types::{CellValue, FiniteF64};

fn subtotal_snapshot() -> WorkbookSnapshot {
    let cells = [
        (1, 0, 0, CellValue::from("Region")),
        (2, 0, 1, CellValue::from("Sales")),
        (3, 1, 0, CellValue::from("East")),
        (4, 1, 1, CellValue::Number(FiniteF64::must(100.0))),
        (5, 2, 0, CellValue::from("East")),
        (6, 2, 1, CellValue::Number(FiniteF64::must(80.0))),
        (7, 3, 0, CellValue::from("West")),
        (8, 3, 1, CellValue::Number(FiniteF64::must(90.0))),
        (9, 4, 0, CellValue::from("West")),
        (10, 4, 1, CellValue::Number(FiniteF64::must(110.0))),
    ]
    .into_iter()
    .map(|(cell_id, row, col, value)| CellData {
        cell_id: format!("550e8400-e29b-41d4-a716-44665544{cell_id:04}"),
        row,
        col,
        value,
        formula: None,
        identity_formula: None,
        array_ref: None,
    })
    .collect();

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
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

fn subtotal_options(function: SubtotalFunction) -> SubtotalOptions {
    SubtotalOptions {
        group_by_column: 0,
        subtotal_columns: vec![1],
        function,
        has_headers: true,
        replace_existing: true,
        summary_below_data: true,
    }
}

fn text_at(engine: &YrsComputeEngine, sheet_id: &SheetId, row: u32, col: u32) -> String {
    match engine.get_cell_value(sheet_id, row, col) {
        CellValue::Text(text) => text.to_string(),
        CellValue::Number(number) => f64::from(number).to_string(),
        CellValue::Null => String::new(),
        other => format!("{other:?}"),
    }
}

fn formula_at(engine: &YrsComputeEngine, sheet_id: &SheetId, row: u32, col: u32) -> Option<String> {
    let cell_id = engine.grid_index(sheet_id)?.cell_id_at(row, col)?;
    engine.get_formula(&cell_id)
}

#[test]
fn create_subtotals_replaces_existing_on_production_engine_path() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(subtotal_snapshot()).unwrap();
    let sid = SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    engine
        .register_viewport("main", &sid, 0, 0, 20, 10)
        .expect("register viewport");

    let (sum_patches, _) = engine
        .create_subtotals(&sid, 0, 0, 4, 1, subtotal_options(SubtotalFunction::Sum))
        .expect("create SUM subtotals");
    assert!(
        sum_patches.len() > 2,
        "subtotal creation must refresh registered viewports"
    );

    let (average_patches, _) = engine
        .create_subtotals(
            &sid,
            0,
            0,
            4,
            1,
            subtotal_options(SubtotalFunction::Average),
        )
        .expect("replace with AVERAGE subtotals");
    assert!(
        average_patches.len() > 2,
        "subtotal replacement must refresh registered viewports"
    );

    let rows: Vec<[String; 2]> = (0..=8)
        .map(|row| {
            [
                text_at(&engine, &sid, row, 0),
                text_at(&engine, &sid, row, 1),
            ]
        })
        .collect();
    assert_eq!(
        rows,
        vec![
            ["Region".to_string(), "Sales".to_string()],
            ["East".to_string(), "100".to_string()],
            ["East".to_string(), "80".to_string()],
            ["East Total".to_string(), "90".to_string()],
            ["West".to_string(), "90".to_string()],
            ["West".to_string(), "110".to_string()],
            ["West Total".to_string(), "100".to_string()],
            ["Grand Total".to_string(), "95".to_string()],
            ["".to_string(), "".to_string()],
        ]
    );

    assert_eq!(
        formula_at(&engine, &sid, 3, 1).as_deref(),
        Some("=SUBTOTAL(101,B2:B3)")
    );
    assert_eq!(
        formula_at(&engine, &sid, 6, 1).as_deref(),
        Some("=SUBTOTAL(101,B5:B6)")
    );
    assert_eq!(
        formula_at(&engine, &sid, 7, 1).as_deref(),
        Some("=SUBTOTAL(101,B2:B7)")
    );
}
