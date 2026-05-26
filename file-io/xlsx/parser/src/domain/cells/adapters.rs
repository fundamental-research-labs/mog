//! Scanner adapter functions for the cell parser.
//!
//! These provide a convenient API that matches the cell parser's needs,
//! wrapping the underlying SIMD-optimized scanner functions.

use crate::infra::scanner::{
    find_any_simd, find_gt_simd, find_lt_simd, find_tag_simd, skip_whitespace_simd,
};

/// Find a specific byte in the slice starting from `start`.
#[inline]
pub(crate) fn find_byte(xml: &[u8], byte: u8, start: usize) -> Option<usize> {
    if start >= xml.len() {
        return None;
    }
    match byte {
        b'<' => find_lt_simd(xml, start),
        b'>' => find_gt_simd(xml, start),
        _ => find_any_simd(xml, start, &[byte]).map(|(pos, _)| pos),
    }
}

/// Find a byte sequence in the slice starting from `start`.
#[inline]
pub(crate) fn find_sequence(xml: &[u8], seq: &[u8], start: usize) -> Option<usize> {
    if seq.is_empty() || start + seq.len() > xml.len() {
        return None;
    }

    // Use memchr for single-byte sequences
    if seq.len() == 1 {
        return find_byte(xml, seq[0], start);
    }

    // For XML tags, use the optimized find_tag_simd
    // Only route to find_tag_simd when the sequence after '<' is a pure tag name
    // (no spaces, '>', '/' inside). Sequences like b"<f " contain a space in the
    // "tag name" portion, which causes find_tag_simd to fail because it calculates
    // name_end as the position of the first delimiter, making the tag region shorter
    // than the search pattern. Such sequences must use the general byte-by-byte path.
    if seq.starts_with(b"<") && !seq.contains(&b'>') {
        // Extract tag name (without < prefix)
        let tag_name = &seq[1..];
        // Check for closing tag pattern </
        if tag_name.starts_with(b"/") {
            // This is a closing tag like </sheetData>
            let inner_tag = &tag_name[1..];
            // Only use optimized path if inner tag has no delimiters
            let has_delimiters = inner_tag
                .iter()
                .any(|&b| matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'/' | b'>'));
            if !has_delimiters {
                return find_closing_tag_position(xml, inner_tag, start);
            }
        } else {
            // Only use optimized path if tag name has no delimiters
            let has_delimiters = tag_name
                .iter()
                .any(|&b| matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'/' | b'>'));
            if !has_delimiters {
                return find_tag_simd(xml, tag_name, start);
            }
        }
    }

    // General case: scan byte by byte using SIMD for first byte
    let first_byte = seq[0];
    let mut pos = start;

    while pos + seq.len() <= xml.len() {
        if let Some((found, _)) = find_any_simd(xml, pos, &[first_byte]) {
            if found + seq.len() <= xml.len() && &xml[found..found + seq.len()] == seq {
                return Some(found);
            }
            pos = found + 1;
        } else {
            break;
        }
    }

    None
}

/// Find a closing tag like </tagname> starting from `start`.
#[inline]
pub(crate) fn find_closing_tag_position(xml: &[u8], tag: &[u8], start: usize) -> Option<usize> {
    let mut pos = start;
    while pos + 2 + tag.len() < xml.len() {
        if let Some(lt_pos) = find_lt_simd(xml, pos) {
            if lt_pos + 1 < xml.len() && xml[lt_pos + 1] == b'/' {
                let tag_start = lt_pos + 2;
                if tag_start + tag.len() <= xml.len()
                    && &xml[tag_start..tag_start + tag.len()] == tag
                {
                    return Some(lt_pos);
                }
            }
            pos = lt_pos + 1;
        } else {
            break;
        }
    }
    None
}

/// Find any of the specified bytes in the slice.
#[inline]
#[allow(dead_code)]
pub(crate) fn find_any_of(xml: &[u8], chars: &[u8], start: usize) -> Option<usize> {
    find_any_simd(xml, start, chars).map(|(pos, _)| pos)
}

/// Skip whitespace characters.
#[inline]
pub(crate) fn skip_whitespace(xml: &[u8], start: usize) -> usize {
    skip_whitespace_simd(xml, start)
}
