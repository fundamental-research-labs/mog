use std::sync::Arc;

use super::super::grid_helpers::{get_cells_map, get_properties_map};
use super::*;
use crate::storage::YrsStorage;
use crate::storage::sheet::{dimensions, filters};
use cell_types::{CellId, IdAllocator, RangePos, SheetId};
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::schema::{KEY_COL_ORDER, KEY_HIDDEN_ROWS, KEY_ROW_ORDER, KEY_VALUE};
use value_types::{CellValue, FiniteF64};
use yrs::{Any, Array, ArrayPrelim, Map, MapPrelim, Out, Transact};

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
fn storage_with_grid() -> (YrsStorage, SheetId, GridIndex) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");

    let alloc = &*crate::storage::STORAGE_ID_ALLOC;

    // Initialise rowOrder / colOrder YArrays and collect the hexes so
    // we can build a matching GridIndex.
    let (row_hexes, col_hexes) = {
        let mut row_hexes = Vec::new();
        let mut col_hexes = Vec::new();
        let mut txn = storage.doc().transact_mut();
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        if let Some(Out::YMap(sheet_map)) = storage.sheets_ref().get(&txn, &*sheet_hex) {
            let row_arr = sheet_map.insert(&mut txn, KEY_ROW_ORDER, ArrayPrelim::default());
            for _ in 0..100u32 {
                let rid = alloc.next_row_id();
                let hex = id_to_hex(rid.as_u128());
                row_arr.push_back(&mut txn, Any::String(Arc::from(hex.as_str())));
                row_hexes.push(hex.to_string());
            }
            let col_arr = sheet_map.insert(&mut txn, KEY_COL_ORDER, ArrayPrelim::default());
            for _ in 0..26u32 {
                let cid = alloc.next_col_id();
                let hex = id_to_hex(cid.as_u128());
                col_arr.push_back(&mut txn, Any::String(Arc::from(hex.as_str())));
                col_hexes.push(hex.to_string());
            }
        }
        (row_hexes, col_hexes)
    };

    // Build a fresh Arc<IdAllocator> for the grid — the storage-level
    // static allocator is not directly shareable.
    let alloc_arc: std::sync::Arc<IdAllocator> = std::sync::Arc::new(IdAllocator::new());
    let grid = GridIndex::from_yrs_arrays(sheet_id, &row_hexes, &col_hexes, alloc_arc);

    (storage, sheet_id, grid)
}

/// Seed a cell at `(row, col)` by registering a CellId in `grid` and
/// writing the value to the yrs `cells` map.
fn seed_cell(
    storage: &YrsStorage,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    row: u32,
    col: u32,
    value: CellValue,
) -> CellId {
    let cell_id = get_or_create_cell_id(storage.doc(), storage.sheets(), sheet_id, grid, row, col);
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    {
        let mut txn = storage.doc().transact_mut();
        if let Some(cells_map) = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
            let v = match &value {
                CellValue::Number(n) => Any::Number(n.get()),
                CellValue::Text(s) => Any::String(Arc::clone(s)),
                CellValue::Boolean(b) => Any::Bool(*b),
                CellValue::Null => Any::Null,
                CellValue::Error(e, _) => Any::String(Arc::from(e.as_str())),
                _ => Any::Null,
            };
            let cell_prelim = MapPrelim::from([(KEY_VALUE, v)]);
            cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
        }
    }
    cell_id
}

fn seeded_filter_navigation_sheet() -> (YrsStorage, SheetId, GridIndex, String) {
    let (storage, sid, mut grid) = storage_with_grid();

    let header_start = get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0);
    let header_filter_col =
        get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 0, 1);
    let header_end = get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 0, 3);
    let data_end = get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 11, 3);

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
        storage.doc(),
        storage.sheets(),
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
        storage.doc(),
        storage.sheets(),
        &sid,
        &filter.id,
        &id_to_hex(header_filter_col.as_u128()),
        filters::ColumnFilter::Values {
            values: vec![serde_json::json!("KeepCo")],
            include_blanks: false,
        },
    );
    dimensions::set_filter_hidden_rows(
        storage.doc(),
        storage.sheets(),
        &sid,
        &filter.id,
        &[2, 4, 6, 8, 10],
        &[],
        Some(&grid),
    );

    (storage, sid, grid, filter.id)
}

