use crate::infra::scanner::*;

// -------------------------------------------------------------------------
// skip_whitespace_simd tests
// -------------------------------------------------------------------------

#[test]
fn test_skip_whitespace_spaces() {
    let bytes = b"   text";
    assert_eq!(skip_whitespace_simd(bytes, 0), 3);
}

#[test]
fn test_skip_whitespace_mixed() {
    let bytes = b"  \t\n\r text";
    assert_eq!(skip_whitespace_simd(bytes, 0), 6);
}

#[test]
fn test_skip_whitespace_none() {
    let bytes = b"text";
    assert_eq!(skip_whitespace_simd(bytes, 0), 0);
}

#[test]
fn test_skip_whitespace_all() {
    let bytes = b"   \t\n  ";
    assert_eq!(skip_whitespace_simd(bytes, 0), bytes.len());
}

#[test]
fn test_skip_whitespace_from_offset() {
    let bytes = b"text   more";
    assert_eq!(skip_whitespace_simd(bytes, 4), 7);
}

#[test]
fn test_skip_whitespace_empty() {
    let bytes = b"";
    assert_eq!(skip_whitespace_simd(bytes, 0), 0);
}

#[test]
fn test_skip_whitespace_large() {
    // Test with more than 16 bytes of whitespace
    let bytes = b"                                   text";
    assert_eq!(skip_whitespace_simd(bytes, 0), 35);
}

// -------------------------------------------------------------------------
// find_element_end tests
// -------------------------------------------------------------------------

#[test]
fn test_find_element_end_basic() {
    let bytes = b"<tag>content";
    assert_eq!(find_element_end(bytes, 1), Some(4));
}

#[test]
fn test_find_element_end_with_attrs() {
    let bytes = b"<tag attr=\"value\">content";
    assert_eq!(find_element_end(bytes, 1), Some(17));
}

#[test]
fn test_find_element_end_with_gt_in_attr() {
    // '>' inside quotes should be ignored
    let bytes = b"<tag attr=\"a>b\">content";
    assert_eq!(find_element_end(bytes, 1), Some(15));
}

#[test]
fn test_find_element_end_with_gt_in_single_quoted_attr() {
    let bytes = b"<tag attr='a>b'>content";
    assert_eq!(find_element_end(bytes, 1), Some(15));
}

#[test]
fn test_find_element_end_self_closing() {
    let bytes = b"<tag/>";
    assert_eq!(find_element_end(bytes, 1), Some(5));
}

#[test]
fn test_find_start_tag_end_quoted_ignores_gt_in_attrs() {
    let bytes = br#"<sheetName val="A>B" alt='C>D'/>tail"#;
    let expected = bytes.len() - b"tail".len() - 1;
    assert_eq!(
        find_start_tag_end_quoted(bytes, 0),
        StartTagEnd::Found(expected)
    );
}

#[test]
fn test_find_start_tag_end_quoted_fast_path_no_quotes() {
    let bytes = b"<sheetData sheetId=0><row/>";
    assert_eq!(find_start_tag_end_quoted(bytes, 0), StartTagEnd::Found(20));
}

#[test]
fn test_find_start_tag_end_quoted_reports_unterminated_quote() {
    let bytes = b"<sheetName val=\"A>B";
    assert_eq!(
        find_start_tag_end_quoted(bytes, 0),
        StartTagEnd::UnterminatedQuote {
            quote: b'"',
            fallback_gt: Some(17)
        }
    );
}

#[test]
fn test_find_start_tag_end_quoted_missing() {
    assert_eq!(
        find_start_tag_end_quoted(b"<sheetName val", 0),
        StartTagEnd::Missing
    );
}

// -------------------------------------------------------------------------
// find_closing_tag tests
// -------------------------------------------------------------------------

#[test]
fn test_find_closing_tag_basic() {
    let xml = b"<row>content</row>";
    assert_eq!(find_closing_tag(xml, b"row", 0), Some(12));
}

#[test]
fn test_find_closing_tag_nested() {
    // <row><c/></row><row>
    // 01234567890123456789
    //          ^-- </row> starts at position 9
    let xml = b"<row><c/></row><row>";
    assert_eq!(find_closing_tag(xml, b"row", 0), Some(9));
}

#[test]
fn test_find_closing_tag_from_offset() {
    let xml = b"</a></b></c>";
    assert_eq!(find_closing_tag(xml, b"b", 4), Some(4));
    assert_eq!(find_closing_tag(xml, b"c", 4), Some(8));
}

#[test]
fn test_find_closing_tag_not_found() {
    let xml = b"<row>content";
    assert_eq!(find_closing_tag(xml, b"row", 0), None);
}

#[test]
fn test_find_closing_tag_matches_namespace_prefixed_local_name() {
    let xml = b"<x14:sheetData></x14:sheetData>";
    assert_eq!(find_closing_tag(xml, b"sheetData", 0), Some(15));
}

#[test]
fn test_find_closing_tag_preserves_exact_prefixed_match() {
    let xml = b"<x14:sheetData></x14:sheetData>";
    assert_eq!(find_closing_tag(xml, b"x14:sheetData", 0), Some(15));
}

#[test]
fn test_find_closing_tag_does_not_match_longer_local_name() {
    let xml = b"</sheetDataExtra></sheetData>";
    assert_eq!(find_closing_tag(xml, b"sheetData", 0), Some(17));
}

// -------------------------------------------------------------------------
// extract_quoted_value tests
// -------------------------------------------------------------------------

#[test]
fn test_extract_quoted_value_basic() {
    let bytes = b"A1\">";
    assert_eq!(extract_quoted_value(bytes, 0), Some((0, 2)));
}

