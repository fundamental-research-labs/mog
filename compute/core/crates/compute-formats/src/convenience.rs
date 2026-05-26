//! DOLLAR / FIXED convenience functions.

use value_types::precision::excel_round_to_decimal_places;

/// Format a number for the `DOLLAR()` spreadsheet function.
///
/// Returns a currency-formatted string with a `$` prefix, thousands separators,
/// and parentheses for negative values.
///
/// # Examples
///
/// ```
/// use compute_formats::format_dollar;
///
/// assert_eq!(format_dollar(1234.5, 2), "$1,234.50");
/// assert_eq!(format_dollar(-1234.5, 2), "($1,234.50)");
/// assert_eq!(format_dollar(1234.5, 0), "$1,235");
/// ```
#[must_use]
pub fn format_dollar(number: f64, decimals: i32) -> String {
    let rounded = excel_round_to_decimal_places(number, decimals);
    let display_dec = if decimals < 0 { 0 } else { decimals as usize };
    let abs_val = rounded.abs();
    let formatted = format!("{abs_val:.display_dec$}");
    let parts: Vec<&str> = formatted.splitn(2, '.').collect();
    let int_with_commas = add_thousands(parts[0]);
    let dec_part = if parts.len() > 1 {
        Some(parts[1])
    } else {
        None
    };

    let mut result = String::new();
    if rounded < 0.0 {
        result.push_str("($");
        result.push_str(&int_with_commas);
        if let Some(d) = dec_part {
            result.push('.');
            result.push_str(d);
        }
        result.push(')');
    } else {
        result.push('$');
        result.push_str(&int_with_commas);
        if let Some(d) = dec_part {
            result.push('.');
            result.push_str(d);
        }
    }
    result
}

/// Format a number for the `FIXED()` spreadsheet function.
///
/// Returns a fixed-decimal string with optional thousands separators.
/// When `no_commas` is `true`, thousands separators are omitted.
///
/// # Examples
///
/// ```
/// use compute_formats::format_fixed;
///
/// assert_eq!(format_fixed(1234.5, 2, false), "1,234.50");
/// assert_eq!(format_fixed(1234.5, 2, true), "1234.50");
/// assert_eq!(format_fixed(-1234.5, 2, false), "-1,234.50");
/// ```
#[must_use]
pub fn format_fixed(number: f64, decimals: i32, no_commas: bool) -> String {
    let rounded = excel_round_to_decimal_places(number, decimals);
    let display_dec = if decimals < 0 { 0 } else { decimals as usize };
    let formatted = format!("{rounded:.display_dec$}");

    if no_commas {
        return formatted;
    }

    let is_negative = formatted.starts_with('-');
    let abs_fmt = if is_negative {
        &formatted[1..]
    } else {
        &formatted
    };
    let parts: Vec<&str> = abs_fmt.splitn(2, '.').collect();
    let int_with_commas = add_thousands(parts[0]);
    let dec_part = if parts.len() > 1 {
        Some(parts[1])
    } else {
        None
    };

    let mut result = String::new();
    if is_negative {
        result.push('-');
    }
    result.push_str(&int_with_commas);
    if let Some(d) = dec_part {
        result.push('.');
        result.push_str(d);
    }
    result
}

pub(crate) fn add_thousands(int_str: &str) -> String {
    let mut r = String::new();
    for (i, ch) in int_str.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            r.push(',');
        }
        r.push(ch);
    }
    r.chars().rev().collect()
}
