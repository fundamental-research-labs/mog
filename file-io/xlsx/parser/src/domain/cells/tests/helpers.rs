use crate::domain::cells::{
    CELL_TYPE_BOOL, CELL_TYPE_ERROR, CELL_TYPE_FORMULA_STRING, CELL_TYPE_NUMBER, CELL_TYPE_STRING,
    CellData, VALUE_TYPE_CACHED_FORMULA, VALUE_TYPE_FORMULA, VALUE_TYPE_INLINE, VALUE_TYPE_NONE,
    VALUE_TYPE_SHARED_STRING, col_to_letters, extract_cell_value_fast, parse_a1_reference,
    parse_cell_type, parse_style_idx,
};

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
