//! Bulk by-position undo/redo identity and dimension behavior.

use super::super::*;
use super::helpers::*;
use formula_types::StructureChange;
use value_types::CellValue;

#[test]
fn bulk_set_cells_by_position_grows_fresh_sheet_to_100k_once() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(empty_bulk_snapshot()).unwrap();
    let sid = sheet_id();

    let edits = (0..100_000)
        .map(|row| {
            (
                sid,
                row,
                0,
                crate::storage::engine::mutation::CellInput::Parse {
                    text: (row + 1).to_string(),
                },
            )
        })
        .collect();

    engine
        .batch_set_cells_by_position(edits, true)
        .expect("100k fresh-sheet batch write");

    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(1.0));
    assert_eq!(cell_value_at(&engine, &sid, 49_999, 0), num(50_000.0));
    assert_eq!(cell_value_at(&engine, &sid, 99_999, 0), num(100_000.0));

    let grid = engine.grid_index(&sid).expect("grid index");
    assert!(grid.row_count() >= 100_000);
    assert!(grid.col_count() >= 1);
}

#[test]
fn bulk_set_cells_by_position_emits_one_provider_update() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(empty_bulk_snapshot()).unwrap();
    let sid = sheet_id();
    engine
        .drain_pending_updates()
        .expect("construction updates should drain");

    engine
        .batch_set_cells_by_position(
            vec![
                (
                    sid,
                    0,
                    0,
                    crate::storage::engine::mutation::CellInput::Parse { text: "1".into() },
                ),
                (
                    sid,
                    1,
                    0,
                    crate::storage::engine::mutation::CellInput::Parse { text: "2".into() },
                ),
                (
                    sid,
                    2,
                    0,
                    crate::storage::engine::mutation::CellInput::Parse { text: "3".into() },
                ),
            ],
            true,
        )
        .expect("bulk write");

    let updates = engine
        .drain_pending_updates()
        .expect("bulk provider updates should drain");
    assert_eq!(
        updates.len(),
        1,
        "bulk cell writes must fan out one provider update per user-visible mutation"
    );
}

#[test]
fn duplicate_set_cells_by_position_uses_last_write_and_one_identity() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(empty_bulk_snapshot()).unwrap();
    let sid = sheet_id();

    engine
        .batch_set_cells_by_position(
            vec![
                (
                    sid,
                    0,
                    0,
                    crate::storage::engine::mutation::CellInput::Parse { text: "1".into() },
                ),
                (
                    sid,
                    0,
                    0,
                    crate::storage::engine::mutation::CellInput::Parse { text: "2".into() },
                ),
            ],
            true,
        )
        .unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(2.0));
    let grid = engine.grid_index(&sid).expect("grid index");
    let cell_id = grid.cell_id_at(0, 0).expect("winning cell id");
    assert_eq!(
        grid.cells().filter(|(id, _, _)| *id == cell_id).count(),
        1,
        "duplicate by-position writes must allocate/register one winning identity",
    );
}

#[test]
fn undo_redo_restores_bulk_dimension_growth() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(empty_bulk_snapshot()).unwrap();
    let sid = sheet_id();
    assert_eq!(engine.grid_index(&sid).unwrap().row_count(), 0);
    assert_eq!(engine.grid_index(&sid).unwrap().col_count(), 0);

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                99_999,
                27,
                crate::storage::engine::mutation::CellInput::Parse { text: "7".into() },
            )],
            true,
        )
        .unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 99_999, 27), num(7.0));
    assert!(engine.grid_index(&sid).unwrap().row_count() >= 100_000);
    assert!(engine.grid_index(&sid).unwrap().col_count() >= 28);

    let (_patches, undo_result) = engine.undo().unwrap();
    assert_eq!(cell_value_at(&engine, &sid, 99_999, 27), CellValue::Null);
    assert_eq!(engine.grid_index(&sid).unwrap().row_count(), 0);
    assert_eq!(engine.grid_index(&sid).unwrap().col_count(), 0);
    assert!(
        undo_result.structure_changes.is_empty(),
        "undo of implicit sparse capacity grow must stay incremental"
    );

    let (_patches, redo_result) = engine.redo().unwrap();
    assert_eq!(cell_value_at(&engine, &sid, 99_999, 27), num(7.0));
    assert!(engine.grid_index(&sid).unwrap().row_count() >= 100_000);
    assert!(engine.grid_index(&sid).unwrap().col_count() >= 28);
    assert!(
        redo_result.structure_changes.is_empty(),
        "redo of implicit sparse capacity grow must stay incremental"
    );
}

#[test]
fn undo_redo_restores_single_axis_col_growth_on_pre_sized_sheet() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(crate::snapshot::WorkbookSnapshot {
        sheets: vec![crate::snapshot::SheetSnapshot {
            id: sheet_id().to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 1_335,
            cols: 18,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    })
    .unwrap();
    let sid = sheet_id();
    assert_eq!(engine.grid_index(&sid).unwrap().row_count(), 1_335);
    assert_eq!(engine.grid_index(&sid).unwrap().col_count(), 18);

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                79,
                18,
                crate::storage::engine::mutation::CellInput::Parse {
                    text: "atlas91 paste alpha".into(),
                },
            )],
            true,
        )
        .unwrap();

    assert_eq!(
        cell_value_at(&engine, &sid, 79, 18),
        CellValue::Text("atlas91 paste alpha".into())
    );
    assert_eq!(engine.grid_index(&sid).unwrap().row_count(), 1_335);
    assert_eq!(engine.grid_index(&sid).unwrap().col_count(), 19);

    let (_patches, undo_result) = engine.undo().unwrap();
    assert_eq!(cell_value_at(&engine, &sid, 79, 18), CellValue::Null);
    assert_eq!(engine.grid_index(&sid).unwrap().row_count(), 1_335);
    assert_eq!(engine.grid_index(&sid).unwrap().col_count(), 18);
    assert!(
        undo_result.structure_changes.is_empty(),
        "undo of implicit single-axis capacity grow must stay incremental"
    );

    let (_patches, redo_result) = engine.redo().unwrap();
    assert_eq!(
        cell_value_at(&engine, &sid, 79, 18),
        CellValue::Text("atlas91 paste alpha".into())
    );
    assert_eq!(engine.grid_index(&sid).unwrap().row_count(), 1_335);
    assert_eq!(engine.grid_index(&sid).unwrap().col_count(), 19);
    assert!(
        redo_result.structure_changes.is_empty(),
        "redo of implicit single-axis capacity grow must stay incremental"
    );
}

#[test]
fn explicit_tail_row_delete_undo_redo_stays_structural() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(empty_bulk_snapshot()).unwrap();
    let sid = sheet_id();

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                0,
                0,
                crate::storage::engine::mutation::CellInput::Parse { text: "11".into() },
            )],
            true,
        )
        .unwrap();

    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteRows {
                at: 0,
                count: 1,
                deleted_cell_ids: vec![],
            },
        )
        .expect("delete tail row");

    assert_eq!(cell_value_at(&engine, &sid, 0, 0), CellValue::Null);

    let (_patches, undo_result) = engine.undo().expect("undo explicit tail row delete");
    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(11.0));
    assert!(
        !undo_result.structure_changes.is_empty(),
        "undo of explicit tail row delete must stay on the structural refresh path"
    );

    let (_patches, redo_result) = engine.redo().expect("redo explicit tail row delete");
    assert_eq!(cell_value_at(&engine, &sid, 0, 0), CellValue::Null);
    assert!(
        !redo_result.structure_changes.is_empty(),
        "redo of explicit tail row delete must stay on the structural refresh path"
    );
}
