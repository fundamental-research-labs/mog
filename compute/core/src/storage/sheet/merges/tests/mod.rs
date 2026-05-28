use super::codec::serialize_merge;
use super::data_loss::read_cell_value;
use super::resolve::ranges_overlap;
use super::yrs_io::get_merges_map;
use super::*;
use crate::storage::YrsStorage;
use crate::storage::infra::grid_helpers::get_cells_map;
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_document::identity::GridIndex;
use compute_document::schema::KEY_VALUE;
use std::sync::Arc;
use value_types::ComputeError;
use yrs::{Any, Map, MapPrelim, Transact};

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

/// Create a storage with one sheet plus a fresh `GridIndex` that serves
/// as the authoritative identity store for that sheet in the test.
fn storage_with_sheet() -> (YrsStorage, SheetId, GridIndex) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");

    let grid = GridIndex::new(sheet_id, 100, 26, Arc::new(cell_types::IdAllocator::new()));

    (storage, sheet_id, grid)
}

/// Seed a cell value at (row, col) so data-loss checks can detect it.
fn seed_cell_value(
    storage: &YrsStorage,
    grid: &mut GridIndex,
    sheet_id: SheetId,
    row: u32,
    col: u32,
    val: &str,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_id = grid.ensure_cell_id(row, col);
    let cell_hex = id_to_hex(cell_id.as_u128());
    let mut txn = storage.doc().transact_mut();
    if let Some(cells_map) = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
        let cell_prelim = MapPrelim::from([(KEY_VALUE, Any::String(Arc::from(val)))]);
        cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
    }
}

fn stored_cell_value(
    storage: &YrsStorage,
    grid: &GridIndex,
    sheet_id: SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_id = grid.cell_id_at(row, col)?;
    let cell_hex = id_to_hex(cell_id.as_u128());
    let txn = storage.doc().transact();
    let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex)?;
    read_cell_value(&txn, &cells_map, &cell_hex)
}

// -------------------------------------------------------------------
// Test 1: Simple merge
// -------------------------------------------------------------------

#[test]
fn test_merge_range_basic() {
    let (storage, sid, mut grid) = storage_with_sheet();
    let result = merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 2, 2);
    assert!(result.is_ok());
    let region = result.unwrap();
    assert!(region.is_some());
    let region = region.unwrap();
    assert!(!region.top_left_id.is_empty());
    assert!(!region.bottom_right_id.is_empty());
    assert_ne!(region.top_left_id, region.bottom_right_id);

    let top_left = CellId::from_raw(hex_to_id(&region.top_left_id).unwrap());
    let bottom_right = CellId::from_raw(hex_to_id(&region.bottom_right_id).unwrap());
    assert_eq!(
        storage.read_cell_position_from_yrs(&sid, &top_left),
        Some(SheetPos::new(0, 0))
    );
    assert_eq!(
        storage.read_cell_position_from_yrs(&sid, &bottom_right),
        Some(SheetPos::new(2, 2))
    );
}

// -------------------------------------------------------------------
// Test 2: Single cell is invalid
// -------------------------------------------------------------------

#[test]
fn test_merge_range_single_cell_returns_none() {
    let (storage, sid, mut grid) = storage_with_sheet();
    let result = merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 5, 5, 5, 5).unwrap();
    assert!(result.is_none());
}

// -------------------------------------------------------------------
// Test 3: Invalid range (start > end)
// -------------------------------------------------------------------

#[test]
fn test_merge_range_invalid_range() {
    let (storage, sid, mut grid) = storage_with_sheet();
    assert!(
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 5, 0, 3, 0,)
            .unwrap()
            .is_none()
    );
    assert!(
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 5, 0, 3,)
            .unwrap()
            .is_none()
    );
}

// -------------------------------------------------------------------
// Test 4: Overlapping merge rejected
// -------------------------------------------------------------------

#[test]
fn test_merge_range_overlap_rejected() {
    let (storage, sid, mut grid) = storage_with_sheet();
    let r1 = merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 2, 2).unwrap();
    assert!(r1.is_some());

    // Overlapping merge should be rejected
    let r2 = merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 1, 1, 3, 3).unwrap();
    assert!(r2.is_none());
}

// -------------------------------------------------------------------
// Test 5: Non-overlapping merges succeed
// -------------------------------------------------------------------

