//! Mutation results carry formatted display text for changed cells.

use super::super::*;
use super::helpers::*;

#[test]
fn test_set_cell_mutation_results_contain_display_text() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    let mutation_result = engine
        .set_cell(
            &sid,
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "42".into() },
        )
        .unwrap();
    let a1_change = mutation_result
        .recalc
        .changed_cells
        .iter()
        .find(|c| c.position.as_ref().map(|p| (p.row, p.col)) == Some((0, 0)))
        .expect("A1 should be in changed_cells");
    assert!(
        a1_change.display_text.is_some(),
        "JSON MutationResult should have display_text populated"
    );
}

#[test]
fn test_apply_mutation_set_cells_results_contain_display_text() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    use crate::bridge_types::CellInput;
    let edits = vec![(
        sid,
        cell_id_a1(),
        0u32,
        0u32,
        CellInput::Parse {
            text: "99".to_string(),
        },
    )];
    let output = engine
        .apply_mutation(EngineMutation::SetCells {
            edits,
            skip_cycle_check: false,
        })
        .unwrap();

    let result = match output {
        MutationOutput::Recalc(r) => r,
        _ => panic!("expected Recalc output"),
    };
    let change = result
        .recalc
        .changed_cells
        .iter()
        .find(|c| c.position.as_ref().map(|p| (p.row, p.col)) == Some((0, 0)))
        .expect("A1 should be in changed_cells");
    assert!(
        change.display_text.is_some(),
        "JSON MutationResult.changed_cells should have display_text"
    );
}

#[test]
fn test_apply_mutation_set_cells_by_position_results_contain_display_text() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    use crate::bridge_types::CellInput;
    let edits = vec![(
        sid,
        0u32,
        0u32,
        CellInput::Parse {
            text: "77".to_string(),
        },
    )];
    let output = engine
        .apply_mutation(EngineMutation::SetCellsByPosition {
            edits,
            skip_cycle_check: false,
        })
        .unwrap();

    let result = match output {
        MutationOutput::Recalc(r) => r,
        _ => panic!("expected Recalc output"),
    };
    let change = result
        .recalc
        .changed_cells
        .iter()
        .find(|c| c.position.as_ref().map(|p| (p.row, p.col)) == Some((0, 0)))
        .expect("A1 should be in changed_cells");
    assert!(change.display_text.is_some());
}

#[test]
fn test_formula_recalc_mutation_results_contain_display_text() {
    let snap = simple_snapshot(); // A1=10, B1=20, A2=A1+B1=30
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    let result = engine
        .set_cell(
            &sid,
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "50".into() },
        )
        .unwrap();
    let a2_change = result
        .recalc
        .changed_cells
        .iter()
        .find(|c| c.position.as_ref().map(|p| (p.row, p.col)) == Some((1, 0)))
        .expect("A2 (formula cell) should be in changed_cells after A1 edit");
    assert!(
        a2_change.display_text.is_some(),
        "A2 formula recalc JSON should have display_text"
    );
    assert_eq!(
        a2_change.display_text.as_deref(),
        Some("70"),
        "A2 should display 70 (50+20)"
    );
}
