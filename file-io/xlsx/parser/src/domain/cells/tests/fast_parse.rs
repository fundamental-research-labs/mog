use crate::domain::cells::{
    CELL_TYPE_BOOL, CELL_TYPE_ERROR, CELL_TYPE_FORMULA_STRING, CELL_TYPE_NUMBER, CELL_TYPE_STRING,
    CellData, ParseExtras, VALUE_TYPE_FORMULA, parse_worksheet_fast,
    parse_worksheet_fast_with_extras,
};

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
