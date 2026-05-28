use crate::domain::cells::{
    CellData, ParseExtras, parse_worksheet_fast, parse_worksheet_fast_with_extras,
};
use crate::domain::worksheet::read::parse_col_widths;
use ooxml_types::worksheet::RowHeight;

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