#[test]
fn test_merge_range_non_overlapping() {
    let (storage, sid, mut grid) = storage_with_sheet();
    let r1 = merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 1, 1).unwrap();
    assert!(r1.is_some());

    let r2 = merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 3, 1, 4).unwrap();
    assert!(r2.is_some());

    let r3 = merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 3, 0, 4, 1).unwrap();
    assert!(r3.is_some());

    let all = get_all_merges(storage.doc(), storage.sheets(), sid, &grid);
    assert_eq!(all.len(), 3);
}

// -------------------------------------------------------------------
// Test 6: get_all_merges resolution
// -------------------------------------------------------------------

#[test]
fn test_get_all_merges_resolves_positions() {
    let (storage, sid, mut grid) = storage_with_sheet();
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 2, 3, 5, 6).unwrap();

    let all = get_all_merges(storage.doc(), storage.sheets(), sid, &grid);
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
    let (storage, sid, mut grid) = storage_with_sheet();
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 2, 2).unwrap();
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 5, 5, 7, 7).unwrap();
    assert_eq!(
        get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
        2
    );

    // Unmerge the first merge (origin at 0,0)
    let removed = unmerge_range(storage.doc(), storage.sheets(), sid, &grid, 0, 0, 2, 2);
    assert_eq!(removed, 1);
    assert_eq!(
        get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
        1
    );

    // The remaining merge is the one at 5,5
    let remaining = get_all_merges(storage.doc(), storage.sheets(), sid, &grid);
    assert_eq!(remaining[0].start_row, 5);
}

#[test]
fn test_merge_range_discards_non_origin_values_on_explicit_unmerge() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell_value(&storage, &mut grid, sid, 0, 0, "Keep");
    seed_cell_value(&storage, &mut grid, sid, 0, 1, "Drop1");
    seed_cell_value(&storage, &mut grid, sid, 1, 0, "Drop2");
    seed_cell_value(&storage, &mut grid, sid, 1, 1, "Drop3");

    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 1, 1).unwrap();

    assert_eq!(
        stored_cell_value(&storage, &grid, sid, 0, 0).as_deref(),
        Some("Keep")
    );
    assert_eq!(stored_cell_value(&storage, &grid, sid, 0, 1), None);
    assert_eq!(stored_cell_value(&storage, &grid, sid, 1, 0), None);
    assert_eq!(stored_cell_value(&storage, &grid, sid, 1, 1), None);

    let removed = unmerge_range(storage.doc(), storage.sheets(), sid, &grid, 0, 0, 1, 1);
    assert_eq!(removed, 1);

    assert_eq!(
        stored_cell_value(&storage, &grid, sid, 0, 0).as_deref(),
        Some("Keep")
    );
    assert_eq!(stored_cell_value(&storage, &grid, sid, 0, 1), None);
    assert_eq!(stored_cell_value(&storage, &grid, sid, 1, 0), None);
    assert_eq!(stored_cell_value(&storage, &grid, sid, 1, 1), None);
}

// -------------------------------------------------------------------
// Test 8: merge_across
// -------------------------------------------------------------------

#[test]
fn test_merge_across() {
    let (storage, sid, mut grid) = storage_with_sheet();
    let results = merge_across(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 2, 3);
    assert_eq!(results.len(), 3);

    let all = get_all_merges(storage.doc(), storage.sheets(), sid, &grid);
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
    let (storage, sid, mut grid) = storage_with_sheet();
    let results = merge_across(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 2, 0);
    assert!(results.is_empty());
}

// -------------------------------------------------------------------
// Test 10: merge_and_center unmerges then merges
// -------------------------------------------------------------------

#[test]
fn test_merge_and_center() {
    let (storage, sid, mut grid) = storage_with_sheet();
    // Create an initial merge
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 1, 1).unwrap();
    assert_eq!(
        get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
        1
    );

    // merge_and_center over a bigger range that includes the existing merge
    let result = merge_and_center(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 3, 3);
    assert!(result.is_ok());
    assert!(result.unwrap().is_some());

    // Should have exactly 1 merge now (the new one)
    let all = get_all_merges(storage.doc(), storage.sheets(), sid, &grid);
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].end_row, 3);
    assert_eq!(all[0].end_col, 3);
}

// -------------------------------------------------------------------
// Test 11: get_merge_for_cell
// -------------------------------------------------------------------

