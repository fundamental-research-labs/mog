use crate::domain::cells::{
    CELL_TYPE_BOOL, CELL_TYPE_ERROR, CELL_TYPE_FORMULA_STRING, CELL_TYPE_NUMBER, CELL_TYPE_STRING,
    CellData, ParseExtras, VALUE_TYPE_CACHED_FORMULA, VALUE_TYPE_FORMULA, VALUE_TYPE_INLINE,
    VALUE_TYPE_SHARED_STRING, parse_worksheet_fast, parse_worksheet_fast_with_extras,
};

fn value_bytes<'a>(cell: &CellData, strings: &'a [u8]) -> &'a [u8] {
    let start = cell.get_value_offset() as usize;
    let end = start + cell.get_value_len() as usize;
    &strings[start..end]
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
fn test_parse_worksheet_fast_prefixed_tags_imports_cells_values_and_row_metadata() {
    let xml = br#"<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>
    <x:row r="1" ht="21.5" customHeight="1">
      <x:c r="A1"><x:v>42</x:v></x:c>
      <x:c r="B1" t="s"><x:v>0</x:v></x:c>
      <x:c r="C1" t="str"><x:v>Audit generated</x:v></x:c>
      <x:c r="D1" t="inlineStr"><x:is><x:t>Inline</x:t></x:is></x:c>
      <x:c r="E1"><x:f>A1&amp;B1</x:f><x:v>cached</x:v></x:c>
    </x:row>
  </x:sheetData></x:worksheet>"#;

    let shared_strings: Vec<&str> = vec!["Shared"];
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

    assert_eq!(count, 5);
    assert_eq!(cells[0].get_row(), 0);
    assert_eq!(cells[4].get_col(), 4);
    assert_eq!(cells[1].get_cell_type(), CELL_TYPE_STRING);
    assert_eq!(cells[1].get_value_type(), VALUE_TYPE_SHARED_STRING);
    assert_eq!(cells[2].get_cell_type(), CELL_TYPE_FORMULA_STRING);
    assert_eq!(cells[2].get_value_type(), VALUE_TYPE_INLINE);
    assert_eq!(cells[4].get_value_type(), VALUE_TYPE_FORMULA);
    assert_eq!(value_bytes(&cells[0], &strings), b"42");
    assert_eq!(value_bytes(&cells[1], &strings), b"Shared");
    assert_eq!(value_bytes(&cells[2], &strings), b"Audit generated");
    assert_eq!(value_bytes(&cells[3], &strings), b"Inline");
    assert_eq!(value_bytes(&cells[4], &strings), b"A1&amp;B1");
    assert_eq!(row_heights.len(), 1);
    assert_eq!(row_heights[0].row, 0);
    assert_eq!(row_heights[0].height, 21.5);
}

#[test]
fn test_parse_worksheet_fast_with_extras_prefixed_formula_tags() {
    let xml = br#"<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>
    <x:row r="1">
      <x:c r="A1"><x:f t="shared" si="7" ref="A1:A2">A1+1</x:f><x:v xml:space="preserve"> cached </x:v></x:c>
      <x:c r="A2"><x:f t="shared" si="7"/><x:v>2</x:v></x:c>
      <x:c r="B1"><x:f t="array" ref="B1:B2" aca="1">SUM(A1:A2)</x:f><x:v>3</x:v></x:c>
      <x:c r="C1"><x:f t="dataTable" ref="C1:D2" r1="$A$1" r2="$A$2" dt2D="1" dtr="1" aca="1" ca="1" bx="1" del1="1" del2="1"/><x:v>4</x:v></x:c>
    </x:row>
  </x:sheetData></x:worksheet>"#;

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

    assert_eq!(count, 4);
    assert_eq!(cells[0].get_value_type(), VALUE_TYPE_FORMULA);
    assert_eq!(cells[1].get_value_type(), VALUE_TYPE_CACHED_FORMULA);
    assert_eq!(cells[2].get_value_type(), VALUE_TYPE_FORMULA);
    assert_eq!(cells[3].get_value_type(), VALUE_TYPE_CACHED_FORMULA);

    let master = extras.sf_masters.get(&7).expect("shared formula master");
    assert_eq!(master.formula_text, "A1+1");
    assert_eq!(master.ref_range, "A1:A2");
    assert_eq!(extras.sf_refs, vec![(7, 1, 0)]);
    assert_eq!(extras.array_refs, vec![(2, "B1:B2".to_string())]);
    assert_eq!(extras.data_tables.len(), 1);
    assert_eq!(extras.data_tables[0].start_row, 0);
    assert_eq!(extras.data_tables[0].start_col, 2);
    assert_eq!(extras.data_tables[0].end_row, 1);
    assert_eq!(extras.data_tables[0].end_col, 3);
    assert_eq!(extras.cached_values.len(), 2);
    assert!(extras.xml_space_value_indices.contains(&0));
    assert!(extras.aca_indices.contains(&2));
    assert!(extras.aca_indices.contains(&3));
    assert!(extras.force_recalc_indices.contains(&3));
}

#[test]
fn self_closing_shared_formula_without_cached_value_does_not_read_next_cell_value() {
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1"><f t="shared" si="7" ref="A1:A3">A1+1</f><v>2</v></c>
      <c r="A2"><f t="shared" si="7"/></c>
      <c r="B2"><v>999</v></c>
      <c r="A3"><f t="shared" si="7"/><v>4</v></c>
    </row>
  </sheetData></worksheet>"#;

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

    assert_eq!(count, 4);
    assert_eq!(cells[1].get_row(), 1);
    assert_eq!(cells[1].get_col(), 0);
    assert_eq!(cells[1].get_value_type(), VALUE_TYPE_CACHED_FORMULA);
    assert_eq!(value_bytes(&cells[1], &strings), b"");
    assert_eq!(value_bytes(&cells[2], &strings), b"999");
    assert_eq!(value_bytes(&cells[3], &strings), b"4");
    assert_eq!(extras.sf_refs, vec![(7, 1, 0), (7, 2, 0)]);
}

#[test]
fn prefixed_self_closing_shared_formula_without_cached_value_stays_empty() {
    let xml = br#"<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>
    <x:row r="1">
      <x:c r="A1"><x:f t="shared" si="7" ref="A1:A3">A1+1</x:f><x:v>2</x:v></x:c>
      <x:c r="A2"><x:f t="shared" si="7"/></x:c>
      <x:c r="B2"><x:v>999</x:v></x:c>
      <x:c r="A3"><x:f t="shared" si="7"/><x:v>4</x:v></x:c>
    </x:row>
  </x:sheetData></x:worksheet>"#;

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

    assert_eq!(count, 4);
    assert_eq!(cells[1].get_row(), 1);
    assert_eq!(cells[1].get_col(), 0);
    assert_eq!(cells[1].get_value_type(), VALUE_TYPE_CACHED_FORMULA);
    assert_eq!(value_bytes(&cells[1], &strings), b"");
    assert_eq!(value_bytes(&cells[2], &strings), b"999");
    assert_eq!(value_bytes(&cells[3], &strings), b"4");
    assert_eq!(extras.sf_refs, vec![(7, 1, 0), (7, 2, 0)]);
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
