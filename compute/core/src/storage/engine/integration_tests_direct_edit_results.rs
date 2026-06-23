use super::*;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

fn sheet_id() -> SheetId {
    SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
}

fn cell_id_b1() -> CellId {
    CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440002").unwrap()
}

fn formula_deps_snapshot() -> WorkbookSnapshot {
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
                    value: num(10.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::Null,
                    formula: Some("=A1*2".to_string()),
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
) -> Option<&crate::snapshot::CellChange> {
    changes
        .iter()
        .find(|change| change.position.as_ref().map(|pos| (pos.row, pos.col)) == Some((row, col)))
}

fn apply_set_b1_formula(
    engine: &mut YrsComputeEngine,
    formula: &str,
) -> crate::snapshot::MutationResult {
    let output = engine
        .apply_mutation(EngineMutation::SetCellsByPosition {
            edits: vec![(
                sheet_id(),
                0,
                1,
                crate::bridge_types::CellInput::Parse {
                    text: formula.to_string(),
                },
            )],
            skip_cycle_check: false,
        })
        .unwrap();

    match output {
        MutationOutput::Recalc(result) => result,
        _ => panic!("expected recalc mutation output"),
    }
}

#[test]
fn set_cells_by_position_same_formula_rewrite_does_not_emit_placeholder_value() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(formula_deps_snapshot()).unwrap();

    let mutation_result = apply_set_b1_formula(&mut engine, "=A1*2");

    assert_eq!(
        engine.mirror().get_cell_value(&cell_id_b1()).cloned(),
        Some(num(20.0))
    );

    if let Some(b1_change) = cell_change_at(&mutation_result.recalc.changed_cells, 0, 1) {
        assert_eq!(b1_change.old_value, Some(num(20.0)));
        assert_eq!(b1_change.value, num(20.0));
        assert_eq!(b1_change.old_display_text.as_deref(), Some("20"));
        assert_eq!(b1_change.display_text.as_deref(), Some("20"));
        assert_eq!(b1_change.old_formula.as_deref(), Some("=A1*2"));
        assert_eq!(b1_change.new_formula.as_deref(), Some("=A1*2"));
    }
}

#[test]
fn set_cells_by_position_formula_rewrite_same_value_reports_formula_change() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(formula_deps_snapshot()).unwrap();

    let mutation_result = apply_set_b1_formula(&mut engine, "=A1+10");
    let b1_change = cell_change_at(&mutation_result.recalc.changed_cells, 0, 1)
        .expect("B1 should report direct formula text changes even when the value is unchanged");

    assert_eq!(b1_change.old_value, Some(num(20.0)));
    assert_eq!(b1_change.value, num(20.0));
    assert_eq!(b1_change.old_display_text.as_deref(), Some("20"));
    assert_eq!(b1_change.display_text.as_deref(), Some("20"));
    assert_eq!(b1_change.old_formula.as_deref(), Some("=A1*2"));
    assert_eq!(b1_change.new_formula.as_deref(), Some("=A1+10"));
}
