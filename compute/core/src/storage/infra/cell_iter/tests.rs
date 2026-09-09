use std::sync::Arc;

use super::*;
use crate::storage::WorkbookStorage;
use crate::storage::sheet::{dimensions, filters};
use cell_types::{CellId, IdAllocator, RangePos, SheetId};
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use value_types::{CellValue, FiniteF64};

mod navigation_outline;
mod region;

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

/// Create a storage with one sheet plus a GridIndex seeded with the
/// sheet's RowIds/ColIds. Returns `(storage, sheet_id, grid)`.
fn storage_with_grid() -> (WorkbookStorage, SheetId, GridIndex) {
    let mut storage = WorkbookStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");

    let grid = GridIndex::new(sheet_id, 100, 26, Arc::new(IdAllocator::new()));

    (storage, sheet_id, grid)
}

/// Seed a cell at `(row, col)` by registering a CellId in `grid` and
/// writing a native cell value.
fn seed_cell(
    storage: &WorkbookStorage,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    row: u32,
    col: u32,
    value: CellValue,
) -> CellId {
    let _ = (storage, sheet_id, value);
    grid.ensure_cell_id(row, col)
}

fn find_data_edge(
    storage: &WorkbookStorage,
    sheet_id: SheetId,
    grid: &GridIndex,
    row: u32,
    col: u32,
    direction: &str,
) -> snapshot_types::queries::CellPosition {
    super::find_data_edge(storage, sheet_id, grid, row, col, direction, |r, c| {
        grid.cell_id_at(r, c).is_some()
    })
}

fn seeded_filter_navigation_sheet() -> (WorkbookStorage, SheetId, GridIndex, String) {
    let (mut storage, sid, mut grid) = storage_with_grid();

    let header_start = grid.ensure_cell_id(0, 0);
    let header_filter_col = grid.ensure_cell_id(0, 1);
    let header_end = grid.ensure_cell_id(0, 3);
    let data_end = grid.ensure_cell_id(11, 3);

    seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        0,
        CellValue::Text(Arc::from("Account")),
    );
    seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        1,
        CellValue::Text(Arc::from("Amount")),
    );
    seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        3,
        CellValue::Text(Arc::from("Vendor")),
    );

    for row in 1..=11u32 {
        seed_cell(
            &storage,
            sid,
            &mut grid,
            row,
            1,
            CellValue::Number(FiniteF64::must(row as f64)),
        );
        seed_cell(
            &storage,
            sid,
            &mut grid,
            row,
            4,
            CellValue::Number(FiniteF64::must(row as f64)),
        );
    }

    let filter_id_alloc = IdAllocator::new();
    let filter = filters::create_filter(
        &mut storage,
        &sid,
        &id_to_hex(header_start.as_u128()),
        &id_to_hex(header_end.as_u128()),
        &id_to_hex(data_end.as_u128()),
        filters::FilterKind::AutoFilter,
        None,
        &filter_id_alloc,
    )
    .expect("create filter");
    filters::set_column_filter(
        &mut storage,
        &sid,
        &filter.id,
        &id_to_hex(header_filter_col.as_u128()),
        filters::ColumnFilter::Values {
            values: vec![serde_json::json!("KeepCo")],
            include_blanks: false,
        },
    );
    dimensions::set_filter_hidden_rows(
        &mut storage,
        &sid,
        &filter.id,
        &[2, 4, 6, 8, 10],
        &[],
        Some(&grid),
    );

    (storage, sid, grid, filter.id)
}

fn set_cell_property(
    storage: &mut WorkbookStorage,
    sheet_id: SheetId,
    cell_id: CellId,
    json: &str,
) {
    let props = serde_json::from_str(json).unwrap();
    crate::storage::properties::set_properties(
        storage,
        &sheet_id,
        &id_to_hex(cell_id.as_u128()),
        &props,
    );
}