fn seed_cell_with_formula(
    storage: &YrsStorage,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    row: u32,
    col: u32,
    value: CellValue,
    formula: &str,
) -> CellId {
    let cell_id = get_or_create_cell_id(storage.doc(), storage.sheets(), sheet_id, grid, row, col);
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    {
        let mut txn = storage.doc().transact_mut();
        if let Some(cells_map) = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
            let v = match &value {
                CellValue::Number(n) => Any::Number(n.get()),
                CellValue::Text(s) => Any::String(Arc::clone(s)),
                CellValue::Boolean(b) => Any::Bool(*b),
                CellValue::Null => Any::Null,
                _ => Any::Null,
            };
            let cell_prelim =
                MapPrelim::from([(KEY_VALUE, v), ("f", Any::String(Arc::from(formula)))]);
            cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
        }
    }
    cell_id
}

fn set_cell_property(storage: &YrsStorage, sheet_id: SheetId, cell_id: CellId, value: &str) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    let mut txn = storage.doc().transact_mut();
    let props_map = get_properties_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
    props_map.insert(&mut txn, &*cell_hex, Any::String(Arc::from(value)));
}

fn cell_property_exists(storage: &YrsStorage, sheet_id: SheetId, cell_id: CellId) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    let txn = storage.doc().transact();
    let props_map = get_properties_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
    props_map.get(&txn, &cell_hex).is_some()
}

fn cell_map_keys(storage: &YrsStorage, sheet_id: SheetId, cell_id: CellId) -> Vec<String> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    let txn = storage.doc().transact();
    let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
    let cell_map = match cells_map.get(&txn, &cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => panic!("cell map missing"),
    };
    cell_map.iter(&txn).map(|(k, _)| k.to_string()).collect()
}

// -------------------------------------------------------------------
// Identity: get_or_create_cell_id
// -------------------------------------------------------------------

#[test]
fn test_get_or_create_cell_id_creates_new() {
    let (storage, sid, mut grid) = storage_with_grid();
    let id1 = get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0);
    assert_ne!(id1.as_u128(), 0);
    assert_eq!(grid.cell_id_at(0, 0), Some(id1));
}

#[test]
fn test_get_or_create_cell_id_returns_existing() {
    let (storage, sid, mut grid) = storage_with_grid();
    let id1 = get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0);
    let id2 = get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0);
    assert_eq!(id1, id2);
}

#[test]
fn test_get_or_create_different_positions() {
    let (storage, sid, mut grid) = storage_with_grid();
    let id1 = get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0);
    let id2 = get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 0, 1);
    assert_ne!(id1, id2);
}

// -------------------------------------------------------------------
// Identity lookups (GridIndex pass-through)
// -------------------------------------------------------------------

#[test]
fn test_grid_cell_id_at_found() {
    let (storage, sid, mut grid) = storage_with_grid();
    let created_id = get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 3, 5);
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
    let id1 = get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0);

    update_cell_position(storage.doc(), storage.sheets(), sid, &mut grid, id1, 5, 5);

    assert!(grid.cell_id_at(0, 0).is_none());
    assert_eq!(grid.cell_id_at(5, 5), Some(id1));
}

// -------------------------------------------------------------------
// clear_cells_by_hex: works on XLSX-hydrated sheets
// -------------------------------------------------------------------

/// Overwrite semantics: yrs `Map::insert` of a fresh `MapPrelim` onto
/// an existing key must REPLACE the prior MapRef, not merge. This is
/// the load-bearing assumption behind `clear_cells_by_hex`: an
/// existing cell's `f` / cached-result keys must not survive the
/// clear.
#[test]
fn test_clear_cells_by_hex_overwrites_existing_cell_map() {
    let (storage, sid, mut grid) = storage_with_grid();
    let cell_id = seed_cell_with_formula(
        &storage,
        sid,
        &mut grid,
        0,
        0,
        CellValue::Number(FiniteF64::must(42.0)),
        "=A2+B2",
    );
    let cell_hex = id_to_hex(cell_id.as_u128()).to_string();

    clear_cells_by_hex(
        storage.doc(),
        storage.sheets(),
        sid,
        &[cell_hex.clone()],
        true,
    );

    let sheet_hex = id_to_hex(sid.as_u128());
    let txn = storage.doc().transact();
    let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
    let cell_map = match cells_map.get(&txn, cell_hex.as_str()) {
        Some(Out::YMap(m)) => m,
        _ => panic!("cell map missing after clear"),
    };

    let keys: Vec<String> = cell_map.iter(&txn).map(|(k, _)| k.to_string()).collect();
    assert_eq!(
        keys,
        vec![KEY_VALUE.to_string()],
        "after clear_cells_by_hex the cell map must contain ONLY KEY_VALUE; \
             formula and any other keys must be gone. Actual keys: {:?}",
        keys
    );

    match cell_map.get(&txn, KEY_VALUE) {
        Some(Out::Any(Any::Null)) => {}
        other => panic!("value should be Null after clear, got: {:?}", other),
    }
}

