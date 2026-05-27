use super::*;
use crate::storage::YrsStorage;
use cell_types::{CellId, IdAllocator, SheetId};
use value_types::{CellValue, FiniteF64};
use yrs::Transact;

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

/// Create a storage with one sheet and a fresh `GridIndex` (the sole
/// identity authority for tests). The GridIndex is not correlated with
/// the yrs rowOrder/colOrder arrays installed by `add_sheet` — post
/// migration, these functions only consult the GridIndex for identity
/// and only the yrs `cells` map for cell values.
fn storage_with_sheet() -> (YrsStorage, SheetId, GridIndex) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");

    let grid = GridIndex::new(sheet_id, 100, 26, Arc::new(IdAllocator::new()));

    (storage, sheet_id, grid)
}

/// Seed a cell at (row, col) with a CellValue, registering its identity
/// in the GridIndex and persisting its value in the yrs `cells` map.
/// Returns the CellId.
fn seed_cell(
    storage: &YrsStorage,
    grid: &mut GridIndex,
    sheet_id: SheetId,
    row: u32,
    col: u32,
    value: CellValue,
) -> CellId {
    let cell_id = grid.ensure_cell_id(row, col);
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

/// Read the raw string value of a cell at a position via the GridIndex.
fn read_value_at(
    storage: &YrsStorage,
    grid: &GridIndex,
    sheet_id: SheetId,
    row: u32,
    col: u32,
) -> String {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = storage.doc().transact();
    let cells_map = match get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
        Some(m) => m,
        None => return String::new(),
    };
    match grid.cell_id_at(row, col) {
        Some(cell_id) => {
            let cell_hex = id_to_hex(cell_id.as_u128());
            read_cell_value_as_string(&txn, &cells_map, &cell_hex)
        }
        None => String::new(),
    }
}

// ===================================================================
// Pure function tests: split_by_fixed_width
// ===================================================================

#[test]
fn test_split_fixed_width_basic() {
    let result = split_by_fixed_width("Hello World Test", &[5, 11]);
    assert_eq!(result, vec!["Hello", "World", "Test"]);
}

#[test]
fn test_split_fixed_width_empty_value() {
    let result = split_by_fixed_width("", &[5]);
    assert_eq!(result, vec![""]);
}

#[test]
fn test_split_fixed_width_no_breaks() {
    let result = split_by_fixed_width("Hello", &[]);
    assert_eq!(result, vec!["Hello"]);
}

#[test]
fn test_split_fixed_width_unsorted_breaks() {
    let result = split_by_fixed_width("ABCDEFGHIJ", &[6, 3]);
    assert_eq!(result, vec!["ABC", "DEF", "GHIJ"]);
}

#[test]
fn test_split_fixed_width_break_beyond_length() {
    let result = split_by_fixed_width("ABC", &[3, 10]);
    assert_eq!(result, vec!["ABC"]);
}

#[test]
fn test_split_fixed_width_trims_parts() {
    let result = split_by_fixed_width("  AB   CD  ", &[5]);
    assert_eq!(result, vec!["AB", "CD"]);
}

// ===================================================================
// Pure function tests: split_by_delimiter
// ===================================================================

#[test]
fn test_split_delimiter_comma() {
    let re = build_delimiter_regex(&Delimiters::default(), false);
    let result = split_by_delimiter("a,b,c", &re, &TextQualifier::None);
    assert_eq!(result, vec!["a", "b", "c"]);
}

#[test]
fn test_split_delimiter_empty_string() {
    let re = build_delimiter_regex(&Delimiters::default(), false);
    let result = split_by_delimiter("", &re, &TextQualifier::None);
    assert_eq!(result, vec![""]);
}

#[test]
fn test_split_delimiter_no_delimiter() {
    let re = build_delimiter_regex(&Delimiters::default(), false);
    let result = split_by_delimiter("hello", &re, &TextQualifier::None);
    assert_eq!(result, vec!["hello"]);
}

