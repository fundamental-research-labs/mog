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
fn test_find_data_edge_traverses_collapsed_outline_columns_from_empty_block_lead_in() {
    let (storage, sid, mut grid) = storage_with_grid();
    let group = grouping::group_columns(storage.doc(), &storage.sheets_ref(), &sid, 15, 26)
        .expect("group columns");
    grouping::set_group_collapsed(storage.doc(), &storage.sheets_ref(), &sid, &group.id, true);
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

    let target = find_data_edge(storage.doc(), storage.sheets(), sid, &grid, 6, 11, "right");

    assert_eq!(target.row, 6);
    assert_eq!(target.col, 27);
}

#[test]
fn test_find_data_edge_does_not_traverse_collapsed_outline_from_distant_empty_cell() {
    let (storage, sid, mut grid) = storage_with_grid();
    let group = grouping::group_columns(storage.doc(), &storage.sheets_ref(), &sid, 15, 26)
        .expect("group columns");
    grouping::set_group_collapsed(storage.doc(), &storage.sheets_ref(), &sid, &group.id, true);
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

    let target = find_data_edge(storage.doc(), storage.sheets(), sid, &grid, 6, 10, "right");

    assert_eq!(target.row, 6);
    assert_eq!(target.col, 12);
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

#[test]
fn test_find_data_edge_treats_formula_only_cells_as_contiguous_data() {
    let (storage, sid, mut grid) = storage_with_grid();
    seed_cell_with_formula(&storage, sid, &mut grid, 0, 6, CellValue::Null, "=1");
    seed_cell_with_formula(&storage, sid, &mut grid, 0, 7, CellValue::Null, "=2");
    seed_cell_with_formula(&storage, sid, &mut grid, 0, 8, CellValue::Null, "=3");
    seed_cell_with_formula(&storage, sid, &mut grid, 0, 9, CellValue::Null, "=4");

    let target = find_data_edge(storage.doc(), storage.sheets(), sid, &grid, 0, 9, "left");

    assert_eq!(target.row, 0);
    assert_eq!(target.col, 6);
}

#[test]
fn test_find_data_edge_uses_extra_data_for_mirror_only_formula_runs() {
    let (storage, sid, mut grid) = storage_with_grid();
    seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
    );

    let target = find_data_edge_with_extra_data(
        storage.doc(),
        storage.sheets(),
        sid,
        &grid,
        0,
        9,
        "left",
        |row, col| row == 0 && (6..=9).contains(&col),
    );

    assert_eq!(target.row, 0);
    assert_eq!(target.col, 6);
}
