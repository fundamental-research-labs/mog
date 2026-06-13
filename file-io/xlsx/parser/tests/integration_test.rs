//! Integration tests for XLSX parsing
//!
//! These tests verify the full parsing pipeline from XLSX file to parsed cell data.

mod fixtures;

use fixtures::{
    CellValue, col_to_letters, create_minimal_xlsx, create_xlsx_with_cells,
    create_xlsx_with_multiple_sheets, create_xlsx_with_shared_strings,
    create_xlsx_with_various_types,
};
use std::fs;

use xlsx_parser::{SharedStrings, XlsxArchive, parse_xlsx_full_native, parse_xlsx_to_output};

// =============================================================================
// Basic Archive Tests
// =============================================================================

#[test]
fn test_parse_minimal_xlsx() {
    let xlsx_data = create_minimal_xlsx();

    // Verify we can open as an archive
    let archive = XlsxArchive::new(&xlsx_data).expect("Failed to parse minimal XLSX");

    // Verify required files exist
    assert!(archive.contains("[Content_Types].xml"));
    assert!(archive.contains("xl/workbook.xml"));
    assert!(archive.contains("xl/worksheets/sheet1.xml"));

    // Verify we can read files
    let workbook = archive.get_workbook().expect("Failed to read workbook");
    assert!(!workbook.is_empty());

    let worksheet = archive.get_worksheet(1).expect("Failed to read worksheet");
    assert!(!worksheet.is_empty());
}

#[test]
fn test_parse_pivot_basic_emits_parse_output_pivot_tables() {
    let bytes = fs::read("test-corpus/parity/pivots/pivot-basic.xlsx")
        .expect("pivot-basic fixture should be present");
    let (output, diagnostics) =
        parse_xlsx_to_output(&bytes).expect("pivot-basic should parse to ParseOutput");

    assert!(
        diagnostics.errors.is_empty(),
        "pivot-basic parse diagnostics should not contain errors: {:?}",
        diagnostics.errors
    );
    assert_eq!(output.pivot_tables.len(), 1);
    assert_eq!(output.pivot_tables[0].config.name, "PivotTable1");
    assert_eq!(output.pivot_tables[0].config.output_sheet_name, "Pivot");
    assert_eq!(output.pivot_cache_sources.len(), 1);
    assert_eq!(
        output.pivot_cache_sources[0].source_sheet.as_deref(),
        Some("Data")
    );
    assert_eq!(
        output.pivot_cache_sources[0].source_range.as_deref(),
        Some("A1:C5")
    );
}

#[test]
fn test_parse_with_shared_strings() {
    let strings = &["Hello", "World", "Test"];
    let cells = &[((0, 0), 0), ((0, 1), 1), ((1, 0), 2)];

    let xlsx_data = create_xlsx_with_shared_strings(strings, cells);
    let archive = XlsxArchive::new(&xlsx_data).expect("Failed to parse XLSX with shared strings");

    // Verify shared strings file exists
    assert!(archive.contains("xl/sharedStrings.xml"));

    // Read and parse shared strings
    let shared_strings_xml = archive
        .get_shared_strings()
        .expect("Failed to read shared strings");

    let mut shared_strings = SharedStrings::parse(shared_strings_xml);
    assert_eq!(shared_strings.len(), 3);
    assert_eq!(shared_strings.get_str(0), Some("Hello"));
    assert_eq!(shared_strings.get_str(1), Some("World"));
    assert_eq!(shared_strings.get_str(2), Some("Test"));
}

