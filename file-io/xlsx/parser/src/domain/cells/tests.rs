//! Tests for the cell parser module.

#![cfg(test)]

use super::*;
use crate::common::range::RowHeight;

// Helpers copy packed fields by value, avoiding references to unaligned fields.
impl CellData {
    #[inline]
    fn get_row(&self) -> u32 {
        self.row
    }
    #[inline]
    fn get_col(&self) -> u32 {
        self.col
    }
    #[inline]
    fn get_cell_type(&self) -> u8 {
        self.cell_type
    }
    #[inline]
    fn get_style_idx(&self) -> u16 {
        self.style_idx
    }
    #[inline]
    fn get_value_offset(&self) -> u32 {
        self.value_offset
    }
    #[inline]
    fn get_value_len(&self) -> u32 {
        self.value_len
    }
}

// Mock scanner functions for testing
#[allow(dead_code)]
mod scanner_mock {
    pub fn find_byte(xml: &[u8], byte: u8, start: usize) -> Option<usize> {
        xml[start..]
            .iter()
            .position(|&b| b == byte)
            .map(|p| p + start)
    }

    pub fn find_sequence(xml: &[u8], seq: &[u8], start: usize) -> Option<usize> {
        if seq.is_empty() || start + seq.len() > xml.len() {
            return None;
        }
        xml[start..]
            .windows(seq.len())
            .position(|w| w == seq)
            .map(|p| p + start)
    }

    pub fn find_any_of(xml: &[u8], chars: &[u8], start: usize) -> Option<usize> {
        for (i, &b) in xml[start..].iter().enumerate() {
            if chars.contains(&b) {
                return Some(i + start);
            }
        }
        None
    }

    pub fn skip_whitespace(xml: &[u8], start: usize) -> usize {
        let mut pos = start;
        while pos < xml.len() && matches!(xml[pos], b' ' | b'\t' | b'\n' | b'\r') {
            pos += 1;
        }
        pos
    }
}

#[test]
fn test_cell_data_size() {
    assert_eq!(core::mem::size_of::<CellData>(), 20);
}

#[test]
fn test_parse_a1_reference_simple() {
    assert_eq!(parse_a1_reference(b"A1"), Some((0, 0)));
    assert_eq!(parse_a1_reference(b"B2"), Some((1, 1)));
    assert_eq!(parse_a1_reference(b"Z9"), Some((8, 25)));
}

#[test]
fn test_parse_a1_reference_double_letter() {
    assert_eq!(parse_a1_reference(b"AA1"), Some((0, 26)));
    assert_eq!(parse_a1_reference(b"AB1"), Some((0, 27)));
    assert_eq!(parse_a1_reference(b"AZ1"), Some((0, 51)));
    assert_eq!(parse_a1_reference(b"BA1"), Some((0, 52)));
}

#[test]
fn test_parse_a1_reference_triple_letter() {
    assert_eq!(parse_a1_reference(b"AAA1"), Some((0, 702)));
    assert_eq!(parse_a1_reference(b"XFD1"), Some((0, 16383))); // Max column
}

#[test]
fn test_parse_a1_reference_max_row() {
    assert_eq!(parse_a1_reference(b"A1048576"), Some((1048575, 0))); // Max row
    assert_eq!(parse_a1_reference(b"XFD1048576"), Some((1048575, 16383))); // Max cell
}

#[test]
fn test_parse_a1_reference_invalid() {
    assert_eq!(parse_a1_reference(b""), None);
    assert_eq!(parse_a1_reference(b"1A"), None); // Row before column
    assert_eq!(parse_a1_reference(b"A"), None); // No row
    assert_eq!(parse_a1_reference(b"A0"), None); // Row 0 invalid
}

#[test]
fn test_parse_cell_type_number() {
    assert_eq!(parse_cell_type(b"<c r=\"A1\">"), CELL_TYPE_NUMBER);
    assert_eq!(parse_cell_type(b"<c r=\"A1\" t=\"n\">"), CELL_TYPE_NUMBER);
}

#[test]
fn test_parse_cell_type_string() {
    assert_eq!(parse_cell_type(b"<c r=\"A1\" t=\"s\">"), CELL_TYPE_STRING);
    assert_eq!(
        parse_cell_type(b"<c r=\"A1\" t=\"str\">"),
        CELL_TYPE_FORMULA_STRING
    );
    assert_eq!(
        parse_cell_type(b"<c r=\"A1\" t=\"inlineStr\">"),
        CELL_TYPE_STRING
    );
}

#[test]
fn test_parse_cell_type_bool() {
    assert_eq!(parse_cell_type(b"<c r=\"A1\" t=\"b\">"), CELL_TYPE_BOOL);
}

#[test]
fn test_parse_cell_type_error() {
    assert_eq!(parse_cell_type(b"<c r=\"A1\" t=\"e\">"), CELL_TYPE_ERROR);
}

