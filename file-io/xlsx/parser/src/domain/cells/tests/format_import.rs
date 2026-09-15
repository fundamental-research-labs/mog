use super::{parse_public_sheet, parse_streamed};
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
    let xml = br#"<worksheet><sheetData><row r="1" s="5" customFormat="1" ht="20.0"><c r="A1"><v>1</v></c></row></sheetData></worksheet>"#;
    let (cells, _, row_heights) = parse_streamed(xml, &[]);
    assert_eq!(cells.len(), 1);
    assert_eq!(row_heights.len(), 1);
    assert_eq!(row_heights[0].row, 0); // 0-indexed
    assert_eq!(row_heights[0].style, Some(5));
}

#[test]
fn test_row_style_not_extracted_without_custom_format() {
    let xml = br#"<worksheet><sheetData><row r="1" s="5" ht="20.0"><c r="A1"><v>1</v></c></row></sheetData></worksheet>"#;
    let (cells, _, row_heights) = parse_streamed(xml, &[]);
    assert_eq!(cells.len(), 1);
    assert_eq!(row_heights.len(), 1);
    assert_eq!(row_heights[0].style, None); // No customFormat="1" => no style
}

#[test]
fn test_row_style_creates_row_height_entry() {
    let xml = br#"<worksheet><sheetData><row r="1" s="3" customFormat="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>"#;
    let (cells, _, row_heights) = parse_streamed(xml, &[]);
    assert_eq!(cells.len(), 1);
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
    let xml = br#"<worksheet><sheetData><row r="1" s="5" customFormat="1"><c r="A1" s="5"/><c r="B1"><v>42</v></c></row></sheetData></worksheet>"#;
    let sheet = parse_public_sheet(xml);
    assert_eq!(sheet.cells.len(), 1);
    assert_eq!(sheet.cells[0].col, 1);
    assert!(sheet.authored_style_runs.is_empty());
}

#[test]
fn test_cell_with_value_and_matching_row_style_not_skipped() {
    let xml = br#"<worksheet><sheetData><row r="1" s="5" customFormat="1"><c r="A1" s="5"><v>100</v></c></row></sheetData></worksheet>"#;
    let sheet = parse_public_sheet(xml);
    assert_eq!(sheet.cells.len(), 1);
    assert_eq!(sheet.cells[0].col, 0);
    assert_eq!(sheet.cells[0].value, value_types::CellValue::number(100.0));
}

#[test]
fn test_cell_skip_matching_col_style() {
    let xml = br#"<worksheet><cols><col min="1" max="1" style="3"/></cols><sheetData><row r="1"><c r="A1" s="3"/><c r="B1"><v>42</v></c></row></sheetData></worksheet>"#;
    let sheet = parse_public_sheet(xml);
    assert_eq!(sheet.cells.len(), 1);
    assert_eq!(sheet.cells[0].col, 1);
    assert!(sheet.authored_style_runs.is_empty());
}

#[test]
fn test_cell_not_skipped_when_row_style_overrides_col() {
    let xml = br#"<worksheet><cols><col min="1" max="1" style="3"/></cols><sheetData><row r="1" s="7" customFormat="1"><c r="A1" s="3"/></row></sheetData></worksheet>"#;
    let sheet = parse_public_sheet(xml);
    assert!(sheet.cells.is_empty());
    assert_eq!(sheet.authored_style_runs.len(), 1);
    assert_eq!(sheet.authored_style_runs[0].style_id, 3);
}

#[test]
fn test_open_close_style_only_cell_preserved_as_authored_run_input() {
    let xml = br#"<worksheet><sheetData><row r="1"><c r="A1" s="0"></c><c r="B1" s="3"></c></row></sheetData></worksheet>"#;
    let (_, extras, _) = parse_streamed(xml, &[]);
    assert_eq!(
        extras
            .authored_style_only_cells
            .iter()
            .map(|cell| cell.style_idx)
            .collect::<Vec<_>>(),
        vec![0, 3]
    );
    let sheet = parse_public_sheet(xml);
    assert!(sheet.cells.is_empty());
    assert_eq!(
        sheet.authored_style_runs.len(),
        1,
        "the default style-zero run is redundant in final output"
    );
    assert_eq!(sheet.authored_style_runs[0].style_id, 3);
}
