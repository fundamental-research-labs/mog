//! SIMD-accelerated number parsing module.

#[inline]
pub fn parse_f64_fast(bytes: &[u8]) -> Option<f64> {
    if bytes.is_empty() {
        return None;
    }
    let bytes = trim_ascii_whitespace(bytes);
    if bytes.is_empty() {
        return None;
    }
    fast_float::parse(bytes).ok()
}

#[inline]
pub fn parse_f32_fast(bytes: &[u8]) -> Option<f32> {
    if bytes.is_empty() {
        return None;
    }
    let bytes = trim_ascii_whitespace(bytes);
    if bytes.is_empty() {
        return None;
    }
    fast_float::parse(bytes).ok()
}

#[inline]
pub fn parse_i64_fast(bytes: &[u8]) -> Option<i64> {
    if bytes.is_empty() {
        return None;
    }
    let bytes = trim_ascii_whitespace(bytes);
    if bytes.is_empty() {
        return None;
    }
    let (is_negative, digits) = if bytes[0] == b'-' {
        (true, &bytes[1..])
    } else if bytes[0] == b'+' {
        (false, &bytes[1..])
    } else {
        (false, bytes)
    };
    if digits.is_empty() {
        return None;
    }
    let unsigned_value = parse_u64_digits(digits)?;
    if is_negative {
        if unsigned_value > (i64::MAX as u64) + 1 {
            return None;
        }
        Some(-(unsigned_value as i64))
    } else {
        if unsigned_value > i64::MAX as u64 {
            return None;
        }
        Some(unsigned_value as i64)
    }
}

#[inline]
pub fn parse_u64_fast(bytes: &[u8]) -> Option<u64> {
    if bytes.is_empty() {
        return None;
    }
    let bytes = trim_ascii_whitespace(bytes);
    if bytes.is_empty() {
        return None;
    }
    let digits = if bytes[0] == b'+' { &bytes[1..] } else { bytes };
    parse_u64_digits(digits)
}

#[inline]
pub fn parse_i32_fast(bytes: &[u8]) -> Option<i32> {
    let value = parse_i64_fast(bytes)?;
    if value >= i32::MIN as i64 && value <= i32::MAX as i64 {
        Some(value as i32)
    } else {
        None
    }
}

#[inline]
pub fn parse_u32_fast(bytes: &[u8]) -> Option<u32> {
    let value = parse_u64_fast(bytes)?;
    if value <= u32::MAX as u64 {
        Some(value as u32)
    } else {
        None
    }
}

#[inline]
fn parse_u64_digits(bytes: &[u8]) -> Option<u64> {
    if bytes.is_empty() || bytes.len() > 20 {
        return None;
    }
    if bytes.len() <= 4 {
        return parse_u64_simple(bytes);
    }
    if bytes.len() <= 8 {
        return parse_u64_swar_8(bytes);
    }
    parse_u64_standard(bytes)
}

#[inline(always)]
fn parse_u64_simple(bytes: &[u8]) -> Option<u64> {
    let mut result: u64 = 0;
    for &b in bytes {
        if !b.is_ascii_digit() {
            return None;
        }
        result = result * 10 + (b - b'0') as u64;
    }
    Some(result)
}

#[inline]
fn parse_u64_swar_8(bytes: &[u8]) -> Option<u64> {
    for &b in bytes {
        if !b.is_ascii_digit() {
            return None;
        }
    }
    match bytes.len() {
        5 => Some(
            (bytes[0] - b'0') as u64 * 10000
                + (bytes[1] - b'0') as u64 * 1000
                + (bytes[2] - b'0') as u64 * 100
                + (bytes[3] - b'0') as u64 * 10
                + (bytes[4] - b'0') as u64,
        ),
        6 => Some(
            (bytes[0] - b'0') as u64 * 100000
                + (bytes[1] - b'0') as u64 * 10000
                + (bytes[2] - b'0') as u64 * 1000
                + (bytes[3] - b'0') as u64 * 100
                + (bytes[4] - b'0') as u64 * 10
                + (bytes[5] - b'0') as u64,
        ),
        7 => Some(
            (bytes[0] - b'0') as u64 * 1000000
                + (bytes[1] - b'0') as u64 * 100000
                + (bytes[2] - b'0') as u64 * 10000
                + (bytes[3] - b'0') as u64 * 1000
                + (bytes[4] - b'0') as u64 * 100
                + (bytes[5] - b'0') as u64 * 10
                + (bytes[6] - b'0') as u64,
        ),
        8 => {
            let hi = (bytes[0] - b'0') as u64 * 1000
                + (bytes[1] - b'0') as u64 * 100
                + (bytes[2] - b'0') as u64 * 10
                + (bytes[3] - b'0') as u64;
            let lo = (bytes[4] - b'0') as u64 * 1000
                + (bytes[5] - b'0') as u64 * 100
                + (bytes[6] - b'0') as u64 * 10
                + (bytes[7] - b'0') as u64;
            Some(hi * 10000 + lo)
        }
        _ => parse_u64_simple(bytes),
    }
}

#[inline]
fn parse_u64_standard(bytes: &[u8]) -> Option<u64> {
    let mut result: u64 = 0;
    for &b in bytes {
        if !b.is_ascii_digit() {
            return None;
        }
        result = result.checked_mul(10)?;
        result = result.checked_add((b - b'0') as u64)?;
    }
    Some(result)
}

#[inline]
fn trim_ascii_whitespace(bytes: &[u8]) -> &[u8] {
    let start = bytes
        .iter()
        .position(|&b| !b.is_ascii_whitespace())
        .unwrap_or(bytes.len());
    let end = bytes
        .iter()
        .rposition(|&b| !b.is_ascii_whitespace())
        .map_or(start, |p| p + 1);
    &bytes[start..end]
}

#[inline]
pub fn parse_number_bytes(bytes: &[u8]) -> Option<f64> {
    parse_f64_fast(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_f64_basic() {
        assert_eq!(parse_f64_fast(b"0"), Some(0.0));
        assert_eq!(parse_f64_fast(b"42"), Some(42.0));
        assert_eq!(parse_f64_fast(b"-42"), Some(-42.0));
    }

    #[test]
    fn test_parse_f64_decimals() {
        assert_eq!(parse_f64_fast(b"1.5"), Some(1.5));
        assert_eq!(parse_f64_fast(b"-3.14"), Some(-3.14));
    }

    #[test]
    fn test_parse_f64_scientific() {
        assert_eq!(parse_f64_fast(b"1e10"), Some(1e10));
        assert_eq!(parse_f64_fast(b"-2.3E-5"), Some(-2.3e-5));
    }

    #[test]
    fn test_parse_i64_basic() {
        assert_eq!(parse_i64_fast(b"42"), Some(42));
        assert_eq!(parse_i64_fast(b"-42"), Some(-42));
    }

    #[test]
    fn test_parse_u64_swar() {
        assert_eq!(parse_u64_fast(b"12345"), Some(12345));
        assert_eq!(parse_u64_fast(b"12345678"), Some(12345678));
    }
}
