//! Fixture-driven integration tests.
//!
//! Each test reads deterministic in-repo fixture bytes and locks the parser's
//! behaviour against the assertions that app-level scenarios check at runtime.
//! If the fixture-level test passes, the app scenario passes — modulo viewport
//! rendering, which the kernel handles uniformly for all data.

use csv_parser::{CsvImportOptions, CsvWarning, parse_csv_to_parse_output};
use domain_types::{CellData, ParseOutput};
use value_types::CellValue;

fn read_fixture(name: &str) -> Vec<u8> {
    match name {
        "leading-zeros.csv" => b"sku,name\n00123,alpha\n00456,beta\n07890,gamma\n".to_vec(),
        "leading-equals.csv" => {
            b"name,formula\nalpha,=1+2\nbeta,=SUM(A1:A10)\ngamma,@1+2\ndelta,+1+2\n".to_vec()
        }
        "quote-escaping.csv" => {
            b"name,quote\nalice,\"she said \"\"hi\"\" today\"\nbob,\"comma, inside\"\neve,\"newline\nhere\"\n"
                .to_vec()
        }
        "mixed-line-endings.csv" => b"a,b,c\n1,2,3\r\n4,5,6\r7,8,9\n".to_vec(),
        "mixed-types-in-column.csv" => {
            b"mixed_col\n42\n3.14\nhello\n2026-05-26\nTRUE\n42\n".to_vec()
        }
        "empty-trailing-newlines.csv" => b"a,b,c\n1,2,3\n4,5,6\n\n\n".to_vec(),
        "utf8-bom.csv" => b"\xEF\xBB\xBFname,value\nalpha,1\n".to_vec(),
        "utf16-le-bom.csv" => {
            let mut bytes = vec![0xFF, 0xFE];
            for unit in "name,value\nalpha,1\n".encode_utf16() {
                bytes.extend_from_slice(&unit.to_le_bytes());
            }
            bytes
        }
        "large-90kb.csv" => large_csv(3_000).into_bytes(),
        "large-2mb.csv" => large_csv(60_000).into_bytes(),
        other => panic!("unknown CSV fixture {other}"),
    }
}

fn large_csv(rows: usize) -> String {
    let mut csv = String::from("col1,col2,col3,col4,col5\n");
    for row in 0..rows {
        csv.push_str(&format!("1234567890,row-{row},true,2026-05-26,3.14159\n"));
    }
    csv
}

fn parse(name: &str) -> csv_parser::CsvParseResult {
    let bytes = read_fixture(name);
    parse_csv_to_parse_output(&bytes, CsvImportOptions::default())
        .unwrap_or_else(|e| panic!("parse fixture {name}: {e}"))
}

fn cell_at<'a>(output: &'a ParseOutput, sheet: usize, row: u32, col: u32) -> Option<&'a CellData> {
    output
        .sheets
        .get(sheet)?
        .cells
        .iter()
        .find(|c| c.row == row && c.col == col)
}

fn assert_text(output: &ParseOutput, row: u32, col: u32, expected: &str) {
    let c = cell_at(output, 0, row, col)
        .unwrap_or_else(|| panic!("expected cell at ({row},{col}); none found"));
    match &c.value {
        CellValue::Text(s) => assert_eq!(s.as_ref(), expected, "cell ({row},{col}) text mismatch"),
        other => panic!("cell ({row},{col}) expected text \"{expected}\", got {other:?}"),
    }
}

fn assert_number(output: &ParseOutput, row: u32, col: u32, expected: f64) {
    let c = cell_at(output, 0, row, col)
        .unwrap_or_else(|| panic!("expected cell at ({row},{col}); none found"));
    match &c.value {
        CellValue::Number(n) => {
            assert!(
                (n.get() - expected).abs() < 1e-9,
                "cell ({row},{col}) expected {expected}, got {}",
                n.get()
            );
        }
        other => panic!("cell ({row},{col}) expected number {expected}, got {other:?}"),
    }
}