#[test]
fn test_split_delimiter_consecutive_as_one() {
    let re = build_delimiter_regex(&Delimiters::default(), true);
    let result = split_by_delimiter("a,,b,,,c", &re, &TextQualifier::None);
    assert_eq!(result, vec!["a", "b", "c"]);
}

#[test]
fn test_split_delimiter_with_double_quote_qualifier() {
    let re = build_delimiter_regex(&Delimiters::default(), false);
    let result = split_by_delimiter("\"hello,world\",test", &re, &TextQualifier::DoubleQuote);
    assert_eq!(result, vec!["hello,world", "test"]);
}

#[test]
fn test_split_delimiter_escaped_quotes() {
    let re = build_delimiter_regex(&Delimiters::default(), false);
    let result = split_by_delimiter(
        "\"He said \"\"hi\"\"\",done",
        &re,
        &TextQualifier::DoubleQuote,
    );
    assert_eq!(result, vec!["He said \"hi\"", "done"]);
}

#[test]
fn test_split_delimiter_tab() {
    let delimiters = Delimiters {
        tab: true,
        semicolon: false,
        comma: false,
        space: false,
        other: None,
    };
    let re = build_delimiter_regex(&delimiters, false);
    let result = split_by_delimiter("a\tb\tc", &re, &TextQualifier::None);
    assert_eq!(result, vec!["a", "b", "c"]);
}

// ===================================================================
// Pure function tests: build_delimiter_regex
// ===================================================================

#[test]
fn test_build_regex_comma_only() {
    let re = build_delimiter_regex(&Delimiters::default(), false);
    assert!(re.is_match(","));
    assert!(!re.is_match("a"));
}

#[test]
fn test_build_regex_semicolon() {
    let d = Delimiters {
        tab: false,
        semicolon: true,
        comma: false,
        space: false,
        other: None,
    };
    let re = build_delimiter_regex(&d, false);
    assert!(re.is_match(";"));
    assert!(!re.is_match(","));
}

#[test]
fn test_build_regex_multiple_delimiters() {
    let d = Delimiters {
        tab: true,
        semicolon: true,
        comma: true,
        space: true,
        other: None,
    };
    let re = build_delimiter_regex(&d, false);
    assert!(re.is_match(","));
    assert!(re.is_match(";"));
    assert!(re.is_match(" "));
    assert!(re.is_match("\t"));
}

#[test]
fn test_build_regex_other_char() {
    let d = Delimiters {
        tab: false,
        semicolon: false,
        comma: false,
        space: false,
        other: Some("|".to_string()),
    };
    let re = build_delimiter_regex(&d, false);
    assert!(re.is_match("|"));
    assert!(!re.is_match(","));
}

#[test]
fn test_build_regex_empty_defaults_to_comma() {
    let d = Delimiters {
        tab: false,
        semicolon: false,
        comma: false,
        space: false,
        other: None,
    };
    let re = build_delimiter_regex(&d, false);
    assert!(re.is_match(","));
}

#[test]
fn test_build_regex_consecutive() {
    let re = build_delimiter_regex(&Delimiters::default(), true);
    // Should match multiple consecutive commas
    let caps: Vec<_> = re.find_iter(",,,").collect();
    assert_eq!(caps.len(), 1); // One match for the whole run
}

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

// ===================================================================
// text_to_columns tests
// ===================================================================

