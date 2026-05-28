use memchr::memchr;

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