#[test]
fn test_parse_style_idx() {
    assert_eq!(parse_style_idx(b"<c r=\"A1\">"), 0);
    assert_eq!(parse_style_idx(b"<c r=\"A1\" s=\"0\">"), 0);
    assert_eq!(parse_style_idx(b"<c r=\"A1\" s=\"1\">"), 1);
    assert_eq!(parse_style_idx(b"<c r=\"A1\" s=\"42\">"), 42);
    assert_eq!(parse_style_idx(b"<c s=\"123\" r=\"A1\">"), 123);
}

#[test]
fn test_extract_cell_value_number() {
    let xml = b"<c r=\"A1\"><v>42.5</v></c>";
    let shared_strings: Vec<&str> = vec![];
    let (vtype, value) = extract_cell_value_fast(xml, &shared_strings);
    assert_eq!(vtype, VALUE_TYPE_INLINE);
    assert_eq!(value, b"42.5");
}

#[test]
fn test_extract_cell_value_shared_string() {
    let xml = b"<c r=\"A1\" t=\"s\"><v>0</v></c>";
    let shared_strings: Vec<&str> = vec!["Hello, World!"];
    let (vtype, value) = extract_cell_value_fast(xml, &shared_strings);
    assert_eq!(vtype, VALUE_TYPE_SHARED_STRING);
    assert_eq!(value, b"Hello, World!");
}

#[test]
fn test_extract_cell_value_formula() {
    let xml = b"<c r=\"A1\"><f>SUM(B1:B10)</f><v>100</v></c>";
    let shared_strings: Vec<&str> = vec![];
    let (vtype, value) = extract_cell_value_fast(xml, &shared_strings);
    assert_eq!(vtype, VALUE_TYPE_FORMULA);
    assert_eq!(value, b"SUM(B1:B10)");
}

#[test]
fn test_extract_cell_value_formula_str_cached_value_collected_via_extras() {
    // Formula cell with t="str" — extract_cell_value_fast returns the formula text;
    // the cached <v> value is collected separately by parse_worksheet_core extras.
    let xml = b"<c r=\"BY2\" s=\"438\" t=\"str\"><f>B2</f><v>some text</v></c>";
    let shared_strings: Vec<&str> = vec![];
    let (vtype, value) = extract_cell_value_fast(xml, &shared_strings);
    assert_eq!(vtype, VALUE_TYPE_FORMULA);
    assert_eq!(value, b"B2");
    // Verify cell_type is CELL_TYPE_FORMULA_STRING (6)
    assert_eq!(parse_cell_type(xml), CELL_TYPE_FORMULA_STRING);
}

#[test]
fn test_extract_cell_value_v_with_xml_space_preserve() {
    // Non-formula cell with <v xml:space="preserve"> should extract the value correctly.
    let xml = b"<c r=\"A1\"><v xml:space=\"preserve\"> hello </v></c>";
    let shared_strings: Vec<&str> = vec![];
    let (vtype, value) = extract_cell_value_fast(xml, &shared_strings);
    assert_eq!(vtype, VALUE_TYPE_INLINE);
    assert_eq!(value, b" hello ");
}

#[test]
fn test_extract_cell_value_cached_formula_with_xml_space_preserve() {
    // Self-closing formula with <v xml:space="preserve"> should extract the cached value.
    let xml =
        b"<c r=\"A1\" t=\"str\"><f t=\"shared\" si=\"3\"/><v xml:space=\"preserve\"> text </v></c>";
    let shared_strings: Vec<&str> = vec![];
    let (vtype, value) = extract_cell_value_fast(xml, &shared_strings);
    assert_eq!(vtype, VALUE_TYPE_CACHED_FORMULA);
    assert_eq!(value, b" text ");
}

#[test]
fn test_extract_cell_value_inline_string() {
    let xml = b"<c r=\"A1\" t=\"inlineStr\"><is><t>Inline Text</t></is></c>";
    let shared_strings: Vec<&str> = vec![];
    let (vtype, value) = extract_cell_value_fast(xml, &shared_strings);
    assert_eq!(vtype, VALUE_TYPE_INLINE);
    assert_eq!(value, b"Inline Text");
}

#[test]
fn test_extract_cell_value_empty() {
    let xml = b"<c r=\"A1\"/>";
    let shared_strings: Vec<&str> = vec![];
    let (vtype, value) = extract_cell_value_fast(xml, &shared_strings);
    assert_eq!(vtype, VALUE_TYPE_NONE);
    assert_eq!(value, b"");
}

#[test]
fn test_col_to_letters() {
    assert_eq!(&col_to_letters(0)[0..1], b"A");
    assert_eq!(&col_to_letters(25)[0..1], b"Z");
    assert_eq!(&col_to_letters(26)[0..2], b"AA");
    assert_eq!(&col_to_letters(27)[0..2], b"AB");
    assert_eq!(&col_to_letters(701)[0..2], b"ZZ");
    assert_eq!(&col_to_letters(702)[0..3], b"AAA");
    assert_eq!(&col_to_letters(16383)[0..3], b"XFD");
}