fn cell_property_exists(storage: &WorkbookStorage, sheet_id: SheetId, cell_id: CellId) -> bool {
    crate::storage::properties::get_properties(storage, &sheet_id, &id_to_hex(cell_id.as_u128()))
        .is_some()
}

// -------------------------------------------------------------------
// Identity: get_or_create_cell_id
// -------------------------------------------------------------------

#[test]
fn test_get_or_create_cell_id_creates_new() {
    let (storage, sid, mut grid) = storage_with_grid();
    let id1 = grid.ensure_cell_id(0, 0);
    assert_ne!(id1.as_u128(), 0);
    assert_eq!(grid.cell_id_at(0, 0), Some(id1));
}

#[test]
fn test_get_or_create_cell_id_returns_existing() {
    let (storage, sid, mut grid) = storage_with_grid();
    let id1 = grid.ensure_cell_id(0, 0);
    let id2 = grid.ensure_cell_id(0, 0);
    assert_eq!(id1, id2);
}

#[test]
fn test_get_or_create_different_positions() {
    let (storage, sid, mut grid) = storage_with_grid();
    let id1 = grid.ensure_cell_id(0, 0);
    let id2 = grid.ensure_cell_id(0, 1);
    assert_ne!(id1, id2);
}

// -------------------------------------------------------------------
// Identity lookups (GridIndex pass-through)
// -------------------------------------------------------------------

#[test]
fn test_grid_cell_id_at_found() {
    let (storage, sid, mut grid) = storage_with_grid();
    let created_id = grid.ensure_cell_id(3, 5);
    assert_eq!(grid.cell_id_at(3, 5), Some(created_id));
}

#[test]
fn test_grid_cell_id_at_not_found() {
    let (_storage, _sid, grid) = storage_with_grid();
    assert!(grid.cell_id_at(99, 25).is_none());
}

#[test]
fn test_grid_cells_in_range_empty() {
    let (_storage, _sid, grid) = storage_with_grid();
    let cells: Vec<_> = grid.cells_in_range(0, 0, 5, 5).collect();
    assert!(cells.is_empty());
}

#[test]
fn test_grid_cells_in_range_finds_cells() {
    let (storage, sid, mut grid) = storage_with_grid();
    let id1 = seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
    );
    let id2 = seed_cell(
        &storage,
        sid,
        &mut grid,
        1,
        1,
        CellValue::Number(FiniteF64::must(2.0)),
    );
    let _id3 = seed_cell(
        &storage,
        sid,
        &mut grid,
        5,
        5,
        CellValue::Number(FiniteF64::must(3.0)),
    );

    let cells: Vec<_> = grid.cells_in_range(0, 0, 2, 2).map(|(c, _, _)| c).collect();
    assert_eq!(cells.len(), 2);
    assert!(cells.contains(&id1));
    assert!(cells.contains(&id2));
}

#[test]
fn test_grid_cells_in_range_single_cell() {
    let (storage, sid, mut grid) = storage_with_grid();
    let id1 = seed_cell(
        &storage,
        sid,
        &mut grid,
        2,
        3,
        CellValue::Number(FiniteF64::must(1.0)),
    );

    let cells: Vec<_> = grid.cells_in_range(2, 3, 2, 3).map(|(c, _, _)| c).collect();
    assert_eq!(cells.len(), 1);
    assert_eq!(cells[0], id1);
}

// -------------------------------------------------------------------
// Identity: update_cell_position
// -------------------------------------------------------------------

#[test]
fn test_update_cell_position() {
    let (storage, sid, mut grid) = storage_with_grid();
    let id1 = grid.ensure_cell_id(0, 0);

    grid.register_cell(id1, 5, 5);

    assert!(grid.cell_id_at(0, 0).is_none());
    assert_eq!(grid.cell_id_at(5, 5), Some(id1));
}

// -------------------------------------------------------------------
// clear_cells_by_hex: works on XLSX-hydrated sheets
// -------------------------------------------------------------------

