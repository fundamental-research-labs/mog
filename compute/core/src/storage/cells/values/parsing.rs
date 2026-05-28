use crate::snapshot::{AutomaticConversionCategory, AutomaticConversionPolicy};
use compute_formats::FormatType;
use value_types::CellError;

// ---------------------------------------------------------------------------
// ParsedValue enum
// ---------------------------------------------------------------------------

/// Result of parsing a raw cell input string.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ParsedValue {
    /// Empty input (whitespace-only or zero-length).
    Empty,
    /// Parsed as a number (including dates converted to Excel serial).
    Number(f64),
    /// Parsed as a boolean (TRUE/FALSE, case-insensitive).
    Boolean(bool),
    /// Parsed as an Excel-compatible cell error literal.
    Error(CellError),
    /// Not coercible — store as literal text.
    Text(String),
}

/// Resolved context for policy-governed user parsing.
#[derive(Debug, Clone)]
pub(crate) struct InputParseContext {
    pub(crate) target: Option<FormatType>,
    pub(crate) policy: AutomaticConversionPolicy,
    pub(crate) culture: String,
    pub(crate) date1904: bool,
}

impl InputParseContext {
    pub(crate) fn default_for_target(target: Option<FormatType>) -> Self {
        Self {
            target,
            policy: AutomaticConversionPolicy::default(),
            culture: "en-US".to_string(),
            date1904: false,
        }
    }
}

/// Result of policy-aware input parsing.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ParsedInputValue {
    pub(crate) value: ParsedValue,
    pub(crate) preserved_category: Option<AutomaticConversionCategory>,
}

// ===========================================================================
// Pure Parsing Functions (no Yrs access)
// ===========================================================================

/// Parse a raw input string to determine its type.
///
/// Parsing order (matching the TypeScript implementation):
/// 1. Empty string -> `ParsedValue::Empty`
/// 2. Excel error literal -> `ParsedValue::Error`
/// 3. Boolean ("TRUE"/"FALSE", case-insensitive) -> `ParsedValue::Boolean`
/// 4. Date strings (US, ISO, D-MMM-YYYY, MMM D YYYY) -> `ParsedValue::Number` (Excel serial)
/// 5. Plain numbers (e.g., "42", "-3.14", "0.5") -> `ParsedValue::Number`
///    — G1 (percent hint) divides by 100 on this branch only.
/// 6. Formatted numbers ($500, 50%, 1,234.56) -> `ParsedValue::Number`
/// 7. Fraction (`"n/d"`) when `target == Some(Fraction)` (G3) -> `ParsedValue::Number`
/// 8. Everything else -> `ParsedValue::Text`
///
/// `target` is the cell's effective number-format category. Hint-aware
/// branches:
///   - G1 (bare-number): percent target divides by 100.
///   - G3 (fallthrough fraction): `Some(Fraction)` lets `"n/d"` parse as
///     a value rather than text.
///   - Date branch: an explicit non-date target (Number, Currency,
///     Accounting, Percentage, Fraction, Scientific, Special) suppresses
///     date coercion so date-shaped input lands as text — Excel parity
///     for "format-aware text fallback." `None`, `General`, `Date`,
///     `Time`, and `Custom` keep the loose behavior (Custom is the "we
///     don't know what you mean" bucket and stays permissive).
///
/// The boolean and formatted-number branches remain format-blind by
/// design.
pub(crate) fn parse_input_value(input: &str, target: Option<FormatType>) -> ParsedValue {
    parse_input_value_with_context(input, &InputParseContext::default_for_target(target)).value
}

