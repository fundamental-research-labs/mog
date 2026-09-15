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

/// Find a byte in a slice starting from `start` (simple linear scan, used
/// within small tag-sized slices where SIMD overhead isn't worthwhile).
#[inline]
pub(super) fn find_byte_in(slice: &[u8], byte: u8, start: usize) -> Option<usize> {
    (start..slice.len()).find(|&i| slice[i] == byte)
}
