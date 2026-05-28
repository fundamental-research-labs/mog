use super::super::*;
use super::fixtures::*;
use crate::storage::YrsStorage;
use cell_types::IdAllocator;
use value_types::{CellValue, FiniteF64};

// ===================================================================
// get_column_headers tests
// ===================================================================

#[test]
fn test_get_column_headers_with_values() {
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
        0,
        1,
        CellValue::Text("Age".into()),
    );
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        2,
        CellValue::Text("City".into()),
    );

    let headers = get_column_headers(storage.doc(), &storage.sheets_ref(), sid, &grid, 0, 0, 2);
    assert_eq!(headers.len(), 3);
    assert_eq!(headers[0].header, "Name");
    assert_eq!(headers[1].header, "Age");
    assert_eq!(headers[2].header, "City");
}

#[test]
fn test_get_column_headers_fallback() {
    let (storage, sid, grid) = storage_with_sheet();
    // No cells seeded at row 0

    let headers = get_column_headers(storage.doc(), &storage.sheets_ref(), sid, &grid, 0, 0, 2);
    assert_eq!(headers.len(), 3);
    assert_eq!(headers[0].header, "Column A");
    assert_eq!(headers[1].header, "Column B");
    assert_eq!(headers[2].header, "Column C");
}

#[test]
fn test_get_column_headers_empty_sheet() {
    let storage = YrsStorage::new();
    let grid = GridIndex::new(make_sheet_id(999), 10, 10, Arc::new(IdAllocator::new()));
    let headers = get_column_headers(
        storage.doc(),
        &storage.sheets_ref(),
        make_sheet_id(999),
        &grid,
        0,
        0,
        2,
    );
    assert_eq!(headers.len(), 3);
    assert_eq!(headers[0].header, "Column A");
}

// ===================================================================
// detect_headers tests
// ===================================================================

#[test]
fn test_detect_headers_text_then_numbers() {
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
        0,
        1,
        CellValue::Text("Score".into()),
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
        1,
        1,
        CellValue::Number(FiniteF64::must(95.0)),
    );

    assert!(detect_headers(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &grid,
        0,
        0,
        1,
        1
    ));
}

#[test]
fn test_detect_headers_numbers_everywhere() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
    );
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        1,
        CellValue::Number(FiniteF64::must(2.0)),
    );
    seed_cell(
        &storage,
        &mut grid,
        sid,
        1,
        0,
        CellValue::Number(FiniteF64::must(3.0)),
    );
    seed_cell(
        &storage,
        &mut grid,
        sid,
        1,
        1,
        CellValue::Number(FiniteF64::must(4.0)),
    );

    assert!(!detect_headers(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &grid,
        0,
        0,
        1,
        1
    ));
}

#[test]
fn test_detect_headers_single_row() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Text("Name".into()),
    );

    assert!(!detect_headers(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &grid,
        0,
        0,
        0,
        0
    ));
}

#[test]
fn test_detect_headers_text_and_text() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Text("Header".into()),
    );
    seed_cell(
        &storage,
        &mut grid,
        sid,
        1,
        0,
        CellValue::Text("Data".into()),
    );

    // Second row has no numbers, so not detected as headers
    assert!(!detect_headers(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &grid,
        0,
        0,
        1,
        0
    ));
}