pub(crate) fn parse_input_value_with_context(
    input: &str,
    context: &InputParseContext,
) -> ParsedInputValue {
    let trimmed = input.trim();

    // 1. Empty
    if trimmed.is_empty() {
        return ParsedInputValue {
            value: ParsedValue::Empty,
            preserved_category: None,
        };
    }

    if let Some(error) = CellError::parse_error_str(trimmed) {
        return parsed(ParsedValue::Error(error));
    }

    // 3. Boolean — hint NOT consulted; G2 (text-format) is enforced upstream
    //    in `CellWrite::from_user_string` so a Text-formatted cell never
    //    reaches this function.
    if trimmed.eq_ignore_ascii_case("TRUE") {
        return parsed(ParsedValue::Boolean(true));
    }
    if trimmed.eq_ignore_ascii_case("FALSE") {
        return parsed(ParsedValue::Boolean(false));
    }

    // 3. Date string (check before plain number to handle date formats).
    //    Hint-aware: an explicit non-date target format (Number, Currency,
    //    Accounting, Percentage, Fraction, Scientific, Special) suppresses
    //    date coercion so the input falls through to text — Excel parity
    //    for "format-aware text fallback." `None`, `General`, `Date`,
    //    `Time`, and `Custom` keep the permissive behavior. (`Text` never
    //    reaches this function — `CellWrite::from_user_string` short-
    //    circuits text-formatted cells before parse runs.) Regression-
    //    guarded by
    //    `parse_input_value_percent_hint_date_input_falls_through_to_text`
    //    and the `parse_input_value_<X>_hint_date_shaped_*` siblings.
    let date_branch_enabled = match context.target {
        None
        | Some(FormatType::General)
        | Some(FormatType::Date)
        | Some(FormatType::Time)
        | Some(FormatType::Custom) => true,
        Some(FormatType::Number)
        | Some(FormatType::Currency)
        | Some(FormatType::Accounting)
        | Some(FormatType::Percentage)
        | Some(FormatType::Fraction)
        | Some(FormatType::Scientific)
        | Some(FormatType::Special) => false,
        // `Text` is short-circuited upstream; defensive arm only.
        _ => false,
    };
    if date_branch_enabled && let Some(serial) = parse_date_string_with_context(trimmed, context) {
        if !context.policy.convert_date_like_text {
            return preserved(input, AutomaticConversionCategory::DateLikeText);
        }
        return parsed(ParsedValue::Number(serial));
    }

    if time_branch_enabled(context.target)
        && let Some(serial) = parse_time_string(trimmed, &context.culture)
    {
        if !context.policy.convert_time_like_text {
            return preserved(input, AutomaticConversionCategory::TimeLikeText);
        }
        return parsed(ParsedValue::Number(serial));
    }

    if matches!(context.target, Some(FormatType::Fraction))
        && let Some(n) = parse_simple_fraction(trimmed)
    {
        if !context.policy.convert_fraction_like_text {
            return preserved(input, AutomaticConversionCategory::FractionLikeText);
        }
        return parsed(ParsedValue::Number(n));
    }

    if is_scientific_notation(trimmed)
        && let Ok(num) = trimmed.parse::<f64>()
        && num.is_finite()
    {
        if !context.policy.convert_scientific_notation {
            return preserved(input, AutomaticConversionCategory::ScientificNotation);
        }
        return parsed(ParsedValue::Number(num));
    }

    if is_long_digit_number(trimmed)
        && is_plain_number(trimmed)
        && !context.policy.convert_long_digit_numbers
    {
        return preserved(input, AutomaticConversionCategory::LongDigitNumber);
    }

    if is_leading_zero_number(trimmed)
        && is_plain_number(trimmed)
        && !context.policy.convert_leading_zero_numbers
    {
        return preserved(input, AutomaticConversionCategory::LeadingZeroNumber);
    }

    // 4. Plain number — G1 lives HERE, on the bare-number branch only.
    //    `is_plain_number` rejects `%`, currency, thousands separators, and
    //    parens — so the percent-format hint divides only the case where
    //    the user typed a bare number into a percent cell ("11" → 0.11).
    //    Inputs like "$100" or "50%" reach the formatted-number branch (#5)
    //    where the hint is NOT consulted (locked in by pass 1 regression
    //    tests).
    if is_plain_number(trimmed)
        && let Ok(num) = trimmed.parse::<f64>()
        && num.is_finite()
    {
        let n = match context.target {
            Some(FormatType::Percentage) => num / 100.0,
            _ => num,
        };
        return parsed(ParsedValue::Number(n));
    }

    // 5. Formatted number (currency, percentage, thousands separators).
    //    Hint NOT consulted: `parse_formatted_number` already divides on the
    //    `%` suffix; double-dividing would corrupt `"50%"` → `0.005`.
    if let Some(num) = parse_formatted_number(trimmed) {
        if has_percent_suffix(trimmed) && !context.policy.convert_percent_suffix {
            return preserved(input, AutomaticConversionCategory::PercentSuffix);
        }
        if has_currency_symbol(trimmed, &context.culture) && !context.policy.convert_currency_symbol
        {
            return preserved(input, AutomaticConversionCategory::CurrencySymbol);
        }
        if is_formatted_number_token(trimmed) && !context.policy.convert_formatted_numbers {
            return preserved(input, AutomaticConversionCategory::FormattedNumber);
        }
        return parsed(ParsedValue::Number(num));
    }

    // 7. Everything else is text (return original input, not trimmed)
    parsed(ParsedValue::Text(input.to_string()))
}

