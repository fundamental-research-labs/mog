use std::sync::Arc;

use super::*;
use crate::cells::{CellEntry, CellStore};
use crate::storage::WorkbookStorage;
use crate::storage::sheet::{dimensions, filters};
use cell_types::{CellId, IdAllocator, RangePos, SheetId, SheetPos};
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
/// sheet's RowIds/ColIds. Returns `(storage, sheet_id, grid, cell_store)`.
fn storage_with_grid() -> (WorkbookStorage, SheetId, GridIndex, CellStore) {
    let mut storage = WorkbookStorage::new();
    let mut cell_store = crate::cells::CellStore::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut cell_store, sheet_id, "Sheet1", 100, 100)
        .expect("add_sheet should succeed");

    let grid = GridIndex::new(sheet_id, 100, 100, Arc::new(IdAllocator::new()));
    cell_store.install_sheet_axes(sheet_id, grid.row_axis(), grid.col_axis());

    (storage, sheet_id, grid, cell_store)
}

/// Allocate an identity and write its native value.
fn seed_cell(
    sheet_id: SheetId,
    cell_store: &mut CellStore,
    row: u32,
    col: u32,
    value: CellValue,
) -> CellId {
    let id = cell_store
        .ensure_identity_at(&sheet_id, SheetPos::new(row, col))
        .unwrap();
    cell_store.insert_cell(&sheet_id, id, SheetPos::new(row, col), CellEntry { value });
    id
}

fn find_data_edge(
    storage: &WorkbookStorage,
    sheet_id: SheetId,
    grid: &GridIndex,
    cell_store: &CellStore,
    row: u32,
    col: u32,
    direction: &str,
) -> snapshot_types::queries::CellPosition {
    super::find_data_edge(
        storage,
        sheet_id,
        grid,
        cell_store,
        row,
        col,
        direction,
        |r, c| {
            cell_store
                .get_sheet(&sheet_id)
                .and_then(|s| s.value_at(SheetPos::new(r, c)))
                .is_some_and(|v| !v.is_null())
        },
    )
}