#[test]
fn test_parse_worksheet_basic() {
    let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<worksheet>
  <sheetData>
    <row r="1">
      <c r="A1"><v>42</v></c>
      <c r="B1" t="s"><v>0</v></c>
    </row>
    <row r="2">
      <c r="A2"><f>A1*2</f><v>84</v></c>
    </row>
  </sheetData>
</worksheet>"#;

    let shared_strings: Vec<&str> = vec!["Hello"];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();

    let count = parse_worksheet_fast(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut Vec::new(),
        &[],
    );

    assert_eq!(count, 3);

    // First cell: A1 with number value
    assert_eq!(cells[0].get_row(), 0);
    assert_eq!(cells[0].get_col(), 0);
    assert_eq!(cells[0].get_cell_type(), CELL_TYPE_NUMBER);

    // Second cell: B1 with shared string
    assert_eq!(cells[1].get_row(), 0);
    assert_eq!(cells[1].get_col(), 1);
    assert_eq!(cells[1].get_cell_type(), CELL_TYPE_STRING);

    // Third cell: A2 with formula
    assert_eq!(cells[2].get_row(), 1);
    assert_eq!(cells[2].get_col(), 0);
}

#[test]
fn test_parse_worksheet_with_styles() {
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1" s="1"><v>100</v></c>
      <c r="B1" s="2" t="s"><v>0</v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec!["Styled"];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();

    let count = parse_worksheet_fast(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut Vec::new(),
        &[],
    );

    assert_eq!(count, 2);
    assert_eq!(cells[0].get_style_idx(), 1);
    assert_eq!(cells[1].get_style_idx(), 2);
}

#[test]
fn test_parse_worksheet_empty_cells_skipped() {
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1"/>
      <c r="B1"><v>1</v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();

    let count = parse_worksheet_fast(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut Vec::new(),
        &[],
    );

    // Empty cell A1 (style=0) is preserved for round-trip fidelity.
    // Excel explicitly includes bare empty cells and dropping them causes byte-level diffs.
    assert_eq!(count, 2);
    assert_eq!(cells[0].get_col(), 0); // A1 — preserved
    assert_eq!(cells[1].get_col(), 1); // B1
}

#[test]
fn test_parse_formula_str_cached_value_with_xml_space_preserve() {
    // Formula cell with t="str" and <v xml:space="preserve"> should have its cached value
    // collected via parse_worksheet_fast_with_extras.
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1" t="str"><f>B1</f><v xml:space="preserve"> hello </v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut extras = ParseExtras::default();

    let count = parse_worksheet_fast_with_extras(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut Vec::new(),
        &mut extras,
        &[],
    );

    assert_eq!(count, 1);
    assert_eq!(cells[0].cell_type, CELL_TYPE_FORMULA_STRING);
    assert_eq!(cells[0].value_type, VALUE_TYPE_FORMULA);

    // The cached <v> value should have been collected in extras
    assert_eq!(extras.cached_values.len(), 1);
    let (idx, offset, len) = extras.cached_values[0];
    assert_eq!(idx, 0);
    let cached = &strings[offset as usize..(offset + len) as usize];
    assert_eq!(cached, b" hello ");
}

#[test]
fn test_parse_formula_str_cached_value_without_xml_space() {
    // Formula cell with t="str" and plain <v>text</v> should also have its cached value collected.
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1" t="str"><f>B1</f><v>some text</v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut extras = ParseExtras::default();

    let count = parse_worksheet_fast_with_extras(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut Vec::new(),
        &mut extras,
        &[],
    );

    assert_eq!(count, 1);
    assert_eq!(cells[0].cell_type, CELL_TYPE_FORMULA_STRING);

    // The cached <v> value should have been collected
    assert_eq!(extras.cached_values.len(), 1);
    let (idx, offset, len) = extras.cached_values[0];
    assert_eq!(idx, 0);
    let cached = &strings[offset as usize..(offset + len) as usize];
    assert_eq!(cached, b"some text");
}

#[test]
fn test_parse_worksheet_bool_and_error() {
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1" t="b"><v>1</v></c>
      <c r="B1" t="e"><v>#DIV/0!</v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();

    let count = parse_worksheet_fast(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut Vec::new(),
        &[],
    );

    assert_eq!(count, 2);
    assert_eq!(cells[0].get_cell_type(), CELL_TYPE_BOOL);
    assert_eq!(cells[1].get_cell_type(), CELL_TYPE_ERROR);
}

#[test]
fn test_large_worksheet_structure() {
    // Test parsing a realistic worksheet structure with 1000 rows
    let mut xml = String::from("<worksheet><sheetData>\n");

    for row in 1..=100 {
        xml.push_str(&format!("<row r=\"{}\">\n", row));
        for col in 0..10 {
            let col_letter = (b'A' + col) as char;
            xml.push_str(&format!(
                "<c r=\"{}{}\"><v>{}</v></c>\n",
                col_letter,
                row,
                row * 10 + col as u32
            ));
        }
        xml.push_str("</row>\n");
    }
    xml.push_str("</sheetData></worksheet>");

    let xml_bytes = xml.as_bytes();
    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 2000];
    let mut strings = Vec::new();

    let count = parse_worksheet_fast(
        xml_bytes,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut Vec::new(),
        &[],
    );

    assert_eq!(count, 1000); // 100 rows * 10 columns

    // Verify a few cells
    assert_eq!(cells[0].get_row(), 0);
    assert_eq!(cells[0].get_col(), 0);

    assert_eq!(cells[10].get_row(), 1); // Second row
    assert_eq!(cells[10].get_col(), 0);
}

