//! Optimized XML byte scanner for high-performance parsing.
//!
//! This module provides fast byte scanning functions optimized for XML parsing,
//! using safe `memchr` search primitives where available with scalar fallbacks
//! for multi-byte predicates.
//!
//! Target throughput: ~1 GB/s for finding XML delimiters.
//!
//! # Usage
//!
//! There are two ways to use this module:
//!
//! 1. **Free functions** - For one-off searches:
//!    ```ignore
//!    use xlsx_parser::infra::scanner::{find_lt_simd, find_tag_simd};
//!
//!    let xml = b"<worksheet><sheetData>";
//!    let pos = find_lt_simd(xml, 0);
//!    ```
//!
//! 2. **XmlScanner struct** - For stateful parsing with position tracking:
//!    ```ignore
//!    use xlsx_parser::infra::scanner::XmlScanner;
//!
//!    let xml = b"<worksheet><sheetData>";
//!    let mut scanner = XmlScanner::new(xml);
//!    let tag_pos = scanner.find_tag(b"sheetData");
//!    ```

// memchr provides fast byte searching with safe SIMD-aware optimizations.
use memchr::{memchr, memchr2, memchr3};

// ============================================================================
// XmlScanner - Stateful Scanner Wrapper
// ============================================================================

/// A stateful XML byte scanner that tracks position while parsing.
///
/// This provides a convenient API for sequential parsing of XML documents,
/// maintaining the current position and providing methods that advance through
/// the byte stream.
///
/// # Example
/// ```ignore
/// use xlsx_parser::infra::scanner::XmlScanner;
///
/// let xml = b"<row r=\"1\"><c r=\"A1\"><v>42</v></c></row>";
/// let mut scanner = XmlScanner::new(xml);
///
/// // Find and advance to elements
/// assert!(scanner.find_tag(b"row").is_some());
/// assert!(scanner.find_tag(b"c").is_some());
/// ```
#[derive(Debug, Clone)]
pub struct XmlScanner<'a> {
    /// The byte slice being scanned
    bytes: &'a [u8],
    /// Current position in the byte stream
    pos: usize,
}

