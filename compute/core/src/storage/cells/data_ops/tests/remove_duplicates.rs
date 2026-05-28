use super::super::*;
use super::fixtures::*;
use crate::storage::YrsStorage;
use cell_types::IdAllocator;
use value_types::{CellValue, FiniteF64};

// ===================================================================
// remove_duplicates tests
// ===================================================================

#[test]
fn test_remove_duplicates_no_dups() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(&storage, &mut grid, sid, 0, 0, CellValue::Text("A".into()));
    seed_cell(&storage, &mut grid, sid, 1, 0, CellValue::Text("B".into()));
    seed_cell(&storage, &mut grid, sid, 2, 0, CellValue::Text("C".into()));

    let result = remove_duplicates(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        2,
        0,
        &RemoveDuplicatesOptions {
            has_headers: false,
            columns_to_compare: vec![],
            case_sensitive: true,
        },
    );

    assert_eq!(result.duplicates_found, 0);
    assert_eq!(result.duplicates_removed, 0);
    assert_eq!(result.unique_values_remaining, 3);
}

#[test]
fn test_remove_duplicates_all_dups() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(&storage, &mut grid, sid, 0, 0, CellValue::Text("A".into()));
    seed_cell(&storage, &mut grid, sid, 1, 0, CellValue::Text("A".into()));
    seed_cell(&storage, &mut grid, sid, 2, 0, CellValue::Text("A".into()));

    let result = remove_duplicates(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        2,
        0,
        &RemoveDuplicatesOptions {
            has_headers: false,
            columns_to_compare: vec![],
            case_sensitive: true,
        },
    );

    assert_eq!(result.duplicates_found, 2);
    assert_eq!(result.duplicates_removed, 2);
    assert_eq!(result.unique_values_remaining, 1);
}

#[test]
fn test_remove_duplicates_with_headers() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Text("Name".into()),
    );
    seed_cell(
        &storage,
        &mut grid,
        sid,
        1,
        0,
        CellValue::Text("Alice".into()),
    );
    seed_cell(
        &storage,
        &mut grid,
        sid,
        2,
        0,
        CellValue::Text("Bob".into()),
    );
    seed_cell(
        &storage,
        &mut grid,
        sid,
        3,
        0,
        CellValue::Text("Alice".into()),
    );

    let result = remove_duplicates(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        3,
        0,
        &RemoveDuplicatesOptions {
            has_headers: true,
            columns_to_compare: vec![],
            case_sensitive: true,
        },
    );

    assert_eq!(result.duplicates_found, 1);
    assert_eq!(result.duplicates_removed, 1);
    assert_eq!(result.unique_values_remaining, 2);

    // Header should still be intact
    assert_eq!(read_value_at(&storage, &grid, sid, 0, 0), "Name");
}

#[test]
fn test_remove_duplicates_case_insensitive() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Text("hello".into()),
    );
    seed_cell(
        &storage,
        &mut grid,
        sid,
        1,
        0,
        CellValue::Text("HELLO".into()),
    );
    seed_cell(
        &storage,
        &mut grid,
        sid,
        2,
        0,
        CellValue::Text("Hello".into()),
    );

    let result = remove_duplicates(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        2,
        0,
        &RemoveDuplicatesOptions {
            has_headers: false,
            columns_to_compare: vec![],
            case_sensitive: false,
        },
    );

    assert_eq!(result.duplicates_found, 2);
    assert_eq!(result.unique_values_remaining, 1);
}

#[test]
fn test_remove_duplicates_case_sensitive() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Text("hello".into()),
    );
    seed_cell(
        &storage,
        &mut grid,
        sid,
        1,
        0,
        CellValue::Text("HELLO".into()),
    );

    let result = remove_duplicates(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        1,
        0,
        &RemoveDuplicatesOptions {
            has_headers: false,
            columns_to_compare: vec![],
            case_sensitive: true,
        },
    );

    assert_eq!(result.duplicates_found, 0);
    assert_eq!(result.unique_values_remaining, 2);
}

#[test]
fn test_remove_duplicates_specific_columns() {
    let (storage, sid, mut grid) = storage_with_sheet();
    // Row 0: A, 1
    seed_cell(&storage, &mut grid, sid, 0, 0, CellValue::Text("A".into()));
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        1,
        CellValue::Number(FiniteF64::must(1.0)),
    );
    // Row 1: A, 2 (same col 0, different col 1)
    seed_cell(&storage, &mut grid, sid, 1, 0, CellValue::Text("A".into()));
    seed_cell(
        &storage,
        &mut grid,
        sid,
        1,
        1,
        CellValue::Number(FiniteF64::must(2.0)),
    );
    // Row 2: B, 1
    seed_cell(&storage, &mut grid, sid, 2, 0, CellValue::Text("B".into()));
    seed_cell(
        &storage,
        &mut grid,
        sid,
        2,
        1,
        CellValue::Number(FiniteF64::must(1.0)),
    );

    // Compare only column 0
    let result = remove_duplicates(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        2,
        1,
        &RemoveDuplicatesOptions {
            has_headers: false,
            columns_to_compare: vec![0],
            case_sensitive: true,
        },
    );

    // "A" appears twice in col 0 -> 1 duplicate
    assert_eq!(result.duplicates_found, 1);
    assert_eq!(result.unique_values_remaining, 2);
}

