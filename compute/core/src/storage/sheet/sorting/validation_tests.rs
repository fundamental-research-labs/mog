fn storage_with_sheet() -> (
    crate::storage::WorkbookStorage,
    cell_types::SheetId,
    crate::cells::CellStore,
) {
    let mut storage = crate::storage::WorkbookStorage::new();
    let mut cells = crate::cells::CellStore::new();
    let sheet = cell_types::SheetId::from_raw(1);
    storage
        .add_sheet(&mut cells, sheet, "Sheet1", 10, 10)
        .unwrap();
    (storage, sheet, cells)
}

use super::types::CellRange;
use super::validation::check_sort_range_merges;

#[test]
fn test_check_sort_range_merges_no_merges() {
    let (storage, sheet_id, grid) = storage_with_sheet();
    let range = CellRange::new(0, 0, 5, 5);
    let (has_merges, msg) = check_sort_range_merges(
        &storage,
        sheet_id,
        grid.get_sheet(&sheet_id).unwrap(),
        &range,
    );
    assert!(!has_merges);
    assert!(msg.is_none());
}

// ===================================================================
// Test 26: check_sort_range_merges — with merges
// ===================================================================

#[test]
fn test_check_sort_range_merges_with_merges() {
    let (mut storage, sheet_id, mut grid) = storage_with_sheet();
    // Create a merge inside the sort range
    crate::storage::sheet::merges::merge_range(&mut storage, sheet_id, &mut grid, 1, 1, 2, 2)
        .expect("merge should succeed");

    let range = CellRange::new(0, 0, 5, 5);
    let (has_merges, msg) = check_sort_range_merges(
        &storage,
        sheet_id,
        grid.get_sheet(&sheet_id).unwrap(),
        &range,
    );
    assert!(has_merges);
    assert!(msg.is_some());
    assert!(msg.unwrap().contains("merged cells"));
}
