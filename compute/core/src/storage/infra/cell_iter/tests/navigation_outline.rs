use crate::storage::sheet::{dimensions, grouping};
use value_types::{CellValue, FiniteF64};

use super::*;

#[test]
fn test_find_data_edge_traverses_collapsed_outline_columns_from_hidden_detail() {
    let (storage, sid, mut grid) = storage_with_grid();
    let group = grouping::group_columns(storage.doc(), &storage.sheets_ref(), &sid, 15, 26)
        .expect("group columns");
    grouping::set_group_collapsed(storage.doc(), &storage.sheets_ref(), &sid, &group.id, true);
    seed_cell(
        &storage,
        sid,
        &mut grid,
        6,
        15,
        CellValue::Number(FiniteF64::must(128_319.0)),
    );
    seed_cell(
        &storage,
        sid,
        &mut grid,
        6,
        27,
        CellValue::Number(FiniteF64::must(100_536.0)),
    );

    let target = find_data_edge(storage.doc(), storage.sheets(), sid, &grid, 6, 15, "right");

    assert_eq!(target.row, 6);
    assert_eq!(target.col, 27);
}

#[test]
fn test_find_data_edge_traverses_collapsed_outline_columns_from_visible_boundary() {
    let (storage, sid, mut grid) = storage_with_grid();
    let group = grouping::group_columns(storage.doc(), &storage.sheets_ref(), &sid, 15, 26)
        .expect("group columns");
    grouping::set_group_collapsed(storage.doc(), &storage.sheets_ref(), &sid, &group.id, true);
    seed_cell(
        &storage,
        sid,
        &mut grid,
        20,
        27,
        CellValue::Number(FiniteF64::must(6_732.0)),
    );

    let target = find_data_edge(storage.doc(), storage.sheets(), sid, &grid, 20, 14, "right");

    assert_eq!(target.row, 20);
    assert_eq!(target.col, 27);
}

#[test]
fn test_find_data_edge_returns_visible_boundary_before_collapsed_outline_columns() {
    let (storage, sid, mut grid) = storage_with_grid();
    let group = grouping::group_columns(storage.doc(), &storage.sheets_ref(), &sid, 15, 26)
        .expect("group columns");
    grouping::set_group_collapsed(storage.doc(), &storage.sheets_ref(), &sid, &group.id, true);
    seed_cell(
        &storage,
        sid,
        &mut grid,
        6,
        27,
        CellValue::Number(FiniteF64::must(100_536.0)),
    );

    let target = find_data_edge(storage.doc(), storage.sheets(), sid, &grid, 6, 27, "left");

    assert_eq!(target.row, 6);
    assert_eq!(target.col, 14);
}

#[test]
fn test_find_data_edge_keeps_manual_hidden_columns_as_boundaries() {
    let (storage, sid, mut grid) = storage_with_grid();
    dimensions::hide_columns(storage.doc(), storage.sheets(), &sid, &[15]);
    seed_cell(
        &storage,
        sid,
        &mut grid,
        6,
        16,
        CellValue::Number(FiniteF64::must(100.0)),
    );

    let target = find_data_edge(storage.doc(), storage.sheets(), sid, &grid, 6, 14, "right");

    assert_eq!(target.row, 6);
    assert_eq!(target.col, 14);
}