#[test]
fn clear_preserves_or_removes_properties_as_requested() {
    let (mut storage, sid, mut grid) = storage_with_grid();
    let cid = grid.ensure_cell_id(0, 0);
    set_cell_property(&mut storage, sid, cid, "{\"s\":1}");
    let hex = id_to_hex(cid.as_u128()).to_string();
    clear_cells_by_hex(&mut storage, sid, &[hex.clone()], false);
    assert!(cell_property_exists(&storage, sid, cid));
    clear_cells_by_hex(&mut storage, sid, &[hex], true);
    assert!(!cell_property_exists(&storage, sid, cid));
    assert_eq!(grid.cell_id_at(0, 0), Some(cid));
}

// -------------------------------------------------------------------
// clear_range_and_return_ids: fully deletes
// -------------------------------------------------------------------

#[test]
fn test_clear_range_and_return_ids_basic() {
    let (mut storage, sid, mut grid) = storage_with_grid();
    let id1 = seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
    );
    let id2 = seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        1,
        CellValue::Number(FiniteF64::must(2.0)),
    );

    let range = RangePos::new(sid, 0, 0, 0, 1);
    let cleared = clear_range_and_return_ids(&mut storage, sid, &mut grid, &range, None);

    assert_eq!(cleared.len(), 2);
    assert!(cleared.contains(&id1));
    assert!(cleared.contains(&id2));

    assert!(grid.cell_id_at(0, 0).is_none());
    assert!(grid.cell_id_at(0, 1).is_none());
}

#[test]
fn test_clear_range_and_return_ids_empty() {
    let (mut storage, sid, mut grid) = storage_with_grid();
    let range = RangePos::new(sid, 0, 0, 5, 5);
    let cleared = clear_range_and_return_ids(&mut storage, sid, &mut grid, &range, None);
    assert!(cleared.is_empty());
}

#[test]
fn test_clear_range_and_return_ids_skips_excluded_cells() {
    let (mut storage, sid, mut grid) = storage_with_grid();
    let id1 = seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
    );
    let id2 = seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        1,
        CellValue::Number(FiniteF64::must(2.0)),
    );
    set_cell_property(&mut storage, sid, id1, "{\"s\":1}");
    set_cell_property(&mut storage, sid, id2, "{\"s\":2}");

    let range = RangePos::new(sid, 0, 0, 0, 1);
    let exclude = std::collections::HashSet::from([id1]);
    let cleared = clear_range_and_return_ids(&mut storage, sid, &mut grid, &range, Some(&exclude));

    assert_eq!(cleared, vec![id2]);
    assert_eq!(grid.cell_id_at(0, 0), Some(id1));
    assert!(grid.cell_id_at(0, 1).is_none());
    assert!(cell_property_exists(&storage, sid, id1));
    assert!(!cell_property_exists(&storage, sid, id2));
}

// -------------------------------------------------------------------
// find_data_edge: filter-owned visibility
// -------------------------------------------------------------------

#[test]
fn test_find_data_edge_skips_filter_only_hidden_rows_inside_filter_body() {
    let (storage, sid, grid, _) = seeded_filter_navigation_sheet();

    let target = find_data_edge(&storage, sid, &grid, 1, 1, "down");

    assert_eq!(target.row, 11);
    assert_eq!(target.col, 1);
}

#[test]
fn test_find_data_edge_treats_manual_plus_filter_hidden_row_as_boundary() {
    let (mut storage, sid, grid, _) = seeded_filter_navigation_sheet();
    dimensions::hide_manual_rows(&mut storage, &sid, &[2], Some(&grid));

    let target = find_data_edge(&storage, sid, &grid, 1, 1, "down");

    assert_eq!(target.row, 1);
    assert_eq!(target.col, 1);
}

