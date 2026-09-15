use super::parse_streamed;

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
    let (cells, _extras, _row_heights) = parse_streamed(xml, &["Hello"]);
    assert_eq!(cells.len(), 3);
    assert_eq!((cells[0].row, cells[0].col, cells[0].cell_type), (0, 0, 1));
    assert_eq!((cells[1].row, cells[1].col, cells[1].cell_type), (0, 1, 2));
    assert_eq!(cells[1].value.as_deref(), Some("Hello"));
    assert_eq!((cells[2].row, cells[2].col), (1, 0));
    assert_eq!(cells[2].formula.as_deref(), Some("A1*2"));
    assert_eq!(cells[2].value.as_deref(), Some("84"));
}

#[test]
fn test_parse_worksheet_stream_prefixed_tags_imports_cells_values_and_row_metadata() {
    let xml = br#"<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>
    <x:row r="1" ht="21.5" customHeight="1">
      <x:c r="A1"><x:v>42</x:v></x:c>
      <x:c r="B1" t="s"><x:v>0</x:v></x:c>
      <x:c r="C1" t="str"><x:v>Audit generated</x:v></x:c>
      <x:c r="D1" t="inlineStr"><x:is><x:t>Inline</x:t></x:is></x:c>
      <x:c r="E1"><x:f>A1&amp;B1</x:f><x:v>cached</x:v></x:c>
    </x:row>
  </x:sheetData></x:worksheet>"#;
    let (cells, _extras, row_heights) = parse_streamed(xml, &["Shared"]);
    assert_eq!(cells.len(), 5);
    assert_eq!((cells[0].row, cells[4].col), (0, 4));
    assert_eq!(cells[1].cell_type, 2);
    assert_eq!(
        cells.iter().map(|c| c.value.as_deref()).collect::<Vec<_>>(),
        [
            Some("42"),
            Some("Shared"),
            Some("Audit generated"),
            Some("Inline"),
            Some("cached")
        ]
    );
    assert_eq!(cells[4].formula.as_deref(), Some("A1&B1"));
    assert_eq!(row_heights.len(), 1);
    assert_eq!((row_heights[0].row, row_heights[0].height), (0, 21.5));
}

#[test]
fn test_parse_worksheet_stream_prefixed_formula_tags() {
    let xml = br#"<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>
    <x:row r="1">
      <x:c r="A1"><x:f t="shared" si="7" ref="A1:A2">A1+1</x:f><x:v xml:space="preserve"> cached </x:v></x:c>
      <x:c r="A2"><x:f t="shared" si="7"/><x:v>2</x:v></x:c>
      <x:c r="B1"><x:f t="array" ref="B1:B2" aca="1">SUM(A1:A2)</x:f><x:v>3</x:v></x:c>
      <x:c r="C1"><x:f t="dataTable" ref="C1:D2" r1="$A$1" r2="$A$2" dt2D="1" dtr="1" aca="1" ca="1" bx="1" del1="1" del2="1"/><x:v>4</x:v></x:c>
    </x:row>
  </x:sheetData></x:worksheet>"#;
    let (cells, extras, _row_heights) = parse_streamed(xml, &[]);
    assert_eq!(cells.len(), 4);
    let master = extras.sf_masters.get(&7).unwrap();
    assert_eq!(master.formula_text, "A1+1");
    assert_eq!(master.ref_range, "A1:A2");
    assert_eq!(extras.sf_refs, vec![(7, 1, 0)]);
    assert_eq!(cells[1].formula.as_deref(), Some("A2+1"));
    assert_eq!(cells[1].value.as_deref(), Some("2"));
    assert_eq!(cells[2].array_ref.as_deref(), Some("B1:B2"));
    assert_eq!(extras.data_tables.len(), 1);
    let dt = &extras.data_tables[0];
    assert_eq!(
        (dt.start_row, dt.start_col, dt.end_row, dt.end_col),
        (0, 2, 1, 3)
    );
    assert_eq!(cells[0].value.as_deref(), Some(" cached "));
    assert!(cells[0].preserve_space_value);
    assert!(cells[2].cell_formula.as_ref().unwrap().aca);
    assert!(cells[3].cell_formula.as_ref().unwrap().aca);
    assert!(cells[3].force_recalc);
}