fn parsed(value: ParsedValue) -> ParsedInputValue {
    ParsedInputValue {
        value,
        preserved_category: None,
    }
}

fn preserved(input: &str, category: AutomaticConversionCategory) -> ParsedInputValue {
    ParsedInputValue {
        value: ParsedValue::Text(input.to_string()),
        preserved_category: Some(category),
    }
}

/// Parse a bare `"n/d"` fraction into an `f64`. Returns `None` for inputs
/// that aren't `<integer>/<integer>` with a non-zero denominator.
///
/// Mixed-number form (`"1 1/2"` → 1.5) is intentionally **not** supported —
/// it's a sibling of G3 deferred until a user-visible bug surfaces it. See
/// the parser's scope.
fn parse_simple_fraction(s: &str) -> Option<f64> {
    let (n_str, d_str) = s.split_once('/')?;
    let n: i64 = n_str.trim().parse().ok()?;
    let d: i64 = d_str.trim().parse().ok()?;
    if d == 0 {
        return None;
    }
    let result = (n as f64) / (d as f64);
    if result.is_finite() {
        Some(result)
    } else {
        None
    }
}

/// Check if a string matches the plain number pattern: /^-?\d*\.?\d+$/
pub(super) fn is_plain_number(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return false;
    }

    let mut i = 0;

    // Optional leading minus
    if bytes[i] == b'-' {
        i += 1;
        if i >= bytes.len() {
            return false;
        }
    }

    // Must have at least one digit somewhere
    let mut has_digit = false;
    let mut has_dot = false;

    // Digits before optional dot
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        has_digit = true;
        i += 1;
    }

    // Optional dot
    if i < bytes.len() && bytes[i] == b'.' {
        has_dot = true;
        i += 1;
    }

    // Digits after dot (required if dot present, or if no digits before)
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        has_digit = true;
        i += 1;
    }

    // Must consume entire string and have at least one digit
    // If dot is present, must have digits after it (to match /^-?\d*\.?\d+$/)
    if !has_digit {
        return false;
    }
    if has_dot {
        // /^-?\d*\.?\d+$/ requires digits after the optional dot position
        // Actually the regex says \d+ after \.? which means digits are required at end
        // Check: if dot is last char, no trailing digits -> fail
        let last = bytes[bytes.len() - 1];
        if !last.is_ascii_digit() {
            return false;
        }
    }

    i == bytes.len()
}

