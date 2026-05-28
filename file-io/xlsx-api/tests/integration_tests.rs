//! Integration tests for xlsx-api using real XLSX files from the parser test corpus.
//!
//! These tests exercise the public API against actual .xlsx files to verify
//! end-to-end behavior: parse, lazy loading, and export round-trip.

use xlsx_api::lazy::LazyWorkbook;
use xlsx_api::{ParseOptions, XlsxApiError, parse, parse_with_options};

// =============================================================================
// Helpers
// =============================================================================

fn test_corpus_path(relative: &str) -> std::path::PathBuf {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest.join("../xlsx/parser/test-corpus").join(relative)
}

fn read_test_file(relative: &str) -> Vec<u8> {
    std::fs::read(test_corpus_path(relative)).expect(&format!("Failed to read {}", relative))
}

// =============================================================================
// Parse tests
// =============================================================================

#[test]
fn parse_minimal_xlsx_succeeds_with_sheets() {
    let data = read_test_file("basic/minimal.xlsx");
    let wb = parse(&data).expect("parse should succeed for minimal.xlsx");

    assert!(
        !wb.output.sheets.is_empty(),
        "minimal.xlsx should have at least one sheet"
    );
    // Every sheet should have a non-empty name
    for sheet in &wb.output.sheets {
        assert!(!sheet.name.is_empty(), "sheet name should not be empty");
    }
}

#[test]
fn parse_with_strings_xlsx_has_string_cells() {
    let data = read_test_file("basic/with_strings.xlsx");
    let wb = parse(&data).expect("parse should succeed for with_strings.xlsx");

    assert!(
        !wb.output.sheets.is_empty(),
        "with_strings.xlsx should have at least one sheet"
    );

    // At least one cell across all sheets should be a text value
    let has_string_cell = wb.output.sheets.iter().any(|sheet| {
        sheet
            .cells
            .iter()
            .any(|cell| matches!(cell.value, domain_types::CellValue::Text(_)))
    });
    assert!(
        has_string_cell,
        "with_strings.xlsx should contain at least one string cell"
    );
}

#[test]
fn parse_with_profiled_option_succeeds() {
    let data = read_test_file("basic/minimal.xlsx");
    let opts = ParseOptions::new().profiled();
    let _wb = parse_with_options(&data, &opts).expect("profiled parse should succeed");
    // Profiling is no longer exposed through ParsedWorkbook; just verify parse succeeds.
}

#[test]
fn parse_empty_bytes_returns_invalid_archive() {
    let result = parse(&[]);
    match result {
        Err(XlsxApiError::InvalidArchive(_)) => {} // expected
        Err(other) => panic!("Expected InvalidArchive, got: {other}"),
        Ok(_) => panic!("Expected error for empty bytes"),
    }
}

#[test]
fn parse_bad_zip_signature_returns_invalid_archive() {
    let data = read_test_file("malformed/zip/bad_zip_signature.xlsx");
    let result = parse(&data);
    match result {
        Err(XlsxApiError::InvalidArchive(_) | XlsxApiError::CorruptedArchive(_)) => {} // expected
        Err(other) => panic!("Expected InvalidArchive or CorruptedArchive, got: {other}"),
        Ok(_) => panic!("Expected error for bad ZIP signature"),
    }
}

#[test]
fn parse_with_unsupported_option_returns_unsupported_option() {
    let data = read_test_file("basic/minimal.xlsx");

    // max_cells is listed as unsupported
    let opts = ParseOptions::new().max_cells(100);
    let result = parse_with_options(&data, &opts);
    match result {
        Err(XlsxApiError::UnsupportedOption { option, .. }) => {
            assert_eq!(option, "max_cells");
        }
        Err(other) => panic!("Expected UnsupportedOption, got: {other}"),
        Ok(_) => panic!("Expected error for unsupported option"),
    }

    // values_only is also unsupported
    let opts = ParseOptions::new().values_only();
    let result = parse_with_options(&data, &opts);
    match result {
        Err(XlsxApiError::UnsupportedOption { option, .. }) => {
            assert_eq!(option, "values_only");
        }
        Err(other) => panic!("Expected UnsupportedOption, got: {other}"),
        Ok(_) => panic!("Expected error for unsupported option"),
    }
}

// =============================================================================
// Lazy loading tests
// =============================================================================

#[test]
fn lazy_open_minimal_xlsx_reports_sheet_count_and_names() {
    let data = read_test_file("basic/minimal.xlsx");
    let wb = LazyWorkbook::new(&data).expect("lazy open should succeed for minimal.xlsx");

    assert!(
        wb.sheet_count() > 0,
        "minimal.xlsx should have at least one sheet"
    );

    let names = wb.sheet_names();
    assert_eq!(
        names.len(),
        wb.sheet_count(),
        "sheet_names().len() should match sheet_count()"
    );
    for name in &names {
        assert!(!name.is_empty(), "sheet name should not be empty");
    }
}

