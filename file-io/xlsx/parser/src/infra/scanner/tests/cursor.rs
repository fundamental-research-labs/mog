use crate::infra::scanner::*;

// -------------------------------------------------------------------------
// XmlScanner tests
// -------------------------------------------------------------------------

#[test]
fn test_xml_scanner_new() {
    let xml = b"<tag>content</tag>";
    let scanner = XmlScanner::new(xml);
    assert_eq!(scanner.pos(), 0);
    assert_eq!(scanner.bytes().len(), 18);
    assert!(!scanner.is_at_end());
}

#[test]
fn test_xml_scanner_new_at() {
    let xml = b"<tag>content</tag>";
    let scanner = XmlScanner::new_at(xml, 5);
    assert_eq!(scanner.pos(), 5);
    assert_eq!(scanner.remaining_len(), 13);
}

#[test]
fn test_xml_scanner_advance() {
    let xml = b"<tag>content</tag>";
    let mut scanner = XmlScanner::new(xml);
    scanner.advance(5);
    assert_eq!(scanner.pos(), 5);
    scanner.advance(3);
    assert_eq!(scanner.pos(), 8);
}

#[test]
fn test_xml_scanner_set_pos() {
    let xml = b"<tag>content</tag>";
    let mut scanner = XmlScanner::new(xml);
    scanner.set_pos(10);
    assert_eq!(scanner.pos(), 10);
}

#[test]
fn test_xml_scanner_is_at_end() {
    let xml = b"<tag>";
    let mut scanner = XmlScanner::new(xml);
    assert!(!scanner.is_at_end());
    scanner.set_pos(5);
    assert!(scanner.is_at_end());
    scanner.set_pos(100);
    assert!(scanner.is_at_end());
}

#[test]
fn test_xml_scanner_remaining() {
    let xml = b"<tag>content</tag>";
    let mut scanner = XmlScanner::new(xml);
    assert_eq!(scanner.remaining(), b"<tag>content</tag>");
    scanner.set_pos(5);
    assert_eq!(scanner.remaining(), b"content</tag>");
    scanner.set_pos(100);
    assert_eq!(scanner.remaining(), b"");
}

#[test]
fn test_xml_scanner_find_lt() {
    let xml = b"text<tag>";
    let scanner = XmlScanner::new(xml);
    assert_eq!(scanner.find_lt(), Some(4));
    // Position should not change
    assert_eq!(scanner.pos(), 0);
}

#[test]
fn test_xml_scanner_find_gt() {
    let xml = b"<tag>content";
    let scanner = XmlScanner::new(xml);
    assert_eq!(scanner.find_gt(), Some(4));
}

#[test]
fn test_xml_scanner_find_any() {
    let xml = b"attr=\"value\"";
    let scanner = XmlScanner::new(xml);
    assert_eq!(scanner.find_any(&[b'=', b'"']), Some((4, b'=')));
}

#[test]
fn test_xml_scanner_find_tag() {
    let xml = b"<worksheet><sheetData>";
    let scanner = XmlScanner::new(xml);
    assert_eq!(scanner.find_tag(b"sheetData"), Some(11));
}

#[test]
fn test_xml_scanner_find_attr() {
    let xml = b"<c r=\"A1\" t=\"s\">";
    let scanner = XmlScanner::new(xml);
    assert_eq!(scanner.find_attr(b"r=\""), Some(3));
    assert_eq!(scanner.find_attr(b"t=\""), Some(10));
}

#[test]
fn test_xml_scanner_find_closing() {
    let xml = b"<row>content</row>";
    let scanner = XmlScanner::new(xml);
    assert_eq!(scanner.find_closing(b"row"), Some(12));
}

#[test]
fn test_xml_scanner_skip_whitespace() {
    let xml = b"   \t\n<tag>";
    let mut scanner = XmlScanner::new(xml);
    let pos = scanner.skip_whitespace();
    assert_eq!(pos, 5);
    assert_eq!(scanner.pos(), 5);
}

#[test]
fn test_xml_scanner_advance_to_lt() {
    let xml = b"text<tag>";
    let mut scanner = XmlScanner::new(xml);
    let result = scanner.advance_to_lt();
    assert_eq!(result, Some(4));
    assert_eq!(scanner.pos(), 4);
}

#[test]
fn test_xml_scanner_advance_to_gt() {
    let xml = b"<tag>content";
    let mut scanner = XmlScanner::new(xml);
    let result = scanner.advance_to_gt();
    assert_eq!(result, Some(4));
    assert_eq!(scanner.pos(), 4);
}