/// Parse a string that might be a formatted number.
///
/// Handles:
/// - Currency symbols: $ EUR £ ¥ ₹ ₽ ¢
/// - Percentages: 50% -> 0.5
/// - Thousands separators: 1,234.56 (US) and 1.234,56 (European)
/// - Accounting negatives: (500) -> -500
///
/// Returns `Some(f64)` if parseable, `None` otherwise.
pub(super) fn parse_formatted_number(value: &str) -> Option<f64> {
    let mut s = value.trim().to_string();
    if s.is_empty() {
        return None;
    }

    // Quick check: must start with digit, currency symbol, minus, or paren
    let first = s.chars().next()?;
    if !matches!(
        first,
        '0'..='9'
            | '-'
            | '('
            | '$'
            | '\u{20AC}'
            | '\u{00A3}'
            | '\u{00A5}'
            | '\u{20B9}'
            | '\u{20BD}'
            | '\u{00A2}'
    ) {
        return None;
    }

    // Check for negative in parentheses: (500) -> -500
    let mut is_negative = false;
    if s.starts_with('(') && s.ends_with(')') {
        is_negative = true;
        // starts_with('(') + ends_with(')') guarantees both edges are
        // single-byte ASCII; `[1..len-1]` is at char boundaries.
        #[allow(clippy::string_slice)]
        let inner = s[1..s.len() - 1].trim().to_string();
        s = inner;
    }

    // Remove currency symbols
    s = remove_currency_symbols(&s).trim().to_string();

    // If nothing left that looks numeric, bail
    if !s.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }

    // Check for explicit negative sign
    if s.starts_with('-') {
        is_negative = !is_negative; // Handle double negative like "(-500)"
        // starts_with('-') guarantees byte 0 is single-byte ASCII '-'.
        #[allow(clippy::string_slice)]
        let rest = s[1..].trim().to_string();
        s = rest;
    }

    // Handle percentage
    let mut is_percent = false;
    if s.ends_with('%') {
        is_percent = true;
        // ends_with('%') guarantees the last byte is single-byte ASCII '%'.
        #[allow(clippy::string_slice)]
        let head = s[..s.len() - 1].trim().to_string();
        s = head;
    }

    // Handle thousands separators
    if s.contains('.') && s.contains(',') {
        let last_comma = s.rfind(',').unwrap();
        let last_period = s.rfind('.').unwrap();
        if last_period > last_comma {
            // US format: 1,234.56
            s = s.replace(',', "");
        } else {
            // European format: 1.234,56
            s = s.replace('.', "").replace(',', ".");
        }
    } else if s.contains(',') {
        // Only comma — determine if thousands or decimal
        if has_thousands_comma(&s) {
            s = s.replace(',', "");
        } else if has_european_decimal(&s) {
            s = s.replace(',', ".");
        } else {
            // Multiple commas like 1,234,567
            s = s.replace(',', "");
        }
    }

    // Parse as number
    let num: f64 = s.parse().ok()?;
    if !num.is_finite() {
        return None;
    }

    let mut result = if is_negative { -num } else { num };
    if is_percent {
        result /= 100.0;
    }

    Some(result)
}

/// Remove currency symbols from a string.
fn remove_currency_symbols(s: &str) -> String {
    s.chars()
        .filter(|c| {
            !matches!(
                c,
                '$' | '\u{20AC}' | '\u{00A3}' | '\u{00A5}' | '\u{20B9}' | '\u{20BD}' | '\u{00A2}'
            )
        })
        .collect()
}

/// Check if comma is a thousands separator: followed by exactly 3 digits at end.
fn has_thousands_comma(s: &str) -> bool {
    // Pattern: ,\d{3}$
    let bytes = s.as_bytes();
    if bytes.len() < 4 {
        return false;
    }
    let n = bytes.len();
    bytes[n - 4] == b','
        && bytes[n - 3].is_ascii_digit()
        && bytes[n - 2].is_ascii_digit()
        && bytes[n - 1].is_ascii_digit()
}

/// Check if comma is a European decimal: followed by 1-2 digits at end.
fn has_european_decimal(s: &str) -> bool {
    // Pattern: ,\d{1,2}$
    let bytes = s.as_bytes();
    if bytes.len() < 2 {
        return false;
    }
    let n = bytes.len();
    // Check ,D$ (1 decimal digit)
    if n >= 2 && bytes[n - 2] == b',' && bytes[n - 1].is_ascii_digit() {
        return true;
    }
    // Check ,DD$ (2 decimal digits)
    if n >= 3
        && bytes[n - 3] == b','
        && bytes[n - 2].is_ascii_digit()
        && bytes[n - 1].is_ascii_digit()
    {
        // But NOT if ,DDD (3 digits = thousands)
        return true;
    }
    false
}

/// Month name abbreviations for date parsing.
const MONTH_NAMES: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