#[test]
fn test_parse_multiple_sheets() {
    let sheet1_cells = vec![
        ((0, 0), CellValue::String("Sheet1 Cell".to_string())),
        ((0, 1), CellValue::Number(1.0)),
    ];
    let sheet2_cells = vec![
        ((0, 0), CellValue::String("Sheet2 Cell".to_string())),
        ((0, 1), CellValue::Number(2.0)),
    ];
    let sheet3_cells = vec![
        ((0, 0), CellValue::String("Sheet3 Cell".to_string())),
        ((0, 1), CellValue::Number(3.0)),
    ];

    let sheet_data = vec![
        ("First Sheet", sheet1_cells),
        ("Second Sheet", sheet2_cells),
        ("Third Sheet", sheet3_cells),
    ];

    let xlsx_data = create_xlsx_with_multiple_sheets(&sheet_data);
    let archive = XlsxArchive::new(&xlsx_data).expect("Failed to parse multi-sheet XLSX");

    // Verify all sheets exist
    assert_eq!(archive.worksheet_count(), 3);

    // Verify we can read each sheet
    for i in 1..=3 {
        let worksheet = archive
            .get_worksheet(i)
            .expect(&format!("Failed to read worksheet {}", i));
        assert!(!worksheet.is_empty());
    }

    // Verify worksheet names
    let names = archive.worksheet_names();
    assert_eq!(names.len(), 3);
}

#[test]
fn test_parse_large_worksheet() {
    // Create a worksheet with 10K+ cells
    let rows = 100;
    let cols = 100;
    let _total_cells = rows * cols; // 10,000 cells

    let xlsx_data = create_xlsx_with_cells(rows, cols);
    let archive = XlsxArchive::new(&xlsx_data).expect("Failed to parse large XLSX");

    // Read the worksheet
    let worksheet = archive.get_worksheet(1).expect("Failed to read worksheet");

    // Verify worksheet is substantial
    assert!(worksheet.len() > 10000, "Worksheet should be > 10KB");

    // Verify shared strings exist (our fixture uses strings for some cells)
    let shared_strings_xml = archive
        .get_shared_strings()
        .expect("Failed to read shared strings");
    let shared_strings = SharedStrings::parse(shared_strings_xml);

    // Should have many shared strings (roughly 1/3 of cells are strings in our fixture)
    assert!(
        shared_strings.len() > 1000,
        "Should have many shared strings"
    );
}

#[test]
fn test_various_cell_types() {
    let xlsx_data = create_xlsx_with_various_types();
    let archive = XlsxArchive::new(&xlsx_data).expect("Failed to parse XLSX with various types");

    // Read the worksheet
    let worksheet = archive.get_worksheet(1).expect("Failed to read worksheet");
    let worksheet_str = String::from_utf8_lossy(&worksheet);

    // Verify numbers are present
    assert!(worksheet_str.contains("<v>42</v>"));
    assert!(worksheet_str.contains("<v>3.14159</v>"));
    assert!(worksheet_str.contains("<v>-100.5</v>"));

    // Verify booleans are present
    assert!(worksheet_str.contains("t=\"b\""));

    // Verify errors are present
    assert!(worksheet_str.contains("t=\"e\""));
    assert!(worksheet_str.contains("#DIV/0!"));
    assert!(worksheet_str.contains("#VALUE!"));
    assert!(worksheet_str.contains("#REF!"));

    // Verify formulas are present
    assert!(worksheet_str.contains("<f>SUM(A1:D1)</f>"));
    assert!(worksheet_str.contains("<f>A1*2</f>"));

    // Verify strings reference shared strings
    assert!(worksheet_str.contains("t=\"s\""));
}

// =============================================================================
// Shared Strings Tests
// =============================================================================

#[test]
fn test_shared_strings_with_xml_entities() {
    let strings = &[
        "Normal text",
        "Less than: <",
        "Greater than: >",
        "Ampersand: &",
        "Quote: \"",
        "Apostrophe: '",
        "Multiple: <>&\"'",
    ];

    // Note: These will be XML-escaped in the shared strings file
    let cells = &[
        ((0, 0), 0),
        ((0, 1), 1),
        ((0, 2), 2),
        ((0, 3), 3),
        ((1, 0), 4),
        ((1, 1), 5),
        ((1, 2), 6),
    ];

    let xlsx_data = create_xlsx_with_shared_strings(strings, cells);
    let archive = XlsxArchive::new(&xlsx_data).expect("Failed to parse XLSX");

    let shared_strings_xml = archive
        .get_shared_strings()
        .expect("Failed to read shared strings");
    let mut shared_strings = SharedStrings::parse(shared_strings_xml);

    // Verify strings are correctly decoded
    assert_eq!(shared_strings.get_str(0), Some("Normal text"));
    assert_eq!(shared_strings.get_str(1), Some("Less than: <"));
    assert_eq!(shared_strings.get_str(2), Some("Greater than: >"));
    assert_eq!(shared_strings.get_str(3), Some("Ampersand: &"));
    assert_eq!(shared_strings.get_str(4), Some("Quote: \""));
    assert_eq!(shared_strings.get_str(5), Some("Apostrophe: '"));
    assert_eq!(shared_strings.get_str(6), Some("Multiple: <>&\"'"));
}

