//! Partial shifts report moved and cleared cells without a registered viewport.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellChange, CellData};
use value_types::CellValue;

fn shift_snapshot(values: &[f64], vertical: bool) -> WorkbookSnapshot {
    let mut snapshot = empty_bulk_snapshot();
    let sheet = &mut snapshot.sheets[0];
    sheet.rows = 4;
    sheet.cols = 4;
    sheet.cells = values
        .iter()
        .enumerate()
        .map(|(index, value)| CellData {
            cell_id: CellId::from_raw(0xe000 + index as u128).to_uuid_string(),
            row: if vertical { index as u32 } else { 0 },
            col: if vertical { 0 } else { index as u32 },
            value: num(*value),
            formula: None,
            identity_formula: None,
            array_ref: None,
        })
        .collect();
    snapshot
}

fn change_at(result: &MutationResult, row: u32, col: u32) -> &CellChange {
    let mut changes = result.recalc.changed_cells.iter().filter(|change| {
        change.sheet_id == sheet_id().to_uuid_string()
            && change.position.as_ref().map(|pos| (pos.row, pos.col)) == Some((row, col))
    });
    let change = changes
        .next()
        .unwrap_or_else(|| panic!("missing change at ({row}, {col}): {:?}", result.recalc));
    assert!(
        changes.next().is_none(),
        "duplicate change at ({row}, {col})"
    );
    change
}

#[test]
fn insert_shift_reports_constant_destinations_and_cleared_source_without_viewport() {
    for vertical in [false, true] {
        let (mut engine, _) =
            ComputeEngine::from_snapshot(shift_snapshot(&[10.0, 20.0], vertical)).unwrap();
        assert!(engine.get_registered_viewports().is_empty());

        let result = engine
            .insert_cells_with_shift(&sheet_id(), 0, 0, 1, 1, !vertical)
            .unwrap();

        for (index, value) in [CellValue::Null, num(10.0), num(20.0)]
            .into_iter()
            .enumerate()
        {
            let (row, col) = if vertical {
                (index as u32, 0)
            } else {
                (0, index as u32)
            };
            assert_eq!(engine.get_cell_value(&sheet_id(), row, col), value);
            assert_eq!(change_at(&result, row, col).value, value);
        }
        assert!(engine.get_registered_viewports().is_empty());
    }
}

#[test]
fn delete_shift_reports_constant_destinations_and_cleared_tail_without_viewport() {
    for vertical in [false, true] {
        let (mut engine, _) =
            ComputeEngine::from_snapshot(shift_snapshot(&[10.0, 20.0, 30.0], vertical)).unwrap();
        assert!(engine.get_registered_viewports().is_empty());

        let result = engine
            .delete_cells_with_shift(&sheet_id(), 0, 0, 1, 1, !vertical)
            .unwrap();

        for (index, value) in [num(20.0), num(30.0), CellValue::Null]
            .into_iter()
            .enumerate()
        {
            let (row, col) = if vertical {
                (index as u32, 0)
            } else {
                (0, index as u32)
            };
            assert_eq!(engine.get_cell_value(&sheet_id(), row, col), value);
            assert_eq!(change_at(&result, row, col).value, value);
        }
        assert!(engine.get_registered_viewports().is_empty());
    }
}

#[test]
fn insert_shift_preserves_recalculated_formula_text_in_destination_change() {
    let mut snapshot = shift_snapshot(&[10.0, 20.0], false);
    snapshot.sheets[0].cells[1].formula = Some("=A1*2".to_string());
    let formula_id = CellId::from_raw(0xe001);
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    assert!(engine.get_registered_viewports().is_empty());

    let result = engine
        .insert_cells_with_shift(&sheet_id(), 0, 0, 1, 1, true)
        .unwrap();

    assert_eq!(change_at(&result, 0, 0).value, CellValue::Null);
    assert_eq!(change_at(&result, 0, 1).value, num(10.0));
    let formula_change = change_at(&result, 0, 2);
    assert_eq!(formula_change.cell_id, formula_id.to_uuid_string());
    assert_eq!(formula_change.value, num(20.0));
    assert_eq!(formula_change.new_formula.as_deref(), Some("=B1*2"));
    assert_eq!(engine.get_formula(&formula_id).as_deref(), Some("=B1*2"));
}