/// Parse a string that might be a date into an Excel serial number.
///
/// Supported formats:
/// - M/D/YYYY or MM/DD/YYYY (US short date, e.g., "3/31/2016")
/// - YYYY-MM-DD (ISO format, e.g., "2016-03-31")
/// - D-MMM-YYYY or DD-MMM-YYYY (e.g., "31-Mar-2016")
/// - MMM D, YYYY (e.g., "Mar 31, 2016")
///
/// Returns `Some(serial)` for valid dates, `None` otherwise.
pub(super) fn parse_date_string(value: &str) -> Option<f64> {
    if value.is_empty() {
        return None;
    }

    // Quick filter: must contain digits and either / or - or ,
    let has_digit = value.chars().any(|c| c.is_ascii_digit());
    let has_sep = value.contains('/') || value.contains('-') || value.contains(',');
    if !has_digit || !has_sep {
        return None;
    }

    let (year, month, day) = try_parse_us_date(value)
        .or_else(|| try_parse_iso_date(value))
        .or_else(|| try_parse_dmmy_date(value))
        .or_else(|| try_parse_mmmd_date(value))?;

    // Validate ranges
    if !(1900..=2200).contains(&year) {
        return None;
    }
    if !(1..=12).contains(&month) {
        return None;
    }
    if !(1..=31).contains(&day) {
        return None;
    }

    // Validate actual date validity using days_in_month
    let dim = crate::functions::helpers::date_serial::days_in_month(year, month)?;
    if day > dim {
        return None;
    }

    // Convert to Excel serial
    let serial = crate::functions::helpers::date_serial::ymd_to_serial(year, month, day);
    if serial.is_finite() && serial >= 1.0 {
        Some(serial)
    } else {
        None
    }
}

fn parse_date_string_with_context(value: &str, context: &InputParseContext) -> Option<f64> {
    let culture = compute_formats::get_culture(&context.culture);
    let serial = compute_formats::parse_date_input(value, &culture)
        .map(|parsed| parsed.serial)
        .or_else(|| parse_date_string(value))?;
    if context.date1904 {
        Some(serial - 1462.0)
    } else {
        Some(serial)
    }
}

fn time_branch_enabled(target: Option<FormatType>) -> bool {
    matches!(
        target,
        None | Some(FormatType::General) | Some(FormatType::Time) | Some(FormatType::Custom)
    )
}

pub(crate) fn parse_time_string(value: &str, culture: &str) -> Option<f64> {
    let locale = compute_formats::get_culture(culture);
    let trimmed = value.trim();
    let lower = trimmed.to_ascii_lowercase();
    let am = locale.am_designator.to_ascii_lowercase();
    let pm = locale.pm_designator.to_ascii_lowercase();
    let (body, meridiem) = if !am.is_empty() && lower.ends_with(&am) {
        let end = trimmed.len().saturating_sub(locale.am_designator.len());
        (trimmed.get(..end)?.trim(), Some(false))
    } else if !pm.is_empty() && lower.ends_with(&pm) {
        let end = trimmed.len().saturating_sub(locale.pm_designator.len());
        (trimmed.get(..end)?.trim(), Some(true))
    } else if lower.ends_with("am") {
        let end = trimmed.len().saturating_sub(2);
        (trimmed.get(..end)?.trim(), Some(false))
    } else if lower.ends_with("pm") {
        let end = trimmed.len().saturating_sub(2);
        (trimmed.get(..end)?.trim(), Some(true))
    } else {
        (trimmed, None)
    };
    let parts: Vec<&str> = body.split(':').collect();
    if !(2..=3).contains(&parts.len()) {
        return None;
    }
    let mut hours: u32 = parts[0].parse().ok()?;
    let minutes: u32 = parts[1].parse().ok()?;
    let seconds: u32 = if parts.len() == 3 {
        parts[2].parse().ok()?
    } else {
        0
    };
    if minutes > 59 || seconds > 59 {
        return None;
    }
    if let Some(is_pm) = meridiem {
        if hours == 0 || hours > 12 {
            return None;
        }
        if is_pm && hours < 12 {
            hours += 12;
        } else if !is_pm && hours == 12 {
            hours = 0;
        }
    } else if hours > 23 {
        return None;
    }
    Some(compute_formats::prepare_time_value(hours, minutes, seconds, None).serial)
}

fn is_scientific_notation(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    let Some((mantissa, exponent)) = lower.split_once('e') else {
        return false;
    };
    !mantissa.is_empty()
        && !exponent.is_empty()
        && is_plain_number(mantissa)
        && exponent
            .strip_prefix('-')
            .or_else(|| exponent.strip_prefix('+'))
            .unwrap_or(exponent)
            .chars()
            .all(|c| c.is_ascii_digit())
}

fn is_long_digit_number(s: &str) -> bool {
    let digits = s.strip_prefix('-').unwrap_or(s);
    digits.len() >= 16 && digits.chars().all(|c| c.is_ascii_digit())
}

