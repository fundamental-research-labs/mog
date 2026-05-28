#![warn(clippy::all, clippy::pedantic)]
#![warn(missing_docs)]
#![allow(clippy::module_name_repetitions)] // FormatResult in format_result.rs is fine
#![allow(clippy::must_use_candidate)]
// addressed separately
// Cast lints: numeric formatting inherently casts between f64, u64, i64, i32, usize.
// Values are bounds-checked or known-safe at each site (e.g., month 1..=12).
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss,
    clippy::cast_possible_wrap,
    clippy::cast_lossless
)]

//! Excel-compatible number format engine with locale, color, and currency support.
//!
//! This crate parses and applies Excel number format codes to produce formatted
//! strings. It powers `TEXT()`, `DOLLAR()`, `FIXED()`, and cell display formatting
//! with full support for locale-aware separators, date/time formatting, conditional
//! color directives, fractions, scientific notation, and currency patterns.
//!
//! # Quick Start
//!
//! ## Basic number formatting
//!
//! ```
//! use compute_formats::format_number;
//!
//! assert_eq!(format_number(1234.5, "#,##0.00"), "1,234.50");
//! assert_eq!(format_number(0.5, "0%"), "50%");
//! assert_eq!(format_number(1234567.0, "0.00E+00"), "1.23E+06");
//! ```
//!
//! ## Date formatting
//!
//! Date values are Excel serial numbers (days since 1899-12-30). Serial 45000
//! corresponds to 2023-03-15.
//!
//! ```
//! use compute_formats::format_number;
//!
//! assert_eq!(format_number(45000.0, "yyyy-mm-dd"), "2023-03-15");
//! assert_eq!(format_number(45000.0, "mmmm d, yyyy"), "March 15, 2023");
//! ```
//!
//! ## Locale-aware formatting
//!
//! ```
//! use compute_formats::{format_number_with_locale, CultureInfo};
//!
//! let german = CultureInfo {
//!     decimal_separator: ",".into(),
//!     thousands_separator: ".".into(),
//!     ..CultureInfo::default()
//! };
//! assert_eq!(format_number_with_locale(1234.5, "#,##0.00", &german), "1.234,50");
//! ```
//!
//! ## Color extraction with `FormatResult`
//!
//! ```
//! use compute_formats::{format_number_result, FormatResult, FormatColor, CultureInfo};
//!
//! let result = format_number_result(-1234.0, "#,##0;[Red](#,##0)", &CultureInfo::default());
//! assert_eq!(result.text, "(1,234)");
//! assert_eq!(result.color, Some(FormatColor::Red));
//! ```
//!
//! # Format Code Syntax
//!
//! Excel format codes have up to 4 semicolon-separated sections:
//!
//! ```text
//! positive ; negative ; zero ; text
//! ```
//!
//! Section count determines which section applies:
//! - **1 section** -- applies to all numbers
//! - **2 sections** -- first for positive/zero, second for negative
//! - **3 sections** -- positive; negative; zero
//! - **4 sections** -- positive; negative; zero; text
//!
//! Each section can contain digit placeholders (`0`, `#`, `?`), literal text
//! (in quotes or escaped with `\`), color directives (`[Red]`, `[Blue]`),
//! and date/time tokens (`yyyy`, `mm`, `dd`, `h`, `ss`, `AM/PM`).
//!
//! # Modules
//!
//! - [`builder`] -- Build format codes from high-level options (type, decimals, currency)
//! - [`color`] -- Excel color palette and format color types
//! - [`constants`] -- Built-in format codes, presets, and category metadata
//! - [`currency`] -- Culture-aware currency symbol positioning
//! - [`detection`] -- Format type classification and date/time detection
//! - [`format_result`] -- The [`FormatResult`] type returned by formatting functions
//! - [`input`] -- Date input parsing and serial number computation
//! - [`locale`] -- Culture information for locale-aware formatting
//! - [`normalize`] -- Format code normalization and preview generation

// Core formatting modules
mod convenience;
mod datetime;
mod fraction;
mod general;
mod number;
mod parser;
mod types;

// Locale, color, and result types
pub mod color;
pub mod constants;
pub mod currency;
pub mod format_result;
pub mod locale;

// Detection, builder, normalize
pub mod builder;
pub mod detection;
pub mod input;
pub mod normalize;