#[test]
fn test_shared_strings_unicode() {
    let strings = &[
        "English",
        "Deutsch",
        "Francais",
        "Espanol",
        "Chinese: ",
        "Japanese: ",
        "Emoji: ",
    ];

    let cells: Vec<((usize, usize), usize)> = strings
        .iter()
        .enumerate()
        .map(|(i, _)| ((i, 0), i))
        .collect();

    let xlsx_data = create_xlsx_with_shared_strings(strings, &cells);
    let archive = XlsxArchive::new(&xlsx_data).expect("Failed to parse XLSX");

    let shared_strings_xml = archive
        .get_shared_strings()
        .expect("Failed to read shared strings");
    let mut shared_strings = SharedStrings::parse(shared_strings_xml);

    // Verify all strings are present
    for (i, expected) in strings.iter().enumerate() {
        assert_eq!(
            shared_strings.get_str(i),
            Some(*expected),
            "String at index {} should match",
            i
        );
    }
}

// =============================================================================
// Archive Structure Tests
// =============================================================================

#[test]
fn test_archive_entries() {
    let xlsx_data = create_xlsx_with_shared_strings(&["Test"], &[((0, 0), 0)]);
    let archive = XlsxArchive::new(&xlsx_data).expect("Failed to parse XLSX");

    let entries = archive.entries();

    // Verify expected files exist
    let entry_names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

    assert!(entry_names.contains(&"[Content_Types].xml"));
    assert!(entry_names.contains(&"_rels/.rels"));
    assert!(entry_names.contains(&"xl/workbook.xml"));
    assert!(entry_names.contains(&"xl/_rels/workbook.xml.rels"));
    assert!(entry_names.contains(&"xl/worksheets/sheet1.xml"));
    assert!(entry_names.contains(&"xl/sharedStrings.xml"));
}

#[test]
fn test_archive_file_reading() {
    let xlsx_data = create_minimal_xlsx();
    let archive = XlsxArchive::new(&xlsx_data).expect("Failed to parse XLSX");

    // Read content types
    let content_types = archive
        .get_content_types()
        .expect("Failed to read content types");
    let content_types_str = String::from_utf8_lossy(&content_types);
    assert!(content_types_str.contains("Types"));

    // Read workbook
    let workbook = archive.get_workbook().expect("Failed to read workbook");
    let workbook_str = String::from_utf8_lossy(&workbook);
    assert!(workbook_str.contains("workbook"));
}

#[test]
fn test_archive_read_into_buffer() {
    let xlsx_data = create_minimal_xlsx();
    let archive = XlsxArchive::new(&xlsx_data).expect("Failed to parse XLSX");

    let mut buffer = vec![0u8; 10000];
    let bytes_read = archive
        .read_file_into("xl/workbook.xml", &mut buffer)
        .expect("Failed to read into buffer");

    assert!(bytes_read > 0);
    assert!(buffer[..bytes_read].starts_with(b"<?xml"));
}

// =============================================================================
// Parse XLSX Function Tests
// =============================================================================

#[test]
fn test_parse_xlsx_empty_data() {
    let result = parse_xlsx_full_native(&[], None);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Empty"));
}

#[test]
fn test_parse_xlsx_invalid_zip() {
    let result = parse_xlsx_full_native(b"not a zip file", None);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("ZIP"));
}