impl<'a> XmlScanner<'a> {
    /// Create a new scanner for the given bytes.
    #[inline]
    pub fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }

    /// Create a scanner starting at a specific position.
    #[inline]
    pub fn new_at(bytes: &'a [u8], pos: usize) -> Self {
        Self { bytes, pos }
    }

    /// Get the underlying byte slice.
    #[inline]
    pub fn bytes(&self) -> &'a [u8] {
        self.bytes
    }

    /// Get the current position.
    #[inline]
    pub fn pos(&self) -> usize {
        self.pos
    }

    /// Set the current position.
    #[inline]
    pub fn set_pos(&mut self, pos: usize) {
        self.pos = pos;
    }

    /// Advance the position by `n` bytes.
    #[inline]
    pub fn advance(&mut self, n: usize) {
        self.pos += n;
    }

    /// Check if we've reached the end.
    #[inline]
    pub fn is_at_end(&self) -> bool {
        self.pos >= self.bytes.len()
    }

    /// Get remaining bytes from current position.
    #[inline]
    pub fn remaining(&self) -> &'a [u8] {
        if self.pos >= self.bytes.len() {
            &[]
        } else {
            &self.bytes[self.pos..]
        }
    }

    /// Get remaining length.
    #[inline]
    pub fn remaining_len(&self) -> usize {
        self.bytes.len().saturating_sub(self.pos)
    }

    // -------------------------------------------------------------------------
    // Find methods (return position without advancing)
    // -------------------------------------------------------------------------

    /// Find the next '<' character from current position.
    /// Does not advance the scanner position.
    #[inline]
    pub fn find_lt(&self) -> Option<usize> {
        find_lt_simd(self.bytes, self.pos)
    }

    /// Find the next '>' character from current position.
    /// Does not advance the scanner position.
    #[inline]
    pub fn find_gt(&self) -> Option<usize> {
        find_gt_simd(self.bytes, self.pos)
    }

    /// Find any of the target bytes from current position.
    /// Returns (position, found_byte). Does not advance.
    #[inline]
    pub fn find_any(&self, targets: &[u8]) -> Option<(usize, u8)> {
        find_any_simd(self.bytes, self.pos, targets)
    }

    /// Find a specific XML tag from current position.
    /// Returns the position of the '<'. Does not advance.
    #[inline]
    pub fn find_tag(&self, tag: &[u8]) -> Option<usize> {
        find_tag_simd(self.bytes, tag, self.pos)
    }

    /// Find an XML attribute from current position.
    /// Returns the position of the attribute name. Does not advance.
    #[inline]
    pub fn find_attr(&self, attr: &[u8]) -> Option<usize> {
        find_attr_simd(self.bytes, attr, self.pos)
    }

    /// Find the closing tag from current position.
    /// Returns the position of the '</'. Does not advance.
    #[inline]
    pub fn find_closing(&self, tag: &[u8]) -> Option<usize> {
        find_closing_tag(self.bytes, tag, self.pos)
    }

    // -------------------------------------------------------------------------
    // Skip/advance methods
    // -------------------------------------------------------------------------

    /// Skip whitespace from current position and update pos.
    /// Returns the new position.
    #[inline]
    pub fn skip_whitespace(&mut self) -> usize {
        self.pos = skip_whitespace_simd(self.bytes, self.pos);
        self.pos
    }

    /// Advance to the next '<' character.
    /// Returns the position if found, None otherwise.
    #[inline]
    pub fn advance_to_lt(&mut self) -> Option<usize> {
        if let Some(pos) = find_lt_simd(self.bytes, self.pos) {
            self.pos = pos;
            Some(pos)
        } else {
            None
        }
    }

    /// Advance to the next '>' character.
    /// Returns the position if found, None otherwise.
    #[inline]
    pub fn advance_to_gt(&mut self) -> Option<usize> {
        if let Some(pos) = find_gt_simd(self.bytes, self.pos) {
            self.pos = pos;
            Some(pos)
        } else {
            None
        }
    }

    /// Advance past the next '>' character.
    /// Returns true if successful.
    #[inline]
    pub fn advance_past_gt(&mut self) -> bool {
        if let Some(pos) = find_gt_simd(self.bytes, self.pos) {
            self.pos = pos + 1;
            true
        } else {
            false
        }
    }

    /// Advance to the next occurrence of a specific tag.
    /// Returns the position if found, None otherwise.
    #[inline]
    pub fn advance_to_tag(&mut self, tag: &[u8]) -> Option<usize> {
        if let Some(pos) = find_tag_simd(self.bytes, tag, self.pos) {
            self.pos = pos;
            Some(pos)
        } else {
            None
        }
    }

    /// Advance past a specific tag (past its '>').
    /// Returns true if successful.
    #[inline]
    pub fn advance_past_tag(&mut self, tag: &[u8]) -> bool {
        if let Some(pos) = find_tag_simd(self.bytes, tag, self.pos) {
            self.pos = pos;
            // Now find the '>' to skip past it
            if let Some(end) = find_element_end(self.bytes, pos + 1) {
                self.pos = end + 1;
                return true;
            }
        }
        false
    }

    // -------------------------------------------------------------------------
    // Extraction methods
    // -------------------------------------------------------------------------

    /// Extract attribute value for given attribute name (e.g., `r="`).
    /// Returns the value bytes (without quotes) if found.
    /// Does not advance the scanner.
    #[inline]
    pub fn extract_attr_value(&self, attr: &[u8]) -> Option<&'a [u8]> {
        let attr_pos = find_attr_simd(self.bytes, attr, self.pos)?;
        let value_start = attr_pos + attr.len();
        let (start, end) = extract_quoted_value(self.bytes, value_start)?;
        Some(&self.bytes[start..end])
    }

    /// Extract text content between current position and closing tag.
    /// Useful for getting values like `<v>123</v>`.
    #[inline]
    pub fn extract_until_closing(&self, tag: &[u8]) -> Option<&'a [u8]> {
        let end_pos = find_closing_tag(self.bytes, tag, self.pos)?;
        if self.pos < end_pos {
            Some(&self.bytes[self.pos..end_pos])
        } else {
            None
        }
    }

    /// Check if bytes at current position match pattern.
    #[inline]
    pub fn matches(&self, pattern: &[u8]) -> bool {
        matches_at(self.bytes, self.pos, pattern)
    }

    /// Get byte at current position, if available.
    #[inline]
    pub fn current_byte(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    /// Peek at byte at offset from current position.
    #[inline]
    pub fn peek(&self, offset: usize) -> Option<u8> {
        self.bytes.get(self.pos + offset).copied()
    }
}

