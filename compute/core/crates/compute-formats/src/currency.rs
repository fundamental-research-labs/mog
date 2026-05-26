//! Currency pattern formatting utilities.
//!
//! Handles culture-aware currency symbol positioning according to
//! .NET `NumberFormatInfo` patterns (4 positive + 16 negative patterns).

use crate::locale::CultureInfo;

/// Apply culture-aware currency positioning to a formatted number.
///
/// If the locale has currency patterns set, repositions the symbol
/// according to the locale's pattern. Otherwise returns None (caller
/// should use the format code's literal positioning).
pub fn apply_currency_pattern(
    formatted_number: &str,
    currency_symbol: &str,
    is_negative: bool,
    locale: &CultureInfo,
    _has_parentheses: bool,
) -> Option<String> {
    let symbol = if locale.currency_symbol.is_empty() {
        currency_symbol
    } else {
        &locale.currency_symbol
    };

    if is_negative {
        Some(apply_negative_currency_pattern(
            formatted_number,
            symbol,
            locale.currency_negative_pattern,
        ))
    } else {
        Some(apply_positive_currency_pattern(
            formatted_number,
            symbol,
            locale.currency_positive_pattern,
        ))
    }
}

/// Apply positive currency pattern.
///
/// Patterns (matches .NET NumberFormatInfo.CurrencyPositivePattern):
/// - 0 = $n  (symbol before, no space) — en-US
/// - 1 = n$  (symbol after, no space)
/// - 2 = $ n (symbol before, space) — rare
/// - 3 = n $ (symbol after, space) — de-DE, fr-FR
pub fn apply_positive_currency_pattern(number: &str, symbol: &str, pattern: u8) -> String {
    match pattern {
        1 => format!("{number}{symbol}"),
        2 => format!("{symbol} {number}"),
        3 => format!("{number} {symbol}"),
        // 0 and unknown: $n
        _ => format!("{symbol}{number}"),
    }
}

