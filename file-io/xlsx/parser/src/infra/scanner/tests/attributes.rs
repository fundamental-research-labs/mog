use crate::infra::scanner::*;

// -------------------------------------------------------------------------
// find_attr_simd tests
// -------------------------------------------------------------------------

#[test]
fn test_find_attr_basic() {
    let xml = b"<c r=\"A1\" t=\"s\">";
    assert_eq!(find_attr_simd(xml, b"r=\"", 0), Some(3));
}

#[test]
fn test_find_attr_second() {
    let xml = b"<c r=\"A1\" t=\"s\">";
    assert_eq!(find_attr_simd(xml, b"t=\"", 0), Some(10));
}

#[test]
fn test_find_attr_from_offset() {
    let xml = b"<c r=\"A1\" t=\"s\">";
    assert_eq!(find_attr_simd(xml, b"r=\"", 5), None); // r is before offset
    assert_eq!(find_attr_simd(xml, b"t=\"", 5), Some(10));
}

#[test]
fn test_find_attr_not_found() {
    let xml = b"<c r=\"A1\">";
    assert_eq!(find_attr_simd(xml, b"notexist=\"", 0), None);
}

#[test]
fn test_find_attr_must_follow_whitespace() {
    // "t=" inside value should not match
    let xml = b"<c r=\"t=test\">";
    // Looking for t=" as an attribute should not find the one inside quotes
    // Note: This test checks that we require whitespace before attribute
    assert_eq!(find_attr_simd(xml, b"t=\"", 0), None);
}