#[test]
fn test_get_merge_for_cell() {
    let (storage, sid, mut grid) = storage_with_sheet();
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 2, 3, 5, 6).unwrap();

    // Origin cell
    let info = get_merge_for_cell(storage.doc(), storage.sheets(), sid, &grid, 2, 3);
    assert!(info.is_some());
    assert!(info.unwrap().is_origin);

    // Interior cell
    let info = get_merge_for_cell(storage.doc(), storage.sheets(), sid, &grid, 4, 5);
    assert!(info.is_some());
    assert!(!info.unwrap().is_origin);

    // Outside cell
    let info = get_merge_for_cell(storage.doc(), storage.sheets(), sid, &grid, 0, 0);
    assert!(info.is_none());
}

// -------------------------------------------------------------------
// Test 12: is_merge_origin
// -------------------------------------------------------------------

#[test]
fn test_is_merge_origin() {
    let (storage, sid, mut grid) = storage_with_sheet();
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 1, 1, 3, 3).unwrap();

    assert!(is_merge_origin(
        storage.doc(),
        storage.sheets(),
        sid,
        &grid,
        1,
        1
    ));
    assert!(!is_merge_origin(
        storage.doc(),
        storage.sheets(),
        sid,
        &grid,
        2,
        2
    ));
    assert!(!is_merge_origin(
        storage.doc(),
        storage.sheets(),
        sid,
        &grid,
        0,
        0
    ));
}

// -------------------------------------------------------------------
// Test 13: clear_all_merges
// -------------------------------------------------------------------

#[test]
fn test_clear_all_merges() {
    let (storage, sid, mut grid) = storage_with_sheet();
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 1, 1).unwrap();
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 3, 3, 4, 4).unwrap();
    assert_eq!(
        get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
        2
    );

    clear_all_merges(storage.doc(), storage.sheets(), sid);
    assert_eq!(
        get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
        0
    );
}

// -------------------------------------------------------------------
// Test 14: clear_all_merges on empty sheet is no-op
// -------------------------------------------------------------------

#[test]
fn test_clear_all_merges_empty() {
    let (storage, sid, grid) = storage_with_sheet();
    // Should not panic
    clear_all_merges(storage.doc(), storage.sheets(), sid);
    assert_eq!(
        get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
        0
    );
}

// -------------------------------------------------------------------
// Test 15: get_merges_in_range
// -------------------------------------------------------------------

#[test]
fn test_get_merges_in_range() {
    let (storage, sid, mut grid) = storage_with_sheet();
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 2, 2).unwrap();
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 5, 5, 7, 7).unwrap();
    merge_range(
        storage.doc(),
        storage.sheets(),
        sid,
        &mut grid,
        10,
        10,
        12,
        12,
    )
    .unwrap();

    // Range overlaps with first two merges
    let in_range = get_merges_in_range(storage.doc(), storage.sheets(), sid, &grid, 0, 0, 6, 6);
    assert_eq!(in_range.len(), 2);

    // Range overlaps with only the last merge
    let in_range2 = get_merges_in_range(storage.doc(), storage.sheets(), sid, &grid, 9, 9, 15, 15);
    assert_eq!(in_range2.len(), 1);

    // Range overlaps with nothing
    let in_range3 =
        get_merges_in_range(storage.doc(), storage.sheets(), sid, &grid, 20, 20, 25, 25);
    assert_eq!(in_range3.len(), 0);
}

// -------------------------------------------------------------------
// Test 16: get_merges_in_viewport (delegates to get_merges_in_range)
// -------------------------------------------------------------------

#[test]
fn test_get_merges_in_viewport() {
    let (storage, sid, mut grid) = storage_with_sheet();
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 3, 3).unwrap();

    let in_vp = get_merges_in_viewport(storage.doc(), storage.sheets(), sid, &grid, 1, 1, 10, 10);
    assert_eq!(in_vp.len(), 1);

    let in_vp_empty =
        get_merges_in_viewport(storage.doc(), storage.sheets(), sid, &grid, 5, 5, 10, 10);
    assert_eq!(in_vp_empty.len(), 0);
}

// -------------------------------------------------------------------
// Test 17: check_merge_data_loss
// -------------------------------------------------------------------

#[test]
fn test_check_merge_data_loss() {
    let (storage, sid, mut grid) = storage_with_sheet();

    // Seed some data into cells that would be cleared
    seed_cell_value(&storage, &mut grid, sid, 0, 1, "Hello");
    seed_cell_value(&storage, &mut grid, sid, 1, 0, "World");

    let (has_loss, count) =
        check_merge_data_loss(storage.doc(), storage.sheets(), sid, &grid, 0, 0, 1, 1);
    assert!(has_loss);
    assert_eq!(count, 2);
}