#[test]
fn test_text_to_columns_comma() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Text("a,b,c".into()),
    );
    seed_cell(
        &storage,
        &mut grid,
        sid,
        1,
        0,
        CellValue::Text("d,e,f".into()),
    );

    let result = text_to_columns(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        1,
        0,
        &TextToColumnsOptions {
            split_type: TextToColumnsSplitType::Delimited,
            delimiters: Delimiters::default(),
            treat_consecutive_as_one: false,
            text_qualifier: TextQualifier::None,
            fixed_width_breaks: vec![],
        },
        &Destination { row: 0, col: 2 },
    );

    assert_eq!(result.rows_processed, 2);
    assert_eq!(result.columns_created, 3);
    assert_eq!(read_value_at(&storage, &grid, sid, 0, 2), "a");
    assert_eq!(read_value_at(&storage, &grid, sid, 0, 3), "b");
    assert_eq!(read_value_at(&storage, &grid, sid, 0, 4), "c");
    assert_eq!(read_value_at(&storage, &grid, sid, 1, 2), "d");
    assert_eq!(read_value_at(&storage, &grid, sid, 1, 3), "e");
    assert_eq!(read_value_at(&storage, &grid, sid, 1, 4), "f");
}

#[test]
fn test_text_to_columns_fixed_width() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Text("ABCDEF".into()),
    );

    let result = text_to_columns(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        0,
        &TextToColumnsOptions {
            split_type: TextToColumnsSplitType::FixedWidth,
            delimiters: Delimiters::default(),
            treat_consecutive_as_one: false,
            text_qualifier: TextQualifier::None,
            fixed_width_breaks: vec![3],
        },
        &Destination { row: 0, col: 2 },
    );

    assert_eq!(result.rows_processed, 1);
    assert_eq!(result.columns_created, 2);
    assert_eq!(read_value_at(&storage, &grid, sid, 0, 2), "ABC");
    assert_eq!(read_value_at(&storage, &grid, sid, 0, 3), "DEF");
}

#[test]
fn test_text_to_columns_number_coercion() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Text("42,hello,3.14".into()),
    );

    let result = text_to_columns(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        0,
        &TextToColumnsOptions {
            split_type: TextToColumnsSplitType::Delimited,
            delimiters: Delimiters::default(),
            treat_consecutive_as_one: false,
            text_qualifier: TextQualifier::None,
            fixed_width_breaks: vec![],
        },
        &Destination { row: 0, col: 2 },
    );

    assert_eq!(result.columns_created, 3);
    // "42" and "3.14" should be stored as numbers — look them up via
    // the GridIndex (the sole identity authority).
    let sheet_hex = id_to_hex(sid.as_u128());
    let txn = storage.doc().transact();
    let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
    let cell_id = grid
        .cell_id_at(0, 2)
        .expect("cell at (0,2) should be registered");
    let cell_hex = id_to_hex(cell_id.as_u128());
    let cell_map = match cells_map.get(&txn, cell_hex.as_str()) {
        Some(Out::YMap(m)) => m,
        _ => panic!("cell not found"),
    };
    assert!(matches!(
        cell_map.get(&txn, KEY_VALUE),
        Some(Out::Any(Any::Number(_)))
    ));
}

#[test]
fn test_text_to_columns_uneven_splits() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Text("a,b,c".into()),
    );
    seed_cell(&storage, &mut grid, sid, 1, 0, CellValue::Text("d".into()));

    let result = text_to_columns(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        1,
        0,
        &TextToColumnsOptions {
            split_type: TextToColumnsSplitType::Delimited,
            delimiters: Delimiters::default(),
            treat_consecutive_as_one: false,
            text_qualifier: TextQualifier::None,
            fixed_width_breaks: vec![],
        },
        &Destination { row: 0, col: 2 },
    );

    assert_eq!(result.columns_created, 3);
    // Row 1 only had "d", so cols 3 and 4 should be empty
    assert_eq!(read_value_at(&storage, &grid, sid, 1, 2), "d");
    assert_eq!(read_value_at(&storage, &grid, sid, 1, 3), "");
    assert_eq!(read_value_at(&storage, &grid, sid, 1, 4), "");
}