// ============================================================================
// Safe optimized scanning functions
// ============================================================================

mod simd {
    use super::{memchr, memchr2, memchr3};

    /// Scalar fallback for find_lt_simd.
    #[inline(always)]
    pub fn find_lt_simd(bytes: &[u8], start: usize) -> Option<usize> {
        if start >= bytes.len() {
            return None;
        }
        memchr(b'<', &bytes[start..]).map(|pos| start + pos)
    }

    /// Scalar fallback for find_gt_simd.
    #[inline(always)]
    pub fn find_gt_simd(bytes: &[u8], start: usize) -> Option<usize> {
        if start >= bytes.len() {
            return None;
        }
        memchr(b'>', &bytes[start..]).map(|pos| start + pos)
    }

    /// Scalar fallback for find_any_simd.
    #[inline(always)]
    pub fn find_any_simd(bytes: &[u8], start: usize, targets: &[u8]) -> Option<(usize, u8)> {
        if start >= bytes.len() || targets.is_empty() {
            return None;
        }

        let search_bytes = &bytes[start..];

        match targets.len() {
            1 => memchr(targets[0], search_bytes).map(|pos| (start + pos, search_bytes[pos])),
            2 => memchr2(targets[0], targets[1], search_bytes)
                .map(|pos| (start + pos, search_bytes[pos])),
            3 => memchr3(targets[0], targets[1], targets[2], search_bytes)
                .map(|pos| (start + pos, search_bytes[pos])),
            _ => {
                for (i, &b) in search_bytes.iter().enumerate() {
                    if targets.contains(&b) {
                        return Some((start + i, b));
                    }
                }
                None
            }
        }
    }

    /// Safe scanner for XML whitespace.
    #[inline(always)]
    pub fn skip_whitespace_simd(bytes: &[u8], start: usize) -> usize {
        if start >= bytes.len() {
            return bytes.len();
        }

        for (i, &b) in bytes[start..].iter().enumerate() {
            if !matches!(b, b' ' | b'\t' | b'\n' | b'\r') {
                return start + i;
            }
        }

        bytes.len()
    }
}

// ============================================================================
// Public API (uses safe optimized search primitives)
// ============================================================================

/// Find the next '<' character starting from `start`.
///
/// Uses safe `memchr` search primitives where available.
///
/// # Example
/// ```
/// use xlsx_parser::infra::scanner::find_lt_simd;
///
/// let xml = b"some text <tag>";
/// assert_eq!(find_lt_simd(xml, 0), Some(10));
/// ```
#[inline(always)]
pub fn find_lt_simd(bytes: &[u8], start: usize) -> Option<usize> {
    simd::find_lt_simd(bytes, start)
}

/// Find the next '>' character starting from `start`.
///
/// Uses safe `memchr` search primitives where available.
///
/// # Example
/// ```
/// use xlsx_parser::infra::scanner::find_gt_simd;
///
/// let xml = b"<tag>content";
/// assert_eq!(find_gt_simd(xml, 0), Some(4));
/// ```
#[inline(always)]
pub fn find_gt_simd(bytes: &[u8], start: usize) -> Option<usize> {
    simd::find_gt_simd(bytes, start)
}

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
    let first_quote = memchr::memchr2(b'"', b'\'', &bytes[start..]).map(|pos| start + pos);

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

