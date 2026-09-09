use crate::storage::sheet::{dimensions, grouping};
use value_types::{CellValue, FiniteF64};

use super::*;

#[test]
fn test_find_data_edge_traverses_collapsed_outline_columns_from_hidden_detail() {
    let (mut storage, sid, mut grid) = storage_with_grid();
    let group = grouping::group_columns(&mut storage, &sid, 15, 26).expect("group columns");
    grouping::set_group_collapsed(&mut storage, &sid, &group.id, true);
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

    let target = find_data_edge(&storage, sid, &grid, 6, 15, "right");

    assert_eq!(target.row, 6);
    assert_eq!(target.col, 27);
}

#[test]
fn test_find_data_edge_traverses_collapsed_outline_columns_from_visible_boundary() {
    let (mut storage, sid, mut grid) = storage_with_grid();
    let group = grouping::group_columns(&mut storage, &sid, 15, 26).expect("group columns");
    grouping::set_group_collapsed(&mut storage, &sid, &group.id, true);
    seed_cell(
        &storage,
        sid,
        &mut grid,
        20,
        27,
        CellValue::Number(FiniteF64::must(6_732.0)),
    );

    let target = find_data_edge(&storage, sid, &grid, 20, 14, "right");

    assert_eq!(target.row, 20);
    assert_eq!(target.col, 27);
}

#[test]
fn test_find_data_edge_traverses_collapsed_outline_columns_from_empty_block_lead_in() {
    let (mut storage, sid, mut grid) = storage_with_grid();
    let group = grouping::group_columns(&mut storage, &sid, 15, 26).expect("group columns");
    grouping::set_group_collapsed(&mut storage, &sid, &group.id, true);
    seed_cell(
        &storage,
        sid,
        &mut grid,
        6,
        12,
        CellValue::Number(FiniteF64::must(505_000.0)),
    );
    seed_cell(
        &storage,
        sid,
        &mut grid,
        6,
        13,
        CellValue::Number(FiniteF64::must(600_000.0)),
    );
    seed_cell(
        &storage,
        sid,
        &mut grid,
        6,
        27,
        CellValue::Number(FiniteF64::must(100_536.0)),
    );

    let target = find_data_edge(&storage, sid, &grid, 6, 11, "right");

    assert_eq!(target.row, 6);
    assert_eq!(target.col, 27);
}

#[test]
fn test_find_data_edge_does_not_traverse_collapsed_outline_from_distant_empty_cell() {
    let (mut storage, sid, mut grid) = storage_with_grid();
    let group = grouping::group_columns(&mut storage, &sid, 15, 26).expect("group columns");
    grouping::set_group_collapsed(&mut storage, &sid, &group.id, true);
    seed_cell(
        &storage,
        sid,
        &mut grid,
        6,
        12,
        CellValue::Number(FiniteF64::must(505_000.0)),
    );
    seed_cell(
        &storage,
        sid,
        &mut grid,
        6,
        27,
        CellValue::Number(FiniteF64::must(100_536.0)),
    );

    let target = find_data_edge(&storage, sid, &grid, 6, 10, "right");

    assert_eq!(target.row, 6);
    assert_eq!(target.col, 12);
}

#[test]
fn test_find_data_edge_returns_visible_boundary_before_collapsed_outline_columns() {
    let (mut storage, sid, mut grid) = storage_with_grid();
    let group = grouping::group_columns(&mut storage, &sid, 15, 26).expect("group columns");
    grouping::set_group_collapsed(&mut storage, &sid, &group.id, true);
    seed_cell(
        &storage,
        sid,
        &mut grid,
        6,
        27,
        CellValue::Number(FiniteF64::must(100_536.0)),
    );

    let target = find_data_edge(&storage, sid, &grid, 6, 27, "left");

    assert_eq!(target.row, 6);
    assert_eq!(target.col, 14);
}

#[test]
fn test_find_data_edge_skips_hidden_columns_to_next_visible_cell() {
    let (mut storage, sid, mut grid) = storage_with_grid();
    dimensions::hide_columns(&mut storage, &sid, &[15], Some(&grid));
    seed_cell(
        &storage,
        sid,
        &mut grid,
        6,
        16,
        CellValue::Number(FiniteF64::must(100.0)),
    );

    let target = find_data_edge(&storage, sid, &grid, 6, 14, "right");

    assert_eq!(target.row, 6);
    assert_eq!(target.col, 16);
}

#[test]
fn test_find_data_edge_traverses_collapsed_outline_rows_from_hidden_detail() {
    let (mut storage, sid, mut grid) = storage_with_grid();
    let group = grouping::group_rows(&mut storage, &sid, 23, 31).expect("group rows");
    grouping::set_group_collapsed(&mut storage, &sid, &group.id, true);
    seed_cell(
        &storage,
        sid,
        &mut grid,
        23,
        5,
        CellValue::Number(FiniteF64::must(1.0)),
    );
    seed_cell(
        &storage,
        sid,
        &mut grid,
        32,
        5,
        CellValue::Number(FiniteF64::must(2.0)),
    );

    let target = find_data_edge(&storage, sid, &grid, 23, 5, "down");

    assert_eq!(target.row, 32);
    assert_eq!(target.col, 5);
}

#[test]
fn test_find_data_edge_ignores_hidden_row_for_horizontal_navigation() {
    let (mut storage, sid, mut grid) = storage_with_grid();
    let group = grouping::group_rows(&mut storage, &sid, 23, 31).expect("group rows");
    grouping::set_group_collapsed(&mut storage, &sid, &group.id, true);
    for col in 50..=53 {
        seed_cell(
            &storage,
            sid,
            &mut grid,
            24,
            col,
            CellValue::Number(FiniteF64::must(col as f64)),
        );
    }

    let left = find_data_edge(&storage, sid, &grid, 24, 52, "left");
    let right = find_data_edge(&storage, sid, &grid, 24, 52, "right");

    assert_eq!(left.row, 24);
    assert_eq!(left.col, 50);
    assert_eq!(right.row, 24);
    assert_eq!(right.col, 53);
}

#[test]
fn test_find_data_edge_uses_native_occupancy_without_registered_identities() {
    let (storage, sid, mut grid) = storage_with_grid();
    seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
    );

    let target = super::super::find_data_edge(&storage, sid, &grid, 0, 9, "left", |row, col| {
        row == 0 && (6..=9).contains(&col)
    });

    assert_eq!(target.row, 0);
    assert_eq!(target.col, 6);
}
