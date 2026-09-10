//! Number-format metadata used by Excel's CELL function.
//! https://support.microsoft.com/en-us/excel/functions/cell-function
use crate::number::select_section;
use crate::parser::parse_format_code;
use crate::types::{FormatSection, Token};

#[derive(Debug, Clone, PartialEq, Eq)]
/// Excel CELL number-format code and its two independent formatting flags.
pub struct CellFormatInfo {
    /// Compact category code, with optional color and parentheses suffixes.
    pub code: String,
    /// Whether the negative numeric section supplies a font color.
    pub colored_negative: bool,
    /// Whether positive values are surrounded by literal parentheses.
    pub parentheses: bool,
}

/// Interpret the same tokens used by the number formatter. Quoted/escaped
/// literals and `_` spacing are therefore distinct from numeric placeholders.
#[must_use]
pub fn cell_format_info(format: &str) -> CellFormatInfo {
    let parsed = parse_format_code(format);
    let (positive, _) = select_section(&parsed, 1.0);
    let (negative, _) = select_section(&parsed, -1.0);
    let colored_negative = negative.color.is_some();
    let literals: String = positive
        .tokens
        .iter()
        .filter_map(|t| match t {
            Token::Literal(s) => Some(s.as_str()),
            _ => None,
        })
        .collect();
    let parentheses = literals.contains('(') && literals.contains(')');
    let mut code = if positive.is_datetime {
        date_code(positive).into()
    } else if !positive.has_digit_placeholders
        || positive
            .tokens
            .iter()
            .any(|t| matches!(t, Token::FractionSlash))
    {
        "G".into()
    } else {
        let prefix = if positive.percent_count > 0 {
            "P"
        } else if positive.has_exponent {
            "S"
        } else if crate::CURRENCY_SYMBOLS
            .iter()
            .any(|currency| literals.contains(currency.symbol))
        {
            "C"
        } else if positive.has_thousands {
            ","
        } else {
            "F"
        };
        format!("{prefix}{}", positive.dec_placeholders)
    };
    if colored_negative {
        code.push('-');
    }
    if parentheses {
        code.push_str("()");
    }
    CellFormatInfo {
        code,
        colored_negative,
        parentheses,
    }
}

fn date_code(section: &FormatSection) -> &'static str {
    // CELL's D-codes describe the recognized built-in date/time patterns,
    // not every format that happens to contain a year or month token.
    // In particular, ISO/year-first custom dates report G.
    let pattern: Vec<u8> = section
        .tokens
        .iter()
        .filter_map(|token| match token {
            Token::DateYear2 | Token::DateYear4 | Token::DateEraYear(_) => Some(1),
            Token::DateMonth1 | Token::DateMonth2 => Some(2),
            Token::DateMonthName3 => Some(3),
            Token::DateDay1 | Token::DateDay2 => Some(4),
            Token::DateHour1 | Token::DateHour2 => Some(5),
            Token::DateMinute1 | Token::DateMinute2 => Some(6),
            Token::DateSecond1 | Token::DateSecond2 => Some(7),
            Token::AmPm(_) => Some(8),
            Token::DateDayName3
            | Token::DateDayName4
            | Token::DateMonthName4
            | Token::DateMonthName5
            | Token::ElapsedHours
            | Token::ElapsedMinutes
            | Token::ElapsedSeconds => Some(9),
            _ => None,
        })
        .collect();
    match pattern.as_slice() {
        [4, 3, 1] => "D1",
        [4, 3] => "D2",
        [3, 1] => "D3",
        [2, 4, 1] | [2, 4, 1, 5, 6] => "D4",
        [2, 4] => "D5",
        [5, 6, 7, 8] => "D6",
        [5, 6, 8] => "D7",
        [5, 6, 7] => "D8",
        [5, 6] => "D9",
        _ => "G",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn documented_cell_format_codes() {
        for (format, expected) in [
            ("General", "G"),
            ("@", "G"),
            ("0", "F0"),
            ("#,##0", ",0"),
            ("0.00", "F2"),
            ("#,##0.00", ",2"),
            ("$#,##0_);($#,##0)", "C0"),
            ("$#,##0_);[Red]($#,##0)", "C0-"),
            ("$#,##0.00_);($#,##0.00)", "C2"),
            ("$#,##0.00_);[Red]($#,##0.00)", "C2-"),
            ("0%", "P0"),
            ("0.00%", "P2"),
            ("0.00E+00", "S2"),
            ("# ?/?", "G"),
            ("# ??/??", "G"),
            ("m/d/yy", "D4"),
            ("m/d/yy h:mm", "D4"),
            ("mm/dd/yy", "D4"),
            ("d-mmm-yy", "D1"),
            ("dd-mmm-yy", "D1"),
            ("d-mmm", "D2"),
            ("dd-mmm", "D2"),
            ("mmm-yy", "D3"),
            ("mm/dd", "D5"),
            ("h:mm AM/PM", "D7"),
            ("h:mm:ss AM/PM", "D6"),
            ("h:mm", "D9"),
            ("h:mm:ss", "D8"),
            (r"yyyy\-mm\-dd", "G"),
            ("yyyy/mm/dd", "G"),
            ("yyyy-mm-dd hh:mm:ss", "G"),
        ] {
            assert_eq!(cell_format_info(format).code, expected, "{format}");
        }
    }

    #[test]
    fn metadata_uses_parsed_sections_and_literal_parentheses() {
        let info = cell_format_info(r#"(0.000);[Blue](0.000)"#);
        assert_eq!(info.code, "F3-()");
        assert!(info.colored_negative && info.parentheses);
        assert!(!cell_format_info(r#"0.00";[Red]""#).colored_negative);
        assert!(!cell_format_info("0.00_( _)").parentheses);
    }
}
