use super::super::*;
use super::fixtures::*;
use value_types::CellValue;

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
    assert_cell_value_is_number(&storage, &grid, sid, 0, 2, None);
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

    assert_cell_value_is_string(&storage, &grid, sid, 0, 2, "00123");
    assert_cell_value_is_string(&storage, &grid, sid, 0, 3, "abc");
    assert_cell_value_is_number(&storage, &grid, sid, 0, 4, Some(42.0));
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
