//! Build Excel format codes from high-level options.
//!
//! Used by the Format Cells dialog to generate format code strings
//! from user selections (type, decimal places, currency, etc.).

use crate::constants::FormatType;

/// How to display negative numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum NegativeFormat {
    /// -1,234.10
    Minus,
    /// -1,234.10 in red
    MinusRed,
    /// (1,234.10)
    Parentheses,
    /// (1,234.10) in red
    ParenthesesRed,
}

/// Fraction denominator type for the fraction format builder.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum FractionType {
    /// Up to halves (`# ?/2`).
    Halves,
    /// Up to quarters (`# ?/4`).
    Quarters,
    /// Up to eighths (`# ?/8`).
    Eighths,
    /// Up to tenths (`# ?/10`).
    Tenths,
    /// Up to hundredths (`# ??/100`).
    Hundredths,
    /// One-digit denominator (`# ?/?`).
    OneDenom,
    /// Two-digit denominator (`# ??/??`).
    TwoDenom,
    /// Three-digit denominator (`# ???/???`).
    ThreeDenom,
    /// Custom fixed denominator (`# ?/N`).
    Custom(u32),
}

/// Options for building a format code via [`build_format_code`].
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FormatOptions {
    /// The target format type (e.g., Number, Currency, Date).
    pub format_type: FormatType,
    /// Number of decimal places (default: 2).
    pub decimal_places: Option<u8>,
    /// Whether to include a thousands separator (default: true).
    pub use_thousands_separator: Option<bool>,
    /// Currency symbol to use (default: "$").
    pub currency_symbol: Option<String>,
    /// How to display negative numbers.
    pub negative_format: Option<NegativeFormat>,
    /// Fraction denominator type.
    pub fraction_type: Option<FractionType>,
    /// Date format code override (e.g., "yyyy-mm-dd").
    pub date_format: Option<String>,
    /// Time format code override (e.g., "hh:mm:ss").
    pub time_format: Option<String>,
}

impl Default for FormatOptions {
    fn default() -> Self {
        Self {
            format_type: FormatType::General,
            decimal_places: None,
            use_thousands_separator: None,
            currency_symbol: None,
            negative_format: None,
            fraction_type: None,
            date_format: None,
            time_format: None,
        }
    }
}