// -------------------------------------------------------------------
// Test 18: check_merge_data_loss with no data
// -------------------------------------------------------------------

#[test]
fn test_check_merge_data_loss_no_data() {
    let (storage, sid, grid) = storage_with_sheet();
    let (has_loss, count) =
        check_merge_data_loss(storage.doc(), storage.sheets(), sid, &grid, 0, 0, 1, 1);
    assert!(!has_loss);
    assert_eq!(count, 0);
}

// -------------------------------------------------------------------
// Test 19: validate_and_clean_merges
// -------------------------------------------------------------------

#[test]
fn test_validate_and_clean_merges_removes_invalid() {
    let (storage, sid, mut grid) = storage_with_sheet();
    let sheet_hex = id_to_hex(sid.as_u128());

    // Create a valid merge
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 1, 1).unwrap();

    // Manually insert an invalid merge (CellIds not in GridIndex, no inline positions)
    {
        let mut txn = storage.doc().transact_mut();
        if let Some(mm) = get_merges_map(&txn, &storage.sheets_ref(), &sheet_hex) {
            // Omit sr/sc/er/ec so resolve_merge_from_stored fails,
            // and fake cell IDs so resolve_merge_entry also fails.
            let raw_json = r#"{"topLeftId":"deadbeef00000000deadbeef00000001","bottomRightId":"deadbeef00000000deadbeef00000002"}"#;
            mm.insert(
                &mut txn,
                "deadbeef00000000deadbeef00000001",
                Any::String(Arc::from(raw_json)),
            );
        }
    }

    // We should have 2 entries in the merges map now
    assert_eq!(
        get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
        1
    ); // only 1 resolves

    let removed = validate_and_clean_merges(storage.doc(), storage.sheets(), sid, &grid);
    assert_eq!(removed, 1);

    // Only the valid merge remains
    assert_eq!(
        get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
        1
    );
}

// -------------------------------------------------------------------
// Test 20: validate_and_clean_merges with all valid
// -------------------------------------------------------------------

#[test]
fn test_validate_and_clean_merges_all_valid() {
    let (storage, sid, mut grid) = storage_with_sheet();
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 1, 1).unwrap();
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 3, 3, 4, 4).unwrap();

    let removed = validate_and_clean_merges(storage.doc(), storage.sheets(), sid, &grid);
    assert_eq!(removed, 0);
    assert_eq!(
        get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
        2
    );
}

// -------------------------------------------------------------------
// Test 21: merge_range on nonexistent sheet returns error
// -------------------------------------------------------------------

#[test]
fn test_merge_range_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let fake_sheet = make_sheet_id(999);
    let mut grid = GridIndex::new(fake_sheet, 10, 10, Arc::new(cell_types::IdAllocator::new()));
    let result = merge_range(
        storage.doc(),
        storage.sheets(),
        fake_sheet,
        &mut grid,
        0,
        0,
        1,
        1,
    );
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
    let (storage, sid, grid) = storage_with_sheet();
    let removed = unmerge_range(storage.doc(), storage.sheets(), sid, &grid, 0, 0, 10, 10);
    assert_eq!(removed, 0);
}

// -------------------------------------------------------------------
// Test 23: serde roundtrip for IdentityMergedRegion
// -------------------------------------------------------------------

#[test]
fn test_stored_merge_serde_roundtrip() {
    let stored = StoredMerge {
        top_left_id: "aabb0000aabb0000aabb0000aabb0001".to_string(),
        bottom_right_id: "aabb0000aabb0000aabb0000aabb0002".to_string(),
        ord: Some(0),
        sr: 0,
        sc: 0,
        er: 2,
        ec: 2,
    };
    let json = serialize_merge(&stored);
    // StoredMerge JSON is backward-compatible with IdentityMergedRegion deserialization
    let parsed: StoredMerge = serde_json::from_str(&json).unwrap();
    assert_eq!(stored.top_left_id, parsed.top_left_id);
    assert_eq!(stored.bottom_right_id, parsed.bottom_right_id);
    assert_eq!(stored.ord, parsed.ord);

    // Also verify backward compat: IdentityMergedRegion can still deserialize from StoredMerge JSON
    let identity: IdentityMergedRegion = serde_json::from_str(&json).unwrap();
    assert_eq!(stored.top_left_id, identity.top_left_id);
    assert_eq!(stored.bottom_right_id, identity.bottom_right_id);
}