fn seeded_filter_navigation_sheet() -> (WorkbookStorage, SheetId, GridIndex, CellStore, String) {
    let (mut storage, sid, grid, mut cell_store) = storage_with_grid();

    let header_start = cell_store
        .ensure_identity_at(&sid, SheetPos::new(0, 0))
        .unwrap();
    let header_filter_col = cell_store
        .ensure_identity_at(&sid, SheetPos::new(0, 1))
        .unwrap();
    let header_end = cell_store
        .ensure_identity_at(&sid, SheetPos::new(0, 3))
        .unwrap();
    let data_end = cell_store
        .ensure_identity_at(&sid, SheetPos::new(11, 3))
        .unwrap();

    seed_cell(
        sid,
        &mut cell_store,
        0,
        0,
        CellValue::Text(Arc::from("Account")),
    );
    seed_cell(
        sid,
        &mut cell_store,
        0,
        1,
        CellValue::Text(Arc::from("Amount")),
    );
    seed_cell(
        sid,
        &mut cell_store,
        0,
        3,
        CellValue::Text(Arc::from("Vendor")),
    );

    for row in 1..=11u32 {
        seed_cell(
            sid,
            &mut cell_store,
            row,
            1,
            CellValue::Number(FiniteF64::must(row as f64)),
        );
        seed_cell(
            sid,
            &mut cell_store,
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

    (storage, sid, grid, cell_store, filter.id)
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
    let (_storage, sid, _grid, mut cell_store) = storage_with_grid();
    let id1 = cell_store
        .ensure_identity_at(&sid, SheetPos::new(0, 0))
        .unwrap();
    assert_ne!(id1.as_u128(), 0);
    assert_eq!(
        cell_store.resolve_cell_id(&sid, SheetPos::new(0, 0)),
        Some(id1)
    );
}

#[test]
fn test_get_or_create_cell_id_returns_existing() {
    let (_storage, sid, _grid, mut cell_store) = storage_with_grid();
    let id1 = cell_store
        .ensure_identity_at(&sid, SheetPos::new(0, 0))
        .unwrap();
    let id2 = cell_store
        .ensure_identity_at(&sid, SheetPos::new(0, 0))
        .unwrap();
    assert_eq!(id1, id2);
}

#[test]
fn test_get_or_create_different_positions() {
    let (_storage, sid, _grid, mut cell_store) = storage_with_grid();
    let id1 = cell_store
        .ensure_identity_at(&sid, SheetPos::new(0, 0))
        .unwrap();
    let id2 = cell_store
        .ensure_identity_at(&sid, SheetPos::new(0, 1))
        .unwrap();
    assert_ne!(id1, id2);
}

// -------------------------------------------------------------------
// Sparse cell identity lookups
// -------------------------------------------------------------------

#[test]
fn test_store_cell_id_at_found() {
    let (_storage, sid, _grid, mut cell_store) = storage_with_grid();
    let created_id = cell_store
        .ensure_identity_at(&sid, SheetPos::new(3, 5))
        .unwrap();
    assert_eq!(
        cell_store.resolve_cell_id(&sid, SheetPos::new(3, 5)),
        Some(created_id)
    );
}

#[test]
fn test_store_cell_id_at_not_found() {
    let (_storage, sid, _grid, cell_store) = storage_with_grid();
    assert!(
        cell_store
            .resolve_cell_id(&sid, SheetPos::new(99, 25))
            .is_none()
    );
}

#[test]
fn test_store_cells_in_range_empty() {
    let (_storage, sid, _grid, cell_store) = storage_with_grid();
    let cells: Vec<_> = cell_store.cells_in_range(&sid, 0, 0, 5, 5).collect();
    assert!(cells.is_empty());
}

#[test]
fn test_store_cells_in_range_finds_cells() {
    let (_storage, sid, _grid, mut cell_store) = storage_with_grid();
    let id1 = seed_cell(
        sid,
        &mut cell_store,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
    );
    let id2 = seed_cell(
        sid,
        &mut cell_store,
        1,
        1,
        CellValue::Number(FiniteF64::must(2.0)),
    );
    let _id3 = seed_cell(
        sid,
        &mut cell_store,
        5,
        5,
        CellValue::Number(FiniteF64::must(3.0)),
    );

    let cells: Vec<_> = cell_store
        .cells_in_range(&sid, 0, 0, 2, 2)
        .map(|(c, _, _)| c)
        .collect();
    assert_eq!(cells.len(), 2);
    assert!(cells.contains(&id1));
    assert!(cells.contains(&id2));
}

#[test]
fn test_store_cells_in_range_single_cell() {
    let (_storage, sid, _grid, mut cell_store) = storage_with_grid();
    let id1 = seed_cell(
        sid,
        &mut cell_store,
        2,
        3,
        CellValue::Number(FiniteF64::must(1.0)),
    );

    let cells: Vec<_> = cell_store
        .cells_in_range(&sid, 2, 3, 2, 3)
        .map(|(c, _, _)| c)
        .collect();
    assert_eq!(cells.len(), 1);
    assert_eq!(cells[0], id1);
}

// -------------------------------------------------------------------
// Identity: update_cell_position
// -------------------------------------------------------------------

#[test]
fn test_update_cell_position() {
    let (_storage, sid, _grid, mut cell_store) = storage_with_grid();
    let id1 = cell_store
        .ensure_identity_at(&sid, SheetPos::new(0, 0))
        .unwrap();

    assert!(cell_store.move_cell(&id1, &sid, SheetPos::new(5, 5)));

    assert!(
        cell_store
            .resolve_cell_id(&sid, SheetPos::new(0, 0))
            .is_none()
    );
    assert_eq!(
        cell_store.resolve_cell_id(&sid, SheetPos::new(5, 5)),
        Some(id1)
    );
}

// -------------------------------------------------------------------
// clear_cells_by_hex: works on XLSX-hydrated sheets
// -------------------------------------------------------------------

#[test]
fn clear_preserves_or_removes_properties_as_requested() {
    let (mut storage, sid, _grid, mut cell_store) = storage_with_grid();
    let cid = cell_store
        .ensure_identity_at(&sid, SheetPos::new(0, 0))
        .unwrap();
    set_cell_property(&mut storage, sid, cid, "{\"s\":1}");
    let hex = id_to_hex(cid.as_u128()).to_string();
    clear_cells_by_hex(&mut storage, sid, &[hex.clone()], false);
    assert!(cell_property_exists(&storage, sid, cid));
    clear_cells_by_hex(&mut storage, sid, &[hex], true);
    assert!(!cell_property_exists(&storage, sid, cid));
    assert_eq!(
        cell_store.resolve_cell_id(&sid, SheetPos::new(0, 0)),
        Some(cid)
    );
}

// -------------------------------------------------------------------
// clear_range_and_return_ids: fully deletes
// -------------------------------------------------------------------

#[test]
fn test_clear_range_and_return_ids_basic() {
    let (mut storage, sid, _grid, mut cell_store) = storage_with_grid();
    let id1 = seed_cell(
        sid,
        &mut cell_store,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
    );
    let id2 = seed_cell(
        sid,
        &mut cell_store,
        0,
        1,
        CellValue::Number(FiniteF64::must(2.0)),
    );

    let range = RangePos::new(sid, 0, 0, 0, 1);
    let cleared = clear_range_and_return_ids(&mut storage, sid, &cell_store, &range, None);
    for id in &cleared {
        cell_store.remove_cell(id);
    }

    assert_eq!(cleared.len(), 2);
    assert!(cleared.contains(&id1));
    assert!(cleared.contains(&id2));

    assert!(
        cell_store
            .resolve_cell_id(&sid, SheetPos::new(0, 0))
            .is_none()
    );
    assert!(
        cell_store
            .resolve_cell_id(&sid, SheetPos::new(0, 1))
            .is_none()
    );
}

#[test]
fn test_clear_range_and_return_ids_empty() {
    let (mut storage, sid, _grid, mut cell_store) = storage_with_grid();
    let range = RangePos::new(sid, 0, 0, 5, 5);
    let cleared = clear_range_and_return_ids(&mut storage, sid, &cell_store, &range, None);
    for id in &cleared {
        cell_store.remove_cell(id);
    }
    assert!(cleared.is_empty());
}

#[test]
fn test_clear_range_and_return_ids_skips_excluded_cells() {
    let (mut storage, sid, _grid, mut cell_store) = storage_with_grid();
    let id1 = seed_cell(
        sid,
        &mut cell_store,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
    );
    let id2 = seed_cell(
        sid,
        &mut cell_store,
        0,
        1,
        CellValue::Number(FiniteF64::must(2.0)),
    );
    set_cell_property(&mut storage, sid, id1, "{\"s\":1}");
    set_cell_property(&mut storage, sid, id2, "{\"s\":2}");

    let range = RangePos::new(sid, 0, 0, 0, 1);
    let exclude = std::collections::HashSet::from([id1]);
    let cleared =
        clear_range_and_return_ids(&mut storage, sid, &cell_store, &range, Some(&exclude));
    for id in &cleared {
        cell_store.remove_cell(id);
    }

    assert_eq!(cleared, vec![id2]);
    assert_eq!(
        cell_store.resolve_cell_id(&sid, SheetPos::new(0, 0)),
        Some(id1)
    );
    assert!(
        cell_store
            .resolve_cell_id(&sid, SheetPos::new(0, 1))
            .is_none()
    );
    assert!(cell_property_exists(&storage, sid, id1));
    assert!(!cell_property_exists(&storage, sid, id2));
}

// -------------------------------------------------------------------
// find_data_edge: filter-owned visibility
// -------------------------------------------------------------------

#[test]
fn test_find_data_edge_skips_filter_only_hidden_rows_inside_filter_body() {
    let (storage, sid, grid, cell_store, _) = seeded_filter_navigation_sheet();

    let target = find_data_edge(&storage, sid, &grid, &cell_store, 1, 1, "down");

    assert_eq!(target.row, 11);
    assert_eq!(target.col, 1);
}

#[test]
fn test_find_data_edge_treats_manual_plus_filter_hidden_row_as_boundary() {
    let (mut storage, sid, grid, cell_store, _) = seeded_filter_navigation_sheet();
    dimensions::hide_manual_rows(&mut storage, &sid, &[2], Some(&grid));

    let target = find_data_edge(&storage, sid, &grid, &cell_store, 1, 1, "down");

    assert_eq!(target.row, 1);
    assert_eq!(target.col, 1);
}

#[test]
fn test_find_data_edge_returns_last_visible_before_skipped_run_boundary() {
    let (mut storage, sid, grid, cell_store, _) = seeded_filter_navigation_sheet();
    dimensions::hide_manual_rows(&mut storage, &sid, &[3], Some(&grid));

    let target = find_data_edge(&storage, sid, &grid, &cell_store, 1, 1, "down");

    assert_eq!(target.row, 1);
    assert_eq!(target.col, 1);
}

#[test]
fn test_find_data_edge_treats_filter_hidden_row_outside_filter_columns_as_boundary() {
    let (storage, sid, grid, cell_store, _) = seeded_filter_navigation_sheet();

    let target = find_data_edge(&storage, sid, &grid, &cell_store, 1, 4, "down");

    assert_eq!(target.row, 1);
    assert_eq!(target.col, 4);
}

#[test]
fn test_find_data_edge_treats_filter_hidden_row_from_header_start_as_boundary() {
    let (storage, sid, grid, cell_store, _) = seeded_filter_navigation_sheet();

    let target = find_data_edge(&storage, sid, &grid, &cell_store, 0, 1, "down");

    assert_eq!(target.row, 1);
    assert_eq!(target.col, 1);
}

// -------------------------------------------------------------------
// relocate_cells: same sheet
// -------------------------------------------------------------------

#[test]
fn test_relocate_cells_same_sheet() {
    let (mut storage, sid, _grid, mut cell_store) = storage_with_grid();
    let id1 = seed_cell(
        sid,
        &mut cell_store,
        0,
        0,
        CellValue::Number(FiniteF64::must(10.0)),
    );
    let id2 = seed_cell(
        sid,
        &mut cell_store,
        0,
        1,
        CellValue::Number(FiniteF64::must(20.0)),
    );

    let source = RangePos::new(sid, 0, 0, 0, 1);
    let result = relocate_cells(&mut storage, sid, &source, sid, 5, 5, &cell_store);
    for id in &result.target_cells_cleared {
        cell_store.remove_cell(id);
    }
    let moves: Vec<_> = result
        .moved_cell_ids
        .iter()
        .map(|id| {
            let pos = cell_store.resolve_position(id).unwrap();
            (*id, sid, SheetPos::new(pos.row() + 5, pos.col() + 5))
        })
        .collect();
    cell_store.move_cells(&moves);

    assert!(result.success);
    assert_eq!(result.moved_cell_ids.len(), 2);
    assert!(result.moved_cell_ids.contains(&id1));
    assert!(result.moved_cell_ids.contains(&id2));

    assert_eq!(
        cell_store.resolve_cell_id(&sid, SheetPos::new(5, 5)),
        Some(id1)
    );
    assert_eq!(
        cell_store.resolve_cell_id(&sid, SheetPos::new(5, 6)),
        Some(id2)
    );
    assert!(
        cell_store
            .resolve_cell_id(&sid, SheetPos::new(0, 0))
            .is_none()
    );
    assert!(
        cell_store
            .resolve_cell_id(&sid, SheetPos::new(0, 1))
            .is_none()
    );
}

#[test]
fn test_relocate_cells_same_sheet_overlap_preserves_moving_ids() {
    let (mut storage, sid, _grid, mut cell_store) = storage_with_grid();
    let id1 = seed_cell(
        sid,
        &mut cell_store,
        0,
        0,
        CellValue::Number(FiniteF64::must(10.0)),
    );
    let id2 = seed_cell(
        sid,
        &mut cell_store,
        0,
        1,
        CellValue::Number(FiniteF64::must(20.0)),
    );
    let target_only = seed_cell(
        sid,
        &mut cell_store,
        0,
        2,
        CellValue::Number(FiniteF64::must(30.0)),
    );

    let source = RangePos::new(sid, 0, 0, 0, 1);
    let result = relocate_cells(&mut storage, sid, &source, sid, 0, 1, &cell_store);
    for id in &result.target_cells_cleared {
        cell_store.remove_cell(id);
    }
    let moves: Vec<_> = result
        .moved_cell_ids
        .iter()
        .map(|id| {
            let pos = cell_store.resolve_position(id).unwrap();
            (*id, sid, SheetPos::new(pos.row() + 0, pos.col() + 1))
        })
        .collect();
    cell_store.move_cells(&moves);

    assert!(result.success);
    let mut vacated = result.source_positions_vacated.clone();
    vacated.sort_unstable();
    assert_eq!(vacated, vec![(0, 0), (0, 1)]);
    assert_eq!(result.target_cells_cleared, vec![target_only]);
    assert_eq!(
        cell_store.resolve_cell_id(&sid, SheetPos::new(0, 1)),
        Some(id1)
    );
    assert_eq!(
        cell_store.resolve_cell_id(&sid, SheetPos::new(0, 2)),
        Some(id2)
    );
    assert!(
        cell_store
            .resolve_cell_id(&sid, SheetPos::new(0, 0))
            .is_none()
    );
}

#[test]
fn test_relocate_cells_empty_source() {
    let (mut storage, sid, _grid, mut cell_store) = storage_with_grid();
    let source = RangePos::new(sid, 0, 0, 0, 0);
    let result = relocate_cells(&mut storage, sid, &source, sid, 5, 5, &cell_store);
    for id in &result.target_cells_cleared {
        cell_store.remove_cell(id);
    }
    let moves: Vec<_> = result
        .moved_cell_ids
        .iter()
        .map(|id| {
            let pos = cell_store.resolve_position(id).unwrap();
            (*id, sid, SheetPos::new(pos.row() + 5, pos.col() + 5))
        })
        .collect();
    cell_store.move_cells(&moves);
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