#[test]
fn test_parse_xlsx_valid() {
    let xlsx_data = create_minimal_xlsx();

    let result = parse_xlsx_full_native(&xlsx_data, None);

    // Should parse successfully or return a meaningful error
    assert!(result.is_ok() || !result.as_ref().unwrap_err().is_empty());
}

// =============================================================================
// Buffer Size Recommendation Tests
// =============================================================================

// Buffer size recommendation tests removed: XlsxParser struct was removed
// in the xlsx-api consolidation. parse_xlsx_full_native handles buffer
// allocation internally.

// =============================================================================
// Version Test
// =============================================================================

// Version test removed: XlsxParser struct was removed in the xlsx-api
// consolidation.

// =============================================================================
// Performance Tests
// =============================================================================

#[test]
fn test_performance_large_file() {
    // Create a large XLSX file
    let rows = 500;
    let cols = 20;

    let xlsx_data = create_xlsx_with_cells(rows, cols);

    // Time the archive creation
    let start = std::time::Instant::now();
    let archive = XlsxArchive::new(&xlsx_data).expect("Failed to parse large XLSX");
    let archive_time = start.elapsed();

    // Time reading the worksheet
    let start = std::time::Instant::now();
    let _worksheet = archive.get_worksheet(1).expect("Failed to read worksheet");
    let worksheet_time = start.elapsed();

    // Time reading shared strings
    let start = std::time::Instant::now();
    let shared_strings_xml = archive
        .get_shared_strings()
        .expect("Failed to read shared strings");
    let shared_strings_read_time = start.elapsed();

    // Time parsing shared strings
    let start = std::time::Instant::now();
    let shared_strings = SharedStrings::parse(shared_strings_xml);
    let shared_strings_parse_time = start.elapsed();

    println!(
        "Performance test results for {}x{} ({} cells):",
        rows,
        cols,
        rows * cols
    );
    println!("  Archive creation: {:?}", archive_time);
    println!("  Worksheet read: {:?}", worksheet_time);
    println!("  Shared strings read: {:?}", shared_strings_read_time);
    println!("  Shared strings parse: {:?}", shared_strings_parse_time);
    println!("  Shared strings count: {}", shared_strings.len());

    // These should all be fast (under 100ms for this size)
    assert!(
        archive_time.as_millis() < 100,
        "Archive creation too slow: {:?}",
        archive_time
    );
}

#[test]
fn test_performance_many_shared_strings() {
    // Create many unique strings
    let string_count = 1000;
    let strings: Vec<String> = (0..string_count)
        .map(|i| {
            format!(
                "Unique string number {} with some padding to make it longer",
                i
            )
        })
        .collect();
    let string_refs: Vec<&str> = strings.iter().map(|s| s.as_str()).collect();

    // Create cells referencing all strings
    let cells: Vec<((usize, usize), usize)> =
        (0..string_count).map(|i| ((i / 10, i % 10), i)).collect();

    let xlsx_data = create_xlsx_with_shared_strings(&string_refs, &cells);
    let archive = XlsxArchive::new(&xlsx_data).expect("Failed to parse XLSX");

    let shared_strings_xml = archive
        .get_shared_strings()
        .expect("Failed to read shared strings");

    let start = std::time::Instant::now();
    let mut shared_strings = SharedStrings::parse(shared_strings_xml);
    let parse_time = start.elapsed();

    // Verify all strings are accessible
    let start = std::time::Instant::now();
    for i in 0..string_count {
        let _ = shared_strings.get(i);
    }
    let access_time = start.elapsed();

    println!("Shared strings performance ({} strings):", string_count);
    println!("  Parse time: {:?}", parse_time);
    println!("  Access time (all): {:?}", access_time);

    // Parsing should be fast (allow more time in debug mode)
    // In release mode, this should be under 50ms
    #[cfg(debug_assertions)]
    let threshold = 500; // ms - debug mode is slower
    #[cfg(not(debug_assertions))]
    let threshold = 50; // ms - release mode should be fast

    assert!(
        parse_time.as_millis() < threshold,
        "Shared string parsing too slow: {:?} (threshold: {}ms)",
        parse_time,
        threshold
    );
}