#[test]
fn test_has_significant_leading_zero() {
    // Tokens that should be flagged (preserve as string)
    assert!(has_significant_leading_zero("00123"));
    assert!(has_significant_leading_zero("007"));
    assert!(has_significant_leading_zero("0123"));
    assert!(has_significant_leading_zero("0123.45"));
    assert!(has_significant_leading_zero("-007"));
    assert!(has_significant_leading_zero("  00007  ")); // trim whitespace

    // Tokens that should NOT be flagged (ordinary numerics)
    assert!(!has_significant_leading_zero("0"));
    assert!(!has_significant_leading_zero("0.5"));
    assert!(!has_significant_leading_zero("-0.5"));
    assert!(!has_significant_leading_zero("123"));
    assert!(!has_significant_leading_zero("3.14"));
    assert!(!has_significant_leading_zero("hello"));
    assert!(!has_significant_leading_zero(""));
    assert!(!has_significant_leading_zero("-"));
}

#[test]
fn test_text_to_columns_preserves_leading_zeros() {
    // Excel-compatible: "00123" survives split as a string (General format),
    // alphabetic tokens stay strings, plain "42" still coerces to a number.
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Text("00123,abc,42".into()),
    );

    let result = text_to_columns(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        0,
        &TextToColumnsOptions {
            split_type: TextToColumnsSplitType::Delimited,
            delimiters: Delimiters::default(),
            treat_consecutive_as_one: false,
            text_qualifier: TextQualifier::None,
            fixed_width_breaks: vec![],
        },
        &Destination { row: 0, col: 2 },
    );

    assert_eq!(result.columns_created, 3);

    let sheet_hex = id_to_hex(sid.as_u128());
    let txn = storage.doc().transact();
    let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();

    // Col 2: "00123" preserved as string (leading zeros retained)
    let id_a = grid.cell_id_at(0, 2).expect("cell (0,2) registered");
    let map_a = match cells_map.get(&txn, id_to_hex(id_a.as_u128()).as_str()) {
        Some(Out::YMap(m)) => m,
        _ => panic!("cell (0,2) not found"),
    };
    match map_a.get(&txn, KEY_VALUE) {
        Some(Out::Any(Any::String(ref s))) => assert_eq!(s.as_ref(), "00123"),
        other => panic!("expected String(\"00123\"), got {:?}", other),
    }

    // Col 3: "abc" remains a string
    let id_b = grid.cell_id_at(0, 3).expect("cell (0,3) registered");
    let map_b = match cells_map.get(&txn, id_to_hex(id_b.as_u128()).as_str()) {
        Some(Out::YMap(m)) => m,
        _ => panic!("cell (0,3) not found"),
    };
    match map_b.get(&txn, KEY_VALUE) {
        Some(Out::Any(Any::String(ref s))) => assert_eq!(s.as_ref(), "abc"),
        other => panic!("expected String(\"abc\"), got {:?}", other),
    }

    // Col 4: "42" coerces to a Number
    let id_c = grid.cell_id_at(0, 4).expect("cell (0,4) registered");
    let map_c = match cells_map.get(&txn, id_to_hex(id_c.as_u128()).as_str()) {
        Some(Out::YMap(m)) => m,
        _ => panic!("cell (0,4) not found"),
    };
    match map_c.get(&txn, KEY_VALUE) {
        Some(Out::Any(Any::Number(n))) => assert!((n - 42.0).abs() < 1e-9),
        other => panic!("expected Number(42), got {:?}", other),
    }
}

// ===================================================================
// preview_text_to_columns tests
// ===================================================================

#[test]
fn test_preview_text_to_columns_basic() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Text("a,b,c".into()),
    );
    seed_cell(
        &storage,
        &mut grid,
        sid,
        1,
        0,
        CellValue::Text("d,e".into()),
    );

    let preview = preview_text_to_columns(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &grid,
        0,
        1,
        0,
        &TextToColumnsOptions {
            split_type: TextToColumnsSplitType::Delimited,
            delimiters: Delimiters::default(),
            treat_consecutive_as_one: false,
            text_qualifier: TextQualifier::None,
            fixed_width_breaks: vec![],
        },
        10,
    );

    assert_eq!(preview.len(), 2);
    assert_eq!(preview[0], vec!["a", "b", "c"]);
    assert_eq!(preview[1], vec!["d", "e"]);
}