#[test]
fn lazy_open_with_strings_get_sheet_by_index_and_name() {
    let data = read_test_file("basic/with_strings.xlsx");
    let mut wb = LazyWorkbook::new(&data).expect("lazy open should succeed for with_strings.xlsx");

    // Get sheet by index, capture cell_count before releasing borrow
    let cell_count_by_index = {
        let sheet = wb.get_sheet(0).expect("get_sheet(0) should succeed");
        assert!(
            sheet.cell_count > 0,
            "first sheet of with_strings.xlsx should have cells"
        );
        sheet.cell_count
    };

    // Get the name of the first sheet, then look it up by name
    let first_name = wb.sheet_names()[0].to_string();
    let sheet_by_name = wb
        .get_sheet_by_name(&first_name)
        .expect("get_sheet_by_name should succeed for existing name");
    assert_eq!(
        sheet_by_name.cell_count, cell_count_by_index,
        "same sheet fetched by index and by name should have same cell_count"
    );
}

#[test]
fn lazy_get_sheet_out_of_bounds_returns_error() {
    let data = read_test_file("basic/minimal.xlsx");
    let mut wb = LazyWorkbook::new(&data).expect("lazy open should succeed");

    let count = wb.sheet_count();
    let result = wb.get_sheet(count); // one past the end
    match result {
        Err(XlsxApiError::SheetIndexOutOfBounds { index, count: c }) => {
            assert_eq!(index, count);
            assert_eq!(c, count);
        }
        Err(other) => panic!("Expected SheetIndexOutOfBounds, got: {other}"),
        Ok(_) => panic!("Expected error for out-of-bounds index"),
    }

    // Also try a large index
    let result = wb.get_sheet(9999);
    match result {
        Err(XlsxApiError::SheetIndexOutOfBounds { .. }) => {} // expected
        Err(other) => panic!("Expected SheetIndexOutOfBounds, got: {other}"),
        Ok(_) => panic!("Expected error for large index"),
    }
}

#[test]
fn lazy_get_sheet_by_nonexistent_name_returns_not_found() {
    let data = read_test_file("basic/minimal.xlsx");
    let mut wb = LazyWorkbook::new(&data).expect("lazy open should succeed");

    let result = wb.get_sheet_by_name("ThisSheetDoesNotExist");
    match result {
        Err(XlsxApiError::SheetNotFound(name)) => {
            assert_eq!(name, "ThisSheetDoesNotExist");
        }
        Err(other) => panic!("Expected SheetNotFound, got: {other}"),
        Ok(_) => panic!("Expected error for nonexistent sheet name"),
    }
}

#[test]
fn lazy_open_empty_bytes_returns_invalid_archive() {
    let result = LazyWorkbook::new(&[]);
    match result {
        Err(XlsxApiError::InvalidArchive(_)) => {} // expected
        Err(other) => panic!("Expected InvalidArchive, got: {other}"),
        Ok(_) => panic!("Expected error for empty bytes"),
    }
}

// =============================================================================
// Export round-trip test
// =============================================================================

#[test]
fn export_round_trip_preserves_basic_structure() {
    use xlsx_api::export_from_parse_output;

    // Step 1: Parse the minimal file to get its structure
    let data = read_test_file("basic/minimal.xlsx");
    let original = parse(&data).expect("initial parse should succeed");

    let original_sheet_count = original.output.sheets.len();
    assert!(
        original_sheet_count > 0,
        "need at least one sheet for round-trip"
    );

    // Step 2: Export to bytes via ParseOutput path
    let exported_bytes = export_from_parse_output(&original.output)
        .expect("export_from_parse_output should succeed");
    assert!(
        !exported_bytes.is_empty(),
        "exported bytes should not be empty"
    );

    // Step 3: Re-parse the exported bytes
    let re_parsed = parse(&exported_bytes).expect("re-parse of exported bytes should succeed");

    // Step 4: Verify structure survived the round-trip
    assert_eq!(
        re_parsed.output.sheets.len(),
        original_sheet_count,
        "round-trip should preserve sheet count"
    );

    for (i, (orig_sheet, re_sheet)) in original
        .output
        .sheets
        .iter()
        .zip(re_parsed.output.sheets.iter())
        .enumerate()
    {
        assert_eq!(
            re_sheet.name, orig_sheet.name,
            "sheet {} name should survive round-trip",
            i
        );
    }
}