#[test]
fn test_clear_cells_by_hex_preserves_properties_when_requested() {
    let (storage, sid, mut grid) = storage_with_grid();
    let cell_id = seed_cell_with_formula(
        &storage,
        sid,
        &mut grid,
        0,
        0,
        CellValue::Number(FiniteF64::must(42.0)),
        "=A2+B2",
    );
    set_cell_property(&storage, sid, cell_id, "{\"s\":1}");

    let cell_hex = id_to_hex(cell_id.as_u128()).to_string();
    clear_cells_by_hex(storage.doc(), storage.sheets(), sid, &[cell_hex], false);

    assert!(
        cell_property_exists(&storage, sid, cell_id),
        "clear contents should preserve cell properties"
    );
    assert_eq!(
        cell_map_keys(&storage, sid, cell_id),
        vec![KEY_VALUE.to_string()]
    );
}

#[test]
fn test_clear_cells_by_hex_removes_properties_and_extra_cell_keys() {
    let (storage, sid, mut grid) = storage_with_grid();
    let cell_id = seed_cell_with_formula(
        &storage,
        sid,
        &mut grid,
        0,
        0,
        CellValue::Number(FiniteF64::must(42.0)),
        "=A2+B2",
    );
    set_cell_property(&storage, sid, cell_id, "{\"s\":1}");

    let sheet_hex = id_to_hex(sid.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128()).to_string();
    {
        let mut txn = storage.doc().transact_mut();
        let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
        let cell_map = match cells_map.get(&txn, cell_hex.as_str()) {
            Some(Out::YMap(m)) => m,
            _ => panic!("cell map missing before clear"),
        };
        cell_map.insert(&mut txn, "cached", Any::String(Arc::from("stale")));
    }

    clear_cells_by_hex(storage.doc(), storage.sheets(), sid, &[cell_hex], true);

    assert!(
        !cell_property_exists(&storage, sid, cell_id),
        "clear all should remove cell properties"
    );
    assert_eq!(
        cell_map_keys(&storage, sid, cell_id),
        vec![KEY_VALUE.to_string()]
    );
}

// -------------------------------------------------------------------
// clear_range_and_return_ids: fully deletes
// -------------------------------------------------------------------

#[test]
fn test_clear_range_and_return_ids_basic() {
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
        0,
        1,
        CellValue::Number(FiniteF64::must(2.0)),
    );

    let range = RangePos::new(sid, 0, 0, 0, 1);
    let cleared = clear_range_and_return_ids(
        storage.doc(),
        storage.sheets(),
        sid,
        &mut grid,
        &range,
        None,
    );

    assert_eq!(cleared.len(), 2);
    assert!(cleared.contains(&id1));
    assert!(cleared.contains(&id2));

    assert!(grid.cell_id_at(0, 0).is_none());
    assert!(grid.cell_id_at(0, 1).is_none());
}

#[test]
fn test_clear_range_and_return_ids_empty() {
    let (storage, sid, mut grid) = storage_with_grid();
    let range = RangePos::new(sid, 0, 0, 5, 5);
    let cleared = clear_range_and_return_ids(
        storage.doc(),
        storage.sheets(),
        sid,
        &mut grid,
        &range,
        None,
    );
    assert!(cleared.is_empty());
}

#[test]
fn test_clear_range_and_return_ids_skips_excluded_cells() {
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
        0,
        1,
        CellValue::Number(FiniteF64::must(2.0)),
    );
    set_cell_property(&storage, sid, id1, "{\"s\":1}");
    set_cell_property(&storage, sid, id2, "{\"s\":2}");

    let range = RangePos::new(sid, 0, 0, 0, 1);
    let exclude = std::collections::HashSet::from([id1]);
    let cleared = clear_range_and_return_ids(
        storage.doc(),
        storage.sheets(),
        sid,
        &mut grid,
        &range,
        Some(&exclude),
    );

    assert_eq!(cleared, vec![id2]);
    assert_eq!(grid.cell_id_at(0, 0), Some(id1));
    assert!(grid.cell_id_at(0, 1).is_none());
    assert!(cell_property_exists(&storage, sid, id1));
    assert!(!cell_property_exists(&storage, sid, id2));
}