/// Apply negative currency pattern.
///
/// Patterns (matches .NET NumberFormatInfo.CurrencyNegativePattern):
/// - 0  = ($n)
/// - 1  = -$n   — en-US standard
/// - 2  = $-n
/// - 3  = $n-
/// - 4  = (n$)
/// - 5  = -n$
/// - 6  = n-$
/// - 7  = n$-
/// - 8  = -n $  — de-DE
/// - 9  = -$ n
/// - 10 = n $-
/// - 11 = $ n-
/// - 12 = $ -n
/// - 13 = n- $
/// - 14 = ($ n)
/// - 15 = (n $)
pub fn apply_negative_currency_pattern(number: &str, symbol: &str, pattern: u8) -> String {
    // Strip any existing negative sign
    let abs_number = number.strip_prefix('-').unwrap_or(number);

    match pattern {
        0 => format!("({symbol}{abs_number})"),
        2 => format!("{symbol}-{abs_number}"),
        3 => format!("{symbol}{abs_number}-"),
        4 => format!("({abs_number}{symbol})"),
        5 => format!("-{abs_number}{symbol}"),
        6 => format!("{abs_number}-{symbol}"),
        7 => format!("{abs_number}{symbol}-"),
        8 => format!("-{abs_number} {symbol}"),
        9 => format!("-{symbol} {abs_number}"),
        10 => format!("{abs_number} {symbol}-"),
        11 => format!("{symbol} {abs_number}-"),
        12 => format!("{symbol} -{abs_number}"),
        13 => format!("{abs_number}- {symbol}"),
        14 => format!("({symbol} {abs_number})"),
        15 => format!("({abs_number} {symbol})"),
        // 1 and unknown: -$n
        _ => format!("-{symbol}{abs_number}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NUM: &str = "1,234.50";
    const SYM: &str = "$";

    // -----------------------------------------------------------------------
    // Positive patterns (0-3)
    // -----------------------------------------------------------------------

    #[test]
    fn positive_pattern_0_symbol_before_no_space() {
        assert_eq!(apply_positive_currency_pattern(NUM, SYM, 0), "$1,234.50");
    }

    #[test]
    fn positive_pattern_1_symbol_after_no_space() {
        assert_eq!(apply_positive_currency_pattern(NUM, SYM, 1), "1,234.50$");
    }

    #[test]
    fn positive_pattern_2_symbol_before_space() {
        assert_eq!(apply_positive_currency_pattern(NUM, SYM, 2), "$ 1,234.50");
    }

    #[test]
    fn positive_pattern_3_symbol_after_space() {
        assert_eq!(apply_positive_currency_pattern(NUM, SYM, 3), "1,234.50 $");
    }

    #[test]
    fn positive_pattern_fallback_defaults_to_0() {
        assert_eq!(apply_positive_currency_pattern(NUM, SYM, 99), "$1,234.50");
    }

    // -----------------------------------------------------------------------
    // Negative patterns (0-15)
    // -----------------------------------------------------------------------

    #[test]
    fn negative_pattern_0_parentheses_symbol_before() {
        assert_eq!(apply_negative_currency_pattern(NUM, SYM, 0), "($1,234.50)");
    }

    #[test]
    fn negative_pattern_1_minus_symbol_before() {
        assert_eq!(apply_negative_currency_pattern(NUM, SYM, 1), "-$1,234.50");
    }

    #[test]
    fn negative_pattern_2_symbol_minus_number() {
        assert_eq!(apply_negative_currency_pattern(NUM, SYM, 2), "$-1,234.50");
    }

    #[test]
    fn negative_pattern_3_symbol_number_minus() {
        assert_eq!(apply_negative_currency_pattern(NUM, SYM, 3), "$1,234.50-");
    }

    #[test]
    fn negative_pattern_4_parentheses_symbol_after() {
        assert_eq!(apply_negative_currency_pattern(NUM, SYM, 4), "(1,234.50$)");
    }

    #[test]
    fn negative_pattern_5_minus_number_symbol() {
        assert_eq!(apply_negative_currency_pattern(NUM, SYM, 5), "-1,234.50$");
    }

    #[test]
    fn negative_pattern_6_number_minus_symbol() {
        assert_eq!(apply_negative_currency_pattern(NUM, SYM, 6), "1,234.50-$");
    }

    #[test]
    fn negative_pattern_7_number_symbol_minus() {
        assert_eq!(apply_negative_currency_pattern(NUM, SYM, 7), "1,234.50$-");
    }

    #[test]
    fn negative_pattern_8_minus_number_space_symbol() {
        assert_eq!(apply_negative_currency_pattern(NUM, SYM, 8), "-1,234.50 $");
    }

    #[test]
    fn negative_pattern_9_minus_symbol_space_number() {
        assert_eq!(apply_negative_currency_pattern(NUM, SYM, 9), "-$ 1,234.50");
    }

    #[test]
    fn negative_pattern_10_number_space_symbol_minus() {
        assert_eq!(apply_negative_currency_pattern(NUM, SYM, 10), "1,234.50 $-");
    }

    #[test]
    fn negative_pattern_11_symbol_space_number_minus() {
        assert_eq!(apply_negative_currency_pattern(NUM, SYM, 11), "$ 1,234.50-");
    }

    #[test]
    fn negative_pattern_12_symbol_space_minus_number() {
        assert_eq!(apply_negative_currency_pattern(NUM, SYM, 12), "$ -1,234.50");
    }

    #[test]
    fn negative_pattern_13_number_minus_space_symbol() {
        assert_eq!(apply_negative_currency_pattern(NUM, SYM, 13), "1,234.50- $");
    }

    #[test]
    fn negative_pattern_14_parentheses_symbol_space_number() {
        assert_eq!(
            apply_negative_currency_pattern(NUM, SYM, 14),
            "($ 1,234.50)"
        );
    }

    #[test]
    fn negative_pattern_15_parentheses_number_space_symbol() {
        assert_eq!(
            apply_negative_currency_pattern(NUM, SYM, 15),
            "(1,234.50 $)"
        );
    }

    #[test]
    fn negative_pattern_fallback_defaults_to_1() {
        assert_eq!(apply_negative_currency_pattern(NUM, SYM, 99), "-$1,234.50");
    }

    #[test]
    fn negative_pattern_strips_existing_minus() {
        assert_eq!(
            apply_negative_currency_pattern("-1,234.50", SYM, 1),
            "-$1,234.50"
        );
    }

    // -----------------------------------------------------------------------
    // apply_currency_pattern integration
    // -----------------------------------------------------------------------

    fn make_locale(currency_symbol: &str, positive: u8, negative: u8) -> CultureInfo {
        CultureInfo {
            currency_symbol: currency_symbol.to_string(),
            currency_positive_pattern: positive,
            currency_negative_pattern: negative,
            ..CultureInfo::default()
        }
    }

    #[test]
    fn apply_returns_some_for_positive_pattern() {
        let locale = make_locale("$", 0, 1);
        let result = apply_currency_pattern(NUM, "$", false, &locale, false);
        assert_eq!(result, Some("$1,234.50".to_string()));
    }

    #[test]
    fn apply_returns_some_for_negative_pattern() {
        let locale = make_locale("$", 0, 1);
        let result = apply_currency_pattern(NUM, "$", true, &locale, false);
        assert_eq!(result, Some("-$1,234.50".to_string()));
    }

    #[test]
    fn apply_uses_locale_symbol_when_nonempty() {
        let locale = make_locale("\u{20ac}", 3, 0);
        let result = apply_currency_pattern(NUM, "$", false, &locale, false);
        assert_eq!(result, Some("1,234.50 \u{20ac}".to_string()));
    }

    #[test]
    fn apply_uses_argument_symbol_when_locale_empty() {
        let locale = make_locale("", 0, 1);
        let result = apply_currency_pattern(NUM, "\u{00a3}", false, &locale, false);
        assert_eq!(result, Some("\u{00a3}1,234.50".to_string()));
    }

    #[test]
    fn apply_with_multi_char_symbol() {
        let locale = make_locale("CHF", 2, 8);
        let pos = apply_currency_pattern(NUM, "$", false, &locale, false);
        assert_eq!(pos, Some("CHF 1,234.50".to_string()));
        let neg = apply_currency_pattern(NUM, "$", true, &locale, false);
        assert_eq!(neg, Some("-1,234.50 CHF".to_string()));
    }
}
