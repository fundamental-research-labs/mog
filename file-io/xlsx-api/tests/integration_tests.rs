//! Integration tests for xlsx-api using real XLSX files from the parser test corpus.
//!
//! These tests exercise the public API against actual .xlsx files to verify
//! end-to-end behavior: parse and export round-trip.

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

#[test]
fn streamed_file_export_matches_byte_export() {
    let input = read_test_file("basic/with_strings.xlsx");
    let parsed = parse(&input).unwrap();
    let expected = xlsx_api::export_from_parse_output(&parsed.output).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("streamed.xlsx");
    xlsx_api::export_from_parse_output_to_path(&parsed.output, &path).unwrap();
    let actual = std::fs::read(&path).unwrap();
    assert_eq!(actual, expected);
    assert_eq!(
        parse(&actual).unwrap().output.sheets.len(),
        parsed.output.sheets.len()
    );
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn failed_streamed_file_export_preserves_destination_and_cleans_temporary() {
    let input = read_test_file("basic/minimal.xlsx");
    let mut parsed = parse(&input).unwrap();
    parsed.output.workbook_conformance = Some("strict".into());
    assert!(xlsx_api::export_from_parse_output(&parsed.output).is_err());
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("existing.xlsx");
    std::fs::write(&path, &input).unwrap();
    assert!(xlsx_api::export_from_parse_output_to_path(&parsed.output, &path).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), input);
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn streamed_export_propagates_output_failure() {
    struct FailingSink;
    impl std::io::Write for FailingSink {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("output unavailable"))
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let input = read_test_file("basic/minimal.xlsx");
    let parsed = parse(&input).unwrap();
    match xlsx_api::export_from_parse_output_to(&parsed.output, FailingSink) {
        Err(error) => assert!(error.to_string().contains("output unavailable")),
        Ok(_) => panic!("failed sink accepted"),
    }
}

#[test]
fn preserved_mismatched_worksheet_xml_is_exported() {
    let input = read_test_file("basic/minimal.xlsx");
    let mut parsed = parse(&input).unwrap();
    let original_sheet_count = parsed.output.sheets.len();
    parsed.output.sheets[0].worksheet_ext_lst_xml =
        Some(r#"<extLst><ext uri="stream-save-test"><custom></mismatched></ext></extLst>"#.into());
    let exported = xlsx_api::export_from_parse_output(&parsed.output)
        .expect("byte export publishes preserved worksheet XML");
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("existing.xlsx");
    std::fs::write(&path, &input).unwrap();
    xlsx_api::export_from_parse_output_to_path(&parsed.output, &path)
        .expect("file export publishes preserved worksheet XML");
    let written = std::fs::read(&path).unwrap();
    assert_eq!(written, exported);
    assert_eq!(
        parse(&written).unwrap().output.sheets.len(),
        original_sheet_count
    );
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}