/// Find any of the target bytes, returning position and which byte was found.
///
/// Optimized for finding XML delimiters like '<', '>', '"', '='.
///
/// # Example
/// ```
/// use xlsx_parser::infra::scanner::find_any_simd;
///
/// let xml = b"attr=\"value\"";
/// assert_eq!(find_any_simd(xml, 0, &[b'=', b'"']), Some((4, b'=')));
/// ```
#[inline(always)]
pub fn find_any_simd(bytes: &[u8], start: usize, targets: &[u8]) -> Option<(usize, u8)> {
    simd::find_any_simd(bytes, start, targets)
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

    // Search for '<' followed by the tag name (with or without namespace prefix)
    while let Some(lt_pos) = find_lt_simd(bytes, pos) {
        let after_lt = lt_pos + 1;

        // Check if we have enough bytes for the tag
        if after_lt + tag.len() > bytes.len() {
            return None;
        }

        // Try to match the tag at different positions after '<'
        // This handles both <tag> and <ns:tag> cases
        let check_pos = after_lt;

        // Look for tag name - it may be after a namespace prefix (e.g., "c:" or "x14:")
        // Find the end of the element name area (up to space, >, /, or end of buffer)
        let mut name_end = check_pos;
        while name_end < bytes.len() {
            let b = bytes[name_end];
            if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
                break;
            }
            name_end += 1;
        }

        // Check if tag matches at the start (no namespace)
        if bytes[check_pos..].starts_with(tag) {
            let after_tag = check_pos + tag.len();
            if after_tag <= name_end {
                let next_byte = if after_tag < bytes.len() {
                    bytes[after_tag]
                } else {
                    b'>'
                };
                if matches!(next_byte, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
                    return Some(lt_pos);
                }
            }
        }

        // Check if tag matches after a namespace prefix (look for ':')
        if let Some(colon_offset) = bytes[check_pos..name_end].iter().position(|&b| b == b':') {
            let after_colon = check_pos + colon_offset + 1;
            if after_colon + tag.len() <= bytes.len() && bytes[after_colon..].starts_with(tag) {
                let after_tag = after_colon + tag.len();
                if after_tag <= name_end {
                    let next_byte = if after_tag < bytes.len() {
                        bytes[after_tag]
                    } else {
                        b'>'
                    };
                    if matches!(next_byte, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
                        return Some(lt_pos);
                    }
                }
            }
        }

        pos = after_lt;
    }

    None
}

/// Find an XML attribute (e.g., `r="`) in the byte stream.
///
/// Returns the position of the first byte of the attribute name.
///
/// # Example
/// ```
/// use xlsx_parser::infra::scanner::find_attr_simd;
///
/// let xml = b"<c r=\"A1\" t=\"s\">";
/// assert_eq!(find_attr_simd(xml, b"r=\"", 0), Some(3));
/// ```
#[inline(always)]
pub fn find_attr_simd(bytes: &[u8], attr: &[u8], start: usize) -> Option<usize> {
    if start >= bytes.len() || attr.is_empty() {
        return None;
    }

    // Use memchr to find the first byte, then verify the rest
    let search_bytes = &bytes[start..];
    let first_byte = attr[0];

    let mut pos = 0;
    while let Some(found) = memchr(first_byte, &search_bytes[pos..]) {
        let abs_pos = pos + found;

        // Check if full attribute matches
        if abs_pos + attr.len() <= search_bytes.len() {
            if search_bytes[abs_pos..].starts_with(attr) {
                // Verify it's preceded by whitespace (valid attribute position)
                if abs_pos == 0 || matches!(search_bytes[abs_pos - 1], b' ' | b'\t' | b'\n' | b'\r')
                {
                    return Some(start + abs_pos);
                }
            }
        }

        pos = abs_pos + 1;
    }

    None
}

/// Skip whitespace bytes starting from `start`.
///
/// Returns the position of the first non-whitespace byte,
/// or `bytes.len()` if all remaining bytes are whitespace.
///
/// Whitespace characters: space (0x20), tab (0x09), newline (0x0A), carriage return (0x0D)
///
/// # Example
/// ```
/// use xlsx_parser::infra::scanner::skip_whitespace_simd;
///
/// let xml = b"   \t\n<tag>";
/// assert_eq!(skip_whitespace_simd(xml, 0), 5);
/// ```
#[inline(always)]
pub fn skip_whitespace_simd(bytes: &[u8], start: usize) -> usize {
    simd::skip_whitespace_simd(bytes, start)
}