// -------------------------------------------------------------------
// for_each_cell: iterates all cells
// -------------------------------------------------------------------

#[test]
fn test_for_each_cell_basic() {
    let (storage, sid, mut grid) = storage_with_grid();
    seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        0,
        CellValue::Number(FiniteF64::must(10.0)),
    );
    seed_cell(
        &storage,
        sid,
        &mut grid,
        1,
        1,
        CellValue::Number(FiniteF64::must(20.0)),
    );
    seed_cell(
        &storage,
        sid,
        &mut grid,
        2,
        2,
        CellValue::Number(FiniteF64::must(30.0)),
    );

    let mut visited = Vec::new();
    for_each_cell(
        storage.doc(),
        storage.sheets(),
        sid,
        &grid,
        |row, col, data| {
            visited.push((row, col, data.cell_id));
        },
    );

    assert_eq!(visited.len(), 3);
}

#[test]
fn test_for_each_cell_empty_sheet() {
    let (storage, sid, grid) = storage_with_grid();
    let mut count = 0;
    for_each_cell(storage.doc(), storage.sheets(), sid, &grid, |_, _, _| {
        count += 1;
    });
    assert_eq!(count, 0);
}

// -------------------------------------------------------------------
// for_each_cell_in_range: only range cells
// -------------------------------------------------------------------

#[test]
fn test_for_each_cell_in_range_basic() {
    let (storage, sid, mut grid) = storage_with_grid();
    seed_cell(
        &storage,
        sid,
        &mut grid,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
    );
    seed_cell(
        &storage,
        sid,
        &mut grid,
        5,
        5,
        CellValue::Number(FiniteF64::must(99.0)),
    );

    let range = RangePos::new(sid, 0, 0, 1, 1);
    let mut with_data = 0;
    let mut without_data = 0;

    for_each_cell_in_range(
        storage.doc(),
        storage.sheets(),
        sid,
        &grid,
        &range,
        |_, _, data| {
            if data.is_some() {
                with_data += 1;
            } else {
                without_data += 1;
            }
        },
    );

    assert_eq!(with_data, 1);
    assert_eq!(without_data, 3);
}

#[test]
fn test_for_each_cell_in_range_all_empty() {
    let (storage, sid, grid) = storage_with_grid();
    let range = RangePos::new(sid, 0, 0, 1, 1);

    let mut all_none = true;
    for_each_cell_in_range(
        storage.doc(),
        storage.sheets(),
        sid,
        &grid,
        &range,
        |_, _, data| {
            if data.is_some() {
                all_none = false;
            }
        },
    );
    assert!(all_none);
}

#[test]
fn test_for_each_cell_in_range_reports_formula_only_cells_and_empty_positions() {
    let (storage, sid, mut grid) = storage_with_grid();
    let formula_id = seed_cell_with_formula(&storage, sid, &mut grid, 0, 0, CellValue::Null, "=A2");
    let range = RangePos::new(sid, 0, 0, 0, 1);

    let mut observed = Vec::new();
    for_each_cell_in_range(
        storage.doc(),
        storage.sheets(),
        sid,
        &grid,
        &range,
        |row, col, data| {
            observed.push((
                row,
                col,
                data.map(|d| (d.cell_id, d.value.clone(), d.formula.clone())),
            ));
        },
    );

    assert_eq!(observed.len(), 2);
    assert_eq!(
        observed[0],
        (0, 0, Some((formula_id, None, Some("=A2".to_string()))))
    );
    assert_eq!(observed[1], (0, 1, None));
}

// -------------------------------------------------------------------
// get_current_region: contiguous block
// -------------------------------------------------------------------

#[test]
fn test_get_current_region_contiguous_block() {
    let (storage, sid, mut grid) = storage_with_grid();
    for row in 0..3u32 {
        for col in 0..3u32 {
            seed_cell(
                &storage,
                sid,
                &mut grid,
                row,
                col,
                CellValue::Number(FiniteF64::must((row * 3 + col) as f64)),
            );
        }
    }

    let region = get_current_region(storage.doc(), storage.sheets(), sid, &grid, 1, 1);
    assert_eq!(region.start_row(), 0);
    assert_eq!(region.start_col(), 0);
    assert_eq!(region.end_row(), 2);
    assert_eq!(region.end_col(), 2);
}

