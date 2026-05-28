use crate::infra::scanner::*;

// -------------------------------------------------------------------------
// find_tag_simd tests
// -------------------------------------------------------------------------

#[test]
fn test_find_tag_basic() {
    let xml = b"<worksheet><sheetData><row>";
    assert_eq!(find_tag_simd(xml, b"sheetData", 0), Some(11));
}

#[test]
fn test_find_tag_with_attributes() {
    let xml = b"<row r=\"1\"><c r=\"A1\"/></row>";
    assert_eq!(find_tag_simd(xml, b"row", 0), Some(0));
    assert_eq!(find_tag_simd(xml, b"c", 0), Some(11));
}

#[test]
fn test_find_tag_self_closing() {
    let xml = b"<c r=\"A1\"/>";
    assert_eq!(find_tag_simd(xml, b"c", 0), Some(0));
}

#[test]
fn test_find_tag_from_offset() {
    let xml = b"<a><b><c>";
    assert_eq!(find_tag_simd(xml, b"b", 3), Some(3));
    assert_eq!(find_tag_simd(xml, b"c", 3), Some(6));
}

#[test]
fn test_find_tag_not_found() {
    let xml = b"<worksheet><sheetData>";
    assert_eq!(find_tag_simd(xml, b"notexist", 0), None);
}

#[test]
fn test_find_tag_partial_match() {
    // Should not match "sheet" when looking for "sheetData"
    let xml = b"<sheet><sheetData>";
    assert_eq!(find_tag_simd(xml, b"sheetData", 0), Some(7));
}

#[test]
fn test_find_tag_does_not_match_longer_local_name() {
    let xml = b"<sheetDataExtra><sheetData>";
    assert_eq!(find_tag_simd(xml, b"sheetData", 0), Some(16));
}

#[test]
fn test_find_tag_matches_namespace_prefixed_local_name() {
    let xml = b"<x14:sheetData/>";
    assert_eq!(find_tag_simd(xml, b"sheetData", 0), Some(0));
}

#[test]
fn test_find_tag_preserves_exact_prefixed_match() {
    let xml = b"<x14:sheetData/>";
    assert_eq!(find_tag_simd(xml, b"x14:sheetData", 0), Some(0));
}

#[test]
fn test_find_tag_empty() {
    let xml = b"<tag>";
    assert_eq!(find_tag_simd(xml, b"", 0), None);
}