fn is_leading_zero_number(s: &str) -> bool {
    let digits = s.strip_prefix('-').unwrap_or(s);
    digits.len() >= 2
        && digits.starts_with('0')
        && digits.chars().all(|c| c.is_ascii_digit())
        && digits.chars().any(|c| c != '0')
}

fn has_percent_suffix(s: &str) -> bool {
    s.trim_end().ends_with('%')
}

fn has_currency_symbol(s: &str, culture: &str) -> bool {
    let locale = compute_formats::get_culture(culture);
    let symbols = [
        "$", "\u{20AC}", "\u{00A3}", "\u{00A5}", "\u{20B9}", "\u{20BD}", "\u{00A2}",
    ];
    symbols.iter().any(|symbol| s.contains(symbol))
        || (!locale.currency_symbol.is_empty() && s.contains(&locale.currency_symbol))
}

fn is_formatted_number_token(s: &str) -> bool {
    s.contains(',') || (s.starts_with('(') && s.ends_with(')'))
}

/// Try parsing as M/D/YYYY or MM/DD/YYYY.
fn try_parse_us_date(value: &str) -> Option<(i32, i32, i32)> {
    let parts: Vec<&str> = value.split('/').collect();
    if parts.len() != 3 {
        return None;
    }
    let m: i32 = parts[0].parse().ok()?;
    let d: i32 = parts[1].parse().ok()?;
    let y: i32 = parts[2].parse().ok()?;
    // Year must be 4 digits
    if parts[2].len() != 4 {
        return None;
    }
    Some((y, m, d))
}

/// Try parsing as YYYY-MM-DD.
fn try_parse_iso_date(value: &str) -> Option<(i32, i32, i32)> {
    let parts: Vec<&str> = value.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    // First part must be 4 digits (year)
    if parts[0].len() != 4 {
        return None;
    }
    let y: i32 = parts[0].parse().ok()?;
    let m: i32 = parts[1].parse().ok()?;
    let d: i32 = parts[2].parse().ok()?;
    Some((y, m, d))
}

/// Try parsing as D-MMM-YYYY or DD-MMM-YYYY (e.g., "31-Mar-2016").
fn try_parse_dmmy_date(value: &str) -> Option<(i32, i32, i32)> {
    let parts: Vec<&str> = value.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let d: i32 = parts[0].parse().ok()?;
    let month_str = parts[1].to_ascii_lowercase();
    let month_idx = MONTH_NAMES.iter().position(|&m| m == month_str)?;
    let m = (month_idx + 1) as i32;
    if parts[2].len() != 4 {
        return None;
    }
    let y: i32 = parts[2].parse().ok()?;
    Some((y, m, d))
}

/// Try parsing as MMM D, YYYY (e.g., "Mar 31, 2016").
fn try_parse_mmmd_date(value: &str) -> Option<(i32, i32, i32)> {
    // Split on whitespace first
    let trimmed = value.trim();
    // Expected: "MMM D, YYYY" or "MMM DD, YYYY"
    let space1 = trimmed.find(' ')?;
    // space1 from find(' ') — ASCII space is a single UTF-8 byte.
    #[allow(clippy::string_slice)]
    let month_str = &trimmed[..space1];
    if month_str.len() != 3 {
        return None;
    }
    #[allow(clippy::string_slice)] // space1 + 1 is a char boundary (ASCII ' ').
    let rest = trimmed[space1 + 1..].trim();
    // Rest should be "D, YYYY" or "DD, YYYY"
    let comma_pos = rest.find(',')?;
    #[allow(clippy::string_slice)] // comma_pos from find(',') — ASCII comma.
    let day_str = &rest[..comma_pos];
    #[allow(clippy::string_slice)] // comma_pos + 1 is a char boundary (ASCII ',').
    let year_str = rest[comma_pos + 1..].trim();

    let month_lower = month_str.to_ascii_lowercase();
    let month_idx = MONTH_NAMES.iter().position(|&m| m == month_lower)?;
    let m = (month_idx + 1) as i32;
    let d: i32 = day_str.trim().parse().ok()?;
    if year_str.len() != 4 {
        return None;
    }
    let y: i32 = year_str.parse().ok()?;
    Some((y, m, d))
}
