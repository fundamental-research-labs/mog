use super::*;
use crate::engine_types::queries::FindInRangeOptions;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

fn sheet_id() -> SheetId {
    SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
}

fn literal_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(10.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(20.0)),
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

fn num(value: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(value))
}

fn cell_change_at(
    changes: &[crate::snapshot::CellChange],
    row: u32,
    col: u32,
) -> &crate::snapshot::CellChange {
    changes
        .iter()
        .find(|change| change.position.as_ref().map(|pos| (pos.row, pos.col)) == Some((row, col)))
        .unwrap_or_else(|| panic!("no CellChange found at row={row}, col={col}"))
}

#[test]
fn replace_all_existing_literals_returns_direct_changes_without_dependents() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(literal_snapshot()).unwrap();

    let (_patches, mutation_result) = engine
        .replace_all_in_range(
            &sheet_id(),
            0,
            0,
            0,
            1,
            "0".to_string(),
            "5".to_string(),
            FindInRangeOptions {
                text: "0".to_string(),
                case_sensitive: None,
                whole_cell: None,
                include_formulas: None,
            },
        )
        .unwrap();

    assert_eq!(mutation_result.extract_data::<u32>(), Some(2));
    let changes = &mutation_result.recalc.changed_cells;
    assert_eq!(
        changes.len(),
        2,
        "replaceAll should emit direct literal edits"
    );

    let a1 = cell_change_at(changes, 0, 0);
    assert_eq!(a1.old_value, Some(num(10.0)));
    assert_eq!(a1.value, num(15.0));

    let b1 = cell_change_at(changes, 0, 1);
    assert_eq!(b1.old_value, Some(num(20.0)));
    assert_eq!(b1.value, num(25.0));
}