#[test]
fn test_extract_quoted_value_empty() {
    let bytes = b"\">";
    assert_eq!(extract_quoted_value(bytes, 0), Some((0, 0)));
}

#[test]
fn test_extract_quoted_value_not_found() {
    let bytes = b"no quote";
    assert_eq!(extract_quoted_value(bytes, 0), None);
}

// -------------------------------------------------------------------------
// matches_at tests
// -------------------------------------------------------------------------

#[test]
fn test_matches_at_basic() {
    let bytes = b"<sheetData>";
    assert!(matches_at(bytes, 0, b"<sheet"));
    assert!(matches_at(bytes, 1, b"sheetData"));
}

#[test]
fn test_matches_at_false() {
    let bytes = b"<sheetData>";
    assert!(!matches_at(bytes, 0, b"other"));
}

#[test]
fn test_matches_at_beyond_end() {
    let bytes = b"short";
    assert!(!matches_at(bytes, 0, b"shorterlongpattern"));
}

// -------------------------------------------------------------------------
// Integration tests with realistic XML
// -------------------------------------------------------------------------

#[test]
fn test_parse_cell_element() {
    // <c r="A1" t="s" s="1"><v>0</v></c>
    // 0123456789012345678901234567890123
    //    ^r="   ^t="   ^s="  ^<v>  ^</v>
    //    3      10     16    22    26
    let xml = b"<c r=\"A1\" t=\"s\" s=\"1\"><v>0</v></c>";

    // Find the cell element
    let cell_start = find_tag_simd(xml, b"c", 0).unwrap();
    assert_eq!(cell_start, 0);

    // Find attributes
    let r_attr = find_attr_simd(xml, b"r=\"", cell_start).unwrap();
    assert_eq!(r_attr, 3);

    let t_attr = find_attr_simd(xml, b"t=\"", cell_start).unwrap();
    assert_eq!(t_attr, 10);

    let s_attr = find_attr_simd(xml, b"s=\"", cell_start).unwrap();
    assert_eq!(s_attr, 16);

    // Find value element
    let v_start = find_tag_simd(xml, b"v", cell_start).unwrap();
    assert_eq!(v_start, 22);

    let v_end = find_closing_tag(xml, b"v", v_start).unwrap();
    assert_eq!(v_end, 26);
}

#[test]
fn test_parse_row_element() {
    let xml = b"<row r=\"1\"><c r=\"A1\"><v>1</v></c><c r=\"B1\"><v>2</v></c></row>";

    // Find row
    let row_start = find_tag_simd(xml, b"row", 0).unwrap();
    assert_eq!(row_start, 0);

    // Find cells within row
    let cell1 = find_tag_simd(xml, b"c", row_start + 1).unwrap();
    assert_eq!(cell1, 11);

    let cell2 = find_tag_simd(xml, b"c", cell1 + 1).unwrap();
    assert_eq!(cell2, 33);

    // Find row end
    let row_end = find_closing_tag(xml, b"row", row_start).unwrap();
    assert_eq!(row_end, 55);
}

#[test]
fn test_worksheet_structure() {
    let xml = br#"<?xml version="1.0"?>
<worksheet>
<sheetData>
    <row r="1">
        <c r="A1"><v>Hello</v></c>
    </row>
</sheetData>
</worksheet>"#;

    // Find sheetData
    let sheet_data = find_tag_simd(xml, b"sheetData", 0).unwrap();
    assert!(sheet_data > 0);

    // Find row
    let row = find_tag_simd(xml, b"row", sheet_data).unwrap();
    assert!(row > sheet_data);

    // Find cell
    let cell = find_tag_simd(xml, b"c", row).unwrap();
    assert!(cell > row);

    // Find sheetData end
    let sheet_data_end = find_closing_tag(xml, b"sheetData", sheet_data).unwrap();
    assert!(sheet_data_end > cell);
}

// -------------------------------------------------------------------------
// Performance-oriented tests (larger inputs)
// -------------------------------------------------------------------------

#[test]
fn test_large_xml_scanning() {
    // Create a reasonably large XML structure
    let mut xml = Vec::with_capacity(10000);
    xml.extend_from_slice(b"<sheetData>");

    for i in 0..100 {
        xml.extend_from_slice(format!("<row r=\"{}\">", i).as_bytes());
        for j in 0..10 {
            let col = (b'A' + j as u8) as char;
            xml.extend_from_slice(
                format!("<c r=\"{}{}\"><v>{}</v></c>", col, i, i * 10 + j).as_bytes(),
            );
        }
        xml.extend_from_slice(b"</row>");
    }
    xml.extend_from_slice(b"</sheetData>");

    // Verify we can find elements
    let sheet_data = find_tag_simd(&xml, b"sheetData", 0);
    assert!(sheet_data.is_some());

    // Count rows
    let mut row_count = 0;
    let mut pos = 0;
    while let Some(row_pos) = find_tag_simd(&xml, b"row", pos) {
        // Make sure it's an opening tag, not closing
        if !matches_at(&xml, row_pos, b"</row") {
            row_count += 1;
        }
        pos = row_pos + 4;
    }
    assert_eq!(row_count, 100);

    // Count cells
    let mut cell_count = 0;
    let mut pos = 0;
    while let Some(cell_pos) = find_tag_simd(&xml, b"c", pos) {
        // Make sure it's not </c
        if !matches_at(&xml, cell_pos, b"</c") {
            cell_count += 1;
        }
        pos = cell_pos + 2;
    }
    assert_eq!(cell_count, 1000);
}