/// Build an Excel format code string from high-level options.
///
/// # Examples
///
/// ```
/// use compute_formats::{build_format_code, FormatOptions, FormatType};
///
/// let opts = FormatOptions {
///     format_type: FormatType::Currency,
///     decimal_places: Some(2),
///     ..FormatOptions::default()
/// };
/// assert_eq!(build_format_code(&opts), "$#,##0.00");
/// ```
#[must_use]
pub fn build_format_code(options: &FormatOptions) -> String {
    let decimals = options.decimal_places.unwrap_or(2) as usize;
    let use_thousands = options.use_thousands_separator.unwrap_or(true);
    let currency = options.currency_symbol.as_deref().unwrap_or("$");

    match options.format_type {
        FormatType::General => "General".to_string(),

        FormatType::Number => {
            let int_part = if use_thousands { "#,##0" } else { "0" };
            if decimals > 0 {
                format!("{}.{}", int_part, "0".repeat(decimals))
            } else {
                int_part.to_string()
            }
        }

        FormatType::Currency => {
            let int_part = if use_thousands { "#,##0" } else { "0" };
            let num_fmt = if decimals > 0 {
                format!("{}.{}", int_part, "0".repeat(decimals))
            } else {
                int_part.to_string()
            };

            match options.negative_format {
                Some(NegativeFormat::Parentheses) => {
                    format!("{currency}{num_fmt};({currency}{num_fmt})")
                }
                Some(NegativeFormat::MinusRed) => {
                    format!("{currency}{num_fmt};[Red]-{currency}{num_fmt}")
                }
                Some(NegativeFormat::ParenthesesRed) => {
                    format!("{currency}{num_fmt};[Red]({currency}{num_fmt})")
                }
                _ => format!("{currency}{num_fmt}"),
            }
        }

        FormatType::Accounting => {
            let dec_part = if decimals > 0 {
                format!(".{}", "0".repeat(decimals))
            } else {
                String::new()
            };
            format!(
                "_({currency}* #,##0{dec_part}_);_({currency}* (#,##0{dec_part});_({currency}* \"-\"??_);_(@_)"
            )
        }

        FormatType::Percentage => {
            if decimals > 0 {
                format!("0.{}%", "0".repeat(decimals))
            } else {
                "0%".to_string()
            }
        }

        FormatType::Scientific => {
            let dec_part = if decimals > 0 {
                format!(".{}", "0".repeat(decimals))
            } else {
                String::new()
            };
            format!("0{dec_part}E+00")
        }

        FormatType::Fraction => {
            match options
                .fraction_type
                .as_ref()
                .unwrap_or(&FractionType::OneDenom)
            {
                FractionType::Halves => "# ?/2".to_string(),
                FractionType::Quarters => "# ?/4".to_string(),
                FractionType::Eighths => "# ?/8".to_string(),
                FractionType::Tenths => "# ?/10".to_string(),
                FractionType::Hundredths => "# ??/100".to_string(),
                FractionType::OneDenom => "# ?/?".to_string(),
                FractionType::TwoDenom => "# ??/??".to_string(),
                FractionType::ThreeDenom => "# ???/???".to_string(),
                FractionType::Custom(d) => format!("# ?/{d}"),
            }
        }

        FormatType::Date => options
            .date_format
            .as_deref()
            .unwrap_or("m/d/yyyy")
            .to_string(),

        FormatType::Time => options
            .time_format
            .as_deref()
            .unwrap_or("h:mm AM/PM")
            .to_string(),

        FormatType::Text => "@".to_string(),

        FormatType::Special | FormatType::Custom => options
            .date_format
            .as_deref()
            .unwrap_or("General")
            .to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(format_type: FormatType) -> FormatOptions {
        FormatOptions {
            format_type,
            ..Default::default()
        }
    }

    #[test]
    fn test_general() {
        assert_eq!(build_format_code(&opts(FormatType::General)), "General");
    }

    #[test]
    fn test_number_default() {
        assert_eq!(build_format_code(&opts(FormatType::Number)), "#,##0.00");
    }

    #[test]
    fn test_number_no_thousands() {
        let o = FormatOptions {
            format_type: FormatType::Number,
            use_thousands_separator: Some(false),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "0.00");
    }

    #[test]
    fn test_number_zero_decimals() {
        let o = FormatOptions {
            format_type: FormatType::Number,
            decimal_places: Some(0),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "#,##0");
    }

    #[test]
    fn test_currency_default() {
        assert_eq!(build_format_code(&opts(FormatType::Currency)), "$#,##0.00");
    }

    #[test]
    fn test_currency_parentheses() {
        let o = FormatOptions {
            format_type: FormatType::Currency,
            negative_format: Some(NegativeFormat::Parentheses),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "$#,##0.00;($#,##0.00)");
    }

    #[test]
    fn test_currency_red_minus() {
        let o = FormatOptions {
            format_type: FormatType::Currency,
            negative_format: Some(NegativeFormat::MinusRed),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "$#,##0.00;[Red]-$#,##0.00");
    }

    #[test]
    fn test_currency_euro() {
        let o = FormatOptions {
            format_type: FormatType::Currency,
            currency_symbol: Some("\u{20AC}".to_string()),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "\u{20AC}#,##0.00");
    }

    #[test]
    fn test_accounting() {
        let result = build_format_code(&opts(FormatType::Accounting));
        assert!(result.starts_with("_($* #,##0.00_)"));
        assert!(result.contains(";_($* (#,##0.00)"));
        assert!(result.contains(";_(@_)"));
    }

    #[test]
    fn test_percentage_default() {
        assert_eq!(build_format_code(&opts(FormatType::Percentage)), "0.00%");
    }

    #[test]
    fn test_percentage_no_decimals() {
        let o = FormatOptions {
            format_type: FormatType::Percentage,
            decimal_places: Some(0),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "0%");
    }

    #[test]
    fn test_scientific_default() {
        assert_eq!(build_format_code(&opts(FormatType::Scientific)), "0.00E+00");
    }

    #[test]
    fn test_scientific_no_decimals() {
        let o = FormatOptions {
            format_type: FormatType::Scientific,
            decimal_places: Some(0),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "0E+00");
    }

    #[test]
    fn test_fraction_halves() {
        let o = FormatOptions {
            format_type: FormatType::Fraction,
            fraction_type: Some(FractionType::Halves),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "# ?/2");
    }

    #[test]
    fn test_fraction_custom() {
        let o = FormatOptions {
            format_type: FormatType::Fraction,
            fraction_type: Some(FractionType::Custom(7)),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "# ?/7");
    }

    #[test]
    fn test_fraction_default() {
        assert_eq!(build_format_code(&opts(FormatType::Fraction)), "# ?/?");
    }

    #[test]
    fn test_fraction_two_denom() {
        let o = FormatOptions {
            format_type: FormatType::Fraction,
            fraction_type: Some(FractionType::TwoDenom),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "# ??/??");
    }

    #[test]
    fn test_fraction_three_denom() {
        let o = FormatOptions {
            format_type: FormatType::Fraction,
            fraction_type: Some(FractionType::ThreeDenom),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "# ???/???");
    }

    #[test]
    fn test_fraction_hundredths() {
        let o = FormatOptions {
            format_type: FormatType::Fraction,
            fraction_type: Some(FractionType::Hundredths),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "# ??/100");
    }

    #[test]
    fn test_date_default() {
        assert_eq!(build_format_code(&opts(FormatType::Date)), "m/d/yyyy");
    }

    #[test]
    fn test_date_custom() {
        let o = FormatOptions {
            format_type: FormatType::Date,
            date_format: Some("yyyy-mm-dd".to_string()),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "yyyy-mm-dd");
    }

    #[test]
    fn test_time_default() {
        assert_eq!(build_format_code(&opts(FormatType::Time)), "h:mm AM/PM");
    }

    #[test]
    fn test_time_custom() {
        let o = FormatOptions {
            format_type: FormatType::Time,
            time_format: Some("hh:mm:ss".to_string()),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "hh:mm:ss");
    }

    #[test]
    fn test_text() {
        assert_eq!(build_format_code(&opts(FormatType::Text)), "@");
    }
}
