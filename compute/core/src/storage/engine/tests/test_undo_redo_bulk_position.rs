//! Bulk by-position undo/redo identity and dimension behavior.

use super::super::*;
use super::helpers::*;
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
fn formula_precedent_identities_are_reused_by_later_position_edits() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(empty_bulk_snapshot()).unwrap();
    let sid = sheet_id();

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                31,
                3,
                crate::storage::engine::mutation::CellInput::Parse {
                    text: "=D11/C11-1".into(),
                },
            )],
            false,
        )
        .unwrap();

    let c11_id = engine
        .grid_index(&sid)
        .expect("grid index")
        .cell_id_at(10, 2)
        .expect("formula precedent identity");

    engine
        .batch_set_cells_by_position(
            vec![
                (
                    sid,
                    10,
                    2,
                    crate::storage::engine::mutation::CellInput::Parse {
                        text: "899.4".into(),
                    },
                ),
                (
                    sid,
                    10,
                    3,
                    crate::storage::engine::mutation::CellInput::Parse {
                        text: "773.8".into(),
                    },
                ),
            ],
            false,
        )
        .unwrap();

    assert_eq!(
        engine
            .grid_index(&sid)
            .expect("grid index")
            .cell_id_at(10, 2),
        Some(c11_id)
    );

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                10,
                2,
                crate::storage::engine::mutation::CellInput::Parse {
                    text: "950.4".into(),
                },
            )],
            false,
        )
        .unwrap();

    match cell_value_at(&engine, &sid, 31, 3) {
        CellValue::Number(actual) => {
            let expected = 773.8 / 950.4 - 1.0;
            assert!(
                (actual.get() - expected).abs() < 1e-12,
                "expected {expected}, got {}",
                actual.get()
            );
        }
        other => panic!("expected recalculated number, got {other:?}"),
    }
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

    engine.undo().unwrap();
    assert_eq!(cell_value_at(&engine, &sid, 99_999, 27), CellValue::Null);
    assert_eq!(engine.grid_index(&sid).unwrap().row_count(), 0);
    assert_eq!(engine.grid_index(&sid).unwrap().col_count(), 0);

    engine.redo().unwrap();
    assert_eq!(cell_value_at(&engine, &sid, 99_999, 27), num(7.0));
    assert!(engine.grid_index(&sid).unwrap().row_count() >= 100_000);
    assert!(engine.grid_index(&sid).unwrap().col_count() >= 28);
}