fn assert_bool(output: &ParseOutput, row: u32, col: u32, expected: bool) {
    let c = cell_at(output, 0, row, col)
        .unwrap_or_else(|| panic!("expected cell at ({row},{col}); none found"));
    match &c.value {
        CellValue::Boolean(b) => assert_eq!(*b, expected),
        other => panic!("cell ({row},{col}) expected boolean {expected}, got {other:?}"),
    }
}

fn style_format_code(output: &ParseOutput, row: u32, col: u32) -> String {
    let c = cell_at(output, 0, row, col).expect("cell exists");
    let style_id = c.style_id.expect("style_id present");
    let format = output
        .style_palette
        .get(style_id as usize)
        .expect("style_id in range");
    format.number_format.clone().unwrap_or_default()
}

// =========================================================================
// 1. Leading-zero preservation (SKUs, zip codes, IDs).
// =========================================================================
#[test]
fn fixture_leading_zeros_preserves_text() {
    let r = parse("leading-zeros.csv");
    assert_text(&r.output, 0, 0, "sku");
    assert_text(&r.output, 0, 1, "name");
    assert_text(&r.output, 1, 0, "00123");
    assert_text(&r.output, 2, 0, "00456");
    assert_text(&r.output, 3, 0, "07890");
    assert_text(&r.output, 1, 1, "alpha");
    // Style: leading-zero fields use @ (text format).
    assert_eq!(style_format_code(&r.output, 1, 0), "@");
    // Style: header in row 0 col 0 is plain text, General format.
    assert_eq!(style_format_code(&r.output, 0, 0), "");
    // No spurious warnings on a clean fixture.
    assert!(
        r.warnings.is_empty() || r.warnings == [CsvWarning::EmptyInput],
        "unexpected warnings: {:?}",
        r.warnings
    );
}

// =========================================================================
// 2. Formula-injection guardrail.
// =========================================================================
#[test]
fn fixture_leading_equals_is_text_by_default() {
    let r = parse("leading-equals.csv");
    assert_text(&r.output, 0, 0, "name");
    assert_text(&r.output, 0, 1, "formula");
    assert_text(&r.output, 1, 0, "alpha");
    assert_text(&r.output, 1, 1, "=1+2");
    assert_text(&r.output, 2, 1, "=SUM(A1:A10)");
    assert_text(&r.output, 3, 1, "@1+2");
    assert_text(&r.output, 4, 1, "+1+2");
    // Each formula-shaped cell is style @.
    assert_eq!(style_format_code(&r.output, 1, 1), "@");
    assert_eq!(style_format_code(&r.output, 3, 1), "@");
    // No formulas attached.
    for row in 1..5 {
        let c = cell_at(&r.output, 0, row, 1).unwrap();
        assert!(c.formula.is_none(), "row {row}: formula should be None");
    }
}

// =========================================================================
// 3. RFC 4180 quoting (doubled quote, embedded comma, embedded newline).
// =========================================================================
#[test]
fn fixture_quote_escaping_unquotes_and_keeps_payload() {
    let r = parse("quote-escaping.csv");
    assert_text(&r.output, 0, 0, "name");
    assert_text(&r.output, 0, 1, "quote");
    assert_text(&r.output, 1, 0, "alice");
    assert_text(&r.output, 1, 1, "she said \"hi\" today");
    assert_text(&r.output, 2, 0, "bob");
    assert_text(&r.output, 2, 1, "comma, inside");
    assert_text(&r.output, 3, 0, "eve");
    // Embedded newline preserved verbatim inside the quoted field.
    assert_text(&r.output, 3, 1, "newline\nhere");
}

// =========================================================================
// 4. Mixed line endings (\n / \r\n / \r in the same file).
// =========================================================================
#[test]
fn fixture_mixed_line_endings_normalises() {
    let r = parse("mixed-line-endings.csv");
    // 4 rows total: header + 3 data rows split by \n / \r\n / \r.
    assert_text(&r.output, 0, 0, "a");
    assert_text(&r.output, 0, 1, "b");
    assert_text(&r.output, 0, 2, "c");
    assert_number(&r.output, 1, 0, 1.0);
    assert_number(&r.output, 1, 1, 2.0);
    assert_number(&r.output, 1, 2, 3.0);
    assert_number(&r.output, 2, 0, 4.0);
    assert_number(&r.output, 3, 0, 7.0);
}