#[test]
fn test_get_current_region_isolated_empty_cell() {
    let (storage, sid, grid) = storage_with_grid();
    let region = get_current_region(storage.doc(), storage.sheets(), sid, &grid, 50, 10);
    assert_eq!(region.start_row(), 50);
    assert_eq!(region.start_col(), 10);
    assert_eq!(region.end_row(), 50);
    assert_eq!(region.end_col(), 10);
}

#[test]
fn test_get_current_region_isolated_cell() {
    let (storage, sid, mut grid) = storage_with_grid();
    seed_cell(
        &storage,
        sid,
        &mut grid,
        10,
        10,
        CellValue::Number(FiniteF64::must(1.0)),
    );

    let region = get_current_region(storage.doc(), storage.sheets(), sid, &grid, 10, 10);
    assert_eq!(region.start_row(), 10);
    assert_eq!(region.start_col(), 10);
    assert_eq!(region.end_row(), 10);
    assert_eq!(region.end_col(), 10);
}

#[test]
fn test_get_current_region_empty_start_uses_cardinal_adjacency_only() {
    let (storage, sid, mut grid) = storage_with_grid();
    seed_cell(
        &storage,
        sid,
        &mut grid,
        5,
        6,
        CellValue::Number(FiniteF64::must(1.0)),
    );
    seed_cell(
        &storage,
        sid,
        &mut grid,
        5,
        7,
        CellValue::Number(FiniteF64::must(2.0)),
    );

    let adjacent = get_current_region(storage.doc(), storage.sheets(), sid, &grid, 5, 5);
    assert_eq!(adjacent.start_row(), 5);
    assert_eq!(adjacent.start_col(), 5);
    assert_eq!(adjacent.end_row(), 5);
    assert_eq!(adjacent.end_col(), 7);

    let (storage, sid, mut grid) = storage_with_grid();
    seed_cell(
        &storage,
        sid,
        &mut grid,
        6,
        6,
        CellValue::Number(FiniteF64::must(1.0)),
    );

    let diagonal = get_current_region(storage.doc(), storage.sheets(), sid, &grid, 5, 5);
    assert_eq!(diagonal.start_row(), 5);
    assert_eq!(diagonal.start_col(), 5);
    assert_eq!(diagonal.end_row(), 5);
    assert_eq!(diagonal.end_col(), 5);
}

#[test]
fn test_get_data_bounds_normal_range() {
    let (storage, sid, grid) = storage_with_grid();
    let range = RangePos::new(sid, 0, 0, 5, 5);
    let result = get_data_bounds_for_range(
        storage.doc(),
        storage.sheets(),
        sid,
        &grid,
        &range,
        RangeSpan::Exact,
    );
    assert_eq!(result, Some(range));
}

#[test]
fn test_get_data_bounds_full_column_no_data() {
    let (storage, sid, grid) = storage_with_grid();
    let range = RangePos::new(sid, 0, 0, 99, 0);
    let result = get_data_bounds_for_range(
        storage.doc(),
        storage.sheets(),
        sid,
        &grid,
        &range,
        RangeSpan::FullColumns,
    );
    assert!(result.is_none());
}

#[test]
fn test_get_data_bounds_full_rows_detects_bounded_columns() {
    let (storage, sid, mut grid) = storage_with_grid();
    seed_cell(
        &storage,
        sid,
        &mut grid,
        2,
        3,
        CellValue::Number(FiniteF64::must(1.0)),
    );
    seed_cell(
        &storage,
        sid,
        &mut grid,
        2,
        4,
        CellValue::Number(FiniteF64::must(2.0)),
    );
    let range = RangePos::new(sid, 2, 0, 2, 25);

    let result = get_data_bounds_for_range(
        storage.doc(),
        storage.sheets(),
        sid,
        &grid,
        &range,
        RangeSpan::FullRows,
    )
    .unwrap();

    assert_eq!(result.start_row(), 2);
    assert_eq!(result.end_row(), 2);
    assert_eq!(result.start_col(), 3);
    assert_eq!(result.end_col(), 4);
}

// -------------------------------------------------------------------
// find_data_edge: filter-owned visibility
// -------------------------------------------------------------------

#[test]
fn test_find_data_edge_skips_filter_only_hidden_rows_inside_filter_body() {
    let (storage, sid, grid, _) = seeded_filter_navigation_sheet();

    let target = find_data_edge(storage.doc(), storage.sheets(), sid, &grid, 1, 1, "down");

    assert_eq!(target.row, 11);
    assert_eq!(target.col, 1);
}

