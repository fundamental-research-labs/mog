use super::*;
use crate::cells::{CellStore, SheetStore};
use crate::storage::WorkbookStorage;
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::hex_to_id;
use value_types::ComputeError;

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

fn fresh_store(rows: u32, cols: u32) -> (crate::cells::CellStore, SheetId) {
    let id = SheetId::from_raw(1);
    let mut cell_store = crate::cells::CellStore::new();
    cell_store.add_sheet_store(
        id,
        "Sheet1".into(),
        crate::cells::SheetStore::new(id, "Sheet1".into(), rows, cols),
    );
    (cell_store, id)
}

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

/// Create a storage with one sheet plus a fresh `GridIndex` that serves
/// as the authoritative identity store for that sheet in the test.
fn storage_with_sheet() -> (WorkbookStorage, SheetId, CellStore) {
    let mut storage = WorkbookStorage::new();
    let mut cell_store = crate::cells::CellStore::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut cell_store, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");

    let grid = cell_store;

    (storage, sheet_id, grid)
}

// -------------------------------------------------------------------
// Test 1: Simple merge
// -------------------------------------------------------------------

#[test]
fn test_merge_range_basic() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    let result = merge_range(&mut storage, sid, &mut grid, 0, 0, 2, 2);
    assert!(result.is_ok());
    let region = result.unwrap();
    assert!(region.is_some());
    let region = region.unwrap();
    assert!(!region.top_left_id.is_empty());
    assert!(!region.bottom_right_id.is_empty());
    assert_ne!(region.top_left_id, region.bottom_right_id);

    let top_left = CellId::from_raw(hex_to_id(&region.top_left_id).unwrap());
    let bottom_right = CellId::from_raw(hex_to_id(&region.bottom_right_id).unwrap());
    assert_eq!(grid.resolve_position(&top_left), Some(SheetPos::new(0, 0)));
    assert_eq!(
        grid.resolve_position(&bottom_right),
        Some(SheetPos::new(2, 2))
    );
}

// -------------------------------------------------------------------
// Test 2: Single cell is invalid
// -------------------------------------------------------------------

#[test]
fn test_merge_range_single_cell_returns_none() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    let result = merge_range(&mut storage, sid, &mut grid, 5, 5, 5, 5).unwrap();
    assert!(result.is_none());
}

// -------------------------------------------------------------------
// Test 3: Invalid range (start > end)
// -------------------------------------------------------------------

#[test]
fn test_merge_range_invalid_range() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    assert!(
        merge_range(&mut storage, sid, &mut grid, 5, 0, 3, 0,)
            .unwrap()
            .is_none()
    );
    assert!(
        merge_range(&mut storage, sid, &mut grid, 0, 5, 0, 3,)
            .unwrap()
            .is_none()
    );
}

// -------------------------------------------------------------------
// Test 4: Overlapping merge rejected
// -------------------------------------------------------------------

#[test]
fn test_merge_range_overlap_rejected() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    let r1 = merge_range(&mut storage, sid, &mut grid, 0, 0, 2, 2).unwrap();
    assert!(r1.is_some());

    // Overlapping merge should be rejected
    let r2 = merge_range(&mut storage, sid, &mut grid, 1, 1, 3, 3).unwrap();
    assert!(r2.is_none());
}

// -------------------------------------------------------------------
// Test 5: Non-overlapping merges succeed
// -------------------------------------------------------------------

#[test]
fn test_merge_range_non_overlapping() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    let r1 = merge_range(&mut storage, sid, &mut grid, 0, 0, 1, 1).unwrap();
    assert!(r1.is_some());

    let r2 = merge_range(&mut storage, sid, &mut grid, 0, 3, 1, 4).unwrap();
    assert!(r2.is_some());

    let r3 = merge_range(&mut storage, sid, &mut grid, 3, 0, 4, 1).unwrap();
    assert!(r3.is_some());

    let all = get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap());
    assert_eq!(all.len(), 3);
}

// -------------------------------------------------------------------
// Test 6: get_all_merges resolution
// -------------------------------------------------------------------

#[test]
fn test_get_all_merges_resolves_positions() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    merge_range(&mut storage, sid, &mut grid, 2, 3, 5, 6).unwrap();

    let all = get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap());
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].start_row, 2);
    assert_eq!(all[0].start_col, 3);
    assert_eq!(all[0].end_row, 5);
    assert_eq!(all[0].end_col, 6);
    assert_eq!(all[0].row_span(), 4);
    assert_eq!(all[0].col_span(), 4);
}