// =========================================================================
// Error Recovery Tests
// =========================================================================

use crate::infra::error::{ErrorCode, ParseContext, ParseMode};

#[test]
fn test_parse_with_context_basic() {
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1"><v>42</v></c>
      <c r="B1" t="s"><v>0</v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec!["Hello"];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut ctx = ParseContext::lenient();
    ctx.set_current_part("sheet1.xml");

    let (parsed, skipped) = parse_worksheet_with_context(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut ctx,
        &mut Vec::new(),
        &[],
    );

    assert_eq!(parsed, 2);
    assert_eq!(skipped, 0);
    assert_eq!(ctx.error_count(), 0);
    assert_eq!(ctx.warning_count(), 0);
}

#[test]
fn test_parse_with_context_invalid_cell_reference_lenient() {
    // Test with invalid cell reference (ZZZ99999999 is out of range)
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1"><v>1</v></c>
      <c r="ZZZ99999999"><v>2</v></c>
      <c r="B1"><v>3</v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut ctx = ParseContext::lenient();
    ctx.set_current_part("sheet1.xml");

    let (parsed, skipped) = parse_worksheet_with_context(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut ctx,
        &mut Vec::new(),
        &[],
    );

    // A1 and B1 should be parsed, ZZZ99999999 should be skipped
    assert_eq!(parsed, 2);
    assert_eq!(skipped, 1);
    assert_eq!(ctx.error_count(), 1);

    // Verify the error details
    let errors = ctx.errors();
    assert_eq!(errors[0].code, ErrorCode::InvalidCellReference);
}

#[test]
fn test_parse_with_context_invalid_cell_reference_strict() {
    // Test that strict mode stops on first error
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1"><v>1</v></c>
      <c r="ZZZ99999999"><v>2</v></c>
      <c r="B1"><v>3</v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut ctx = ParseContext::strict();
    ctx.set_current_part("sheet1.xml");

    let (parsed, skipped) = parse_worksheet_with_context(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut ctx,
        &mut Vec::new(),
        &[],
    );

    // Should stop after the invalid cell reference
    assert_eq!(parsed, 1); // Only A1 parsed
    assert!(ctx.should_stop());
    assert_eq!(ctx.error_count(), 1);
}

#[test]
fn test_parse_with_context_invalid_shared_string_index() {
    // Test with shared string index out of bounds
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>999</v></c>
      <c r="C1"><v>42</v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec!["Hello"]; // Only index 0 exists
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut ctx = ParseContext::lenient();
    ctx.set_current_part("sheet1.xml");

    let (parsed, skipped) = parse_worksheet_with_context(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut ctx,
        &mut Vec::new(),
        &[],
    );

    // All cells should be parsed (B1 will use #REF! placeholder)
    assert_eq!(parsed, 3);
    assert_eq!(skipped, 0);
    assert_eq!(ctx.error_count(), 1);

    // Verify the error
    let errors = ctx.errors();
    assert_eq!(errors[0].code, ErrorCode::InvalidSharedStringIndex);
}

#[test]
fn test_parse_with_context_invalid_number_value() {
    // Test with invalid number value
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1"><v>42</v></c>
      <c r="B1"><v>not-a-number</v></c>
      <c r="C1"><v>100</v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut ctx = ParseContext::lenient();
    ctx.set_current_part("sheet1.xml");

    let (parsed, skipped) = parse_worksheet_with_context(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut ctx,
        &mut Vec::new(),
        &[],
    );

    // All cells should be parsed (warning for invalid number)
    assert_eq!(parsed, 3);
    assert_eq!(skipped, 0);
    assert_eq!(ctx.warning_count(), 1);
}

#[test]
fn test_parse_with_context_invalid_style_index() {
    // Test with invalid style index
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1" s="abc"><v>1</v></c>
      <c r="B1" s="2"><v>2</v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut ctx = ParseContext::lenient();
    ctx.set_current_part("sheet1.xml");

    let (parsed, skipped) = parse_worksheet_with_context(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut ctx,
        &mut Vec::new(),
        &[],
    );

    // Both cells should be parsed
    assert_eq!(parsed, 2);
    assert_eq!(skipped, 0);
    assert_eq!(ctx.warning_count(), 1);

    // A1 should have style 0 (default) due to invalid style
    assert_eq!(cells[0].get_style_idx(), 0);
    // B1 should have style 2
    assert_eq!(cells[1].get_style_idx(), 2);
}

#[test]
fn test_parse_with_context_unknown_cell_type() {
    // Test with unknown cell type
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1" t="x"><v>unknown</v></c>
      <c r="B1"><v>42</v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut ctx = ParseContext::lenient();
    ctx.set_current_part("sheet1.xml");

    let (parsed, skipped) = parse_worksheet_with_context(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut ctx,
        &mut Vec::new(),
        &[],
    );

    assert_eq!(parsed, 2);
    assert_eq!(skipped, 0);
    assert_eq!(ctx.warning_count(), 1);

    // Unknown type should default to string
    assert_eq!(cells[0].get_cell_type(), CELL_TYPE_STRING);
}

