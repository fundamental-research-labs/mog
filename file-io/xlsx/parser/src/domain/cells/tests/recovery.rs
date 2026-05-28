use crate::domain::cells::{CELL_TYPE_STRING, CellData, parse_worksheet_with_context};
use crate::infra::error::{ErrorCode, ParseContext};

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