// -------------------------------------------------------------------
// Test 7: unmerge_range removes by origin
// -------------------------------------------------------------------

#[test]
fn test_unmerge_range() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    merge_range(&mut storage, sid, &mut grid, 0, 0, 2, 2).unwrap();
    merge_range(&mut storage, sid, &mut grid, 5, 5, 7, 7).unwrap();
    assert_eq!(
        get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap()).len(),
        2
    );

    // Unmerge the first merge (origin at 0,0)
    let removed = unmerge_range(&mut storage, sid, grid.get_sheet(&sid).unwrap(), 0, 0, 2, 2);
    assert_eq!(removed, 1);
    assert_eq!(
        get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap()).len(),
        1
    );

    // The remaining merge is the one at 5,5
    let remaining = get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap());
    assert_eq!(remaining[0].start_row, 5);
}

// -------------------------------------------------------------------
// Test 8: merge_across
// -------------------------------------------------------------------

#[test]
fn test_merge_across() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    let results = merge_across(&mut storage, sid, &mut grid, 0, 0, 2, 3);
    assert_eq!(results.len(), 3);

    let all = get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap());
    assert_eq!(all.len(), 3);

    // Each merge should span one row and 4 columns
    for m in &all {
        assert_eq!(m.row_span(), 1);
        assert_eq!(m.col_span(), 4);
    }
}

// -------------------------------------------------------------------
// Test 9: merge_across with single column returns empty
// -------------------------------------------------------------------

#[test]
fn test_merge_across_single_column() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    let results = merge_across(&mut storage, sid, &mut grid, 0, 0, 2, 0);
    assert!(results.is_empty());
}

// -------------------------------------------------------------------
// Test 10: merge_and_center unmerges then merges
// -------------------------------------------------------------------

#[test]
fn test_merge_and_center() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    // Create an initial merge
    merge_range(&mut storage, sid, &mut grid, 0, 0, 1, 1).unwrap();
    assert_eq!(
        get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap()).len(),
        1
    );

    // merge_and_center over a bigger range that includes the existing merge
    let result = merge_and_center(&mut storage, sid, &mut grid, 0, 0, 3, 3);
    assert!(result.is_ok());
    assert!(result.unwrap().is_some());

    // Should have exactly 1 merge now (the new one)
    let all = get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap());
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].end_row, 3);
    assert_eq!(all[0].end_col, 3);
}

// -------------------------------------------------------------------
// Test 11: get_merge_for_cell
// -------------------------------------------------------------------

#[test]
fn test_get_merge_for_cell() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    merge_range(&mut storage, sid, &mut grid, 2, 3, 5, 6).unwrap();

    // Origin cell
    let info = get_merge_for_cell(&storage, sid, grid.get_sheet(&sid).unwrap(), 2, 3);
    assert!(info.is_some());
    assert!(info.unwrap().is_origin);

    // Interior cell
    let info = get_merge_for_cell(&storage, sid, grid.get_sheet(&sid).unwrap(), 4, 5);
    assert!(info.is_some());
    assert!(!info.unwrap().is_origin);

    // Outside cell
    let info = get_merge_for_cell(&storage, sid, grid.get_sheet(&sid).unwrap(), 0, 0);
    assert!(info.is_none());
}

// -------------------------------------------------------------------
// Test 12: is_merge_origin
// -------------------------------------------------------------------

#[test]
fn test_is_merge_origin() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    merge_range(&mut storage, sid, &mut grid, 1, 1, 3, 3).unwrap();

    assert!(is_merge_origin(
        &storage,
        sid,
        grid.get_sheet(&sid).unwrap(),
        1,
        1
    ));
    assert!(!is_merge_origin(
        &storage,
        sid,
        grid.get_sheet(&sid).unwrap(),
        2,
        2
    ));
    assert!(!is_merge_origin(
        &storage,
        sid,
        grid.get_sheet(&sid).unwrap(),
        0,
        0
    ));
}

// -------------------------------------------------------------------
// Test 13: clear_all_merges
// -------------------------------------------------------------------

#[test]
fn test_clear_all_merges() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    merge_range(&mut storage, sid, &mut grid, 0, 0, 1, 1).unwrap();
    merge_range(&mut storage, sid, &mut grid, 3, 3, 4, 4).unwrap();
    assert_eq!(
        get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap()).len(),
        2
    );

    clear_all_merges(&mut storage, sid);
    assert_eq!(
        get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap()).len(),
        0
    );
}

// -------------------------------------------------------------------
// Test 14: clear_all_merges on empty sheet is no-op
// -------------------------------------------------------------------