// -------------------------------------------------------------------
// Test 23b: old IdentityMergedRegion JSON deserializes as StoredMerge
// -------------------------------------------------------------------

#[test]
fn test_old_identity_json_deserializes_as_stored_merge() {
    // This is the JSON format written by the old runtime CRUD path (no `ord` field)
    let old_json =
        r#"{"topLeftId":"aabb0001","bottomRightId":"ccdd0002","sr":0,"sc":0,"er":1,"ec":1}"#;
    let parsed: StoredMerge = serde_json::from_str(old_json).unwrap();
    assert_eq!(parsed.top_left_id, "aabb0001");
    assert_eq!(parsed.bottom_right_id, "ccdd0002");
    assert_eq!(parsed.ord, None); // missing field defaults to None
    assert_eq!(parsed.sr, 0);
    assert_eq!(parsed.sc, 0);
    assert_eq!(parsed.er, 1);
    assert_eq!(parsed.ec, 1);
}

// -------------------------------------------------------------------
// Test 24: ranges_overlap helper
// -------------------------------------------------------------------

#[test]
fn test_ranges_overlap() {
    // Overlapping
    assert!(ranges_overlap(0, 0, 2, 2, 1, 1, 3, 3));
    // Edge-touching
    assert!(ranges_overlap(0, 0, 2, 2, 2, 2, 4, 4));
    // Non-overlapping
    assert!(!ranges_overlap(0, 0, 2, 2, 3, 3, 5, 5));
    assert!(!ranges_overlap(0, 0, 2, 2, 0, 3, 2, 5));
}

// -------------------------------------------------------------------
// Test 25: nonexistent sheet returns empty for queries
// -------------------------------------------------------------------

#[test]
fn test_nonexistent_sheet_returns_empty() {
    let storage = YrsStorage::new();
    let fake = make_sheet_id(999);
    let grid = GridIndex::new(fake, 10, 10, Arc::new(cell_types::IdAllocator::new()));

    assert!(get_all_merges(storage.doc(), storage.sheets(), fake, &grid).is_empty());
    assert!(
        get_merges_in_range(storage.doc(), storage.sheets(), fake, &grid, 0, 0, 10, 10).is_empty()
    );
    assert!(get_merge_for_cell(storage.doc(), storage.sheets(), fake, &grid, 0, 0).is_none());
    assert!(!is_merge_origin(
        storage.doc(),
        storage.sheets(),
        fake,
        &grid,
        0,
        0
    ));
}

// -------------------------------------------------------------------
// Test 26: merge_across with overlapping existing merge skips rows
// -------------------------------------------------------------------

#[test]
fn test_merge_across_skips_overlapping_rows() {
    let (storage, sid, mut grid) = storage_with_sheet();
    // Create a merge that blocks row 1
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 1, 0, 1, 3).unwrap();

    // merge_across rows 0-2, cols 0-3
    let results = merge_across(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 2, 3);
    // Row 1 should be skipped (already merged), rows 0 and 2 succeed
    assert_eq!(results.len(), 2);
}

// -------------------------------------------------------------------
// Test 27: unmerge only affects merges with origin inside range
// -------------------------------------------------------------------

#[test]
fn test_unmerge_only_origin_inside() {
    let (storage, sid, mut grid) = storage_with_sheet();
    // Merge A: origin at (0,0), extends to (2,2)
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 2, 2).unwrap();
    // Merge B: origin at (5,0), extends to (7,2)
    merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 5, 0, 7, 2).unwrap();

    // Unmerge range that covers bottom part of A but not its origin
    let removed = unmerge_range(storage.doc(), storage.sheets(), sid, &grid, 1, 0, 4, 2);
    assert_eq!(removed, 0); // origin at (0,0) is not in [1..4, 0..2]

    // Both merges still exist
    assert_eq!(
        get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
        2
    );
}

// -------------------------------------------------------------------
// Test 28: multiple merge_and_center calls
// -------------------------------------------------------------------

#[test]
fn test_merge_and_center_idempotent() {
    let (storage, sid, mut grid) = storage_with_sheet();
    merge_and_center(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 3, 3).unwrap();
    assert_eq!(
        get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
        1
    );

    // Calling again with same range should still result in 1 merge
    merge_and_center(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 3, 3).unwrap();
    assert_eq!(
        get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
        1
    );
}