#[test]
fn deleting_cells_with_shift_replays_deleted_formulas_comments_and_identities() {
    use domain_types::domain::comment::CommentType;
    for vertical in [false, true] {
        for has_survivor in [false, true] {
            let values = if has_survivor {
                vec![11.0, 22.0]
            } else {
                vec![11.0]
            };
            let mut snapshot = shift_snapshot(&values, vertical);
            snapshot.sheets[0].cells[0].formula = Some("=5+6".into());
            let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
            let sid = sheet_id();
            let deleted = engine
                .cell_store()
                .resolve_cell_id(&sid, SheetPos::new(0, 0))
                .unwrap();
            engine
                .add_comment_by_position(
                    &sid,
                    0,
                    0,
                    "preserve this note",
                    "Tester",
                    None,
                    None,
                    CommentType::Note,
                )
                .unwrap();
            let note = engine.get_comments_for_cell_by_position(&sid, 0, 0)[0].clone();
            engine.clear_history();
            engine
                .delete_cells_with_shift(&sid, 0, 0, 1, 1, !vertical)
                .unwrap();
            assert!(engine.can_undo());
            for _ in 0..2 {
                assert_eq!(engine.cell_store().sheet_for_cell(&deleted), None);
                assert!(engine.get_all_comments(&sid).is_empty());
                assert_eq!(
                    engine.get_cell_value(&sid, 0, 0),
                    if has_survivor {
                        num(22.0)
                    } else {
                        CellValue::Null
                    }
                );
                engine.undo().unwrap();
                assert_eq!(
                    engine
                        .cell_store()
                        .resolve_cell_id(&sid, SheetPos::new(0, 0)),
                    Some(deleted)
                );
                assert_eq!(engine.get_formula(&deleted).as_deref(), Some("=5+6"));
                assert_eq!(engine.get_cell_value(&sid, 0, 0), num(11.0));
                assert_eq!(
                    engine.get_comments_for_cell_by_position(&sid, 0, 0),
                    vec![note.clone()]
                );
                if has_survivor {
                    let (row, col) = if vertical { (1, 0) } else { (0, 1) };
                    assert_eq!(engine.get_cell_value(&sid, row, col), num(22.0));
                }
                engine.redo().unwrap();
            }
        }
    }
}

#[test]
fn deleting_a_cse_anchor_with_shift_restores_its_selection_on_undo() {
    let (mut engine, _) = ComputeEngine::from_snapshot(shift_snapshot(&[], true)).unwrap();
    let sid = sheet_id();
    engine
        .set_array_formula(&sid, 0, 0, 2, 0, "=SEQUENCE(3)".into())
        .unwrap();
    let anchor = engine
        .cell_store()
        .resolve_cell_id(&sid, SheetPos::new(0, 0))
        .unwrap();
    engine.clear_history();
    engine
        .delete_cells_with_shift(&sid, 0, 0, 1, 1, false)
        .unwrap();
    for _ in 0..2 {
        assert!(!engine.cell_store().is_cse_anchor(&anchor));
        engine.undo().unwrap();
        assert!(engine.cell_store().is_cse_anchor(&anchor));
        assert_eq!(engine.get_formula(&anchor).as_deref(), Some("=SEQUENCE(3)"));
        for row in 0..3 {
            assert_eq!(engine.get_cell_value(&sid, row, 0), num((row + 1) as f64));
        }
        let projection = engine
            .cell_store()
            .projection_registry
            .get(&anchor)
            .unwrap();
        assert_eq!((projection.rows, projection.cols), (3, 1));
        engine.redo().unwrap();
    }
}