#[test]
fn test_preview_text_to_columns_limited_rows() {
    let (storage, sid, mut grid) = storage_with_sheet();
    for i in 0..10 {
        seed_cell(
            &storage,
            &mut grid,
            sid,
            i,
            0,
            CellValue::Text(format!("row{}", i).into()),
        );
    }

    let preview = preview_text_to_columns(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &grid,
        0,
        9,
        0,
        &TextToColumnsOptions {
            split_type: TextToColumnsSplitType::Delimited,
            delimiters: Delimiters::default(),
            treat_consecutive_as_one: false,
            text_qualifier: TextQualifier::None,
            fixed_width_breaks: vec![],
        },
        3,
    );

    assert_eq!(preview.len(), 3);
}

#[test]
fn test_preview_does_not_modify() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Text("a,b,c".into()),
    );

    let _preview = preview_text_to_columns(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &grid,
        0,
        0,
        0,
        &TextToColumnsOptions {
            split_type: TextToColumnsSplitType::Delimited,
            delimiters: Delimiters::default(),
            treat_consecutive_as_one: false,
            text_qualifier: TextQualifier::None,
            fixed_width_breaks: vec![],
        },
        5,
    );

    // Original cell should be unchanged
    assert_eq!(read_value_at(&storage, &grid, sid, 0, 0), "a,b,c");
    // Destination cells should not exist
    assert_eq!(read_value_at(&storage, &grid, sid, 0, 1), "");
}

// ===================================================================
// Edge case tests
// ===================================================================

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

#[test]
fn test_text_to_columns_empty_source() {
    let (storage, sid, mut grid) = storage_with_sheet();
    // No cells seeded in the source column

    let result = text_to_columns(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        2,
        0,
        &TextToColumnsOptions {
            split_type: TextToColumnsSplitType::Delimited,
            delimiters: Delimiters::default(),
            treat_consecutive_as_one: false,
            text_qualifier: TextQualifier::None,
            fixed_width_breaks: vec![],
        },
        &Destination { row: 0, col: 2 },
    );

    assert_eq!(result.rows_processed, 3);
    // Empty strings split by comma give [""] so 1 column
    assert_eq!(result.columns_created, 1);
}

#[test]
fn test_text_to_columns_semicolon_delimiter() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Text("x;y;z".into()),
    );

    let result = text_to_columns(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        0,
        &TextToColumnsOptions {
            split_type: TextToColumnsSplitType::Delimited,
            delimiters: Delimiters {
                tab: false,
                semicolon: true,
                comma: false,
                space: false,
                other: None,
            },
            treat_consecutive_as_one: false,
            text_qualifier: TextQualifier::None,
            fixed_width_breaks: vec![],
        },
        &Destination { row: 0, col: 2 },
    );

    assert_eq!(result.columns_created, 3);
    assert_eq!(read_value_at(&storage, &grid, sid, 0, 2), "x");
    assert_eq!(read_value_at(&storage, &grid, sid, 0, 3), "y");
    assert_eq!(read_value_at(&storage, &grid, sid, 0, 4), "z");
}

#[test]
fn test_text_to_columns_with_text_qualifier() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Text("\"hello,world\",test".into()),
    );

    let result = text_to_columns(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        0,
        &TextToColumnsOptions {
            split_type: TextToColumnsSplitType::Delimited,
            delimiters: Delimiters::default(),
            treat_consecutive_as_one: false,
            text_qualifier: TextQualifier::DoubleQuote,
            fixed_width_breaks: vec![],
        },
        &Destination { row: 0, col: 2 },
    );

    assert_eq!(result.columns_created, 2);
    assert_eq!(read_value_at(&storage, &grid, sid, 0, 2), "hello,world");
    assert_eq!(read_value_at(&storage, &grid, sid, 0, 3), "test");
}