// ============================================================================
// Additional Utility Functions
// ============================================================================

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

    // Look for "</" followed by tag (with or without namespace prefix)
    while pos + 2 + tag.len() <= bytes.len() {
        if let Some(lt_pos) = find_lt_simd(bytes, pos) {
            let after_lt = lt_pos + 1;

            // Check for '/'
            if after_lt < bytes.len() && bytes[after_lt] == b'/' {
                let tag_start = after_lt + 1;

                // Find the end of the tag name area
                let mut name_end = tag_start;
                while name_end < bytes.len() {
                    let b = bytes[name_end];
                    if matches!(b, b'>' | b' ' | b'\t' | b'\n' | b'\r') {
                        break;
                    }
                    name_end += 1;
                }

                // Check if tag matches at the start (no namespace)
                if tag_start + tag.len() <= bytes.len() && bytes[tag_start..].starts_with(tag) {
                    let after_tag = tag_start + tag.len();
                    if after_tag <= name_end {
                        if after_tag >= bytes.len()
                            || matches!(bytes[after_tag], b'>' | b' ' | b'\t' | b'\n' | b'\r')
                        {
                            return Some(lt_pos);
                        }
                    }
                }

                // Check if tag matches after a namespace prefix (look for ':')
                if let Some(colon_offset) =
                    bytes[tag_start..name_end].iter().position(|&b| b == b':')
                {
                    let after_colon = tag_start + colon_offset + 1;
                    if after_colon + tag.len() <= bytes.len()
                        && bytes[after_colon..].starts_with(tag)
                    {
                        let after_tag = after_colon + tag.len();
                        if after_tag <= name_end {
                            if after_tag >= bytes.len()
                                || matches!(bytes[after_tag], b'>' | b' ' | b'\t' | b'\n' | b'\r')
                            {
                                return Some(lt_pos);
                            }
                        }
                    }
                }
            }

            pos = after_lt;
        } else {
            break;
        }
    }

    None
}

/// Extract the value between quotes in an attribute.
/// Assumes `start` is positioned after the opening quote.
///
/// Returns (value_start, value_end) positions, exclusive of quotes.
#[inline(always)]
pub fn extract_quoted_value(bytes: &[u8], start: usize) -> Option<(usize, usize)> {
    if start >= bytes.len() {
        return None;
    }

    // Find closing quote
    if let Some(end_offset) = memchr(b'"', &bytes[start..]) {
        return Some((start, start + end_offset));
    }

    None
}

