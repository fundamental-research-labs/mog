use super::name::{closing_tag_name_matches, start_tag_name_matches};
use super::primitives::{find_gt_simd, find_lt_simd};
use memchr::memchr2;

/// Result of scanning for the structural `>` that ends an XML start tag.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartTagEnd {
    /// A `>` was found outside quoted attribute values.
    Found(usize),
    /// The scanner entered a quoted attribute value and reached EOF before the
    /// matching quote. `fallback_gt` is the first raw `>` seen inside that
    /// unterminated quoted value, if any.
    UnterminatedQuote {
        quote: u8,
        fallback_gt: Option<usize>,
    },
    /// No structural `>` was found.
    Missing,
}

/// Find the structural `>` that ends a start tag, ignoring raw `>` bytes inside
/// single- or double-quoted attribute values.
///
/// `start` may point at the opening `<` or anywhere inside the tag name. This is
/// the required boundary helper for callers that slice an attribute-bearing
/// start tag before extracting string attributes.
#[inline]
pub fn find_start_tag_end_quoted(bytes: &[u8], start: usize) -> StartTagEnd {
    if start >= bytes.len() {
        return StartTagEnd::Missing;
    }

    let first_gt = find_gt_simd(bytes, start);
    let first_quote = memchr2(b'"', b'\'', &bytes[start..]).map(|pos| start + pos);

    match (first_gt, first_quote) {
        (Some(gt), Some(quote)) if gt < quote => return StartTagEnd::Found(gt),
        (Some(gt), None) => return StartTagEnd::Found(gt),
        (None, None) => return StartTagEnd::Missing,
        _ => {}
    }

    let mut pos = start;
    let mut active_quote: Option<u8> = None;
    let mut fallback_gt = None;

    while pos < bytes.len() {
        let b = bytes[pos];

        match active_quote {
            Some(quote) => {
                if b == quote {
                    active_quote = None;
                } else if b == b'>' && fallback_gt.is_none() {
                    fallback_gt = Some(pos);
                }
            }
            None => {
                if b == b'\'' || b == b'"' {
                    active_quote = Some(b);
                    fallback_gt = None;
                } else if b == b'>' {
                    return StartTagEnd::Found(pos);
                }
            }
        }

        pos += 1;
    }

    match active_quote {
        Some(quote) => StartTagEnd::UnterminatedQuote { quote, fallback_gt },
        None => StartTagEnd::Missing,
    }
}

/// Find a specific XML tag (e.g., `<sheetData>`) in the byte stream.
///
/// This is optimized for OOXML parsing where we know the exact tags to look for.
///
/// # Example
/// ```
/// use xlsx_parser::infra::scanner::find_tag_simd;
///
/// let xml = b"<worksheet><sheetData><row>";
/// assert_eq!(find_tag_simd(xml, b"sheetData", 0), Some(11));
/// ```
#[inline(always)]
pub fn find_tag_simd(bytes: &[u8], tag: &[u8], start: usize) -> Option<usize> {
    if start >= bytes.len() || tag.is_empty() {
        return None;
    }

    let mut pos = start;

    while let Some(lt_pos) = find_lt_simd(bytes, pos) {
        let name_start = lt_pos + 1;

        if name_start + tag.len() > bytes.len() {
            return None;
        }

        let mut name_end = name_start;
        while name_end < bytes.len() {
            let b = bytes[name_end];
            if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
                break;
            }
            name_end += 1;
        }

        if start_tag_name_matches(bytes, name_start, name_end, tag) {
            return Some(lt_pos);
        }

        pos = name_start;
    }

    None
}

/// Find the end of an XML element (the closing '>').
/// Handles self-closing tags (/>).
///
/// Returns the position of the closing '>' character.
#[inline(always)]
pub fn find_element_end(bytes: &[u8], start: usize) -> Option<usize> {
    match find_start_tag_end_quoted(bytes, start) {
        StartTagEnd::Found(pos) => Some(pos),
        StartTagEnd::UnterminatedQuote { .. } | StartTagEnd::Missing => None,
    }
}

/// Find the closing tag for an element (e.g., `</sheetData>`).
///
/// # Example
/// ```
/// use xlsx_parser::infra::scanner::find_closing_tag;
///
/// let xml = b"<row><c r=\"A1\"/></row><row>";
/// assert_eq!(find_closing_tag(xml, b"row", 0), Some(16));
/// ```
#[inline(always)]
pub fn find_closing_tag(bytes: &[u8], tag: &[u8], start: usize) -> Option<usize> {
    if start >= bytes.len() || tag.is_empty() {
        return None;
    }

    let mut pos = start;

    while pos + 2 + tag.len() <= bytes.len() {
        let Some(lt_pos) = find_lt_simd(bytes, pos) else {
            break;
        };

        let after_lt = lt_pos + 1;
        if after_lt < bytes.len() && bytes[after_lt] == b'/' {
            let name_start = after_lt + 1;
            let mut name_end = name_start;
            while name_end < bytes.len() {
                let b = bytes[name_end];
                if matches!(b, b'>' | b' ' | b'\t' | b'\n' | b'\r') {
                    break;
                }
                name_end += 1;
            }

            if closing_tag_name_matches(bytes, name_start, name_end, tag) {
                return Some(lt_pos);
            }
        }

        pos = after_lt;
    }

    None
}
