use memchr::{memchr, memmem};

/// Find a byte sequence in the XML starting from the given position
#[inline]
pub(super) fn find_bytes(xml: &[u8], pattern: &[u8], start: usize) -> Option<usize> {
    if start >= xml.len() {
        return None;
    }
    memmem::find(&xml[start..], pattern).map(|pos| pos + start)
}

/// Find a single byte in the XML starting from the given position
#[inline]
pub(super) fn find_byte(xml: &[u8], byte: u8, start: usize) -> Option<usize> {
    if start >= xml.len() {
        return None;
    }
    memchr(byte, &xml[start..]).map(|pos| pos + start)
}

/// Parse the uniqueCount attribute from the <sst> element
pub(super) fn parse_unique_count(xml: &[u8]) -> Option<usize> {
    parse_sst_usize_attr(xml, b"uniqueCount")
}

/// Parse the count attribute from the <sst> element.
pub(super) fn parse_count(xml: &[u8]) -> Option<usize> {
    parse_sst_usize_attr(xml, b"count")
}

fn parse_sst_usize_attr(xml: &[u8], attr_name: &[u8]) -> Option<usize> {
    // Find <sst element
    let sst_pos = find_bytes(xml, b"<sst", 0)?;
    let sst_end = find_byte(xml, b'>', sst_pos)?;

    let mut pattern = Vec::with_capacity(attr_name.len() + 2);
    pattern.extend_from_slice(attr_name);
    pattern.extend_from_slice(b"=\"");

    let attr_start = find_bytes(xml, &pattern, sst_pos)?;
    if attr_start > sst_end {
        return None;
    }

    let value_start = attr_start + pattern.len();
    let value_end = find_byte(xml, b'"', value_start)?;

    // Parse the number
    let value_bytes = &xml[value_start..value_end];
    let value_str = std::str::from_utf8(value_bytes).ok()?;
    value_str.parse().ok()
}

/// Check if a byte slice contains XML text that needs decoding or XML line-end normalization.
#[inline]
pub(super) fn needs_xml_text_decode(bytes: &[u8]) -> bool {
    // '&' starts XML entities, '_' may start an OOXML _xHHHH_ escape, and
    // raw CR/CRLF in XML text is normalized to LF by conforming XML parsers.
    memchr(b'&', bytes).is_some() || memchr(b'_', bytes).is_some() || memchr(b'\r', bytes).is_some()
}

/// Find the content boundaries of a <t> element
/// Returns (content_start, content_end) or None
pub(super) fn find_t_content(
    xml: &[u8],
    start: usize,
    end_boundary: usize,
) -> Option<(usize, usize)> {
    // Find <t or <t>
    let t_start = find_bytes(xml, b"<t", start)?;
    if t_start >= end_boundary {
        return None;
    }

    // Skip past <t> or <t ...>
    let after_t = t_start + 2;
    if after_t >= xml.len() {
        return None;
    }

    let content_start = if xml[after_t] == b'>' {
        // Simple <t>
        after_t + 1
    } else if xml[after_t] == b' ' {
        // <t xml:space="preserve"> or other attributes
        let close = find_byte(xml, b'>', after_t)?;
        close + 1
    } else {
        // Not a <t> tag (could be <table> or something else)
        return None;
    };

    // Find </t>
    let content_end = find_bytes(xml, b"</t>", content_start)?;
    if content_end > end_boundary {
        return None;
    }

    Some((content_start, content_end))
}

/// Extract an attribute value from a region starting at element position `elem_pos`.
/// Searches for `attr_name="value"` within the element (up to `>` or `/>` or end of region).
pub(super) fn extract_attr_in_region<'a>(
    region: &'a [u8],
    elem_pos: usize,
    attr_name: &[u8],
) -> Option<&'a [u8]> {
    // Find end of element (> or />)
    let elem_end = memchr(b'>', &region[elem_pos..])
        .map(|p| p + elem_pos + 1)
        .unwrap_or(region.len());
    let tag = &region[elem_pos..elem_end];

    // Build pattern: attr_name="
    let mut pattern = Vec::with_capacity(attr_name.len() + 2);
    pattern.extend_from_slice(attr_name);
    pattern.extend_from_slice(b"=\"");

    let attr_pos = memmem::find(tag, &pattern)?;
    let val_start = attr_pos + pattern.len();
    let val_end = memchr(b'"', &tag[val_start..])? + val_start;
    Some(&tag[val_start..val_end])
}