/// Check if bytes starting at `start` match the given pattern.
#[inline(always)]
pub fn matches_at(bytes: &[u8], start: usize, pattern: &[u8]) -> bool {
    if start + pattern.len() > bytes.len() {
        return false;
    }
    bytes[start..].starts_with(pattern)
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn ref_find_byte(bytes: &[u8], start: usize, target: u8) -> Option<usize> {
        bytes
            .get(start..)?
            .iter()
            .position(|&b| b == target)
            .map(|pos| start + pos)
    }

    fn ref_find_any(bytes: &[u8], start: usize, targets: &[u8]) -> Option<(usize, u8)> {
        bytes
            .get(start..)?
            .iter()
            .enumerate()
            .find_map(|(offset, &b)| {
                if targets.contains(&b) {
                    Some((start + offset, b))
                } else {
                    None
                }
            })
    }

    fn ref_skip_xml_whitespace(bytes: &[u8], start: usize) -> usize {
        if start >= bytes.len() {
            return bytes.len();
        }

        bytes[start..]
            .iter()
            .position(|&b| !matches!(b, b' ' | b'\t' | b'\n' | b'\r'))
            .map_or(bytes.len(), |offset| start + offset)
    }

    #[test]
    fn test_primitive_scanners_match_references_for_all_short_offsets() {
        let cases: &[&[u8]] = &[
            b"",
            b"<",
            b">",
            b"plain",
            b" <a>",
            b"\t\r\n<row r=\"1\">",
            b"abc>def<ghi",
            b"\x0b<formfeed\x0c>",
        ];
        let target_sets: &[&[u8]] = &[
            b"",
            b"<",
            b">",
            b"<>",
            b"=\"",
            b"<>'\"",
            b"abcde",
            b"abcdefg",
            b"<<>>==\"\"",
        ];

        for bytes in cases {
            for start in 0..=bytes.len() + 2 {
                assert_eq!(
                    find_lt_simd(bytes, start),
                    ref_find_byte(bytes, start, b'<')
                );
                assert_eq!(
                    find_gt_simd(bytes, start),
                    ref_find_byte(bytes, start, b'>')
                );
                assert_eq!(
                    skip_whitespace_simd(bytes, start),
                    ref_skip_xml_whitespace(bytes, start)
                );

                for targets in target_sets {
                    assert_eq!(
                        find_any_simd(bytes, start, targets),
                        ref_find_any(bytes, start, targets),
                        "bytes={bytes:?}, start={start}, targets={targets:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn test_primitive_scanners_match_references_around_chunk_boundaries() {
        let boundary_positions = [15, 16, 17, 31, 32, 33];
        let target_sets: &[&[u8]] = &[
            b"",
            b"<",
            b">",
            b"<>",
            b"<>\"",
            b"<>\"=",
            b"abcdef",
            b"01234567",
        ];

        for &position in &boundary_positions {
            for marker in [b'<', b'>', b'=', b'"', b'g'] {
                let mut bytes = vec![b'x'; 48];
                bytes[position] = marker;
                bytes[0] = b'<';
                bytes[47] = b'>';

                for start in [
                    0,
                    1,
                    position.saturating_sub(1),
                    position,
                    position + 1,
                    48,
                    49,
                ] {
                    assert_eq!(
                        find_lt_simd(&bytes, start),
                        ref_find_byte(&bytes, start, b'<')
                    );
                    assert_eq!(
                        find_gt_simd(&bytes, start),
                        ref_find_byte(&bytes, start, b'>')
                    );

                    for targets in target_sets {
                        assert_eq!(
                            find_any_simd(&bytes, start, targets),
                            ref_find_any(&bytes, start, targets),
                            "position={position}, marker={marker}, start={start}, targets={targets:?}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn test_find_any_target_lengths_zero_through_eight_and_duplicates() {
        let bytes = b"prefix-a-middle-=-suffix->";
        let target_sets: &[&[u8]] = &[
            b"",
            b"z",
            b"za",
            b"za=",
            b"za=<",
            b"za=<m",
            b"za=<m-",
            b"za=<m->",
            b"za=<m->p",
            b"zz==aa>>",
        ];

        for targets in target_sets {
            for start in 0..=bytes.len() + 1 {
                assert_eq!(
                    find_any_simd(bytes, start, targets),
                    ref_find_any(bytes, start, targets),
                    "target length {}, start {start}",
                    targets.len()
                );
            }
        }
    }

    #[test]
    fn test_skip_whitespace_xml_set_only() {
        let bytes = b" \t\n\r\x0b\x0ctext";
        assert_eq!(skip_whitespace_simd(bytes, 0), 4);
        assert_eq!(skip_whitespace_simd(bytes, 4), 4);
        assert_eq!(skip_whitespace_simd(b" \t\n\r", 0), 4);
        assert_eq!(skip_whitespace_simd(b"text", 4), 4);
        assert_eq!(skip_whitespace_simd(b"text", 5), 4);
    }

    // -------------------------------------------------------------------------
    // find_lt_simd tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_find_lt_at_start() {
        let bytes = b"<tag>content</tag>";
        assert_eq!(find_lt_simd(bytes, 0), Some(0));
    }

    #[test]
    fn test_find_lt_in_middle() {
        let bytes = b"some text <tag>";
        assert_eq!(find_lt_simd(bytes, 0), Some(10));
    }

    #[test]
    fn test_find_lt_from_offset() {
        let bytes = b"<first><second>";
        assert_eq!(find_lt_simd(bytes, 1), Some(7));
    }

    #[test]
    fn test_find_lt_not_found() {
        let bytes = b"no angle brackets here";
        assert_eq!(find_lt_simd(bytes, 0), None);
    }

    #[test]
    fn test_find_lt_empty_input() {
        let bytes = b"";
        assert_eq!(find_lt_simd(bytes, 0), None);
    }

    #[test]
    fn test_find_lt_start_past_end() {
        let bytes = b"<tag>";
        assert_eq!(find_lt_simd(bytes, 100), None);
    }

    #[test]
    fn test_find_lt_large_input() {
        // Test with input larger than 16 bytes to exercise optimized search.
        let mut bytes = vec![b'x'; 100];
        bytes[50] = b'<';
        assert_eq!(find_lt_simd(&bytes, 0), Some(50));
    }

    #[test]
    fn test_find_lt_multiple_occurrences() {
        let bytes = b"<a><b><c>";
        assert_eq!(find_lt_simd(bytes, 0), Some(0));
        assert_eq!(find_lt_simd(bytes, 1), Some(3));
        assert_eq!(find_lt_simd(bytes, 4), Some(6));
    }

    #[test]
    fn test_find_lt_at_16_byte_boundary() {
        let mut bytes = vec![b'x'; 32];
        bytes[16] = b'<';
        assert_eq!(find_lt_simd(&bytes, 0), Some(16));
    }

    #[test]
    fn test_find_lt_in_remainder() {
        // Test finding '<' near the end of a short suffix.
        let mut bytes = vec![b'x'; 20];
        bytes[18] = b'<';
        assert_eq!(find_lt_simd(&bytes, 0), Some(18));
    }

    // -------------------------------------------------------------------------
    // find_gt_simd tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_find_gt_basic() {
        let bytes = b"<tag>content";
        assert_eq!(find_gt_simd(bytes, 0), Some(4));
    }

    #[test]
    fn test_find_gt_from_offset() {
        let bytes = b"<a>text<b>more";
        assert_eq!(find_gt_simd(bytes, 4), Some(9));
    }

    #[test]
    fn test_find_gt_not_found() {
        let bytes = b"<tag without close";
        assert_eq!(find_gt_simd(bytes, 5), None);
    }

    #[test]
    fn test_find_gt_large_input() {
        let mut bytes = vec![b'x'; 100];
        bytes[75] = b'>';
        assert_eq!(find_gt_simd(&bytes, 0), Some(75));
    }

    // -------------------------------------------------------------------------
    // find_any_simd tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_find_any_single_target() {
        let bytes = b"attr=\"value\"";
        assert_eq!(find_any_simd(bytes, 0, &[b'=']), Some((4, b'=')));
    }

    #[test]
    fn test_find_any_two_targets() {
        let bytes = b"attr=\"value\"";
        assert_eq!(find_any_simd(bytes, 0, &[b'=', b'"']), Some((4, b'=')));
    }

    #[test]
    fn test_find_any_three_targets() {
        let bytes = b"<tag attr=\"val\">";
        assert_eq!(
            find_any_simd(bytes, 0, &[b'<', b'=', b'"']),
            Some((0, b'<'))
        );
    }

    #[test]
    fn test_find_any_four_targets() {
        let bytes = b"text<tag>";
        assert_eq!(
            find_any_simd(bytes, 0, &[b'<', b'>', b'"', b'=']),
            Some((4, b'<'))
        );
    }

    #[test]
    fn test_find_any_from_offset() {
        let bytes = b"<a>text<b>";
        assert_eq!(find_any_simd(bytes, 4, &[b'<', b'>']), Some((7, b'<')));
    }

    #[test]
    fn test_find_any_not_found() {
        let bytes = b"plain text";
        assert_eq!(find_any_simd(bytes, 0, &[b'<', b'>']), None);
    }

    #[test]
    fn test_find_any_empty_targets() {
        let bytes = b"<tag>";
        assert_eq!(find_any_simd(bytes, 0, &[]), None);
    }

    #[test]
    fn test_find_any_large_input() {
        let mut bytes = vec![b'x'; 100];
        bytes[60] = b'"';
        assert_eq!(
            find_any_simd(&bytes, 0, &[b'"', b'<', b'>']),
            Some((60, b'"'))
        );
    }

    #[test]
    fn test_find_any_target_counts_match_in_simd_sized_chunks() {
        let cases: &[(&[u8], u8)] = &[
            (b"a", b'a'),
            (b"ab", b'b'),
            (b"abc", b'c'),
            (b"abcd", b'd'),
            (b"abcde", b'e'),
        ];

        for &(targets, expected_byte) in cases {
            let mut bytes = vec![b'x'; 64];
            bytes[32] = expected_byte;
            assert_eq!(
                find_any_simd(&bytes, 0, targets),
                Some((32, expected_byte)),
                "target count {} should find byte in a full 16-byte chunk",
                targets.len()
            );
        }
    }

    #[test]
    fn test_find_any_target_counts_match_in_scalar_remainders() {
        let cases: &[(&[u8], u8)] = &[
            (b"a", b'a'),
            (b"ab", b'b'),
            (b"abc", b'c'),
            (b"abcd", b'd'),
            (b"abcde", b'e'),
        ];

        for &(targets, expected_byte) in cases {
            let mut bytes = vec![b'x'; 35];
            bytes[34] = expected_byte;
            assert_eq!(
                find_any_simd(&bytes, 0, targets),
                Some((34, expected_byte)),
                "target count {} should find byte in the scalar remainder",
                targets.len()
            );
        }
    }

    #[test]
    fn test_find_any_more_than_five_targets_checks_later_targets() {
        let mut bytes = vec![b'x'; 64];
        bytes[48] = b'g';

        assert_eq!(find_any_simd(&bytes, 0, b"abcdefg"), Some((48, b'g')));
    }

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
    fn test_find_tag_empty() {
        let xml = b"<tag>";
        assert_eq!(find_tag_simd(xml, b"", 0), None);
    }

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
}
