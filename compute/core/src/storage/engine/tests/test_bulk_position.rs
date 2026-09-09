//! Bulk by-position identity and dimension behavior.

use super::super::*;
use super::helpers::*;

#[test]
fn bulk_set_cells_by_position_grows_fresh_sheet_to_100k_once() {
    let (mut engine, _) = ComputeEngine::from_snapshot(empty_bulk_snapshot()).unwrap();
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
    let (mut engine, _) = ComputeEngine::from_snapshot(empty_bulk_snapshot()).unwrap();
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
    let grid = engine.cell_store().get_sheet(&sid).expect("grid index");
    let cell_id = grid
        .cell_id_at(cell_types::SheetPos::new(0, 0))
        .expect("winning cell id");
    assert_eq!(
        grid.cells().filter(|(id, _, _)| *id == cell_id).count(),
        1,
        "duplicate by-position writes must allocate/register one winning identity",
    );
}
