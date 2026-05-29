#![allow(clippy::string_slice)]

/// Attempt to recover an invalid cell reference
///
/// Tries to parse what it can from the reference, returning (0, 0) as default.
///
/// # Arguments
/// * `raw` - The raw cell reference string (e.g., "A1", "ZZZ999", or garbage)
///
/// # Returns
/// A tuple of (row, col) with 0-based indices, defaulting to (0, 0) on failure
pub fn recover_cell_reference(raw: &str) -> (u32, u32) {
    let raw = raw.trim();
    if raw.is_empty() {
        return (0, 0);
    }

    let mut col_end = 0;
    for (i, c) in raw.chars().enumerate() {
        if c.is_ascii_alphabetic() {
            col_end = i + 1;
        } else {
            break;
        }
    }

    if col_end == 0 {
        return (0, 0);
    }

    // The split is byte-safe because the scanned prefix accepts only ASCII letters.
    let col_str = &raw[..col_end].to_uppercase();
    let mut col_num: u32 = 0;
    for c in col_str.chars() {
        if c.is_ascii_uppercase() {
            col_num = col_num
                .saturating_mul(26)
                .saturating_add((c as u32) - ('A' as u32) + 1);
        }
    }
    let col = col_num.saturating_sub(1);

    let row = if col_end < raw.len() {
        let row_str = &raw[col_end..];
        if row_str.is_empty() || !row_str.bytes().all(|b| b.is_ascii_digit()) {
            return (0, 0);
        }
        row_str.parse::<u32>().unwrap_or(1).saturating_sub(1)
    } else {
        if col_end > 3 {
            return (0, 0);
        }
        0
    };

    (row, col)
}

/// Attempt to recover an invalid number
///
/// Tries various parsing strategies, returning 0.0 as default.
///
/// # Arguments
/// * `raw` - The raw number string
///
/// # Returns
/// The parsed number, or 0.0 on failure
pub fn recover_number(raw: &str) -> f64 {
    let raw = raw.trim();
    if raw.is_empty() {
        return 0.0;
    }

    if let Ok(n) = raw.parse::<f64>() {
        return n;
    }

    let mut num_str = String::new();
    let mut has_decimal = false;
    let mut has_exponent = false;
    let mut expect_exponent_sign = false;
    let mut started = false;

    for c in raw.chars() {
        if c == '-' || c == '+' {
            if started && !expect_exponent_sign {
                break;
            }
            num_str.push(c);
            started = true;
            expect_exponent_sign = false;
        } else if c.is_ascii_digit() {
            num_str.push(c);
            started = true;
            expect_exponent_sign = false;
        } else if c == '.' && !has_decimal {
            num_str.push(c);
            has_decimal = true;
            started = true;
        } else if matches!(c, 'e' | 'E') && started && !has_exponent {
            num_str.push(c);
            has_exponent = true;
            expect_exponent_sign = true;
        } else if started {
            break;
        }
    }

    num_str.parse().unwrap_or(0.0)
}

/// Attempt to recover an invalid style index
///
/// # Arguments
/// * `raw` - The raw style index string
///
/// # Returns
/// The parsed style index, or 0 (default style) on failure
pub fn recover_style_index(raw: &str) -> u32 {
    raw.trim().parse().unwrap_or(0)
}

/// Attempt to recover an invalid shared string index
///
/// # Arguments
/// * `index` - The requested index
/// * `max` - The maximum valid index (exclusive)
///
/// # Returns
/// A placeholder string for display
pub fn recover_shared_string(index: usize, max: usize) -> &'static str {
    if index >= max { "#REF!" } else { "" }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recover_cell_reference_valid() {
        assert_eq!(recover_cell_reference("A1"), (0, 0));
        assert_eq!(recover_cell_reference("B2"), (1, 1));
        assert_eq!(recover_cell_reference("Z26"), (25, 25));
        assert_eq!(recover_cell_reference("AA1"), (0, 26));
        assert_eq!(recover_cell_reference("AB10"), (9, 27));
    }

    #[test]
    fn test_recover_cell_reference_invalid() {
        assert_eq!(recover_cell_reference(""), (0, 0));
        assert_eq!(recover_cell_reference("   "), (0, 0));
        assert_eq!(recover_cell_reference("123"), (0, 0));
        assert_eq!(recover_cell_reference("!!!"), (0, 0));
    }

    #[test]
    fn test_recover_cell_reference_partial() {
        assert_eq!(recover_cell_reference("A"), (0, 0));
        assert_eq!(recover_cell_reference("ABC"), (0, 730));
    }

    #[test]
    fn test_recover_cell_reference_malformed_contracts() {
        assert_eq!(recover_cell_reference("Axyz"), (0, 0));
        assert_eq!(recover_cell_reference("A1B2"), (0, 0));
        assert_eq!(recover_cell_reference("b2"), (1, 1));
        assert_eq!(recover_cell_reference("A0"), (0, 0));

        let (_, col) = recover_cell_reference(
            "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ1",
        );
        assert_eq!(col, u32::MAX - 1);
    }

    #[test]
    fn test_recover_number_valid() {
        assert_eq!(recover_number("123"), 123.0);
        assert_eq!(recover_number("123.456"), 123.456);
        assert_eq!(recover_number("-42"), -42.0);
        assert_eq!(recover_number("1e10"), 1e10);
    }

    #[test]
    fn test_recover_number_invalid() {
        assert_eq!(recover_number(""), 0.0);
        assert_eq!(recover_number("abc"), 0.0);
        assert_eq!(recover_number("!!!"), 0.0);
    }

    #[test]
    fn test_recover_number_formatted() {
        assert_eq!(recover_number("$123"), 123.0);
        assert_eq!(recover_number("123%"), 123.0);
        assert_eq!(recover_number(" 42 "), 42.0);
    }

    #[test]
    fn test_recover_number_filtered_exponent_and_leading_prefix() {
        assert_eq!(recover_number("$1.2e3"), 1200.0);
        assert_eq!(recover_number("12-3"), 12.0);
        assert_eq!(recover_number("-12abc34"), -12.0);
    }

    #[test]
    fn test_recover_style_index() {
        assert_eq!(recover_style_index("0"), 0);
        assert_eq!(recover_style_index("42"), 42);
        assert_eq!(recover_style_index(""), 0);
        assert_eq!(recover_style_index("abc"), 0);
        assert_eq!(recover_style_index("  5  "), 5);
    }

    #[test]
    fn test_recover_shared_string() {
        assert_eq!(recover_shared_string(100, 50), "#REF!");
        assert_eq!(recover_shared_string(0, 10), "");
    }
}