#[test]
fn test_find_data_edge_returns_last_visible_before_skipped_run_boundary() {
    let (mut storage, sid, grid, _) = seeded_filter_navigation_sheet();
    dimensions::hide_manual_rows(&mut storage, &sid, &[3], Some(&grid));

    let target = find_data_edge(&storage, sid, &grid, 1, 1, "down");

    assert_eq!(target.row, 1);
    assert_eq!(target.col, 1);
}

#[test]
fn test_find_data_edge_treats_filter_hidden_row_outside_filter_columns_as_boundary() {
    let (storage, sid, grid, _) = seeded_filter_navigation_sheet();

    let target = find_data_edge(&storage, sid, &grid, 1, 4, "down");

    assert_eq!(target.row, 1);
    assert_eq!(target.col, 4);
}

#[test]
fn test_find_data_edge_treats_filter_hidden_row_from_header_start_as_boundary() {
    let (storage, sid, grid, _) = seeded_filter_navigation_sheet();

    let target = find_data_edge(&storage, sid, &grid, 0, 1, "down");

    assert_eq!(target.row, 1);
    assert_eq!(target.col, 1);
}

// -------------------------------------------------------------------
// relocate_cells: same sheet
// -------------------------------------------------------------------

#[test]
fn test_relocate_cells_same_sheet() {
    let (mut storage, sid, mut grid) = storage_with_grid();
    let id1 = seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        0,
        CellValue::Number(FiniteF64::must(10.0)),
    );
    let id2 = seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        1,
        CellValue::Number(FiniteF64::must(20.0)),
    );

    let source = RangePos::new(sid, 0, 0, 0, 1);
    let result = relocate_cells(&mut storage, sid, &source, sid, 5, 5, &mut grid, None);

    assert!(result.success);
    assert_eq!(result.moved_cell_ids.len(), 2);
    assert!(result.moved_cell_ids.contains(&id1));
    assert!(result.moved_cell_ids.contains(&id2));

    assert_eq!(grid.cell_id_at(5, 5), Some(id1));
    assert_eq!(grid.cell_id_at(5, 6), Some(id2));
    assert!(grid.cell_id_at(0, 0).is_none());
    assert!(grid.cell_id_at(0, 1).is_none());
}

#[test]
fn test_relocate_cells_same_sheet_overlap_preserves_moving_ids() {
    let (mut storage, sid, mut grid) = storage_with_grid();
    let id1 = seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        0,
        CellValue::Number(FiniteF64::must(10.0)),
    );
    let id2 = seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        1,
        CellValue::Number(FiniteF64::must(20.0)),
    );
    let target_only = seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        2,
        CellValue::Number(FiniteF64::must(30.0)),
    );

    let source = RangePos::new(sid, 0, 0, 0, 1);
    let result = relocate_cells(&mut storage, sid, &source, sid, 0, 1, &mut grid, None);

    assert!(result.success);
    assert_eq!(result.source_positions_vacated, vec![(0, 0), (0, 1)]);
    assert_eq!(result.target_cells_cleared, vec![target_only]);
    assert_eq!(grid.cell_id_at(0, 1), Some(id1));
    assert_eq!(grid.cell_id_at(0, 2), Some(id2));
    assert!(grid.cell_id_at(0, 0).is_none());
}

#[test]
fn test_relocate_cells_empty_source() {
    let (mut storage, sid, mut grid) = storage_with_grid();
    let source = RangePos::new(sid, 0, 0, 0, 0);
    let result = relocate_cells(&mut storage, sid, &source, sid, 5, 5, &mut grid, None);
    assert!(result.success);
    assert!(result.moved_cell_ids.is_empty());
}

// -------------------------------------------------------------------
// CellRange
// -------------------------------------------------------------------

#[test]
fn test_cell_range_new() {
    let sid = make_sheet_id(1);
    let range = RangePos::new(sid, 0, 0, 10, 5);
    assert_eq!(range.sheet(), sid);
    assert_eq!(range.start_row(), 0);
    assert_eq!(range.start_col(), 0);
    assert_eq!(range.end_row(), 10);
    assert_eq!(range.end_col(), 5);
}
