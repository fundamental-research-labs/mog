//! Public formatting facade implementation.

use crate::color::FormatColor;
use crate::datetime::format_datetime;
use crate::format_result::FormatResult;
use crate::fraction::format_fraction;
use crate::general::format_general;
use crate::locale::CultureInfo;
use crate::number::{apply_text_section, emit_literals, format_numeric, select_section};
use crate::parser::parse_format_code;
use crate::types::Token;

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
        .and_then(|name| FormatColor::from_name(name));

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
        apply_text_section(&parsed.sections[3], text)
    } else if parsed.sections.len() == 1
        && parsed.sections[0]
            .tokens
            .iter()
            .any(|t| matches!(t, Token::TextPlaceholder))
    {
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