// Public API re-exports
pub use builder::{FormatOptions, FractionType, NegativeFormat, build_format_code};
pub use color::{EXCEL_COLOR_PALETTE, FormatColor, palette_color};
pub use constants::{
    ACCOUNTING_PRESETS, CURRENCY_PRESETS, CURRENCY_SYMBOLS, CurrencySymbolDef, DATE_PRESETS,
    EXCEL_BUILTIN_FORMATS, FORMAT_CATEGORIES, FRACTION_PRESETS, FormatCategory,
    FormatConstantsData, FormatPreset, FormatType, GENERAL_PRESETS, NEGATIVE_FORMATS,
    NUMBER_PRESETS, NegativeFormatOption, PERCENTAGE_PRESETS, SCIENTIFIC_PRESETS, SPECIAL_PRESETS,
    TEXT_PRESETS, TIME_PRESETS, builtin_format, default_format, get_format_data, presets_for_type,
};
pub use convenience::{format_dollar, format_fixed};
pub use currency::{
    apply_currency_pattern, apply_negative_currency_pattern, apply_positive_currency_pattern,
};
pub use detection::{
    detect_format_type, has_date_tokens, has_time_tokens, is_date_format, is_likely_date_serial,
    is_time_only_format, should_format_as_date,
};
pub use format_result::FormatResult;
pub use input::{
    DateValueResult, ParsedDateInput, parse_date_input, parse_date_input_with_default_year,
    prepare_date_value, prepare_time_value,
};
pub use locale::{CultureInfo, get_all_cultures, get_culture};
pub use normalize::{get_format_preview, normalize_format_code};

// Internal imports used by this module and re-exported for tests (which use `super::*`)
pub(crate) use datetime::format_datetime;
pub(crate) use fraction::format_fraction;
pub(crate) use general::format_general;
pub(crate) use number::{apply_text_section, emit_literals, format_numeric, select_section};
pub(crate) use parser::parse_format_code;
pub(crate) use types::Token;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Format a number using the default (US English) locale.
///
/// Applies the given Excel format code to `value` and returns the formatted
/// string. Uses US English separators (`.` for decimal, `,` for thousands).
///
/// # Examples
///
/// ```
/// use compute_formats::format_number;
///
/// assert_eq!(format_number(1234.5, "#,##0.00"), "1,234.50");
/// assert_eq!(format_number(0.5, "0%"), "50%");
/// assert_eq!(format_number(1234.0, "$#,##0"), "$1,234");
/// assert_eq!(format_number(1234.5, "General"), "1234.5");
/// ```
#[must_use]
pub fn format_number(value: f64, format_code: &str) -> String {
    format_number_internal(value, format_code, &CultureInfo::default()).text
}

/// Format a number using a specific locale for separators and names.
///
/// The locale controls decimal/thousands separators, month/day names,
/// and AM/PM designators.
///
/// # Examples
///
/// ```
/// use compute_formats::{format_number_with_locale, CultureInfo};
///
/// let german = CultureInfo {
///     decimal_separator: ",".into(),
///     thousands_separator: ".".into(),
///     ..CultureInfo::default()
/// };
/// assert_eq!(
///     format_number_with_locale(1234.5, "#,##0.00", &german),
///     "1.234,50"
/// );
/// ```
#[must_use]
pub fn format_number_with_locale(value: f64, format_code: &str, locale: &CultureInfo) -> String {
    format_number_internal(value, format_code, locale).text
}

/// Format a number and return a [`FormatResult`] with color information.
///
/// Unlike [`format_number`], this returns the full result including any color
/// directive embedded in the format code (e.g., `[Red]`).
///
/// # Examples
///
/// ```
/// use compute_formats::{format_number_result, FormatColor, CultureInfo};
///
/// let r = format_number_result(42.5, "[Red]0.00", &CultureInfo::default());
/// assert_eq!(r.text, "42.50");
/// assert_eq!(r.color, Some(FormatColor::Red));
/// ```
#[must_use]
pub fn format_number_result(value: f64, format_code: &str, locale: &CultureInfo) -> FormatResult {
    format_number_internal(value, format_code, locale)
}