#[test]
fn test_parse_with_context_permissive_mode() {
    // Test permissive mode recovers invalid cell references
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r=""><v>1</v></c>
      <c r="B1"><v>2</v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut ctx = ParseContext::permissive();
    ctx.set_current_part("sheet1.xml");

    let (parsed, skipped) = parse_worksheet_with_context(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut ctx,
        &mut Vec::new(),
        &[],
    );

    // In permissive mode, invalid cells are recovered with fallback values
    assert_eq!(parsed, 2);
    assert_eq!(skipped, 0);

    // First cell should use fallback (row 0, col 0)
    assert_eq!(cells[0].get_row(), 0);
    assert_eq!(cells[0].get_col(), 0);
}

#[test]
fn test_parse_with_context_missing_sheet_data() {
    // Test with missing sheetData element
    let xml = br#"<worksheet></worksheet>"#;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut ctx = ParseContext::lenient();
    ctx.set_current_part("sheet1.xml");

    let (parsed, skipped) = parse_worksheet_with_context(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut ctx,
        &mut Vec::new(),
        &[],
    );

    assert_eq!(parsed, 0);
    assert_eq!(skipped, 0);
    assert_eq!(ctx.warning_count(), 1);
}

#[test]
fn test_parse_with_context_collects_multiple_errors() {
    // Test that lenient mode collects multiple errors
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="ZZZ1"><v>1</v></c>
      <c r="A1" t="s"><v>999</v></c>
      <c r="B1" s="invalid"><v>2</v></c>
      <c r="C1"><v>valid</v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec!["Hello"];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut ctx = ParseContext::lenient();
    ctx.set_current_part("sheet1.xml");

    let (parsed, _skipped) = parse_worksheet_with_context(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut ctx,
        &mut Vec::new(),
        &[],
    );

    // Should have collected multiple errors/warnings
    assert!(ctx.error_count() + ctx.warning_count() >= 2);
}

#[test]
fn test_parse_with_context_error_location_info() {
    // Test that error location info is captured
    let xml = br#"<worksheet><sheetData>
    <row r="5">
      <c r="C5" t="s"><v>999</v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut ctx = ParseContext::lenient();
    ctx.set_current_part("xl/worksheets/sheet1.xml");

    let (_, _) = parse_worksheet_with_context(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut ctx,
        &mut Vec::new(),
        &[],
    );

    let errors = ctx.errors();
    assert!(!errors.is_empty());

    // Check that location info is present
    let error = &errors[0];
    assert!(error.location.is_some());
    let loc = error.location.as_ref().unwrap();
    assert_eq!(loc.part, "xl/worksheets/sheet1.xml");
    // Row should be 5 (1-based), col should be 3 (1-based for C)
    assert_eq!(loc.row, Some(5));
    assert_eq!(loc.col, Some(3));
}

