pub use crate::infra::a1::col_to_letters;

/// Parse an A1 reference string directly (e.g., "A1", "XFD1048576")
///
/// Returns 0-indexed (row, col) tuple.
#[inline]
pub fn parse_a1_reference(reference: &[u8]) -> Option<(u32, u32)> {
    if reference.is_empty() {
        return None;
    }

    let mut pos = 0;

    // Extract column letters (1-3 uppercase letters)
    let mut col: u32 = 0;
    while pos < reference.len() && reference[pos].is_ascii_uppercase() {
        col = col
            .saturating_mul(26)
            .saturating_add((reference[pos] - b'A' + 1) as u32);
        pos += 1;
    }

    if col == 0 || pos == 0 {
        return None;
    }
    col -= 1; // Convert to 0-indexed

    // Extract row number
    let mut row: u32 = 0;
    while pos < reference.len() && reference[pos].is_ascii_digit() {
        row = row
            .saturating_mul(10)
            .saturating_add((reference[pos] - b'0') as u32);
        pos += 1;
    }

    if row == 0 {
        return None;
    }
    row -= 1; // Convert to 0-indexed

    // Validate ranges: max col = XFD (16383), max row = 1048575
    if col > 16383 || row > 1048575 {
        return None;
    }

    Some((row, col))
}

/// Parse cell type from the 't' attribute.
///
/// OOXML cell types:
/// - (none) or "n" -> number (default)
/// - "s" -> shared string index
/// - "str" -> inline string
/// - "inlineStr" -> inline string with rich text
/// - "b" -> boolean
/// - "e" -> error
///

/// Format a u32 into a byte buffer, returning a &str slice.
/// This avoids allocation compared to format!("{}", n).
pub(super) fn format_u32(mut n: u32, buf: &mut [u8; 10]) -> &str {
    if n == 0 {
        buf[0] = b'0';
        return core::str::from_utf8(&buf[..1]).expect("format_u32 writes ASCII decimal digits");
    }

    let mut pos = buf.len();
    while n > 0 {
        pos -= 1;
        buf[pos] = b'0' + (n % 10) as u8;
        n /= 10;
    }

    core::str::from_utf8(&buf[pos..]).expect("format_u32 writes ASCII decimal digits")
}

#[cfg(test)]
mod safety_tests {
    use super::format_u32;

    #[test]
    fn format_u32_uses_safe_decimal_utf8_conversion() {
        let cases = [
            (0, "0"),
            (1, "1"),
            (42, "42"),
            (1_048_576, "1048576"),
            (u32::MAX, "4294967295"),
        ];

        for (value, expected) in cases {
            let mut buf = [0u8; 10];
            assert_eq!(format_u32(value, &mut buf), expected);
        }
    }
}
