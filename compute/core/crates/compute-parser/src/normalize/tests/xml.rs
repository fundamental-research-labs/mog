use std::borrow::Cow;

use super::super::xml::{decode_xml_entities, decode_xml_entities_str};

// XML entity decoding

#[test]
fn test_decode_standard_entities() {
    assert_eq!(decode_xml_entities("A&amp;B"), "A&B");
    assert_eq!(decode_xml_entities("1&lt;2"), "1<2");
    assert_eq!(decode_xml_entities("2&gt;1"), "2>1");
    assert_eq!(decode_xml_entities("&quot;hi&quot;"), "\"hi\"");
    assert_eq!(decode_xml_entities("it&apos;s"), "it's");
}

#[test]
fn test_decode_numeric_entities() {
    assert_eq!(decode_xml_entities("&#65;"), "A");
    assert_eq!(decode_xml_entities("&#x41;"), "A");
    assert_eq!(decode_xml_entities("&#X41;"), "A");
    assert_eq!(decode_xml_entities("&#169;"), "\u{00A9}"); // ©
}

#[test]
fn test_decode_no_entities() {
    assert_eq!(decode_xml_entities("SUM(A1:B10)"), "SUM(A1:B10)");
}

#[test]
fn test_decode_unrecognized_entity() {
    assert_eq!(decode_xml_entities("&foo;bar"), "&foo;bar");
}

#[test]
fn test_decode_ampersand_without_semicolon() {
    assert_eq!(decode_xml_entities("A&B"), "A&B");
}

#[test]
fn test_decode_multiple_entities() {
    assert_eq!(decode_xml_entities("A&amp;B&lt;C&gt;D"), "A&B<C>D");
}

#[test]
fn test_decode_no_entities_borrowed() {
    assert!(matches!(
        decode_xml_entities("SUM(A1:B10)"),
        Cow::Borrowed(_)
    ));
}