#[test]
#[ignore] // Requires /tmp/xlsx_test_sheet.xml and /tmp/xlsx_test_ss.xml from manual extraction
fn test_parse_real_xlsx_worksheet() {
    // Load the actual worksheet XML from the golden LBO test file
    let xml = std::fs::read("/tmp/xlsx_test_sheet.xml")
        .expect("Failed to read test sheet XML - run python extraction first");
    let ss_xml =
        std::fs::read("/tmp/xlsx_test_ss.xml").expect("Failed to read test shared strings XML");

    // Parse shared strings
    let mut ss_parser = crate::domain::strings::read::SharedStrings::parse(ss_xml);
    let ss_count = ss_parser.len();
    let mut shared_string_values: Vec<String> = Vec::with_capacity(ss_count);
    for i in 0..ss_count {
        let bytes = ss_parser.get(i);
        shared_string_values.push(String::from_utf8_lossy(bytes).into_owned());
    }
    let shared_string_refs: Vec<&str> = shared_string_values.iter().map(|s| s.as_str()).collect();

    eprintln!("Shared strings count: {}", ss_count);
    eprintln!("Worksheet XML size: {} bytes", xml.len());

    // Allocate buffers
    let estimated_cells = xml.len() / 50;
    let mut cells = vec![CellData::default(); estimated_cells.max(3000)];
    let mut strings = Vec::with_capacity(estimated_cells * 20);

    // Parse
    let count = parse_worksheet_fast(
        &xml,
        &shared_string_refs,
        &mut cells,
        &mut strings,
        &mut Vec::new(),
        &[],
    );

    eprintln!("Cells parsed: {}", count);

    // Show first 10 cells
    for i in 0..count.min(10) {
        let c = &cells[i];
        let row = c.get_row();
        let col = c.get_col();
        let style_idx = c.get_style_idx();
        let val_offset = c.get_value_offset() as usize;
        let val_len = c.get_value_len() as usize;
        let value_str = if val_len > 0 && val_offset < strings.len() {
            let end = (val_offset + val_len).min(strings.len());
            String::from_utf8_lossy(&strings[val_offset..end]).to_string()
        } else {
            "(empty)".to_string()
        };
        eprintln!(
            "  Cell[{}]: row={}, col={}, type={}, style={}, value_type={}, value={}",
            i,
            row,
            col,
            c.cell_type,
            style_idx,
            c.value_type,
            &value_str[..value_str.len().min(80)]
        );
    }

    // Show cell type distribution
    let mut type_counts = [0u32; 6];
    let mut value_type_counts = [0u32; 5];
    for i in 0..count {
        let c = &cells[i];
        if (c.cell_type as usize) < type_counts.len() {
            type_counts[c.cell_type as usize] += 1;
        }
        if (c.value_type as usize) < value_type_counts.len() {
            value_type_counts[c.value_type as usize] += 1;
        }
    }
    eprintln!("\nCell type distribution:");
    eprintln!("  EMPTY(0): {}", type_counts[0]);
    eprintln!("  NUMBER(1): {}", type_counts[1]);
    eprintln!("  STRING(2): {}", type_counts[2]);
    eprintln!("  BOOL(3): {}", type_counts[3]);
    eprintln!("  ERROR(4): {}", type_counts[4]);
    eprintln!("  FORMULA(5): {}", type_counts[5]);

    eprintln!("\nValue type distribution:");
    eprintln!("  NONE(0): {}", value_type_counts[0]);
    eprintln!("  INLINE(1): {}", value_type_counts[1]);
    eprintln!("  SHARED_STRING(2): {}", value_type_counts[2]);
    eprintln!("  FORMULA(3): {}", value_type_counts[3]);
    eprintln!("  CACHED_FORMULA(4): {}", value_type_counts[4]);

    // Count cells by cell_type AND value_type combination
    let mut formula_string = 0u32;
    let mut formula_number = 0u32;
    for i in 0..count {
        let c = &cells[i];
        if c.value_type == VALUE_TYPE_FORMULA {
            if c.cell_type == CELL_TYPE_STRING {
                formula_string += 1;
            } else if c.cell_type == CELL_TYPE_NUMBER {
                formula_number += 1;
            }
        }
    }
    eprintln!("\nFormula cells with cell_type STRING: {}", formula_string);
    eprintln!("Formula cells with cell_type NUMBER: {}", formula_number);

    // Count cells that have no value but have styling (these are style-only cells)
    let mut style_only = 0u32;
    for i in 0..count {
        let c = &cells[i];
        if c.value_type == VALUE_TYPE_NONE {
            let style = c.get_style_idx();
            if style != 0 {
                style_only += 1;
            }
        }
    }
    eprintln!("Style-only cells (no value, style > 0): {}", style_only);

    // The file has ~2011 cells total, ~1378 with values
    // At minimum we should parse significantly more than 70
    assert!(count > 100, "Expected more than 100 cells, got {}", count);
}

#[test]
fn test_parse_worksheet_fast_extracts_row_heights() {
    let xml = b"<worksheet><sheetData><row r=\"1\" ht=\"20.5\"><c r=\"A1\"><v>1</v></c></row><row r=\"2\"><c r=\"A2\"><v>2</v></c></row><row r=\"3\" ht=\"30.0\"><c r=\"A3\"><v>3</v></c></row></sheetData></worksheet>";
    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 100];
    let mut strings = Vec::new();
    let mut row_heights = Vec::new();

    let count = parse_worksheet_fast(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut row_heights,
        &[],
    );
    assert_eq!(count, 3);
    assert_eq!(row_heights.len(), 2);
    assert_eq!(row_heights[0].row, 0); // 0-indexed
    assert_eq!(row_heights[0].height, 20.5);
    assert_eq!(row_heights[1].row, 2); // 0-indexed
    assert_eq!(row_heights[1].height, 30.0);
}

// ==========================================================================
// Format Import Optimization Tests
// ==========================================================================

#[test]
fn test_row_height_with_style() {
    let rh = RowHeight::new(5, 20.0).with_style(3);
    assert_eq!(rh.style, Some(3));
    assert_eq!(rh.row, 5);
    assert_eq!(rh.height, 20.0);
}

#[test]
fn test_row_style_extracted_with_custom_format() {
    // <row> with s="5" AND customFormat="1" should extract style
    let xml = br#"<worksheet><sheetData><row r="1" s="5" customFormat="1" ht="20.0"><c r="A1"><v>1</v></c></row></sheetData></worksheet>"#;
    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut row_heights = Vec::new();

    let count = parse_worksheet_fast(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut row_heights,
        &[],
    );
    assert_eq!(count, 1);
    assert_eq!(row_heights.len(), 1);
    assert_eq!(row_heights[0].row, 0); // 0-indexed
    assert_eq!(row_heights[0].style, Some(5));
}

#[test]
fn test_row_style_not_extracted_without_custom_format() {
    // <row> with s="5" but NO customFormat="1" should NOT extract style
    let xml = br#"<worksheet><sheetData><row r="1" s="5" ht="20.0"><c r="A1"><v>1</v></c></row></sheetData></worksheet>"#;
    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut row_heights = Vec::new();

    let count = parse_worksheet_fast(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut row_heights,
        &[],
    );
    assert_eq!(count, 1);
    assert_eq!(row_heights.len(), 1);
    assert_eq!(row_heights[0].style, None); // No customFormat="1" => no style
}