fn format_number_internal(value: f64, format_code: &str, locale: &CultureInfo) -> FormatResult {
    if format_code.is_empty() || format_code.eq_ignore_ascii_case("General") {
        return FormatResult::text(format_general(value));
    }

    let parsed = parse_format_code(format_code);
    let (section, section_count) = select_section(&parsed, value);

    let color = section
        .color
        .as_ref()
        .and_then(|name| color::FormatColor::from_name(name));

    let text = if section.is_text_section {
        apply_text_section(section, &format_general(value))
    } else if section.is_datetime {
        format_datetime(value, section, locale)
    } else if section
        .tokens
        .iter()
        .any(|t| matches!(t, Token::Literal(s) if s == "General"))
    {
        format_general(value)
    } else if !section.has_digit_placeholders && !section.has_exponent {
        emit_literals(section)
    } else if section
        .tokens
        .iter()
        .any(|t| matches!(t, Token::FractionSlash))
    {
        format_fraction(value, section, section_count)
    } else {
        format_numeric(value, section, section_count, locale)
    };

    FormatResult {
        text,
        color,
        is_error: false,
    }
}

/// Format a [`CellValue`](value_types::CellValue) for display.
///
/// This is the top-level formatting function that dispatches on the value type:
/// numbers go through the format engine, text uses the text section (4th section
/// or `@`), booleans render as `TRUE`/`FALSE`, and errors pass through.
///
/// # Examples
///
/// ```
/// use compute_formats::{format_value, CultureInfo};
///
/// let val = value_types::CellValue::Number(value_types::FiniteF64::new(1234.5).unwrap());
/// let result = format_value(&val, "#,##0.00", &CultureInfo::default());
/// assert_eq!(result.text, "1,234.50");
///
/// let text = value_types::CellValue::Text("hello".into());
/// assert_eq!(format_value(&text, "@", &CultureInfo::default()).text, "hello");
/// ```
#[must_use]
pub fn format_value(
    value: &value_types::CellValue,
    format_code: &str,
    locale: &CultureInfo,
) -> FormatResult {
    match value {
        value_types::CellValue::Number(n) => format_number_result(**n, format_code, locale),
        value_types::CellValue::Text(s) => {
            let text = format_text(s, format_code);
            FormatResult::text(text)
        }
        value_types::CellValue::Boolean(b) => FormatResult::text(if *b { "TRUE" } else { "FALSE" }),
        value_types::CellValue::Error(e, _) => FormatResult::error(e.to_string()),
        value_types::CellValue::Null => FormatResult::text(""),
        value_types::CellValue::Array(_) => FormatResult::text("{...}"),
        value_types::CellValue::Control(c) => {
            FormatResult::text(if c.value { "TRUE" } else { "FALSE" })
        }
        value_types::CellValue::Image(image) => FormatResult::text(image.fallback_text()),
    }
}

/// Format a text string using the text section of a format code.
///
/// If the format code has 4 sections, the 4th section is applied as the text
/// format. A single-section format containing `@` (text placeholder) is also
/// applied. Otherwise the text is returned unchanged.
///
/// # Examples
///
/// ```
/// use compute_formats::format_text;
///
/// assert_eq!(format_text("hello", "@\" world\""), "hello world");
/// assert_eq!(format_text("world", "\"hello \"@"), "hello world");
/// assert_eq!(format_text("test", "#,##0"), "test"); // no text section
/// ```
#[must_use]
pub fn format_text(text: &str, format_code: &str) -> String {
    if format_code.is_empty() {
        return text.to_string();
    }
    let parsed = parse_format_code(format_code);
    if parsed.sections.len() >= 4 {
        // 4-section format: 4th section is the text section
        apply_text_section(&parsed.sections[3], text)
    } else if parsed.sections.len() == 1
        && parsed.sections[0]
            .tokens
            .iter()
            .any(|t| matches!(t, Token::TextPlaceholder))
    {
        // Single-section format containing @: apply it as a text section
        apply_text_section(&parsed.sections[0], text)
    } else {
        text.to_string()
    }
}

/// Entry for batch formatting: a value paired with its format code.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FormatEntry {
    /// The cell value to format.
    pub value: value_types::CellValue,
    /// The Excel format code to apply.
    pub format_code: String,
}

