//! Attribute parsing helpers for scoped drawing XML elements.

use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_element_end};

/// Extract an attribute value from an element opening tag.
///
/// `attr` is the existing scanner pattern, for example `b"editAs=\""`.
/// Only the opening tag is searched so child attributes cannot bleed into the
/// parent element's attributes.
pub(crate) fn attr_value<'a>(element: &'a [u8], attr: &[u8]) -> Option<&'a [u8]> {
    let open = opening_tag(element)?;
    let attr_pos = find_attr_simd(open, attr, 0)?;
    let value_start = attr_pos + attr.len();
    let (start, end) = extract_quoted_value(open, value_start)?;
    Some(&open[start..end])
}

/// Parse an OOXML boolean value from an optional attribute.
pub(crate) fn parse_bool(value: &[u8]) -> Option<bool> {
    match value {
        b"1" | b"true" | b"TRUE" | b"True" => Some(true),
        b"0" | b"false" | b"FALSE" | b"False" => Some(false),
        _ => None,
    }
}

/// Parse an optional OOXML boolean attribute with a default.
pub(crate) fn bool_attr_or(element: &[u8], attr: &[u8], default: bool) -> bool {
    attr_value(element, attr)
        .and_then(parse_bool)
        .unwrap_or(default)
}

fn opening_tag(element: &[u8]) -> Option<&[u8]> {
    let end = find_element_end(element, 0)?;
    element.get(..=end)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attr_value_is_limited_to_opening_tag() {
        let xml = br#"<xdr:sp macro="parent"><xdr:child macro="child"/></xdr:sp>"#;
        assert_eq!(attr_value(xml, b"macro=\""), Some(&b"parent"[..]));

        let xml = br#"<xdr:sp><xdr:child macro="child"/></xdr:sp>"#;
        assert_eq!(attr_value(xml, b"macro=\""), None);
    }

    #[test]
    fn parse_ooxml_bool_values() {
        assert_eq!(parse_bool(b"1"), Some(true));
        assert_eq!(parse_bool(b"true"), Some(true));
        assert_eq!(parse_bool(b"0"), Some(false));
        assert_eq!(parse_bool(b"false"), Some(false));
        assert_eq!(parse_bool(b"maybe"), None);
    }
}