#[test]
fn test_row_style_creates_row_height_entry() {
    // Row with customFormat but no ht should still create a RowHeight entry for the style
    let xml = br#"<worksheet><sheetData><row r="1" s="3" customFormat="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>"#;
    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut row_heights = Vec::new();

    let _count = parse_worksheet_fast(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut row_heights,
        &[],
    );
    assert_eq!(row_heights.len(), 1);
    assert_eq!(row_heights[0].row, 0);
    assert_eq!(row_heights[0].style, Some(3));
    assert_eq!(row_heights[0].height, 0.0); // No explicit height
}

#[test]
fn test_col_widths_extract_style() {
    use crate::domain::worksheet::read::parse_col_widths;

    // Each <col ...> element is now preserved as a single ColWidth range entry.
    let xml = br#"<cols><col min="1" max="1" width="10.0" style="3"/><col min="2" max="3" width="12.0"/></cols>"#;
    let col_widths = parse_col_widths(xml);
    assert_eq!(col_widths.len(), 2);
    assert_eq!(col_widths[0].min, 1);
    assert_eq!(col_widths[0].max, 1);
    assert_eq!(col_widths[0].col, 0);
    assert_eq!(col_widths[0].style, Some(3));
    assert_eq!(col_widths[1].min, 2);
    assert_eq!(col_widths[1].max, 3);
    assert_eq!(col_widths[1].col, 1); // 0-based min-1
    assert_eq!(col_widths[1].style, None);
}

#[test]
fn test_cell_skip_matching_row_style() {
    // Cell with style matching row default should be skipped (formatting-only)
    let xml = br#"<worksheet><sheetData><row r="1" s="5" customFormat="1"><c r="A1" s="5"/><c r="B1"><v>42</v></c></row></sheetData></worksheet>"#;
    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut row_heights = Vec::new();

    let count = parse_worksheet_fast(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut row_heights,
        &[],
    );
    // A1 has no value and style=5 matching row style=5 => skipped
    // B1 has value => kept
    assert_eq!(count, 1);
    assert_eq!(cells[0].get_col(), 1); // B1
}

#[test]
fn test_cell_with_value_and_matching_row_style_not_skipped() {
    // Cell with value + matching row style should NOT be skipped
    let xml = br#"<worksheet><sheetData><row r="1" s="5" customFormat="1"><c r="A1" s="5"><v>100</v></c></row></sheetData></worksheet>"#;
    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut row_heights = Vec::new();

    let count = parse_worksheet_fast(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut row_heights,
        &[],
    );
    assert_eq!(count, 1);
    assert_eq!(cells[0].get_col(), 0); // A1 kept because it has a value
}

#[test]
fn test_cell_skip_matching_col_style() {
    // Cell with style matching column default (no row style) should be skipped
    let col_styles: Vec<Option<u32>> = vec![Some(3), None];
    let xml = br#"<worksheet><sheetData><row r="1"><c r="A1" s="3"/><c r="B1"><v>42</v></c></row></sheetData></worksheet>"#;
    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut row_heights = Vec::new();

    let count = parse_worksheet_fast(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut row_heights,
        &col_styles,
    );
    // A1 has no value and style=3 matching col_styles[0]=Some(3) => skipped
    // B1 has value => kept
    assert_eq!(count, 1);
    assert_eq!(cells[0].get_col(), 1); // B1
}

#[test]
fn test_cell_not_skipped_when_row_style_overrides_col() {
    // Cell matching column default but row has different customFormat is an
    // authored cell-level style override. It is preserved in the compact
    // style-only side channel rather than materialized as a dense cell.
    let col_styles: Vec<Option<u32>> = vec![Some(3), None];
    let xml = br#"<worksheet><sheetData><row r="1" s="7" customFormat="1"><c r="A1" s="3"/></row></sheetData></worksheet>"#;
    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut row_heights = Vec::new();
    let mut extras = ParseExtras::default();

    let count = parse_worksheet_fast_with_extras(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut row_heights,
        &mut extras,
        &col_styles,
    );
    assert_eq!(count, 0);
    assert_eq!(extras.authored_style_only_cells.len(), 1);
    assert_eq!(extras.authored_style_only_cells[0].row, 0);
    assert_eq!(extras.authored_style_only_cells[0].col, 0);
    assert_eq!(extras.authored_style_only_cells[0].style_idx, 3);
}

#[test]
fn test_open_close_style_only_cell_preserved_as_authored_run_input() {
    let xml = br#"<worksheet><sheetData><row r="1"><c r="A1" s="0"></c><c r="B1" s="3"></c></row></sheetData></worksheet>"#;
    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut row_heights = Vec::new();
    let mut extras = ParseExtras::default();

    let count = parse_worksheet_fast_with_extras(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut row_heights,
        &mut extras,
        &[],
    );

    assert_eq!(count, 0);
    assert_eq!(extras.authored_style_only_cells.len(), 2);
    assert_eq!(extras.authored_style_only_cells[0].style_idx, 0);
    assert_eq!(extras.authored_style_only_cells[1].style_idx, 3);
}

