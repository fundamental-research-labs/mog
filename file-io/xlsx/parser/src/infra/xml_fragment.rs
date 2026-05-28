//! XML element extraction helpers shared by XLSX readers.
//!
//! The old workbook/worksheet raw-child replay model has been removed. This
//! module intentionally keeps only generic fragment-boundary utilities used by
//! typed parsers that need to copy a current element into owned feature state.

#![allow(clippy::string_slice)]

use crate::infra::scanner::{find_element_end, find_gt_simd, find_lt_simd};

/// Extract a complete XML element (including all content and nested elements).
///
/// This function handles self-closing elements, elements with content, nested
/// elements with the same tag name, and namespaced tags.
pub fn extract_element_bounds(xml: &[u8], start: usize) -> Option<(usize, usize)> {
    if start >= xml.len() || xml[start] != b'<' {
        return None;
    }

    let tag_start = start + 1;
    let mut tag_end = tag_start;
    while tag_end < xml.len() {
        let b = xml[tag_end];
        if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
            break;
        }
        tag_end += 1;
    }

    if tag_end <= tag_start {
        return None;
    }

    let tag_name = &xml[tag_start..tag_end];
    let element_end_pos = find_element_end(xml, tag_end)?;

    if element_end_pos > 0 && xml[element_end_pos - 1] == b'/' {
        return Some((start, element_end_pos + 1));
    }

    let mut pos = element_end_pos + 1;
    let mut depth = 1;

    while pos < xml.len() && depth > 0 {
        let Some(lt_pos) = find_lt_simd(xml, pos) else {
            break;
        };
        let after_lt = lt_pos + 1;
        if after_lt >= xml.len() {
            break;
        }

        if xml[after_lt] == b'/' {
            let close_tag_start = after_lt + 1;
            let mut close_tag_end = close_tag_start;
            while close_tag_end < xml.len() {
                let b = xml[close_tag_end];
                if matches!(b, b'>' | b' ' | b'\t' | b'\n' | b'\r') {
                    break;
                }
                close_tag_end += 1;
            }

            let close_tag_name = &xml[close_tag_start..close_tag_end];
            if tags_match(tag_name, close_tag_name) {
                depth -= 1;
                if depth == 0 {
                    let gt_pos = find_gt_simd(xml, close_tag_end)?;
                    return Some((start, gt_pos + 1));
                }
            }
        } else {
            let mut open_tag_end = after_lt;
            while open_tag_end < xml.len() {
                let b = xml[open_tag_end];
                if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
                    break;
                }
                open_tag_end += 1;
            }

            let open_tag_name = &xml[after_lt..open_tag_end];
            if tags_match(tag_name, open_tag_name)
                && let Some(gt_pos) = find_element_end(xml, open_tag_end)
                && gt_pos > 0
                && xml[gt_pos - 1] != b'/'
            {
                depth += 1;
            }
        }

        pos = after_lt;
    }

    None
}

fn tags_match(tag1: &[u8], tag2: &[u8]) -> bool {
    if tag1 == tag2 {
        return true;
    }

    let local1 = tag1
        .iter()
        .position(|&b| b == b':')
        .map(|p| &tag1[p + 1..])
        .unwrap_or(tag1);
    let local2 = tag2
        .iter()
        .position(|&b| b == b':')
        .map(|p| &tag2[p + 1..])
        .unwrap_or(tag2);

    local1 == local2
}

/// Extract raw XML for an element from bytes.
pub fn extract_element_xml(xml: &[u8], start: usize) -> Option<String> {
    let (_, end) = extract_element_bounds(xml, start)?;
    String::from_utf8(xml[start..end].to_vec()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_bounds_self_closing() {
        let xml = b"<element attr=\"value\"/>";
        assert_eq!(extract_element_bounds(xml, 0), Some((0, xml.len())));
    }

    #[test]
    fn extract_bounds_with_content() {
        let xml = b"<parent><child>content</child></parent>";
        assert_eq!(extract_element_bounds(xml, 0), Some((0, xml.len())));
    }

    #[test]
    fn extract_bounds_nested_same_name() {
        let xml = b"<div><div>nested</div></div>";
        assert_eq!(extract_element_bounds(xml, 0), Some((0, xml.len())));
    }

    #[test]
    fn extract_bounds_namespaced() {
        let xml = b"<x14:ext><x14:child/></x14:ext>";
        assert_eq!(extract_element_bounds(xml, 0), Some((0, xml.len())));
    }

    #[test]
    fn extract_bounds_with_offset() {
        let xml = b"prefix<element>content</element>suffix";
        assert_eq!(extract_element_bounds(xml, 6), Some((6, 32)));
    }

    #[test]
    fn extract_bounds_malformed() {
        assert_eq!(extract_element_bounds(b"<element>", 0), None);
        assert_eq!(extract_element_bounds(b"", 0), None);
    }

    #[test]
    fn extract_xml() {
        let xml = b"prefix<child>text</child>suffix";
        assert_eq!(
            extract_element_xml(xml, 6).as_deref(),
            Some("<child>text</child>")
        );
    }
}
