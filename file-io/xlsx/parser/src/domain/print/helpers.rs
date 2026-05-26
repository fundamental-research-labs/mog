//! Helper functions for print settings parsing.
//!
//! This module contains utility functions for parsing XML content:
//! - `parse_element_content` - Parse text content between opening and closing tags
//! - `decode_xml_entities` - Decode XML entities in content
//! - `parse_char_reference` - Parse numeric character references

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};

/// Parse element content (text between opening and closing tags)
pub fn parse_element_content(xml: &[u8], tag_name: &[u8]) -> Option<String> {
    let tag_start = find_tag_simd(xml, tag_name, 0)?;
    let content_start = find_gt_simd(xml, tag_start)? + 1;
    let content_end = find_closing_tag(xml, tag_name, content_start)?;

    if content_start < content_end {
        let content_bytes = &xml[content_start..content_end];
        Some(decode_xml_entities(content_bytes))
    } else {
        Some(String::new())
    }
}

/// Decode XML entities in content
pub fn decode_xml_entities(bytes: &[u8]) -> String {
    let mut result = String::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'&' {
            if i + 4 <= bytes.len() && &bytes[i..i + 4] == b"&lt;" {
                result.push('<');
                i += 4;
            } else if i + 4 <= bytes.len() && &bytes[i..i + 4] == b"&gt;" {
                result.push('>');
                i += 4;
            } else if i + 5 <= bytes.len() && &bytes[i..i + 5] == b"&amp;" {
                result.push('&');
                i += 5;
            } else if i + 6 <= bytes.len() && &bytes[i..i + 6] == b"&quot;" {
                result.push('"');
                i += 6;
            } else if i + 6 <= bytes.len() && &bytes[i..i + 6] == b"&apos;" {
                result.push('\'');
                i += 6;
            } else if i + 2 < bytes.len() && bytes[i + 1] == b'#' {
                if let Some((ch, len)) = parse_char_reference(&bytes[i..]) {
                    result.push(ch);
                    i += len;
                } else {
                    result.push('&');
                    i += 1;
                }
            } else {
                result.push('&');
                i += 1;
            }
        } else {
            // Copy byte as UTF-8
            if bytes[i] < 0x80 {
                result.push(bytes[i] as char);
                i += 1;
            } else {
                // Multi-byte UTF-8 character
                let remaining = &bytes[i..];
                if let Ok(s) = std::str::from_utf8(remaining) {
                    if let Some(c) = s.chars().next() {
                        result.push(c);
                        i += c.len_utf8();
                    } else {
                        i += 1;
                    }
                } else {
                    // Invalid UTF-8, use replacement character
                    result.push('\u{FFFD}');
                    i += 1;
                }
            }
        }
    }

    result
}

/// Parse a numeric character reference (&#NNN; or &#xHHH;)
fn parse_char_reference(bytes: &[u8]) -> Option<(char, usize)> {
    if bytes.len() < 4 || bytes[0] != b'&' || bytes[1] != b'#' {
        return None;
    }

    let is_hex = bytes[2] == b'x' || bytes[2] == b'X';
    let num_start = if is_hex { 3 } else { 2 };

    let mut end = num_start;
    while end < bytes.len() && bytes[end] != b';' {
        end += 1;
    }

    if end >= bytes.len() || bytes[end] != b';' {
        return None;
    }

    let num_bytes = &bytes[num_start..end];
    let code_point = if is_hex {
        u32::from_str_radix(std::str::from_utf8(num_bytes).ok()?, 16).ok()?
    } else {
        std::str::from_utf8(num_bytes).ok()?.parse::<u32>().ok()?
    };

    char::from_u32(code_point).map(|ch| (ch, end + 1))
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_xml_entities() {
        assert_eq!(decode_xml_entities(b"hello"), "hello");
        assert_eq!(decode_xml_entities(b"&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_xml_entities(b"&amp;"), "&");
        assert_eq!(decode_xml_entities(b"&quot;text&quot;"), "\"text\"");
        assert_eq!(decode_xml_entities(b"&apos;"), "'");
    }

    #[test]
    fn test_decode_xml_entities_numeric() {
        assert_eq!(decode_xml_entities(b"&#65;"), "A");
        assert_eq!(decode_xml_entities(b"&#x41;"), "A");
    }

    #[test]
    fn test_decode_xml_entities_mixed() {
        assert_eq!(decode_xml_entities(b"&lt;a&gt;&amp;&lt;/a&gt;"), "<a>&</a>");
    }

    #[test]
    fn test_decode_xml_entities_incomplete() {
        // Incomplete entity should be passed through
        assert_eq!(decode_xml_entities(b"&incomplete"), "&incomplete");
        assert_eq!(decode_xml_entities(b"&"), "&");
    }

    #[test]
    fn test_parse_char_reference_decimal() {
        let bytes = b"&#65;rest";
        let (ch, len) = parse_char_reference(bytes).unwrap();
        assert_eq!(ch, 'A');
        assert_eq!(len, 5);
    }

    #[test]
    fn test_parse_char_reference_hex() {
        let bytes = b"&#x41;rest";
        let (ch, len) = parse_char_reference(bytes).unwrap();
        assert_eq!(ch, 'A');
        assert_eq!(len, 6);
    }

    #[test]
    fn test_parse_char_reference_invalid() {
        assert!(parse_char_reference(b"&#;").is_none());
        assert!(parse_char_reference(b"&#abc;").is_none());
        assert!(parse_char_reference(b"&xyz;").is_none());
    }

    #[test]
    fn test_parse_element_content() {
        let xml = b"<root><tag>content</tag></root>";
        let content = parse_element_content(xml, b"tag").unwrap();
        assert_eq!(content, "content");
    }

    #[test]
    fn test_parse_element_content_with_entities() {
        let xml = b"<root><tag>&lt;hello&gt;</tag></root>";
        let content = parse_element_content(xml, b"tag").unwrap();
        assert_eq!(content, "<hello>");
    }

    #[test]
    fn test_parse_element_content_empty() {
        let xml = b"<root><tag></tag></root>";
        let content = parse_element_content(xml, b"tag").unwrap();
        assert_eq!(content, "");
    }

    #[test]
    fn test_parse_element_content_not_found() {
        let xml = b"<root><other>content</other></root>";
        assert!(parse_element_content(xml, b"tag").is_none());
    }
}