// =============================================================================
// Typed data-table input refs: — data table input ref typing (boundaries 1.5/1.6/1.7)
// =============================================================================

#[test]
fn test_parse_data_table_typed_input_refs() {
    // Master-cell `<f t="dataTable" ref="..." r1="..." r2="...">` with
    // absolute A1 r1/r2 attributes — the standard XLSX shape.
    // Typed data-table input refs: r1/r2 lift to typed `Option<CellRef>` on
    // `DataTableEntry`; the body-cell `formula: String` is dropped from
    // the entry and regenerated at write time.
    let xml = br#"<worksheet><sheetData>
    <row r="2">
      <c r="B2"><f t="dataTable" ref="B2:C3" r1="$A$1" r2="$A$2" dt2D="1" dtr="1" aca="1" ca="1" bx="1" del1="1" del2="1"/><v>1</v></c>
      <c r="C2"><v>2</v></c>
    </row>
    <row r="3">
      <c r="B3"><v>3</v></c>
      <c r="C3"><v>4</v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut extras = ParseExtras::default();

    let _ = parse_worksheet_fast_with_extras(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut Vec::new(),
        &mut extras,
        &[],
    );

    assert_eq!(extras.data_tables.len(), 1, "data table extracted");
    let dt = &extras.data_tables[0];
    assert_eq!(dt.start_row, 1);
    assert_eq!(dt.start_col, 1);
    assert_eq!(dt.end_row, 2);
    assert_eq!(dt.end_col, 2);
    assert!(dt.dt2d, "dt2D=1 attribute parsed");
    assert!(dt.dtr, "dtr=1 attribute parsed");
    assert!(dt.aca, "aca=1 attribute parsed");
    assert!(dt.ca, "ca=1 attribute parsed");
    assert!(dt.bx, "bx=1 attribute parsed");
    assert!(dt.del1, "del1=1 attribute parsed");
    assert!(dt.del2, "del2=1 attribute parsed");

    // r1 = $A$1 → row 0, col 0; r2 = $A$2 → row 1, col 0
    match dt.row_input_ref.as_ref().expect("typed r1") {
        formula_types::CellRef::Positional { row, col, .. } => {
            assert_eq!((*row, *col), (0, 0));
        }
        _ => panic!("expected Positional CellRef for r1"),
    }
    match dt.col_input_ref.as_ref().expect("typed r2") {
        formula_types::CellRef::Positional { row, col, .. } => {
            assert_eq!((*row, *col), (1, 0));
        }
        _ => panic!("expected Positional CellRef for r2"),
    }
}

#[test]
fn test_parse_data_table_ref_error_collapses_to_none() {
    // `#REF!` r1/r2 — the broken-ref case the pre-W4.b
    // `is_broken_cell_ref` shadow parser used to filter. Post-W4.b the
    // typed classifier returns `None`, scheduler later skips the entry.
    let xml = br##"<worksheet><sheetData>
    <row r="2">
      <c r="B2"><f t="dataTable" ref="B2:C3" r1="#REF!" r2="$A$2"/><v>1</v></c>
    </row>
  </sheetData></worksheet>"##;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut extras = ParseExtras::default();

    let _ = parse_worksheet_fast_with_extras(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut Vec::new(),
        &mut extras,
        &[],
    );

    assert_eq!(extras.data_tables.len(), 1);
    let dt = &extras.data_tables[0];
    assert!(
        dt.row_input_ref.is_none(),
        "r1=#REF! collapses to None at the parser boundary"
    );
    assert!(
        dt.col_input_ref.is_some(),
        "r2=$A$2 stays typed alongside the broken r1"
    );
}

#[test]
fn test_parse_data_table_unicode_does_not_panic() {
    // UTF-8 boundary incident class: byte-level shadow parsers panicked on
    // `&str[n..]` slices at non-UTF-8 boundaries. Sheet-qualified
    // refs and non-ASCII names were the trigger. Even though XLSX
    // r1/r2 attributes are normally bare-cell ASCII (e.g. `$A$1`), a
    // malformed XLSX could carry a sheet-qualified or non-ASCII string;
    // the parser must classify-or-reject without panicking.
    let xml = "<worksheet><sheetData>
    <row r=\"2\">
      <c r=\"B2\"><f t=\"dataTable\" ref=\"B2:C3\" r1=\"'Πλήρης'!A1\" r2=\"μμμ\"/><v>1</v></c>
    </row>
  </sheetData></worksheet>"
        .as_bytes();

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut extras = ParseExtras::default();

    let _ = parse_worksheet_fast_with_extras(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut Vec::new(),
        &mut extras,
        &[],
    );

    // We don't assert the specific classification — just that nothing
    // panicked and the entry exists. Sheet-qualified shape rejects to
    // `None` (parse_a1_cell takes a single bare cell ref).
    assert_eq!(extras.data_tables.len(), 1);
    let dt = &extras.data_tables[0];
    assert!(dt.row_input_ref.is_none(), "sheet-qualified ref rejects");
    assert!(dt.col_input_ref.is_none(), "non-ASCII garbage rejects");
}