#[test]
fn test_clear_all_merges_empty() {
    let (mut storage, sid, grid) = storage_with_sheet();
    // Should not panic
    clear_all_merges(&mut storage, sid);
    assert_eq!(
        get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap()).len(),
        0
    );
}

// -------------------------------------------------------------------
// Test 15: get_merges_in_range
// -------------------------------------------------------------------

#[test]
fn test_get_merges_in_range() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    merge_range(&mut storage, sid, &mut grid, 0, 0, 2, 2).unwrap();
    merge_range(&mut storage, sid, &mut grid, 5, 5, 7, 7).unwrap();
    merge_range(&mut storage, sid, &mut grid, 10, 10, 12, 12).unwrap();

    // Range overlaps with first two merges
    let in_range = get_merges_in_range(&storage, sid, grid.get_sheet(&sid).unwrap(), 0, 0, 6, 6);
    assert_eq!(in_range.len(), 2);

    // Range overlaps with only the last merge
    let in_range2 = get_merges_in_range(&storage, sid, grid.get_sheet(&sid).unwrap(), 9, 9, 15, 15);
    assert_eq!(in_range2.len(), 1);

    // Range overlaps with nothing
    let in_range3 =
        get_merges_in_range(&storage, sid, grid.get_sheet(&sid).unwrap(), 20, 20, 25, 25);
    assert_eq!(in_range3.len(), 0);
}

// -------------------------------------------------------------------
// Test 16: get_merges_in_range (delegates to get_merges_in_range)
// -------------------------------------------------------------------

#[test]
fn test_get_merges_in_range_viewport_intersection() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    merge_range(&mut storage, sid, &mut grid, 0, 0, 3, 3).unwrap();

    let in_vp = get_merges_in_range(&storage, sid, grid.get_sheet(&sid).unwrap(), 1, 1, 10, 10);
    assert_eq!(in_vp.len(), 1);

    let in_vp_empty =
        get_merges_in_range(&storage, sid, grid.get_sheet(&sid).unwrap(), 5, 5, 10, 10);
    assert_eq!(in_vp_empty.len(), 0);
}

// -------------------------------------------------------------------
// Test 17: check_merge_data_loss
// -------------------------------------------------------------------

#[test]
fn test_check_merge_data_loss() {
    let (mut cell_store, sid) = fresh_store(10, 10);
    for (id, row, col, value) in [(10, 0, 0, "Keep"), (11, 0, 1, "Hello"), (12, 1, 0, "World")] {
        cell_store.insert_cell(
            &sid,
            CellId::from_raw(id),
            SheetPos::new(row, col),
            crate::cells::CellEntry {
                value: value_types::CellValue::Text(value.into()),
            },
        );
    }
    let (has_loss, count) = check_merge_data_loss(&cell_store, sid, 0, 0, 1, 1);
    assert!(has_loss);
    assert_eq!(count, 2);
}

// -------------------------------------------------------------------
// Test 18: check_merge_data_loss with no data
// -------------------------------------------------------------------

#[test]
fn test_check_merge_data_loss_no_data() {
    let (cell_store, sid) = fresh_store(10, 10);
    let (has_loss, count) = check_merge_data_loss(&cell_store, sid, 0, 0, 1, 1);
    assert!(!has_loss);
    assert_eq!(count, 0);
}

// -------------------------------------------------------------------
// Test 19: validate_and_clean_merges
// -------------------------------------------------------------------

#[test]
fn test_validate_and_clean_merges_removes_invalid() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    merge_range(&mut storage, sid, &mut grid, 0, 0, 1, 1).unwrap();
    storage
        .sheet_metadata
        .get_mut(&sid)
        .unwrap()
        .merges
        .push(StoredMerge {
            top_left_id: CellId::from_raw(u128::MAX - 1),
            bottom_right_id: CellId::from_raw(u128::MAX),
            ord: None,
        });

    // We should have 2 entries in the merges map now
    assert_eq!(
        get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap()).len(),
        1
    ); // only 1 resolves

    let removed = validate_and_clean_merges(&mut storage, sid, grid.get_sheet(&sid).unwrap());
    assert_eq!(removed, 1);

    // Only the valid merge remains
    assert_eq!(
        get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap()).len(),
        1
    );
}

// -------------------------------------------------------------------
// Test 20: validate_and_clean_merges with all valid
// -------------------------------------------------------------------