#[test]
fn test_remove_duplicates_multi_column_key() {
    let (storage, sid, mut grid) = storage_with_sheet();
    // Row 0: A, 1
    seed_cell(&storage, &mut grid, sid, 0, 0, CellValue::Text("A".into()));
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        1,
        CellValue::Number(FiniteF64::must(1.0)),
    );
    // Row 1: A, 1 (exact duplicate)
    seed_cell(&storage, &mut grid, sid, 1, 0, CellValue::Text("A".into()));
    seed_cell(
        &storage,
        &mut grid,
        sid,
        1,
        1,
        CellValue::Number(FiniteF64::must(1.0)),
    );
    // Row 2: A, 2 (different col 1)
    seed_cell(&storage, &mut grid, sid, 2, 0, CellValue::Text("A".into()));
    seed_cell(
        &storage,
        &mut grid,
        sid,
        2,
        1,
        CellValue::Number(FiniteF64::must(2.0)),
    );

    // Compare both columns
    let result = remove_duplicates(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        2,
        1,
        &RemoveDuplicatesOptions {
            has_headers: false,
            columns_to_compare: vec![0, 1],
            case_sensitive: true,
        },
    );

    assert_eq!(result.duplicates_found, 1);
    assert_eq!(result.unique_values_remaining, 2);
}

#[test]
fn test_remove_duplicates_empty_cells() {
    let (storage, sid, mut grid) = storage_with_sheet();
    // Two rows with no data -> both have empty key -> second is dup
    // (no cells seeded means empty values for both)

    let result = remove_duplicates(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        1,
        0,
        &RemoveDuplicatesOptions {
            has_headers: false,
            columns_to_compare: vec![],
            case_sensitive: true,
        },
    );

    assert_eq!(result.duplicates_found, 1);
    assert_eq!(result.unique_values_remaining, 1);
}

#[test]
fn test_remove_duplicates_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let mut grid = GridIndex::new(make_sheet_id(999), 10, 10, Arc::new(IdAllocator::new()));
    let result = remove_duplicates(
        storage.doc(),
        &storage.sheets_ref(),
        make_sheet_id(999),
        &mut grid,
        0,
        0,
        5,
        5,
        &RemoveDuplicatesOptions {
            has_headers: false,
            columns_to_compare: vec![],
            case_sensitive: true,
        },
    );

    assert_eq!(result.duplicates_found, 0);
    assert_eq!(result.duplicates_removed, 0);
    assert_eq!(result.unique_values_remaining, 0);
}

#[test]
fn test_remove_duplicates_numeric_values() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Number(FiniteF64::must(42.0)),
    );
    seed_cell(
        &storage,
        &mut grid,
        sid,
        1,
        0,
        CellValue::Number(FiniteF64::must(42.0)),
    );
    seed_cell(
        &storage,
        &mut grid,
        sid,
        2,
        0,
        CellValue::Number(FiniteF64::must(99.0)),
    );

    let result = remove_duplicates(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        2,
        0,
        &RemoveDuplicatesOptions {
            has_headers: false,
            columns_to_compare: vec![],
            case_sensitive: true,
        },
    );

    assert_eq!(result.duplicates_found, 1);
    assert_eq!(result.unique_values_remaining, 2);
}

#[test]
fn test_remove_duplicates_compaction_order() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(&storage, &mut grid, sid, 0, 0, CellValue::Text("A".into()));
    seed_cell(&storage, &mut grid, sid, 1, 0, CellValue::Text("B".into()));
    seed_cell(&storage, &mut grid, sid, 2, 0, CellValue::Text("A".into())); // dup of row 0
    seed_cell(&storage, &mut grid, sid, 3, 0, CellValue::Text("C".into()));

    let result = remove_duplicates(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        3,
        0,
        &RemoveDuplicatesOptions {
            has_headers: false,
            columns_to_compare: vec![],
            case_sensitive: true,
        },
    );

    assert_eq!(result.duplicates_found, 1);
    assert_eq!(result.unique_values_remaining, 3);

    // After compaction: rows should be A, B, C (row 2 dup removed, C moved up)
    assert_eq!(read_value_at(&storage, &grid, sid, 0, 0), "A");
    assert_eq!(read_value_at(&storage, &grid, sid, 1, 0), "B");
    assert_eq!(read_value_at(&storage, &grid, sid, 2, 0), "C");
    // Row 3 should be cleared
    assert_eq!(read_value_at(&storage, &grid, sid, 3, 0), "");
}

#[test]
fn test_remove_duplicates_empty_columns_to_compare() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(&storage, &mut grid, sid, 0, 0, CellValue::Text("A".into()));
    seed_cell(&storage, &mut grid, sid, 1, 0, CellValue::Text("A".into()));

    // Empty columns_to_compare means compare all columns in range
    let result = remove_duplicates(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        1,
        0,
        &RemoveDuplicatesOptions {
            has_headers: false,
            columns_to_compare: vec![],
            case_sensitive: true,
        },
    );

    assert_eq!(result.duplicates_found, 1);
}

#[test]
fn test_remove_duplicates_columns_to_compare_out_of_range() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(&storage, &mut grid, sid, 0, 0, CellValue::Text("A".into()));
    seed_cell(&storage, &mut grid, sid, 1, 0, CellValue::Text("A".into()));

    // columns_to_compare references column 5, but range is 0..0
    let result = remove_duplicates(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        1,
        0,
        &RemoveDuplicatesOptions {
            has_headers: false,
            columns_to_compare: vec![5],
            case_sensitive: true,
        },
    );

    // All columns filtered out -> no comparison possible -> all unique
    assert_eq!(result.duplicates_found, 0);
    assert_eq!(result.unique_values_remaining, 2);
}