#[test]
fn test_xml_scanner_advance_past_gt() {
    let xml = b"<tag>content";
    let mut scanner = XmlScanner::new(xml);
    let result = scanner.advance_past_gt();
    assert!(result);
    assert_eq!(scanner.pos(), 5);
}

#[test]
fn test_xml_scanner_advance_to_tag() {
    let xml = b"<worksheet><sheetData>";
    let mut scanner = XmlScanner::new(xml);
    let result = scanner.advance_to_tag(b"sheetData");
    assert_eq!(result, Some(11));
    assert_eq!(scanner.pos(), 11);
}

#[test]
fn test_xml_scanner_advance_past_tag() {
    let xml = b"<worksheet><sheetData><row>";
    let mut scanner = XmlScanner::new(xml);
    let result = scanner.advance_past_tag(b"sheetData");
    assert!(result);
    assert_eq!(scanner.pos(), 22); // past >
}

#[test]
fn test_xml_scanner_extract_attr_value() {
    let xml = b"<c r=\"A1\" t=\"s\">";
    let scanner = XmlScanner::new(xml);
    let value = scanner.extract_attr_value(b"r=\"");
    assert_eq!(value, Some(&b"A1"[..]));
    let value = scanner.extract_attr_value(b"t=\"");
    assert_eq!(value, Some(&b"s"[..]));
}

#[test]
fn test_xml_scanner_extract_until_closing() {
    let xml = b"content</row>";
    let scanner = XmlScanner::new(xml);
    let content = scanner.extract_until_closing(b"row");
    assert_eq!(content, Some(&b"content"[..]));
}

#[test]
fn test_xml_scanner_matches() {
    let xml = b"<sheetData>";
    let mut scanner = XmlScanner::new(xml);
    assert!(scanner.matches(b"<sheet"));
    scanner.advance(1);
    assert!(scanner.matches(b"sheetData"));
    assert!(!scanner.matches(b"other"));
}

#[test]
fn test_xml_scanner_current_byte() {
    let xml = b"<tag>";
    let mut scanner = XmlScanner::new(xml);
    assert_eq!(scanner.current_byte(), Some(b'<'));
    scanner.advance(1);
    assert_eq!(scanner.current_byte(), Some(b't'));
    scanner.set_pos(100);
    assert_eq!(scanner.current_byte(), None);
}

#[test]
fn test_xml_scanner_peek() {
    let xml = b"<tag>";
    let scanner = XmlScanner::new(xml);
    assert_eq!(scanner.peek(0), Some(b'<'));
    assert_eq!(scanner.peek(1), Some(b't'));
    assert_eq!(scanner.peek(4), Some(b'>'));
    assert_eq!(scanner.peek(100), None);
}

#[test]
fn test_xml_scanner_cell_parsing() {
    // Integration test: parse a cell element using XmlScanner
    let xml = b"<c r=\"B3\" t=\"s\" s=\"2\"><v>42</v></c>";
    let mut scanner = XmlScanner::new(xml);

    // Find the cell
    assert!(scanner.advance_to_tag(b"c").is_some());

    // Extract cell reference
    let cell_ref = scanner.extract_attr_value(b"r=\"");
    assert_eq!(cell_ref, Some(&b"B3"[..]));

    // Extract cell type
    let cell_type = scanner.extract_attr_value(b"t=\"");
    assert_eq!(cell_type, Some(&b"s"[..]));

    // Extract style
    let style = scanner.extract_attr_value(b"s=\"");
    assert_eq!(style, Some(&b"2"[..]));

    // Move past the opening tag
    assert!(scanner.advance_past_gt());

    // Find value element
    assert!(scanner.advance_to_tag(b"v").is_some());
    scanner.advance_past_gt();

    // Extract value content
    let value = scanner.extract_until_closing(b"v");
    assert_eq!(value, Some(&b"42"[..]));
}

#[test]
fn test_xml_scanner_row_iteration() {
    // Integration test: iterate through rows
    let xml = b"<sheetData><row r=\"1\"><c/></row><row r=\"2\"><c/></row></sheetData>";
    let mut scanner = XmlScanner::new(xml);

    // Skip to sheetData
    assert!(scanner.advance_past_tag(b"sheetData"));

    // Find first row
    assert!(scanner.advance_to_tag(b"row").is_some());
    let row1_ref = scanner.extract_attr_value(b"r=\"");
    assert_eq!(row1_ref, Some(&b"1"[..]));

    // Move past first row's closing tag
    scanner.advance_past_gt();
    assert!(scanner.advance_to_tag(b"row").is_some());

    // Find second row
    let row2_ref = scanner.extract_attr_value(b"r=\"");
    assert_eq!(row2_ref, Some(&b"2"[..]));
}