#[test]
fn test_validate_and_clean_merges_all_valid() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    merge_range(&mut storage, sid, &mut grid, 0, 0, 1, 1).unwrap();
    merge_range(&mut storage, sid, &mut grid, 3, 3, 4, 4).unwrap();

    let removed = validate_and_clean_merges(&mut storage, sid, grid.get_sheet(&sid).unwrap());
    assert_eq!(removed, 0);
    assert_eq!(
        get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap()).len(),
        2
    );
}

// -------------------------------------------------------------------
// Test 21: merge_range on nonexistent sheet returns error
// -------------------------------------------------------------------

#[test]
fn test_merge_range_nonexistent_sheet() {
    let mut storage = WorkbookStorage::new();
    let fake_sheet = make_sheet_id(999);
    let mut grid = CellStore::new();
    let result = merge_range(&mut storage, fake_sheet, &mut grid, 0, 0, 1, 1);
    assert!(result.is_err());
    match result.unwrap_err() {
        ComputeError::SheetNotFound { .. } => {}
        other => panic!("Expected SheetNotFound, got {:?}", other),
    }
}

// -------------------------------------------------------------------
// Test 22: unmerge on empty sheet returns 0
// -------------------------------------------------------------------

#[test]
fn test_unmerge_empty() {
    let (mut storage, sid, grid) = storage_with_sheet();
    let removed = unmerge_range(
        &mut storage,
        sid,
        grid.get_sheet(&sid).unwrap(),
        0,
        0,
        10,
        10,
    );
    assert_eq!(removed, 0);
}

// -------------------------------------------------------------------
// Test 23: serde roundtrip for IdentityMergedRegion
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Test 23b: old IdentityMergedRegion JSON deserializes as StoredMerge
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Test 24: ranges_overlap helper
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Test 25: nonexistent sheet returns empty for queries
// -------------------------------------------------------------------

#[test]
fn test_nonexistent_sheet_returns_empty() {
    let storage = WorkbookStorage::new();
    let fake = make_sheet_id(999);
    let grid = SheetStore::new(fake, "missing".into(), 10, 10);

    assert!(get_all_merges(&storage, fake, &grid).is_empty());
    assert!(get_merges_in_range(&storage, fake, &grid, 0, 0, 10, 10).is_empty());
    assert!(get_merge_for_cell(&storage, fake, &grid, 0, 0).is_none());
    assert!(!is_merge_origin(&storage, fake, &grid, 0, 0));
}

// -------------------------------------------------------------------
// Test 26: merge_across with overlapping existing merge skips rows
// -------------------------------------------------------------------

#[test]
fn test_merge_across_skips_overlapping_rows() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    // Create a merge that blocks row 1
    merge_range(&mut storage, sid, &mut grid, 1, 0, 1, 3).unwrap();

    // merge_across rows 0-2, cols 0-3
    let results = merge_across(&mut storage, sid, &mut grid, 0, 0, 2, 3);
    // Row 1 should be skipped (already merged), rows 0 and 2 succeed
    assert_eq!(results.len(), 2);
}

// -------------------------------------------------------------------
// Test 27: unmerge only affects merges with origin inside range
// -------------------------------------------------------------------

#[test]
fn test_unmerge_only_origin_inside() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    // Merge A: origin at (0,0), extends to (2,2)
    merge_range(&mut storage, sid, &mut grid, 0, 0, 2, 2).unwrap();
    // Merge B: origin at (5,0), extends to (7,2)
    merge_range(&mut storage, sid, &mut grid, 5, 0, 7, 2).unwrap();

    // Unmerge range that covers bottom part of A but not its origin
    let removed = unmerge_range(&mut storage, sid, grid.get_sheet(&sid).unwrap(), 1, 0, 4, 2);
    assert_eq!(removed, 0); // origin at (0,0) is not in [1..4, 0..2]

    // Both merges still exist
    assert_eq!(
        get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap()).len(),
        2
    );
}

// -------------------------------------------------------------------
// Test 28: multiple merge_and_center calls
// -------------------------------------------------------------------

#[test]
fn test_merge_and_center_idempotent() {
    let (mut storage, sid, mut grid) = storage_with_sheet();
    merge_and_center(&mut storage, sid, &mut grid, 0, 0, 3, 3).unwrap();
    assert_eq!(
        get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap()).len(),
        1
    );

    // Calling again with same range should still result in 1 merge
    merge_and_center(&mut storage, sid, &mut grid, 0, 0, 3, 3).unwrap();
    assert_eq!(
        get_all_merges(&storage, sid, grid.get_sheet(&sid).unwrap()).len(),
        1
    );
}