/// Batch-format multiple cell values, returning one display string per entry.
///
/// This is an optimization for column autofit: the caller collects all cells
/// and their format codes, sends them in one call, and uses the formatted
/// strings for pixel-width measurement.
///
/// # Examples
///
/// ```
/// use compute_formats::{format_values_batch, FormatEntry, CultureInfo};
///
/// let entries = vec![
///     FormatEntry {
///         value: value_types::CellValue::Number(value_types::FiniteF64::new(1234.5).unwrap()),
///         format_code: "#,##0.00".into(),
///     },
///     FormatEntry {
///         value: value_types::CellValue::Text("hello".into()),
///         format_code: "@".into(),
///     },
/// ];
/// let results = format_values_batch(&entries, &CultureInfo::default());
/// assert_eq!(results, vec!["1,234.50", "hello"]);
/// ```
#[must_use]
pub fn format_values_batch(entries: &[FormatEntry], locale: &CultureInfo) -> Vec<String> {
    entries
        .iter()
        .map(|e| format_value(&e.value, &e.format_code, locale).text)
        .collect()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::datetime::serial_to_datetime_parts;
    use crate::parser::split_sections;

    // ----- Helper for date tests -----
    // Uses the authoritative date_to_serial from datetime.rs via the re-export.

    fn date_to_serial(year: i32, month: u32, day: u32) -> f64 {
        let date = chrono::NaiveDate::from_ymd_opt(year, month, day).unwrap();
        value_types::date_serial::date_to_serial(&date)
    }

    // ----- Basic numeric formatting -----

    #[test]
    fn test_basic_zero_placeholder() {
        assert_eq!(format_number(5.0, "000"), "005");
        assert_eq!(format_number(123.0, "000"), "123");
        assert_eq!(format_number(1234.0, "000"), "1234");
    }

    #[test]
    fn test_basic_hash_placeholder() {
        assert_eq!(format_number(5.0, "###"), "5");
        assert_eq!(format_number(123.0, "###"), "123");
        assert_eq!(format_number(1234.0, "###"), "1234");
    }

    #[test]
    fn test_decimal_places() {
        assert_eq!(format_number(1234.5, "0.00"), "1234.50");
        assert_eq!(format_number(1234.567, "0.00"), "1234.57");
        assert_eq!(format_number(0.5, "0.00"), "0.50");
    }

    #[test]
    fn test_thousands_separator() {
        assert_eq!(format_number(1234.0, "#,##0"), "1,234");
        assert_eq!(format_number(1234567.0, "#,##0"), "1,234,567");
        assert_eq!(format_number(123.0, "#,##0"), "123");
        assert_eq!(format_number(0.0, "#,##0"), "0");
    }

    #[test]
    fn test_thousands_with_decimals() {
        assert_eq!(format_number(1234.5, "#,##0.00"), "1,234.50");
        assert_eq!(format_number(1234567.89, "#,##0.00"), "1,234,567.89");
    }

    #[test]
    fn test_percentage() {
        assert_eq!(format_number(0.5, "0%"), "50%");
        assert_eq!(format_number(0.1234, "0.00%"), "12.34%");
        assert_eq!(format_number(1.0, "0%"), "100%");
    }

    #[test]
    fn test_scientific_notation() {
        assert_eq!(format_number(1234567.0, "0.00E+00"), "1.23E+06");
        assert_eq!(format_number(0.0001, "0.00E+00"), "1.00E-04");
        assert_eq!(format_number(0.0, "0.00E+00"), "0.00E+00");
        assert_eq!(format_number(0.123456, "0.00E+00"), "1.23E-01");
    }

    #[test]
    fn test_currency() {
        assert_eq!(format_number(1234.5, "$#,##0.00"), "$1,234.50");
        assert_eq!(format_number(0.0, "$#,##0.00"), "$0.00");
    }

    #[test]
    fn test_negative_format_two_sections() {
        assert_eq!(format_number(1234.0, "#,##0;(#,##0)"), "1,234");
        assert_eq!(format_number(-1234.0, "#,##0;(#,##0)"), "(1,234)");
    }

    #[test]
    fn test_negative_format_single_section() {
        assert_eq!(format_number(-1234.5, "#,##0.00"), "-1,234.50");
    }

    #[test]
    fn test_three_sections() {
        assert_eq!(format_number(1234.0, "#,##0;(#,##0);\"zero\""), "1,234");
        assert_eq!(format_number(-1234.0, "#,##0;(#,##0);\"zero\""), "(1,234)");
        assert_eq!(format_number(0.0, "#,##0;(#,##0);\"zero\""), "zero");
    }

    #[test]
    fn test_leading_zeros_zip_code() {
        assert_eq!(format_number(1234.0, "00000"), "01234");
        assert_eq!(format_number(12345.0, "00000"), "12345");
    }

    #[test]
    fn test_scale_divisor() {
        assert_eq!(format_number(1234567.0, "#,##0,"), "1,235");
        assert_eq!(format_number(1234567890.0, "#,##0,,"), "1,235");
    }

    #[test]
    fn test_quoted_literal() {
        assert_eq!(format_number(42.0, "0\" units\""), "42 units");
    }

    #[test]
    fn test_escaped_literal() {
        assert_eq!(format_number(42.0, "0\\x"), "42x");
    }

    #[test]
    fn test_general_format() {
        assert_eq!(format_number(1234.0, "General"), "1234");
        assert_eq!(format_number(1234.5, "General"), "1234.5");
        assert_eq!(format_number(0.0, "General"), "0");
    }

    #[test]
    fn test_empty_format() {
        assert_eq!(format_number(1234.5, ""), "1234.5");
    }

    // ----- Date/Time formatting -----

    #[test]
    fn test_date_yyyy_mm_dd() {
        let serial = date_to_serial(2024, 1, 15);
        assert_eq!(format_number(serial, "yyyy-mm-dd"), "2024-01-15");
    }

    #[test]
    fn test_date_m_d_yyyy() {
        let serial = date_to_serial(2024, 3, 5);
        assert_eq!(format_number(serial, "m/d/yyyy"), "3/5/2024");
    }

    #[test]
    fn test_time_h_mm_ss() {
        assert_eq!(format_number(0.5, "h:mm:ss"), "12:00:00");
        assert_eq!(format_number(0.75, "h:mm:ss"), "18:00:00");
    }

    #[test]
    fn test_time_h_mm_ampm() {
        assert_eq!(format_number(0.5, "h:mm AM/PM"), "12:00 PM");
        assert_eq!(format_number(0.75, "h:mm AM/PM"), "6:00 PM");
        assert_eq!(format_number(0.25, "h:mm AM/PM"), "6:00 AM");
    }

    #[test]
    fn test_m_ambiguity_month_vs_minute() {
        let serial = date_to_serial(2024, 3, 15);
        assert_eq!(format_number(serial, "m/d/yyyy"), "3/15/2024");

        let time_serial = 12.0 / 24.0 + 15.0 / 1440.0;
        assert_eq!(format_number(time_serial, "h:mm"), "12:15");
    }

    // ----- Edge cases -----

    #[test]
    fn test_zero_value() {
        assert_eq!(format_number(0.0, "#,##0.00"), "0.00");
        assert_eq!(format_number(0.0, "#.##"), ".");
    }

    #[test]
    fn test_very_large_number() {
        assert_eq!(format_number(1e15, "0.00E+00"), "1.00E+15");
    }

    #[test]
    fn test_very_small_number() {
        assert_eq!(format_number(0.000001, "0.00E+00"), "1.00E-06");
    }

    #[test]
    fn test_skip_width() {
        assert_eq!(format_number(123.0, "0_)"), "123 ");
    }

    #[test]
    fn test_locale_currency() {
        assert_eq!(
            format_number(1234.5, "[$\u{20ac}-407]#,##0.00"),
            "\u{20ac}1,234.50"
        );
    }

    #[test]
    fn test_color_ignored() {
        assert_eq!(format_number(1234.0, "[Red]#,##0"), "1,234");
    }

    // ----- Convenience function tests -----

    #[test]
    fn test_format_dollar_basic() {
        assert_eq!(format_dollar(1234.5, 2), "$1,234.50");
        assert_eq!(format_dollar(0.0, 2), "$0.00");
    }

    #[test]
    fn test_format_dollar_negative() {
        assert_eq!(format_dollar(-1234.5, 2), "($1,234.50)");
    }

    #[test]
    fn test_format_dollar_no_decimals() {
        assert_eq!(format_dollar(1234.5, 0), "$1,235");
    }

    #[test]
    fn test_format_dollar_negative_decimals() {
        assert_eq!(format_dollar(1234.5, -2), "$1,200");
    }

    #[test]
    fn test_format_fixed_basic() {
        assert_eq!(format_fixed(1234.5, 2, false), "1,234.50");
        assert_eq!(format_fixed(1234.5, 2, true), "1234.50");
    }

    #[test]
    fn test_format_fixed_negative() {
        assert_eq!(format_fixed(-1234.5, 2, false), "-1,234.50");
    }

    #[test]
    fn test_format_fixed_no_decimals() {
        assert_eq!(format_fixed(1234.5, 0, false), "1,235");
    }

    #[test]
    fn test_format_fixed_no_commas() {
        assert_eq!(format_fixed(1234567.89, 2, true), "1234567.89");
    }

    // ----- TEXT function integration -----

    #[test]
    fn test_text_percentage() {
        assert_eq!(format_number(0.5, "0%"), "50%");
    }

    #[test]
    fn test_text_number_format() {
        assert_eq!(format_number(1234.5, "#,##0.00"), "1,234.50");
    }

    #[test]
    fn test_text_custom_literal() {
        assert_eq!(format_number(0.25, "0.0%\" complete\""), "25.0% complete");
    }

    // ----- Parser tests -----

    #[test]
    fn test_split_sections() {
        let sections = split_sections("pos;neg;zero;text");
        assert_eq!(sections.len(), 4);
        assert_eq!(sections[0], "pos");
        assert_eq!(sections[1], "neg");
    }

    #[test]
    fn test_split_sections_with_quotes() {
        let sections = split_sections("0\";\"0");
        assert_eq!(sections.len(), 1);
    }

    #[test]
    fn test_section_selection() {
        let code = parse_format_code("#,##0;(#,##0);\"zero\"");
        assert_eq!(code.sections.len(), 3);
        let (s, _) = select_section(&code, 5.0);
        assert!(!s.is_text_section);
        let (s, _) = select_section(&code, -5.0);
        assert!(!s.is_text_section);
        let (s, _) = select_section(&code, 0.0);
        assert!(
            s.tokens
                .iter()
                .any(|t| matches!(t, Token::Literal(s) if s == "zero"))
        );
    }

    #[test]
    fn test_format_text_section() {
        // Single-section format with @ should now apply the text format
        let result = format_text("hello", "@\" world\"");
        assert_eq!(result, "hello world");
    }

    #[test]
    fn test_serial_to_datetime_roundtrip() {
        let serial = date_to_serial(2024, 6, 15);
        let (y, m, d, _, _, _) = serial_to_datetime_parts(serial);
        assert_eq!(y, 2024);
        assert_eq!(m, 6);
        assert_eq!(d, 15);
    }

    #[test]
    fn test_format_month_name() {
        let serial = date_to_serial(2024, 3, 15);
        assert_eq!(format_number(serial, "dd-mmm-yyyy"), "15-Mar-2024");
        assert_eq!(format_number(serial, "mmmm d, yyyy"), "March 15, 2024");
    }

    #[test]
    fn test_format_day_name() {
        let serial = date_to_serial(2024, 1, 15);
        let result = format_number(serial, "dddd, mmmm d, yyyy");
        assert_eq!(result, "Monday, January 15, 2024");
    }

    #[test]
    fn test_question_placeholder() {
        assert_eq!(format_number(5.0, "???"), "  5");
    }

    #[test]
    fn test_at_sign_numeric_section() {
        let code = parse_format_code("@");
        assert_eq!(code.sections.len(), 1);
        assert!(code.sections[0].is_text_section);
    }

    #[test]
    fn test_format_number_negative_single_section() {
        assert_eq!(format_number(-42.0, "0.00"), "-42.00");
    }

    #[test]
    fn test_format_number_parens_negative() {
        assert_eq!(format_number(-1234.0, "#,##0_);(#,##0)"), "(1,234)");
        assert_eq!(format_number(1234.0, "#,##0_);(#,##0)"), "1,234 ");
    }

    // -----------------------------------------------------------------------
    // Verify format engine uses correct serial-to-date (no off-by-one)
    // -----------------------------------------------------------------------

    #[test]
    fn test_time_only_serial_formatting() {
        // TEXT(0.5, "h:mm:ss") should be "12:00:00" (noon)
        // This verifies the format engine handles time-only serials correctly.
        assert_eq!(format_number(0.5, "h:mm:ss"), "12:00:00");
    }

    #[test]
    fn test_format_text_single_section_at() {
        // Single-section format with @ placeholder should apply to text
        assert_eq!(format_text("world", "\"hello \"@"), "hello world");
        // Just @ should return text unchanged
        assert_eq!(format_text("test", "@"), "test");
    }

    // -----------------------------------------------------------------------
    // General format produces Excel-faithful output (15 sig digits + scientific)
    // -----------------------------------------------------------------------

    #[test]
    fn test_general_format_excel_faithful() {
        // 15-digit integer fits in fixed notation, no thousands separator.
        assert_eq!(format_general(999_999_999_999_999.0), "999999999999999");
        // 16+ digit integer overflows to scientific.
        assert_eq!(format_general(1.23e16), "1.23E+16");
        // Decimal capped at 15 significant digits.
        assert_eq!(format_general(1.234567890123456), "1.23456789012346");
    }

    // -----------------------------------------------------------------------
    // FIX 2: Fraction formatting
    // -----------------------------------------------------------------------

    #[test]
    fn test_fraction_simple_quarter() {
        // 3.25 with "# ?/?" -> "3 1/4"
        assert_eq!(format_number(3.25, "# ?/?"), "3 1/4");
    }

    #[test]
    fn test_fraction_zero_frac() {
        // 5.0 with "# ?/?" -> integer part, no fraction
        let result = format_number(5.0, "# ?/?");
        assert_eq!(result, "5  / ");
    }

    #[test]
    fn test_fraction_half() {
        assert_eq!(format_number(0.5, "# ?/?"), "  1/2");
    }

    #[test]
    fn test_fraction_two_digit_denom() {
        // 0.333... with "# ??/??" should find 1/3
        let result = format_number(1.0 / 3.0, "# ??/??");
        assert!(result.contains("1/3"), "got: {}", result);
    }

    // -----------------------------------------------------------------------
    // FIX 3: Conditional sections
    // -----------------------------------------------------------------------

    #[test]
    fn test_conditional_sections_gt() {
        let fmt = "[>100]\"big\";[<0]\"neg\";\"small\"";
        assert_eq!(format_number(150.0, fmt), "big");
        assert_eq!(format_number(-5.0, fmt), "neg");
        assert_eq!(format_number(50.0, fmt), "small");
    }

    #[test]
    fn test_conditional_sections_with_format() {
        let fmt = "[>=1000]#,##0;[Red]0.00";
        assert_eq!(format_number(1500.0, fmt), "1,500");
        assert_eq!(format_number(42.5, fmt), "42.50");
    }

    // -----------------------------------------------------------------------
    // FIX 4: Elapsed time formats
    // -----------------------------------------------------------------------

    #[test]
    fn test_elapsed_hours() {
        // 1.5 days = 36 hours
        assert_eq!(format_number(1.5, "[h]:mm:ss"), "36:00:00");
    }

    #[test]
    fn test_elapsed_hours_partial() {
        // 0.0625 days = 1.5 hours = 1:30:00
        assert_eq!(format_number(0.0625, "[h]:mm:ss"), "1:30:00");
    }

    #[test]
    fn test_elapsed_minutes_total() {
        // 0.5 days = 720 minutes
        assert_eq!(format_number(0.5, "[mm]:ss"), "720:00");
    }

    #[test]
    fn test_elapsed_seconds_total() {
        // 0.5 days = 43200 seconds
        assert_eq!(format_number(0.5, "[ss]"), "43200");
    }

    // -----------------------------------------------------------------------
    // FIX 5: Large number overflow guard
    // -----------------------------------------------------------------------

    #[test]
    fn test_large_number_overflow_guard() {
        // 1e20 exceeds u64::MAX (1.8e19) — should not panic and should produce
        // scientific notation as fallback
        let result = format_number(1e20, "0.00");
        assert!(
            !result.is_empty(),
            "large number formatting should not panic"
        );
        assert!(
            result.contains('E'),
            "should fallback to scientific: {}",
            result
        );
    }

    // -----------------------------------------------------------------------
    // FIX 6: Serial 0 date formatting matches Excel (Dec 30, 1899)
    // -----------------------------------------------------------------------

    #[test]
    fn test_serial_zero_date_format() {
        // TEXT(0, "yyyymmdd") — Excel's serial 0 is "January 0, 1900"
        assert_eq!(format_number(0.0, "yyyymmdd"), "19000100");
    }

    #[test]
    fn test_serial_zero_date_parts() {
        let (y, m, d, _, _, _) = serial_to_datetime_parts(0.0);
        assert_eq!(y, 1900);
        assert_eq!(m, 1);
        assert_eq!(d, 0);
    }

    // -----------------------------------------------------------------------
    // Locale-aware formatting tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_locale_decimal_separator() {
        let german = CultureInfo {
            decimal_separator: ",".into(),
            thousands_separator: ".".into(),
            ..CultureInfo::default()
        };
        assert_eq!(
            format_number_with_locale(1234.5, "#,##0.00", &german),
            "1.234,50"
        );
    }

    #[test]
    fn test_locale_thousands_separator() {
        let german = CultureInfo {
            decimal_separator: ",".into(),
            thousands_separator: ".".into(),
            ..CultureInfo::default()
        };
        assert_eq!(
            format_number_with_locale(1234567.0, "#,##0", &german),
            "1.234.567"
        );
    }

    #[test]
    fn test_locale_scientific_decimal() {
        let german = CultureInfo {
            decimal_separator: ",".into(),
            ..CultureInfo::default()
        };
        assert_eq!(
            format_number_with_locale(1234567.0, "0.00E+00", &german),
            "1,23E+06"
        );
    }

    #[test]
    fn test_locale_month_names() {
        let spanish = CultureInfo {
            month_names: [
                "Enero".to_string(),
                "Febrero".to_string(),
                "Marzo".to_string(),
                "Abril".to_string(),
                "Mayo".to_string(),
                "Junio".to_string(),
                "Julio".to_string(),
                "Agosto".to_string(),
                "Septiembre".to_string(),
                "Octubre".to_string(),
                "Noviembre".to_string(),
                "Diciembre".to_string(),
            ],
            abbreviated_month_names: [
                "Ene".to_string(),
                "Feb".to_string(),
                "Mar".to_string(),
                "Abr".to_string(),
                "May".to_string(),
                "Jun".to_string(),
                "Jul".to_string(),
                "Ago".to_string(),
                "Sep".to_string(),
                "Oct".to_string(),
                "Nov".to_string(),
                "Dic".to_string(),
            ],
            ..CultureInfo::default()
        };
        let serial = date_to_serial(2024, 3, 15);
        assert_eq!(
            format_number_with_locale(serial, "mmmm d, yyyy", &spanish),
            "Marzo 15, 2024"
        );
        assert_eq!(
            format_number_with_locale(serial, "dd-mmm-yyyy", &spanish),
            "15-Mar-2024"
        );
    }

    #[test]
    fn test_locale_am_pm() {
        let japanese = CultureInfo {
            am_designator: "\u{5348}\u{524d}".to_string(),
            pm_designator: "\u{5348}\u{5f8c}".to_string(),
            ..CultureInfo::default()
        };
        assert_eq!(
            format_number_with_locale(0.25, "h:mm AM/PM", &japanese),
            "6:00 \u{5348}\u{524d}"
        );
        assert_eq!(
            format_number_with_locale(0.75, "h:mm AM/PM", &japanese),
            "6:00 \u{5348}\u{5f8c}"
        );
    }

    // -----------------------------------------------------------------------
    // format_number_result tests (color extraction)
    // -----------------------------------------------------------------------

    #[test]
    fn test_format_number_result_no_color() {
        let r = format_number_result(1234.5, "#,##0.00", &CultureInfo::default());
        assert_eq!(r.text, "1,234.50");
        assert_eq!(r.color, None);
        assert!(!r.is_error);
    }

    #[test]
    fn test_format_number_result_red_color() {
        let r = format_number_result(42.5, "[Red]0.00", &CultureInfo::default());
        assert_eq!(r.text, "42.50");
        assert_eq!(r.color, Some(FormatColor::Red));
    }

    #[test]
    fn test_format_number_result_negative_with_color() {
        // 2-section: positive;[Red]negative
        let r = format_number_result(-1234.0, "#,##0;[Red](#,##0)", &CultureInfo::default());
        assert_eq!(r.text, "(1,234)");
        assert_eq!(r.color, Some(FormatColor::Red));
    }

    // -----------------------------------------------------------------------
    // format_value tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_format_value_number() {
        let val = value_types::CellValue::Number(value_types::FiniteF64::new(1234.5).unwrap());
        let r = format_value(&val, "#,##0.00", &CultureInfo::default());
        assert_eq!(r.text, "1,234.50");
        assert!(!r.is_error);
    }

    #[test]
    fn test_format_value_text() {
        let val = value_types::CellValue::Text("hello".into());
        let r = format_value(&val, "@", &CultureInfo::default());
        assert_eq!(r.text, "hello");
    }

    #[test]
    fn test_format_value_boolean() {
        let val_t = value_types::CellValue::Boolean(true);
        let val_f = value_types::CellValue::Boolean(false);
        assert_eq!(
            format_value(&val_t, "", &CultureInfo::default()).text,
            "TRUE"
        );
        assert_eq!(
            format_value(&val_f, "", &CultureInfo::default()).text,
            "FALSE"
        );
    }

    #[test]
    fn test_format_value_null() {
        let val = value_types::CellValue::Null;
        assert_eq!(
            format_value(&val, "#,##0", &CultureInfo::default()).text,
            ""
        );
    }

    #[test]
    fn test_format_value_error() {
        let val = value_types::CellValue::Error(value_types::CellError::Value, None);
        let r = format_value(&val, "", &CultureInfo::default());
        assert!(r.is_error);
        assert!(r.text.contains("VALUE"));
    }
}