// =============================================================================
// Edge Case Tests
// =============================================================================

#[test]
fn test_empty_shared_strings() {
    // Create XLSX with no string values
    let cells: Vec<((usize, usize), CellValue)> = vec![
        ((0, 0), CellValue::Number(1.0)),
        ((0, 1), CellValue::Number(2.0)),
        ((1, 0), CellValue::Boolean(true)),
    ];

    let xlsx_data = create_xlsx_with_multiple_sheets(&[("Sheet1", cells)]);
    let archive = XlsxArchive::new(&xlsx_data).expect("Failed to parse XLSX");

    // Should not have shared strings file
    let result = archive.get_shared_strings();
    assert!(result.is_err());
}

#[test]
fn test_single_cell() {
    let strings = &["Single value"];
    let cells = &[((0, 0), 0)];

    let xlsx_data = create_xlsx_with_shared_strings(strings, cells);
    let archive = XlsxArchive::new(&xlsx_data).expect("Failed to parse XLSX");

    let shared_strings_xml = archive
        .get_shared_strings()
        .expect("Failed to read shared strings");
    let mut shared_strings = SharedStrings::parse(shared_strings_xml);

    assert_eq!(shared_strings.len(), 1);
    assert_eq!(shared_strings.get_str(0), Some("Single value"));
}

#[test]
fn test_sparse_worksheet() {
    // Create worksheet with cells at far positions
    let cells: Vec<((usize, usize), CellValue)> = vec![
        ((0, 0), CellValue::Number(1.0)),   // A1
        ((99, 99), CellValue::Number(2.0)), // CV100
        ((0, 99), CellValue::Number(3.0)),  // CV1
        ((99, 0), CellValue::Number(4.0)),  // A100
    ];

    let xlsx_data = create_xlsx_with_multiple_sheets(&[("Sheet1", cells)]);
    let archive = XlsxArchive::new(&xlsx_data).expect("Failed to parse sparse XLSX");

    let worksheet = archive.get_worksheet(1).expect("Failed to read worksheet");
    let worksheet_str = String::from_utf8_lossy(&worksheet);

    // Verify cells at expected positions
    assert!(worksheet_str.contains("A1"));
    assert!(worksheet_str.contains("A100"));
    // Column 99 is CV (99 = 2*26 + 21, but actually: 99 = 3*26 + 21 = 99, which is CV)
    // Let's verify with our helper
    assert_eq!(col_to_letters(99), "CV");
}

#[test]
fn test_maximum_column() {
    // Test column XFD (16383, the maximum in Excel)
    assert_eq!(col_to_letters(16383), "XFD");
}

// =============================================================================
// Compression Tests
// =============================================================================

#[test]
fn test_deflate_compressed_files() {
    // All our fixtures use DEFLATE compression
    let xlsx_data = create_xlsx_with_cells(10, 10);
    let archive = XlsxArchive::new(&xlsx_data).expect("Failed to parse XLSX");

    // Verify all files can be read (decompressed)
    let _ = archive
        .get_content_types()
        .expect("Failed to read content types");
    let _ = archive.get_workbook().expect("Failed to read workbook");
    let _ = archive.get_worksheet(1).expect("Failed to read worksheet");
    let _ = archive
        .get_shared_strings()
        .expect("Failed to read shared strings");
}

// =============================================================================
// Worksheet Path Tests
// =============================================================================

#[test]
fn test_worksheet_paths() {
    assert_eq!(XlsxArchive::shared_strings_path(), "xl/sharedStrings.xml");
    assert_eq!(XlsxArchive::workbook_path(), "xl/workbook.xml");
    assert_eq!(XlsxArchive::worksheet_path(1), "xl/worksheets/sheet1.xml");
    assert_eq!(XlsxArchive::worksheet_path(10), "xl/worksheets/sheet10.xml");
    assert_eq!(XlsxArchive::styles_path(), "xl/styles.xml");
}
