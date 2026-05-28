use super::super::adapters::{find_byte, find_sequence};

/// Parse a u32 from ASCII digits without allocation
#[inline]
pub(crate) fn parse_u32(bytes: &[u8]) -> Option<u32> {
    if bytes.is_empty() {
        return None;
    }

    let mut result: u32 = 0;
    for &b in bytes {
        if b.is_ascii_digit() {
            result = result.saturating_mul(10).saturating_add((b - b'0') as u32);
        } else {
            break;
        }
    }
    Some(result)
}

pub(crate) fn extract_attribute<'a>(xml: &'a [u8], attr_name: &[u8]) -> Option<&'a [u8]> {
    // Build the pattern: attr_name="
    let mut pattern = Vec::with_capacity(attr_name.len() + 2);
    pattern.extend_from_slice(attr_name);
    pattern.extend_from_slice(b"=\"");

    if let Some(start) = find_sequence(xml, &pattern, 0) {
        let value_start = start + pattern.len();
        if let Some(end) = find_byte(xml, b'"', value_start) {
            return Some(&xml[value_start..end]);
        }
    }
    None
}

/// Shared formula metadata returned from `extract_shared_formula_info`.
///
/// This is returned when a cell's `<f>` element has `t="shared"` attribute.

/// Find a byte in a slice starting from `start` (simple linear scan, used
/// within small tag-sized slices where SIMD overhead isn't worthwhile).
#[inline]
pub(super) fn find_byte_in(slice: &[u8], byte: u8, start: usize) -> Option<usize> {
    (start..slice.len()).find(|&i| slice[i] == byte)
}
