use memchr::{memchr, memchr2, memchr3};

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