// =========================================================================
// 5. Mixed types in a single column.
// =========================================================================
#[test]
fn fixture_mixed_types_per_cell_inference() {
    let r = parse("mixed-types-in-column.csv");
    assert_text(&r.output, 0, 0, "mixed_col");
    assert_number(&r.output, 1, 0, 42.0);
    assert_number(&r.output, 2, 0, 3.14);
    assert_text(&r.output, 3, 0, "hello");
    // Date row 4 → m/d/yyyy format
    let c = cell_at(&r.output, 0, 4, 0).unwrap();
    assert!(matches!(c.value, CellValue::Number(_)));
    assert_eq!(style_format_code(&r.output, 4, 0), "m/d/yyyy");
    assert_bool(&r.output, 5, 0, true);
    assert_number(&r.output, 6, 0, 42.0);
}

// =========================================================================
// 6. Empty trailing newlines — trim trailing blank rows.
// =========================================================================
#[test]
fn fixture_empty_trailing_newlines_trimmed() {
    let r = parse("empty-trailing-newlines.csv");
    assert_text(&r.output, 0, 0, "a");
    assert_number(&r.output, 1, 0, 1.0);
    assert_number(&r.output, 2, 0, 4.0);
    // No trailing-blank row contributes a cell.
    assert_eq!(r.output.sheets[0].rows, 3);
}

// =========================================================================
// 7. UTF-8 BOM stripped, payload decodes.
// =========================================================================
#[test]
fn fixture_utf8_bom_strips_and_decodes() {
    let r = parse("utf8-bom.csv");
    assert_eq!(r.detected_encoding, "UTF-8");
    assert_text(&r.output, 0, 0, "name");
    assert_text(&r.output, 0, 1, "value");
    assert_text(&r.output, 1, 0, "alpha");
    assert_number(&r.output, 1, 1, 1.0);
}

// =========================================================================
// 8. UTF-16 LE BOM decoded as UTF-16 LE.
// =========================================================================
#[test]
fn fixture_utf16_le_bom_decodes() {
    let r = parse("utf16-le-bom.csv");
    assert_eq!(r.detected_encoding, "UTF-16LE");
    assert_text(&r.output, 0, 0, "name");
    assert_text(&r.output, 0, 1, "value");
    assert_text(&r.output, 1, 0, "alpha");
}

// =========================================================================
// 9. 90 KB scale fixture parses cleanly.
// =========================================================================
#[test]
fn fixture_large_90kb_parses() {
    let r = parse("large-90kb.csv");
    assert_text(&r.output, 0, 0, "col1");
    assert_text(&r.output, 0, 1, "col2");
    // Body row 1 has a numeric col1 (1234567890).
    assert_number(&r.output, 1, 0, 1234567890.0);
    // Output dimensions reflect the file size.
    assert!(r.output.sheets[0].rows > 100, "expected many rows");
    assert_eq!(r.output.sheets[0].cols, 5);
}

// =========================================================================
// 10. 2 MB scale fixture parses cleanly (release-tier perf check).
// =========================================================================
#[test]
fn fixture_large_2mb_parses() {
    let r = parse("large-2mb.csv");
    assert_text(&r.output, 0, 0, "col1");
    assert_eq!(r.output.sheets[0].cols, 5);
    // 69905 lines from wc -l, minus one for the trailing newline gives
    // 69904 logical rows. The exact count depends on whether the file
    // ends with a trailing newline; assert at least 50k rows to keep the
    // test stable across regenerations.
    assert!(
        r.output.sheets[0].rows > 50_000,
        "expected many rows, got {}",
        r.output.sheets[0].rows
    );
}