#[test]
fn empty_formula_metadata_is_distinct_from_shared_and_data_table_formulas() {
    let xml = br#"<worksheet><sheetData><row r="1">
      <c r="A1"><f t="array" ref="A1:B1" aca="1" ca="1">SUM(1,2)</f><v>3</v></c>
      <c r="B1" t="b"><f ca="1"/><v>0</v></c>
      <c r="C1" t="b"><f ca="1"/></c>
      <c r="D1"><f t="shared" si="9" ref="D1:D2">A1+1</f><v>4</v></c>
      <c r="D2"><f t="shared" si="9"/><v>5</v></c>
      <c r="E1"><f t="dataTable" ref="E1:F2" r1="$A$1" r2="$A$2" ca="1"/><v>6</v></c>
    </row></sheetData></worksheet>"#;
    let (cells, extras, _row_heights) = parse_streamed(xml, &[]);
    assert_eq!(cells.len(), 6);
    for cell in &cells[1..3] {
        assert!(cell.formula.is_none());
        let formula = cell.cell_formula.as_ref().unwrap();
        assert!(formula.text.is_empty());
        assert!(formula.ca);
    }
    assert_eq!(extras.sf_refs, vec![(9, 1, 3)]);
    assert_eq!(extras.data_tables.len(), 1);
    assert_eq!(cells[0].array_ref.as_deref(), Some("A1:B1"));
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
    let (cells, extras, _row_heights) = parse_streamed(xml, &[]);
    assert_eq!(cells.len(), 4);
    assert_eq!((cells[1].row, cells[1].col), (1, 0));
    assert!(cells[1].value.as_deref().is_none_or(str::is_empty));
    assert_eq!(cells[2].value.as_deref(), Some("999"));
    assert_eq!(cells[3].value.as_deref(), Some("4"));
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
    let (cells, extras, _row_heights) = parse_streamed(xml, &[]);
    assert_eq!(cells.len(), 4);
    assert_eq!((cells[1].row, cells[1].col), (1, 0));
    assert!(cells[1].value.as_deref().is_none_or(str::is_empty));
    assert_eq!(cells[2].value.as_deref(), Some("999"));
    assert_eq!(cells[3].value.as_deref(), Some("4"));
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
    let (cells, _extras, _row_heights) = parse_streamed(xml, &["Styled"]);
    assert_eq!(cells.len(), 2);
    assert_eq!(cells[0].style_idx, 1);
    assert_eq!(cells[1].style_idx, 2);
}

#[test]
fn test_parse_worksheet_empty_cells_skipped() {
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1"/>
      <c r="B1"><v>1</v></c>
    </row>
  </sheetData></worksheet>"#;
    let (cells, _extras, _row_heights) = parse_streamed(xml, &[]);
    assert_eq!(cells.len(), 2);
    assert_eq!(cells[0].col, 0);
    assert!(cells[0].value.is_none());
    assert_eq!(cells[1].col, 1);
}

#[test]
fn test_parse_formula_str_cached_value_with_xml_space_preserve() {
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1" t="str"><f>B1</f><v xml:space="preserve"> hello </v></c>
    </row>
  </sheetData></worksheet>"#;
    let (cells, _extras, _row_heights) = parse_streamed(xml, &[]);
    assert_eq!(cells.len(), 1);
    assert_eq!(cells[0].formula.as_deref(), Some("B1"));
    assert_eq!(
        cells[0].cached_value_type,
        crate::domain::cells::CELL_TYPE_FORMULA_STRING
    );
    assert_eq!(cells[0].value.as_deref(), Some(" hello "));
    assert!(cells[0].preserve_space_value);
}

#[test]
fn test_parse_formula_str_cached_value_without_xml_space() {
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1" t="str"><f>B1</f><v>some text</v></c>
    </row>
  </sheetData></worksheet>"#;
    let (cells, _extras, _row_heights) = parse_streamed(xml, &[]);
    assert_eq!(cells.len(), 1);
    assert_eq!(cells[0].formula.as_deref(), Some("B1"));
    assert_eq!(
        cells[0].cached_value_type,
        crate::domain::cells::CELL_TYPE_FORMULA_STRING
    );
    assert_eq!(cells[0].value.as_deref(), Some("some text"));
}

#[test]
fn test_parse_worksheet_bool_and_error() {
    let xml = br#"<worksheet><sheetData>
    <row r="1">
      <c r="A1" t="b"><v>1</v></c>
      <c r="B1" t="e"><v>#DIV/0!</v></c>
    </row>
  </sheetData></worksheet>"#;
    let (cells, _extras, _row_heights) = parse_streamed(xml, &[]);
    assert_eq!(cells.len(), 2);
    assert_eq!(cells[0].cell_type, 3);
    assert_eq!(cells[1].cell_type, 4);
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
    let (cells, _extras, _row_heights) = parse_streamed(xml_bytes, &[]);
    assert_eq!(cells.len(), 1000);
    assert_eq!((cells[0].row, cells[0].col), (0, 0));
    assert_eq!((cells[10].row, cells[10].col), (1, 0));
}

#[test]
fn test_parse_worksheet_stream_extracts_row_heights() {
    let xml = b"<worksheet><sheetData><row r=\"1\" ht=\"20.5\"><c r=\"A1\"><v>1</v></c></row><row r=\"2\"><c r=\"A2\"><v>2</v></c></row><row r=\"3\" ht=\"30.0\"><c r=\"A3\"><v>3</v></c></row></sheetData></worksheet>";
    let (cells, _extras, row_heights) = parse_streamed(xml, &[]);
    assert_eq!(cells.len(), 3);
    assert_eq!(row_heights.len(), 2);
    assert_eq!((row_heights[0].row, row_heights[0].height), (0, 20.5));
    assert_eq!((row_heights[1].row, row_heights[1].height), (2, 30.0));
}
