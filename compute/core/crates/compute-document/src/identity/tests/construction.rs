use super::fixtures::{assert_invariants, make_grid};
use crate::identity::GridIndex;
use cell_types::{
    AxisIdentityRun, AxisIdentitySeed, AxisIdentityStore, AxisRunId, CellId, ColId, IdAllocator,
    RowId, SheetId,
};
use std::collections::HashSet;
use std::sync::Arc;

// -----------------------------------------------------------------------
// 1. Construction
// -----------------------------------------------------------------------

#[test]
fn new_grid_has_correct_dimensions() {
    let grid = make_grid(5, 3);
    assert_eq!(grid.row_count(), 5);
    assert_eq!(grid.col_count(), 3);
    assert_eq!(grid.cell_count(), 0);
}

#[test]
fn new_grid_zero_dimensions() {
    let grid = make_grid(0, 0);
    assert_eq!(grid.row_count(), 0);
    assert_eq!(grid.col_count(), 0);
    assert_eq!(grid.cell_count(), 0);
}

#[test]
fn new_grid_all_row_col_ids_unique() {
    let grid = make_grid(10, 8);
    let row_ids: Vec<RowId> = (0..10).map(|i| grid.row_id(i).unwrap()).collect();
    let col_ids: Vec<ColId> = (0..8).map(|i| grid.col_id(i).unwrap()).collect();

    let unique_rows: HashSet<u128> = row_ids.iter().map(|r| r.as_u128()).collect();
    assert_eq!(unique_rows.len(), 10, "all RowIds should be unique");

    let unique_cols: HashSet<u128> = col_ids.iter().map(|c| c.as_u128()).collect();
    assert_eq!(unique_cols.len(), 8, "all ColIds should be unique");
}

#[test]
fn new_grid_bidirectional_invariant() {
    let grid = make_grid(4, 6);
    assert_invariants(&grid);
}

#[test]
fn compact_axis_grid_resolves_position_and_id_without_dense_maps() {
    let sheet_id = SheetId::from_raw(0x500);
    let row_run = AxisIdentityRun::new(
        AxisRunId::from_raw(7),
        AxisIdentitySeed::from_raw(0x71),
        10,
        4,
    );
    let col_run = AxisIdentityRun::new(
        AxisRunId::from_raw(8),
        AxisIdentitySeed::from_raw(0x82),
        20,
        3,
    );
    let grid = GridIndex::from_axis_stores(
        sheet_id,
        AxisIdentityStore::<RowId>::from_runs([row_run]),
        AxisIdentityStore::<ColId>::from_runs([col_run]),
        Arc::new(IdAllocator::new()),
    );

    assert_eq!(grid.row_ids_dense(), &[]);
    assert_eq!(grid.col_ids_dense(), &[]);
    assert_eq!(
        grid.row_ids_ordered(),
        (0..4)
            .map(|position| grid.row_id(position).unwrap())
            .collect::<Vec<_>>()
    );
    assert_eq!(
        grid.col_ids_ordered(),
        (0..3)
            .map(|position| grid.col_id(position).unwrap())
            .collect::<Vec<_>>()
    );
    assert_eq!(grid.row_count(), 4);
    assert_eq!(grid.col_count(), 3);

    let row = grid.row_id(2).expect("compact row id at position");
    let col = grid.col_id(1).expect("compact col id at position");
    assert!(row.is_compact_axis_identity());
    assert!(col.is_compact_axis_identity());
    assert_eq!(grid.row_index(&row), Some(2));
    assert_eq!(grid.col_index(&col), Some(1));
    assert_eq!(
        grid.row_index_from_hex(&crate::hex::id_to_hex(row.as_u128())),
        Some(2)
    );
    assert_eq!(
        grid.col_index_from_hex(&crate::hex::id_to_hex(col.as_u128())),
        Some(1)
    );
}

#[test]
fn legacy_yrs_arrays_hydrate_dense_axis_behavior() {
    let row_ids = [RowId::from_raw(0x101), RowId::from_raw(0x102)];
    let col_ids = [
        ColId::from_raw(0x201),
        ColId::from_raw(0x202),
        ColId::from_raw(0x203),
    ];
    let row_hexes: Vec<String> = row_ids
        .iter()
        .map(|id| crate::hex::id_to_hex(id.as_u128()).to_string())
        .collect();
    let col_hexes: Vec<String> = col_ids
        .iter()
        .map(|id| crate::hex::id_to_hex(id.as_u128()).to_string())
        .collect();

    let grid = GridIndex::from_yrs_arrays(
        SheetId::from_raw(0x600),
        &row_hexes,
        &col_hexes,
        Arc::new(IdAllocator::new()),
    );

    assert_eq!(grid.row_ids_dense(), row_ids);
    assert_eq!(grid.col_ids_dense(), col_ids);
    assert_eq!(grid.row_id(1), Some(row_ids[1]));
    assert_eq!(grid.col_id(2), Some(col_ids[2]));
    assert_eq!(grid.row_index(&row_ids[0]), Some(0));
    assert_eq!(grid.col_index(&col_ids[1]), Some(1));
    assert_eq!(grid.row_index_from_hex(&row_hexes[1]), Some(1));
    assert_eq!(grid.col_index_from_hex(&col_hexes[2]), Some(2));
}

#[test]
fn row_id_out_of_bounds_returns_none() {
    let grid = make_grid(3, 3);
    assert_eq!(grid.row_id(3), None);
    assert_eq!(grid.col_id(3), None);
}