#[test]
fn test_find_data_edge_treats_manual_plus_filter_hidden_row_as_boundary() {
    let (storage, sid, grid, _) = seeded_filter_navigation_sheet();
    dimensions::hide_manual_rows(storage.doc(), storage.sheets(), &sid, &[2], Some(&grid));

    let target = find_data_edge(storage.doc(), storage.sheets(), sid, &grid, 1, 1, "down");

    assert_eq!(target.row, 1);
    assert_eq!(target.col, 1);
}

#[test]
fn test_find_data_edge_returns_last_visible_before_skipped_run_boundary() {
    let (storage, sid, grid, _) = seeded_filter_navigation_sheet();
    dimensions::hide_manual_rows(storage.doc(), storage.sheets(), &sid, &[3], Some(&grid));

    let target = find_data_edge(storage.doc(), storage.sheets(), sid, &grid, 1, 1, "down");

    assert_eq!(target.row, 1);
    assert_eq!(target.col, 1);
}

#[test]
fn test_find_data_edge_treats_filter_hidden_row_outside_filter_columns_as_boundary() {
    let (storage, sid, grid, _) = seeded_filter_navigation_sheet();

    let target = find_data_edge(storage.doc(), storage.sheets(), sid, &grid, 1, 4, "down");

    assert_eq!(target.row, 1);
    assert_eq!(target.col, 4);
}

#[test]
fn test_find_data_edge_treats_filter_hidden_row_from_header_start_as_boundary() {
    let (storage, sid, grid, _) = seeded_filter_navigation_sheet();

    let target = find_data_edge(storage.doc(), storage.sheets(), sid, &grid, 0, 1, "down");

    assert_eq!(target.row, 1);
    assert_eq!(target.col, 1);
}

#[test]
fn test_find_data_edge_treats_cache_hidden_orphan_as_boundary() {
    let (storage, sid, grid, filter_id) = seeded_filter_navigation_sheet();
    dimensions::clear_filter_hidden_rows(
        storage.doc(),
        storage.sheets(),
        &sid,
        &filter_id,
        Some(&grid),
    );
    let sheet_hex = id_to_hex(sid.as_u128());
    let mut txn = storage.doc().transact_mut();
    let sheet_map = match storage.sheets_ref().get(&txn, &*sheet_hex) {
        Some(Out::YMap(map)) => map,
        _ => panic!("sheet map missing"),
    };
    let hidden_rows_map = match sheet_map.get(&txn, KEY_HIDDEN_ROWS) {
        Some(Out::YMap(map)) => map,
        _ => panic!("hiddenRows map missing"),
    };
    hidden_rows_map.insert(&mut txn, "2", Any::Bool(true));
    drop(txn);

    let target = find_data_edge(storage.doc(), storage.sheets(), sid, &grid, 1, 1, "down");

    assert_eq!(target.row, 1);
    assert_eq!(target.col, 1);
}

// -------------------------------------------------------------------
// relocate_cells: same sheet
// -------------------------------------------------------------------

#[test]
fn test_relocate_cells_same_sheet() {
    let (storage, sid, mut grid) = storage_with_grid();
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
    let result = relocate_cells(
        storage.doc(),
        storage.sheets(),
        sid,
        &source,
        sid,
        5,
        5,
        &mut grid,
        None,
    );

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
    let (storage, sid, mut grid) = storage_with_grid();
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
    let result = relocate_cells(
        storage.doc(),
        storage.sheets(),
        sid,
        &source,
        sid,
        0,
        1,
        &mut grid,
        None,
    );

    assert!(result.success);
    assert_eq!(result.source_positions_vacated, vec![(0, 0), (0, 1)]);
    assert_eq!(result.target_cells_cleared, vec![target_only]);
    assert_eq!(grid.cell_id_at(0, 1), Some(id1));
    assert_eq!(grid.cell_id_at(0, 2), Some(id2));
    assert!(grid.cell_id_at(0, 0).is_none());
}

#[test]
fn test_relocate_cells_empty_source() {
    let (storage, sid, mut grid) = storage_with_grid();
    let source = RangePos::new(sid, 0, 0, 0, 0);
    let result = relocate_cells(
        storage.doc(),
        storage.sheets(),
        sid,
        &source,
        sid,
        5,
        5,
        &mut grid,
        None,
    );
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
