//! Cell Values Module — higher-level cell value operations on YrsStorage.
//!
//! Port of `spreadsheet-model/src/cells/cell-values.ts` (1,312 LOC).
//!
//! # Responsibilities
//!
//! - **Pure parsing functions**: `parse_input_value`, `parse_formatted_number`,
//!   `parse_date_string` — no Yrs access needed, highly testable.
//!   (The `is_formula` shadow check was retired in typed formula boundary — every
//!   user-typed cell input is now classified at the scheduler boundary via
//!   [`crate::scheduler::input::CellWrite::from_user_string`].)
//! - **Cell write dispatcher**: [`set_cell_value`] and [`set_cell_values`]
//!   are the sole entry points for cell writes. Both take a typed
//!   [`CellInput`] expressing caller intent (Clear / Literal / Parse) and
//!   dispatch into narrow leaf helpers (`yrs_remove_cell`, `yrs_store_text`,
//!   `yrs_store_formula`, `yrs_store_typed`) whose signatures cannot be
//!   handed the wrong shape of data.
//! - **Read operations** (free functions): `import_values`, `get_cell_data`,
//!   `get_display_value`, `get_raw_value`, `get_effective_value`, `get_cell_count`.
//!
//! # Design
//!
//! Parsing functions are **pure** — they take string input and return parsed values
//! without touching the Yrs document. This makes them easy to test in isolation.
//!
//! The free functions build on top of the low-level `set_cell()`,
//! `get_cell_value_at()`, `read_cell_from_yrs()` from `storage/mod.rs`, adding
//! input parsing, grid index management, and display formatting.

use std::sync::Arc;

use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Any, Array, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::mirror::{CellMirror, SheetMirror};
use crate::scheduler::input::CellWrite;
use crate::snapshot::{AutomaticConversionCategory, AutomaticConversionPolicy};
use crate::storage::engine::mutation::CellInput;
use cell_types::{CellId, SheetId};
use compute_document::cell_serde::{cell_value_to_any, yrs_any_to_cell_value};
use compute_document::hex::id_to_hex;
use compute_document::schema::{KEY_CELLS, KEY_FORMULA, KEY_GRID_INDEX, KEY_VALUE};
use compute_formats::FormatType;
use compute_parser::FormulaSource;
use value_types::CellValue;

// ---------------------------------------------------------------------------
// yrs-side identity sub-map writes (gridIndex/{posToId, idToPos})
// ---------------------------------------------------------------------------
//
// GridIndex migration designated `gridIndex/{posToId, idToPos}` as the authoritative
// yrs-side identity store, but the value-write paths
// (`set_cell_value`, `set_cell_values`, `import_values`, `set_cell`) were
// only writing identity into the in-memory `GridIndex`. Undo/redo (and
// structural-rebuild via `build_sheet_snapshot_from_yrs`) need to recover
// a cell's (row, col) from yrs after the in-memory GridIndex has been
// cleared — the read-side fallback `read_cell_position_from_yrs` returns
// `None` unless the yrs sub-maps were populated at write time.
//
// These helpers mirror the writes performed by the hydration paths in
// `storage/infra/hydration/{snapshot,sheet}.rs` so every cell write into
// yrs also carries its position mapping.

/// Write `(cell_hex → "rowHex:colHex")` into `gridIndex/idToPos` and the
/// reverse mapping into `gridIndex/posToId` for a single cell.
///
/// No-op if the sheet map or the gridIndex sub-map is missing (the schema
/// guarantees they exist on every well-formed doc, but defensive callers
/// tolerate partial state).
pub(crate) fn write_cell_position_to_yrs(
    txn: &mut yrs::TransactionMut<'_>,
    sheets: &MapRef,
    sheet_hex: &str,
    cell_hex: &str,
    row_hex: &str,
    col_hex: &str,
) {
    let Some(Out::YMap(sheet_map)) = sheets.get(txn, sheet_hex) else {
        return;
    };
    let Some(Out::YMap(gi_map)) = sheet_map.get(txn, KEY_GRID_INDEX) else {
        return;
    };
    let pos_key = format!("{}:{}", row_hex, col_hex);
    if let Some(Out::YMap(pos_to_id)) = gi_map.get(txn, "posToId") {
        pos_to_id.insert(txn, pos_key.as_str(), Any::String(Arc::from(cell_hex)));
    }
    if let Some(Out::YMap(id_to_pos)) = gi_map.get(txn, "idToPos") {
        id_to_pos.insert(txn, cell_hex, Any::String(Arc::from(pos_key.as_str())));
    }
}

/// Remove the identity mapping for a cell from `gridIndex/{posToId, idToPos}`.
pub(crate) fn remove_cell_position_from_yrs(
    txn: &mut yrs::TransactionMut<'_>,
    sheets: &MapRef,
    sheet_hex: &str,
    cell_hex: &str,
) {
    let Some(Out::YMap(sheet_map)) = sheets.get(txn, sheet_hex) else {
        return;
    };
    let Some(Out::YMap(gi_map)) = sheet_map.get(txn, KEY_GRID_INDEX) else {
        return;
    };
    // Read the existing pos_key before removing so we can also drop the
    // reverse posToId entry.
    let pos_key = match gi_map.get(txn, "idToPos") {
        Some(Out::YMap(id_to_pos)) => match id_to_pos.get(txn, cell_hex) {
            Some(Out::Any(Any::String(s))) => {
                let k = s.to_string();
                id_to_pos.remove(txn, cell_hex);
                Some(k)
            }
            _ => None,
        },
        _ => None,
    };
    if let Some(pos_key) = pos_key
        && let Some(Out::YMap(pos_to_id)) = gi_map.get(txn, "posToId")
    {
        pos_to_id.remove(txn, pos_key.as_str());
    }
}

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

// ---------------------------------------------------------------------------
// CellData struct
// ---------------------------------------------------------------------------

/// Full cell data as returned by `get_cell_data` / `get_cell_data_by_id`.
#[derive(Debug, Clone)]
pub struct CellData {
    /// Stable cell identity.
    pub cell_id: CellId,
    /// Zero-based row.
    pub row: u32,
    /// Zero-based column.
    pub col: u32,
    /// Raw value stored in the cell (before formula evaluation).
    pub raw: Option<CellValue>,
    /// Computed value (from formula evaluation), if this is a formula cell.
    pub computed: Option<CellValue>,
    /// Formula string (without leading '='), if this is a formula cell.
    pub formula: Option<String>,
    /// Hyperlink URL, if set.
    pub hyperlink: Option<String>,
    /// Cell note/comment, if set.
    pub note: Option<String>,
}

// ===========================================================================
// Pure Parsing Functions (no Yrs access)
// ===========================================================================

/// Parse a raw input string to determine its type.
///
/// Parsing order (matching the TypeScript implementation):
/// 1. Empty string -> `ParsedValue::Empty`
/// 2. Boolean ("TRUE"/"FALSE", case-insensitive) -> `ParsedValue::Boolean`
/// 3. Date strings (US, ISO, D-MMM-YYYY, MMM D YYYY) -> `ParsedValue::Number` (Excel serial)
/// 4. Plain numbers (e.g., "42", "-3.14", "0.5") -> `ParsedValue::Number`
///    — G1 (percent hint) divides by 100 on this branch only.
/// 5. Formatted numbers ($500, 50%, 1,234.56) -> `ParsedValue::Number`
/// 6. Fraction (`"n/d"`) when `target == Some(Fraction)` (G3) -> `ParsedValue::Number`
/// 7. Everything else -> `ParsedValue::Text`
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

    // 2. Boolean — hint NOT consulted; G2 (text-format) is enforced upstream
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
fn is_plain_number(s: &str) -> bool {
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
fn parse_formatted_number(value: &str) -> Option<f64> {
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
fn parse_date_string(value: &str) -> Option<f64> {
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

fn parse_time_string(value: &str, culture: &str) -> Option<f64> {
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

// ===========================================================================
// Grid Index Helpers
// ===========================================================================

/// Read full cell data from a Yrs cell map, given a cells map and position info.
fn read_cell_data_from_yrs<T: yrs::ReadTxn>(
    cells_map: &MapRef,
    txn: &T,
    cell_id: CellId,
    row: u32,
    col: u32,
) -> Option<CellData> {
    let cell_hex = id_to_hex(cell_id.as_u128());
    let cell_map = match cells_map.get(txn, &cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let raw_value = yrs_any_to_cell_value(&cell_map, txn);
    let raw = if matches!(raw_value, CellValue::Null) {
        None
    } else {
        Some(raw_value)
    };

    let formula = match cell_map.get(txn, KEY_FORMULA) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    };

    // Read hyperlink and note from properties sub-map (if available)
    // For now these come from the cell map itself if stored there
    let hyperlink = match cell_map.get(txn, "h") {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    };
    let note = match cell_map.get(txn, "n") {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    };

    Some(CellData {
        cell_id,
        row,
        col,
        raw,
        computed: None, // Computed values come from the compute engine
        formula,
        hyperlink,
        note,
    })
}

// ===========================================================================
// Higher-Level Cell Operations (free functions)
// ===========================================================================

// -----------------------------------------------------------------------
// Set Cell Value (with parsing)
// -----------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Narrow write leaves
// ---------------------------------------------------------------------------
//
// Each leaf takes only the data it needs. Un-classified strings cannot reach
// them; the caller has already dispatched on `CellInput` (intent) and —
// for `Parse` — run the classifier in `CellWrite::from_user_string`. Leaves
// operate on an open transaction; the caller owns mirror updates because the
// mirror API needs the transaction dropped.

/// Remove a cell. Returns the `CellId` that was removed, or `None` if the
/// cell did not exist at (row, col). Caller is responsible for the matching
/// `mirror.remove_cell(...)` after dropping the transaction.
fn yrs_remove_cell(
    txn: &mut yrs::TransactionMut<'_>,
    sheets: &MapRef,
    sheet_hex: &str,
    cells_map: &MapRef,
    grid_index: &mut crate::identity::GridIndex,
    row: u32,
    col: u32,
) -> Option<CellId> {
    let cell_id = grid_index.cell_id_at(row, col)?;
    let cell_hex = id_to_hex(cell_id.as_u128());
    cells_map.remove(txn, &cell_hex);
    remove_cell_position_from_yrs(txn, sheets, sheet_hex, &cell_hex);
    grid_index.remove_cell(&cell_id);
    Some(cell_id)
}

/// Store verbatim text. Empty `text` stores `Text("")` — structurally
/// distinct from [`yrs_remove_cell`]. Returns (`CellId`, `CellValue`) for
/// the caller's mirror update.
fn yrs_store_text(
    txn: &mut yrs::TransactionMut<'_>,
    sheets: &MapRef,
    sheet_hex: &str,
    cells_map: &MapRef,
    grid_index: &mut crate::identity::GridIndex,
    row: u32,
    col: u32,
    text: &str,
) -> (CellId, CellValue) {
    let cell_id = grid_index.ensure_cell_id(row, col);
    let cell_hex = id_to_hex(cell_id.as_u128());
    let row_hex = grid_index.row_id_hex(row);
    let col_hex = grid_index.col_id_hex(col);
    let stored: Arc<str> = Arc::from(text);
    let cell_prelim = MapPrelim::from([(KEY_VALUE, Any::String(Arc::clone(&stored)))]);
    cells_map.insert(txn, &*cell_hex, cell_prelim);
    if let (Some(rh), Some(ch)) = (row_hex.as_ref(), col_hex.as_ref()) {
        write_cell_position_to_yrs(txn, sheets, sheet_hex, &cell_hex, rh.as_str(), ch.as_str());
    }
    (cell_id, CellValue::Text(stored))
}

/// Store a parsed formula. Takes `FormulaSource` — an un-parsed string
/// cannot reach this leaf. Mirror gets `Null` (compute fills it after
/// recalc). Returns the `CellId` for the caller's mirror update.
fn yrs_store_formula(
    txn: &mut yrs::TransactionMut<'_>,
    sheets: &MapRef,
    sheet_hex: &str,
    cells_map: &MapRef,
    grid_index: &mut crate::identity::GridIndex,
    row: u32,
    col: u32,
    fs: FormulaSource,
) -> CellId {
    let cell_id = grid_index.ensure_cell_id(row, col);
    let cell_hex = id_to_hex(cell_id.as_u128());
    let row_hex = grid_index.row_id_hex(row);
    let col_hex = grid_index.col_id_hex(col);
    let body = fs.original.strip_prefix('=').unwrap_or(&fs.original);
    let cell_prelim = MapPrelim::from([
        (KEY_VALUE, Any::Null),
        (KEY_FORMULA, Any::String(Arc::from(body))),
    ]);
    cells_map.insert(txn, &*cell_hex, cell_prelim);
    if let (Some(rh), Some(ch)) = (row_hex.as_ref(), col_hex.as_ref()) {
        write_cell_position_to_yrs(txn, sheets, sheet_hex, &cell_hex, rh.as_str(), ch.as_str());
    }
    cell_id
}

/// Store a coerced scalar (Number, Boolean, Date-as-number, Control). Text
/// must route to [`yrs_store_text`]; Null must route to [`yrs_remove_cell`].
fn yrs_store_typed(
    txn: &mut yrs::TransactionMut<'_>,
    sheets: &MapRef,
    sheet_hex: &str,
    cells_map: &MapRef,
    grid_index: &mut crate::identity::GridIndex,
    row: u32,
    col: u32,
    value: CellValue,
) -> (CellId, CellValue) {
    debug_assert!(
        !matches!(value, CellValue::Null | CellValue::Text(_)),
        "yrs_store_typed: Null and Text must route to remove/store_text"
    );
    let cell_id = grid_index.ensure_cell_id(row, col);
    let cell_hex = id_to_hex(cell_id.as_u128());
    let row_hex = grid_index.row_id_hex(row);
    let col_hex = grid_index.col_id_hex(col);
    let any_val = cell_value_to_any(&value);
    let cell_prelim = MapPrelim::from([(KEY_VALUE, any_val)]);
    cells_map.insert(txn, &*cell_hex, cell_prelim);
    if let (Some(rh), Some(ch)) = (row_hex.as_ref(), col_hex.as_ref()) {
        write_cell_position_to_yrs(txn, sheets, sheet_hex, &cell_hex, rh.as_str(), ch.as_str());
    }
    (cell_id, value)
}

/// What the caller should do with the mirror after dropping the txn.
enum MirrorAction {
    Remove(CellId),
    Apply(CellId, CellValue),
    None,
}

/// Dispatch one `CellInput` onto the narrow leaves, returning the mirror
/// action the caller must apply after dropping the transaction. The
/// classifier in `CellWrite::from_user_string` is reachable only from the
/// `Parse` arm — parse-site locality is structurally enforced.
///
/// `target` is the cell's effective number-format category, pre-computed
/// by the caller *before* opening the write transaction (so the cascade
/// helpers — which open their own read txn — don't conflict with the
/// active write txn). `Literal` and `Clear` arms ignore the hint by
/// construction.
#[allow(clippy::too_many_arguments)]
fn dispatch_cell_input(
    txn: &mut yrs::TransactionMut<'_>,
    sheets: &MapRef,
    sheet_hex: &str,
    cells_map: &MapRef,
    grid_index: &mut crate::identity::GridIndex,
    row: u32,
    col: u32,
    input: CellInput,
    target: Option<FormatType>,
) -> MirrorAction {
    match input {
        CellInput::Clear => {
            yrs_remove_cell(txn, sheets, sheet_hex, cells_map, grid_index, row, col)
                .map_or(MirrorAction::None, MirrorAction::Remove)
        }
        CellInput::Literal { text } => {
            let (cid, cv) = yrs_store_text(
                txn, sheets, sheet_hex, cells_map, grid_index, row, col, &text,
            );
            MirrorAction::Apply(cid, cv)
        }
        CellInput::Parse { text } => match CellWrite::from_user_string(&text, target) {
            CellWrite::Empty => {
                yrs_remove_cell(txn, sheets, sheet_hex, cells_map, grid_index, row, col)
                    .map_or(MirrorAction::None, MirrorAction::Remove)
            }
            // Defensive: `from_user_string` never produces Value(Null)
            // (whitespace-only classifies to Empty). Preserved to carry the
            // pre-W6 behaviour of routing a null scalar to cell-remove.
            CellWrite::Value(CellValue::Null) => {
                yrs_remove_cell(txn, sheets, sheet_hex, cells_map, grid_index, row, col)
                    .map_or(MirrorAction::None, MirrorAction::Remove)
            }
            // Classifier-produced text preserves the original bytes (trailing
            // whitespace round-trips). Route to the text leaf so the stored
            // shape is identical to the `Literal` path.
            CellWrite::Value(CellValue::Text(t)) => {
                let (cid, cv) =
                    yrs_store_text(txn, sheets, sheet_hex, cells_map, grid_index, row, col, &t);
                MirrorAction::Apply(cid, cv)
            }
            CellWrite::Formula(fs) => {
                let cid =
                    yrs_store_formula(txn, sheets, sheet_hex, cells_map, grid_index, row, col, fs);
                MirrorAction::Apply(cid, CellValue::Null)
            }
            CellWrite::Value(v) => {
                let (cid, cv) =
                    yrs_store_typed(txn, sheets, sheet_hex, cells_map, grid_index, row, col, v);
                MirrorAction::Apply(cid, cv)
            }
        },
    }
}

/// If `(row, col)` falls inside a Range, derive the virtual CellId and
/// pre-register it in the GridIndex so that `ensure_cell_id` returns it
/// instead of minting a fresh random CellId.
pub(crate) fn maybe_register_virtual_cell_id(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    grid_index: &mut crate::identity::GridIndex,
    row: u32,
    col: u32,
) {
    if grid_index.cell_id_at(row, col).is_some() {
        return;
    }
    let Some(sheet) = mirror.get_sheet(sheet_id) else {
        return;
    };
    if sheet.range_views_is_empty() {
        return;
    }
    let Some(row_id) = sheet.row_id_at(row) else {
        return;
    };
    let Some(col_id) = sheet.col_id_at(col) else {
        return;
    };
    // Check if any RangeView covers this (row_id, col_id)
    for rv in sheet.iter_ranges().map(|(_, rv)| rv) {
        if rv.row_offset_by_id.contains_key(&row_id) && rv.col_offset_by_id.contains_key(&col_id) {
            let virtual_id = CellId::virtual_at(*sheet_id, row_id, col_id);
            grid_index.register_cell(virtual_id, row, col);
            return;
        }
    }
}

/// Resolve the effective format category for a single cell *before* the
/// write transaction opens. Used by `set_cell_value` / `set_cell_values`
/// so the read-side cascade (which opens its own `transact()`) never
/// runs concurrent with our `transact_mut`.
///
/// Returns `None` for the `Clear` and `Literal` arms (the format hint is
/// only relevant to `Parse`); also returns `None` when no number_format
/// is set anywhere up the cascade.
fn resolve_format_hint(
    storage: &crate::storage::YrsStorage,
    sheet_id: &SheetId,
    grid_index: &crate::identity::GridIndex,
    sheet_mirror: Option<&SheetMirror>,
    row: u32,
    col: u32,
    input: &CellInput,
) -> Option<FormatType> {
    if !matches!(input, CellInput::Parse { .. }) {
        return None;
    }
    use crate::storage::properties;
    let format = match grid_index.cell_id_at(row, col) {
        Some(cid) => {
            let cell_hex = id_to_hex(cid.as_u128());
            properties::get_effective_format(
                storage,
                sheet_id,
                &cell_hex,
                row,
                col,
                None,
                Some(grid_index),
                sheet_mirror,
            )
        }
        None => properties::get_positional_format(
            storage,
            sheet_id,
            row,
            col,
            Some(grid_index),
            sheet_mirror,
        ),
    };
    format
        .number_format
        .as_deref()
        .map(compute_formats::detect_format_type)
}

fn apply_mirror_action(
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    action: MirrorAction,
) {
    match action {
        MirrorAction::Remove(cell_id) => mirror.remove_cell(&cell_id),
        MirrorAction::Apply(cell_id, value) => mirror.apply_edit(
            sheet_id,
            cell_id,
            cell_types::SheetPos::new(row, col),
            value,
            None,
        ),
        MirrorAction::None => {}
    }
}

/// Set a single cell. Sole entry point on the single-cell write path.
///
/// Takes a typed [`CellInput`] expressing caller intent:
/// - [`CellInput::Clear`] → remove the cell (no-op if absent).
/// - [`CellInput::Literal`] → store the text verbatim. Empty text stores
///   `Text("")`, which is structurally distinct from `Clear`.
/// - [`CellInput::Parse`] → classify via
///   [`CellWrite::from_user_string`] (with the cell's effective number
///   format as a hint) and dispatch to the matching leaf.
///
/// `storage` is required so the format-hint cascade can resolve the
/// cell's effective number format *before* the write transaction opens
/// — see `resolve_format_hint` for the rationale.
#[allow(clippy::too_many_arguments)]
pub(crate) fn set_cell_value(
    storage: &crate::storage::YrsStorage,
    doc: &Doc,
    sheets: &MapRef,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    input: CellInput,
    _id_alloc: &cell_types::IdAllocator,
    grid_index: &mut crate::identity::GridIndex,
) {
    // For Range-resident positions, pre-register the virtual CellId so
    // ensure_cell_id returns it instead of minting a new one.
    maybe_register_virtual_cell_id(mirror, sheet_id, grid_index, row, col);

    // Resolve the format hint BEFORE opening the write txn so the read-side
    // cascade in `properties::get_effective_format` doesn't try to open a
    // concurrent read txn on the same Doc.
    let target = resolve_format_hint(
        storage,
        sheet_id,
        grid_index,
        mirror.get_sheet(sheet_id),
        row,
        col,
        &input,
    );

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    // Auto-expand sheet dimensions through SheetDimensionsMut. Keeps
    // GridIndex and yrs rowOrder/colOrder in lock-step.
    {
        let mut dims = crate::storage::sheet_dimensions::SheetDimensionsMut::from_grid_index(
            doc, sheets, grid_index,
        );
        let _ = dims.ensure_capacity(&mut txn, *sheet_id, row, col);
    }

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };
    let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };

    let action = dispatch_cell_input(
        &mut txn, sheets, &sheet_hex, &cells_map, grid_index, row, col, input, target,
    );

    drop(txn);
    apply_mirror_action(mirror, sheet_id, row, col, action);
}

/// Batch variant of [`set_cell_value`]. All writes share a single yrs
/// transaction for atomicity; mirror updates run after the txn is dropped.
#[allow(clippy::too_many_arguments)]
pub(crate) fn set_cell_values(
    storage: &crate::storage::YrsStorage,
    doc: &Doc,
    sheets: &MapRef,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    updates: Vec<(u32, u32, CellInput)>,
    _id_alloc: &cell_types::IdAllocator,
    grid_index: &mut crate::identity::GridIndex,
) {
    for &(r, c, _) in &updates {
        maybe_register_virtual_cell_id(mirror, sheet_id, grid_index, r, c);
    }

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut deferred: Vec<(u32, u32, MirrorAction)> = Vec::with_capacity(updates.len());

    // Resolve format hints for every Parse-arm update BEFORE opening the
    // write txn so the read-side cascade doesn't conflict.
    let targets: Vec<Option<FormatType>> = updates
        .iter()
        .map(|(r, c, inp)| {
            resolve_format_hint(
                storage,
                sheet_id,
                grid_index,
                mirror.get_sheet(sheet_id),
                *r,
                *c,
                inp,
            )
        })
        .collect();

    {
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

        // Auto-expand sheet dimensions to cover the max (row, col) in this
        // batch BEFORE we look up rowOrder/colOrder. Keeps GridIndex and
        // yrs in lock-step.
        if let Some((max_row, max_col)) =
            updates
                .iter()
                .fold(None, |acc: Option<(u32, u32)>, (r, c, _)| match acc {
                    Some((mr, mc)) => Some((mr.max(*r), mc.max(*c))),
                    None => Some((*r, *c)),
                })
        {
            let mut dims = crate::storage::sheet_dimensions::SheetDimensionsMut::from_grid_index(
                doc, sheets, grid_index,
            );
            let _ = dims.ensure_capacity(&mut txn, *sheet_id, max_row, max_col);
        }

        let sheet_map = match sheets.get(&txn, &sheet_hex) {
            Some(Out::YMap(m)) => m,
            _ => return,
        };
        let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
            Some(Out::YMap(m)) => m,
            _ => return,
        };

        for ((row, col, input), target) in updates.into_iter().zip(targets.into_iter()) {
            let action = dispatch_cell_input(
                &mut txn, sheets, &sheet_hex, &cells_map, grid_index, row, col, input, target,
            );
            deferred.push((row, col, action));
        }
    }

    for (row, col, action) in deferred {
        apply_mirror_action(mirror, sheet_id, row, col, action);
    }
}

/// Import cell values with pre-parsed CellValue and optional formula.
///
/// Used by XLSX import where values are already parsed. Does NOT trigger
/// formula evaluation — the caller handles recalculation.
pub fn import_values(
    doc: &Doc,
    sheets: &MapRef,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    updates: &[(u32, u32, CellValue, Option<String>)],
    _id_alloc: &cell_types::IdAllocator,
    grid_index: &mut crate::identity::GridIndex,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut mirror_edits: Vec<(CellId, u32, u32, CellValue)> = Vec::new();

    {
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

        // Auto-expand sheet dimensions to accommodate all (row, col) positions
        // in this batch BEFORE we read rowOrder/colOrder. Keeps GridIndex and
        // yrs rowOrder/colOrder in lock-step.
        if let Some((max_row, max_col)) =
            updates
                .iter()
                .fold(None, |acc: Option<(u32, u32)>, (r, c, _, _)| match acc {
                    Some((mr, mc)) => Some((mr.max(*r), mc.max(*c))),
                    None => Some((*r, *c)),
                })
        {
            let mut dims = crate::storage::sheet_dimensions::SheetDimensionsMut::from_grid_index(
                doc, sheets, grid_index,
            );
            let _ = dims.ensure_capacity(&mut txn, *sheet_id, max_row, max_col);
        }

        let sheet_map = match sheets.get(&txn, &sheet_hex) {
            Some(Out::YMap(m)) => m,
            _ => return,
        };

        let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
            Some(Out::YMap(m)) => m,
            _ => return,
        };

        for (row, col, value, formula) in updates {
            // For Range-resident positions, pre-register the virtual CellId so
            // ensure_cell_id returns it instead of minting a new one.
            maybe_register_virtual_cell_id(mirror, sheet_id, grid_index, *row, *col);

            let cell_id = grid_index.ensure_cell_id(*row, *col);
            let cell_hex = id_to_hex(cell_id.as_u128());
            let row_hex = grid_index.row_id_hex(*row);
            let col_hex = grid_index.col_id_hex(*col);

            let v = cell_value_to_any(value);
            let cell_prelim = match formula {
                Some(f) => MapPrelim::from([
                    (KEY_VALUE, v),
                    (KEY_FORMULA, Any::String(Arc::from(f.as_str()))),
                ]),
                None => MapPrelim::from([(KEY_VALUE, v)]),
            };
            cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
            if let (Some(rh), Some(ch)) = (row_hex.as_ref(), col_hex.as_ref()) {
                write_cell_position_to_yrs(
                    &mut txn,
                    sheets,
                    &sheet_hex,
                    &cell_hex,
                    rh.as_str(),
                    ch.as_str(),
                );
            }

            mirror_edits.push((cell_id, *row, *col, value.clone()));
        }
    }

    // Apply mirror edits
    for (cell_id, row, col, value) in mirror_edits {
        mirror.apply_edit(
            sheet_id,
            cell_id,
            cell_types::SheetPos::new(row, col),
            value,
            None,
        );
    }
}

// -----------------------------------------------------------------------
// Get Cell Data
// -----------------------------------------------------------------------

/// Get full cell data by position.
///
/// Uses the in-memory `GridIndex` for O(1) position-to-CellId lookup,
/// then reads the cell data from the Yrs cells map.
pub fn get_cell_data(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    grid_index: &crate::identity::GridIndex,
) -> Option<CellData> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let cell_id = grid_index.cell_id_at(row, col)?;

    let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    read_cell_data_from_yrs(&cells_map, &txn, cell_id, row, col)
}

/// Get full cell data by CellId.
///
/// Looks up the position via the in-memory `GridIndex` (O(1) reverse lookup),
/// then reads the cell data from the Yrs cells map.
pub fn get_cell_data_by_id(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: CellId,
    grid_index: &compute_document::identity::GridIndex,
) -> Option<CellData> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let (row, col) = grid_index.cell_position(&cell_id)?;

    let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    read_cell_data_from_yrs(&cells_map, &txn, cell_id, row, col)
}

/// Get the raw value for formula bar display.
///
/// For formula cells, returns the formula prefixed with '='.
/// For value cells, returns the string representation of the raw value.
/// Returns empty string for empty cells.
pub fn get_raw_value(
    mirror: &CellMirror,
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    grid_index: &crate::identity::GridIndex,
) -> String {
    // Try via Yrs doc to get formula info
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return String::new(),
    };

    let cell_id = match grid_index.cell_id_at(row, col) {
        Some(id) => id,
        None => return mirror_display_value(mirror, sheet_id, row, col),
    };

    let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
        Some(Out::YMap(m)) => m,
        _ => return String::new(),
    };

    let cell_hex = id_to_hex(cell_id.as_u128());
    let cell_map = match cells_map.get(&txn, &cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => return String::new(),
    };

    // If has formula, return "=formula"
    if let Some(Out::Any(Any::String(formula))) = cell_map.get(&txn, KEY_FORMULA) {
        return format!("={}", &*formula);
    }

    // Otherwise return string rep of value
    let value = yrs_any_to_cell_value(&cell_map, &txn);
    match value {
        CellValue::Null => String::new(),
        other => format!("{}", other),
    }
}

/// Helper: get display value from mirror.
fn mirror_display_value(mirror: &CellMirror, sheet_id: &SheetId, row: u32, col: u32) -> String {
    match mirror.get_cell_value_at(sheet_id, cell_types::SheetPos::new(row, col)) {
        Some(cv) => format!("{}", cv),
        None => String::new(),
    }
}

/// Get the effective value of a cell.
///
/// For formula cells, returns the computed value (from the mirror/compute engine).
/// For value cells, returns the raw value.
/// Returns `None` for empty cells.
pub fn get_effective_value(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellValue> {
    mirror
        .get_cell_value_at(sheet_id, cell_types::SheetPos::new(row, col))
        .cloned()
}

/// Get the count of non-empty cells in a sheet.
///
/// Reads from the Yrs cells map to get an accurate count.
pub fn get_cell_count(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> usize {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return 0,
    };

    let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
        Some(Out::YMap(m)) => m,
        _ => return 0,
    };

    cells_map.len(&txn) as usize
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;
    use cell_types::SheetId;
    use value_types::{CellError, FiniteF64};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    fn make_cell_id(n: u128) -> CellId {
        CellId::from_raw(n)
    }

    /// Create a YrsStorage with a single sheet.
    ///
    /// `add_sheet()` creates the yrs sheet sub-maps, cells, rowOrder, colOrder.
    fn storage_with_sheet() -> (YrsStorage, crate::mirror::CellMirror, SheetId) {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let sheet_id = make_sheet_id(1);
        storage
            .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
            .unwrap();
        (storage, mirror, sheet_id)
    }

    /// Build a fresh `GridIndex` matching the test sheet dimensions
    /// used by `storage_with_sheet()`.
    fn make_grid_index(sheet_id: SheetId) -> crate::identity::GridIndex {
        crate::identity::GridIndex::new(
            sheet_id,
            100,
            26,
            std::sync::Arc::new(cell_types::IdAllocator::new()),
        )
    }

    // -----------------------------------------------------------------------
    // Test: parse_input_value — empty
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_empty() {
        assert_eq!(parse_input_value("", None), ParsedValue::Empty);
        assert_eq!(parse_input_value("   ", None), ParsedValue::Empty);
        assert_eq!(parse_input_value("\t", None), ParsedValue::Empty);
    }

    // -----------------------------------------------------------------------
    // Test: parse_input_value — booleans
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_boolean_true() {
        assert_eq!(parse_input_value("TRUE", None), ParsedValue::Boolean(true));
        assert_eq!(parse_input_value("true", None), ParsedValue::Boolean(true));
        assert_eq!(parse_input_value("True", None), ParsedValue::Boolean(true));
        assert_eq!(parse_input_value("tRuE", None), ParsedValue::Boolean(true));
    }

    #[test]
    fn test_parse_boolean_false() {
        assert_eq!(
            parse_input_value("FALSE", None),
            ParsedValue::Boolean(false)
        );
        assert_eq!(
            parse_input_value("false", None),
            ParsedValue::Boolean(false)
        );
        assert_eq!(
            parse_input_value("False", None),
            ParsedValue::Boolean(false)
        );
    }

    // -----------------------------------------------------------------------
    // Test: parse_input_value — plain numbers
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_plain_integer() {
        assert_eq!(parse_input_value("42", None), ParsedValue::Number(42.0));
        assert_eq!(parse_input_value("0", None), ParsedValue::Number(0.0));
        assert_eq!(parse_input_value("-7", None), ParsedValue::Number(-7.0));
    }

    #[test]
    fn test_parse_plain_decimal() {
        #[allow(clippy::approx_constant)]
        let expected = 3.14;
        assert_eq!(
            parse_input_value("3.14", None),
            ParsedValue::Number(expected)
        );
        assert_eq!(parse_input_value("-0.5", None), ParsedValue::Number(-0.5));
        assert_eq!(parse_input_value(".5", None), ParsedValue::Number(0.5));
    }

    #[test]
    fn test_parse_number_with_whitespace() {
        assert_eq!(parse_input_value("  42  ", None), ParsedValue::Number(42.0));
        #[allow(clippy::approx_constant)]
        let expected = -3.14;
        assert_eq!(
            parse_input_value(" -3.14 ", None),
            ParsedValue::Number(expected)
        );
    }

    // -----------------------------------------------------------------------
    // Test: parse_input_value — formatted numbers
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_currency_usd() {
        assert_eq!(parse_input_value("$500", None), ParsedValue::Number(500.0));
        assert_eq!(
            parse_input_value("$1,234.56", None),
            ParsedValue::Number(1234.56)
        );
    }

    #[test]
    fn test_parse_currency_euro() {
        assert_eq!(
            parse_input_value("\u{20AC}1.234,56", None),
            ParsedValue::Number(1234.56)
        );
    }

    #[test]
    fn test_parse_percentage() {
        assert_eq!(parse_input_value("50%", None), ParsedValue::Number(0.5));
        assert_eq!(parse_input_value("100%", None), ParsedValue::Number(1.0));
        assert_eq!(parse_input_value("0.5%", None), ParsedValue::Number(0.005));
    }

    #[test]
    fn test_parse_accounting_negative() {
        assert_eq!(
            parse_input_value("(500)", None),
            ParsedValue::Number(-500.0)
        );
        assert_eq!(
            parse_input_value("($1,234.56)", None),
            ParsedValue::Number(-1234.56)
        );
    }

    #[test]
    fn test_parse_thousands_separator() {
        assert_eq!(
            parse_input_value("1,234,567", None),
            ParsedValue::Number(1_234_567.0)
        );
    }

    // -----------------------------------------------------------------------
    // Test: parse_formatted_number directly
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_formatted_number_empty() {
        assert_eq!(parse_formatted_number(""), None);
    }

    #[test]
    fn test_parse_formatted_number_currency() {
        assert_eq!(parse_formatted_number("$500"), Some(500.0));
        assert_eq!(parse_formatted_number("\u{00A3}100"), Some(100.0)); // £
        assert_eq!(parse_formatted_number("\u{00A5}200"), Some(200.0)); // ¥
        assert_eq!(parse_formatted_number("\u{20B9}300"), Some(300.0)); // ₹
    }

    #[test]
    fn test_parse_formatted_number_negative_sign() {
        assert_eq!(parse_formatted_number("-$500"), Some(-500.0));
    }

    #[test]
    fn test_parse_formatted_number_european() {
        // European: period as thousands, comma as decimal
        assert_eq!(parse_formatted_number("1.234,56"), Some(1234.56));
    }

    #[test]
    fn test_parse_formatted_number_us() {
        assert_eq!(parse_formatted_number("1,234.56"), Some(1234.56));
    }

    #[test]
    fn test_parse_formatted_number_not_a_number() {
        assert_eq!(parse_formatted_number("hello"), None);
        assert_eq!(parse_formatted_number("abc"), None);
    }

    #[test]
    fn test_parse_formatted_number_single_comma_european_decimal() {
        // "1,5" should be treated as European decimal -> 1.5
        assert_eq!(parse_formatted_number("1,5"), Some(1.5));
        assert_eq!(parse_formatted_number("1,50"), Some(1.50));
    }

    // -----------------------------------------------------------------------
    // Test: parse_date_string
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_date_us_format() {
        let serial = parse_date_string("3/31/2016").unwrap();
        // 2016-03-31 should be a valid serial > 0
        assert!(serial > 0.0);
        // Verify by checking known value: Jan 1 1900 = serial 1
        let jan1_1900 = parse_date_string("1/1/1900").unwrap();
        assert!((jan1_1900 - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_parse_date_iso_format() {
        let serial = parse_date_string("2016-03-31").unwrap();
        assert!(serial > 0.0);
        // Should match the US format for same date
        let us_serial = parse_date_string("3/31/2016").unwrap();
        assert!((serial - us_serial).abs() < 0.001);
    }

    #[test]
    fn test_parse_date_dmmy_format() {
        let serial = parse_date_string("31-Mar-2016").unwrap();
        let us_serial = parse_date_string("3/31/2016").unwrap();
        assert!((serial - us_serial).abs() < 0.001);
    }

    #[test]
    fn test_parse_date_mmmd_format() {
        let serial = parse_date_string("Mar 31, 2016").unwrap();
        let us_serial = parse_date_string("3/31/2016").unwrap();
        assert!((serial - us_serial).abs() < 0.001);
    }

    #[test]
    fn test_parse_date_invalid() {
        assert!(parse_date_string("").is_none());
        assert!(parse_date_string("hello").is_none());
        assert!(parse_date_string("13/32/2020").is_none()); // invalid month/day
        assert!(parse_date_string("2/30/2020").is_none()); // Feb 30 doesn't exist
        assert!(parse_date_string("2/29/2019").is_none()); // Not a leap year
    }

    #[test]
    fn test_parse_date_leap_year() {
        assert!(parse_date_string("2/29/2020").is_some()); // 2020 is a leap year
        assert!(parse_date_string("2/29/2000").is_some()); // 2000 is a leap year
    }

    #[test]
    fn test_parse_date_boundary_years() {
        assert!(parse_date_string("1/1/1900").is_some());
        assert!(parse_date_string("12/31/2200").is_some());
        assert!(parse_date_string("1/1/1899").is_none()); // Too early
        assert!(parse_date_string("1/1/2201").is_none()); // Too late
    }

    #[test]
    fn test_parse_date_case_insensitive_month() {
        let serial1 = parse_date_string("31-Mar-2016").unwrap();
        let serial2 = parse_date_string("31-mar-2016").unwrap();
        let serial3 = parse_date_string("31-MAR-2016").unwrap();
        assert!((serial1 - serial2).abs() < 0.001);
        assert!((serial1 - serial3).abs() < 0.001);
    }

    // -----------------------------------------------------------------------
    // Test: parse_input_value — dates
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_input_value_date() {
        if let ParsedValue::Number(serial) = parse_input_value("3/31/2016", None) {
            assert!(serial > 40000.0); // Excel serial for dates in 2016
        } else {
            panic!("Expected ParsedValue::Number for date input");
        }
    }

    // -----------------------------------------------------------------------
    // Test: parse_input_value — text
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_text() {
        assert_eq!(
            parse_input_value("hello", None),
            ParsedValue::Text("hello".to_string())
        );
        assert_eq!(
            parse_input_value("Hello World", None),
            ParsedValue::Text("Hello World".to_string())
        );
    }

    #[test]
    fn test_parse_text_formula_not_parsed() {
        // Formulas should be returned as text (caller checks isFormula separately)
        assert_eq!(
            parse_input_value("=SUM(A1)", None),
            ParsedValue::Text("=SUM(A1)".to_string())
        );
    }

    // -----------------------------------------------------------------------
    // Test: set_cell_value and get operations (round-trip)
    // -----------------------------------------------------------------------

    #[test]
    fn test_set_cell_value_number() {
        let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
        // Use the low-level set_cell to write, then use get_cell_count
        storage.set_cell(
            &mut mirror,
            &sheet_id,
            make_cell_id(100),
            0,
            0,
            CellValue::Number(FiniteF64::must(42.0)),
            None,
            None,
        );

        // Verify via mirror
        let val = mirror.get_cell_value_at(&sheet_id, cell_types::SheetPos::new(0, 0));
        assert!(val.is_some());
        assert_eq!(*val.unwrap(), CellValue::Number(FiniteF64::must(42.0)));
    }

    #[test]
    fn test_literal_preserves_text() {
        let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
        let mut grid = make_grid_index(sheet_id);
        {
            let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
            set_cell_value(
                &storage,
                doc,
                sheets,
                mirror,
                &sheet_id,
                0,
                0,
                CellInput::Literal {
                    text: "123".to_string(),
                },
                &*crate::storage::STORAGE_ID_ALLOC,
                &mut grid,
            );
        }
        // Stored as text "123", not number 123 — `Literal` bypasses coercion.
        let val = get_effective_value(&mirror, &sheet_id, 0, 0);
        assert_eq!(val, Some(CellValue::Text("123".into())));
    }

    #[test]
    fn test_literal_formula_not_evaluated() {
        let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
        let mut grid = make_grid_index(sheet_id);
        {
            let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
            set_cell_value(
                &storage,
                doc,
                sheets,
                mirror,
                &sheet_id,
                0,
                0,
                CellInput::Literal {
                    text: "=SUM(A1:A10)".to_string(),
                },
                &*crate::storage::STORAGE_ID_ALLOC,
                &mut grid,
            );
        }
        // Stored as literal text, not as a formula — `Literal` bypasses parsing.
        let val = get_effective_value(&mirror, &sheet_id, 0, 0);
        assert_eq!(val, Some(CellValue::Text("=SUM(A1:A10)".into())));
    }

    #[test]
    fn test_literal_empty_stores_as_empty_text() {
        // sub-scope/A motivating invariant: `Literal { text: "" }` is
        // structurally distinct from `Clear`. Stores `Text("")`.
        let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
        let mut grid = make_grid_index(sheet_id);
        {
            let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
            set_cell_value(
                &storage,
                doc,
                sheets,
                mirror,
                &sheet_id,
                0,
                0,
                CellInput::Literal {
                    text: String::new(),
                },
                &*crate::storage::STORAGE_ID_ALLOC,
                &mut grid,
            );
        }
        assert_eq!(
            get_effective_value(&mirror, &sheet_id, 0, 0),
            Some(CellValue::Text("".into()))
        );
    }

    #[test]
    fn test_parse_nul_is_plain_text() {
        // sub-scope/A: `Parse { text: "\x00" }` is a plain text character,
        // not a sentinel. The NUL-prefix sentinel died with this refactor.
        let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
        let mut grid = make_grid_index(sheet_id);
        {
            let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
            set_cell_value(
                &storage,
                doc,
                sheets,
                mirror,
                &sheet_id,
                0,
                0,
                CellInput::Parse {
                    text: "\x00".to_string(),
                },
                &*crate::storage::STORAGE_ID_ALLOC,
                &mut grid,
            );
        }
        assert_eq!(
            get_effective_value(&mirror, &sheet_id, 0, 0),
            Some(CellValue::Text("\x00".into()))
        );
    }

    // -----------------------------------------------------------------------
    // Test: set_cell_values batch
    // -----------------------------------------------------------------------

    #[test]
    fn test_set_cell_values_batch() {
        let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
        let mut grid = make_grid_index(sheet_id);
        {
            let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
            set_cell_values(
                &storage,
                doc,
                sheets,
                mirror,
                &sheet_id,
                vec![
                    (
                        0,
                        0,
                        CellInput::Parse {
                            text: "42".to_string(),
                        },
                    ),
                    (
                        0,
                        1,
                        CellInput::Parse {
                            text: "hello".to_string(),
                        },
                    ),
                    (
                        0,
                        2,
                        CellInput::Parse {
                            text: "TRUE".to_string(),
                        },
                    ),
                ],
                &*crate::storage::STORAGE_ID_ALLOC,
                &mut grid,
            );
        }
        // Verify via get_cell_count (should be at least 3 from YRS cells)
        let count = get_cell_count(storage.doc(), storage.sheets(), &sheet_id);
        assert!(count >= 3);
    }

    // -----------------------------------------------------------------------
    // Test: get_raw_value
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_raw_value_empty() {
        let (storage, mirror, sheet_id) = storage_with_sheet();
        let grid = make_grid_index(sheet_id);
        let raw = get_raw_value(
            &mirror,
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            5,
            5,
            &grid,
        );
        assert_eq!(raw, "");
    }

    // -----------------------------------------------------------------------
    // Test: get_effective_value
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_effective_value_number() {
        let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
        storage.set_cell(
            &mut mirror,
            &sheet_id,
            make_cell_id(300),
            0,
            0,
            CellValue::Number(FiniteF64::must(99.0)),
            None,
            None,
        );

        let eff = get_effective_value(&mirror, &sheet_id, 0, 0);
        assert!(eff.is_some());
        assert_eq!(eff.unwrap(), CellValue::Number(FiniteF64::must(99.0)));
    }

    #[test]
    fn test_get_effective_value_empty() {
        let (storage, mirror, sheet_id) = storage_with_sheet();
        let eff = get_effective_value(&mirror, &sheet_id, 5, 5);
        assert!(eff.is_none());
    }

    // -----------------------------------------------------------------------
    // Test: get_cell_count
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_cell_count_empty() {
        let (storage, mirror, sheet_id) = storage_with_sheet();
        assert_eq!(
            get_cell_count(storage.doc(), storage.sheets(), &sheet_id),
            0
        );
    }

    #[test]
    fn test_get_cell_count_with_cells() {
        let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
        storage.set_cell(
            &mut mirror,
            &sheet_id,
            make_cell_id(400),
            0,
            0,
            CellValue::Number(FiniteF64::must(1.0)),
            None,
            None,
        );
        storage.set_cell(
            &mut mirror,
            &sheet_id,
            make_cell_id(401),
            0,
            1,
            CellValue::Number(FiniteF64::must(2.0)),
            None,
            None,
        );
        storage.set_cell(
            &mut mirror,
            &sheet_id,
            make_cell_id(402),
            1,
            0,
            CellValue::Text("hello".into()),
            None,
            None,
        );

        assert_eq!(
            get_cell_count(storage.doc(), storage.sheets(), &sheet_id),
            3
        );
    }

    #[test]
    fn test_get_cell_count_nonexistent_sheet() {
        let storage = YrsStorage::new();
        assert_eq!(
            get_cell_count(storage.doc(), storage.sheets(), &make_sheet_id(999)),
            0
        );
    }

    // -----------------------------------------------------------------------
    // Test: import_values
    // -----------------------------------------------------------------------

    #[test]
    fn test_import_values_basic() {
        let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
        let mut grid = make_grid_index(sheet_id);
        {
            let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
            import_values(
                doc,
                sheets,
                mirror,
                &sheet_id,
                &[
                    (0, 0, CellValue::Number(FiniteF64::must(42.0)), None),
                    (0, 1, CellValue::Text("hello".into()), None),
                    (
                        1,
                        0,
                        CellValue::Number(FiniteF64::must(100.0)),
                        Some("A1*2".to_string()),
                    ),
                ],
                &*crate::storage::STORAGE_ID_ALLOC,
                &mut grid,
            );
        }
        // Verify cell count
        let count = get_cell_count(storage.doc(), storage.sheets(), &sheet_id);
        assert_eq!(count, 3);
    }

    // -----------------------------------------------------------------------
    // Test: is_plain_number helper
    // -----------------------------------------------------------------------

    #[test]
    fn test_is_plain_number() {
        assert!(is_plain_number("42"));
        assert!(is_plain_number("-42"));
        assert!(is_plain_number("3.14"));
        assert!(is_plain_number("-3.14"));
        assert!(is_plain_number("0"));
        assert!(is_plain_number(".5"));
        assert!(is_plain_number("-.5"));

        assert!(!is_plain_number(""));
        assert!(!is_plain_number("-"));
        assert!(!is_plain_number("abc"));
        assert!(!is_plain_number("42abc"));
        assert!(!is_plain_number("1,234"));
        assert!(!is_plain_number("$42"));
        assert!(!is_plain_number("42."));
    }

    // -----------------------------------------------------------------------
    // Test: Clear on an absent cell is a no-op (does not panic)
    // -----------------------------------------------------------------------

    #[test]
    fn test_clear_absent_cell_is_noop() {
        let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
        let mut grid = make_grid_index(sheet_id);
        {
            let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
            set_cell_value(
                &storage,
                doc,
                sheets,
                mirror,
                &sheet_id,
                0,
                0,
                CellInput::Clear,
                &*crate::storage::STORAGE_ID_ALLOC,
                &mut grid,
            );
        }
    }

    // -----------------------------------------------------------------------
    // Test: Parse(empty) on an absent cell is a no-op
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_empty_on_absent_cell_is_noop() {
        let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
        let mut grid = make_grid_index(sheet_id);
        {
            let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
            set_cell_value(
                &storage,
                doc,
                sheets,
                mirror,
                &sheet_id,
                0,
                0,
                CellInput::Parse {
                    text: String::new(),
                },
                &*crate::storage::STORAGE_ID_ALLOC,
                &mut grid,
            );
        }
    }

    // -----------------------------------------------------------------------
    // Test: integration with parse_input_value for various inputs
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_input_value_comprehensive() {
        // Numbers
        assert_eq!(parse_input_value("0", None), ParsedValue::Number(0.0));
        assert_eq!(
            parse_input_value("999999", None),
            ParsedValue::Number(999999.0)
        );
        assert_eq!(
            parse_input_value("-1234.5678", None),
            ParsedValue::Number(-1234.5678)
        );

        // Booleans
        assert_eq!(parse_input_value("TRUE", None), ParsedValue::Boolean(true));
        assert_eq!(
            parse_input_value("FALSE", None),
            ParsedValue::Boolean(false)
        );

        // Text
        assert!(matches!(
            parse_input_value("hello world", None),
            ParsedValue::Text(_)
        ));
        assert!(matches!(
            parse_input_value("abc123", None),
            ParsedValue::Text(_)
        ));

        // Empty
        assert_eq!(parse_input_value("", None), ParsedValue::Empty);
    }

    // -----------------------------------------------------------------------
    // sub-scope/A — end-to-end regression tests for CellInput → storage
    //
    // These pin down the behaviour contract across the typed boundary:
    //   CellInput → dispatch_cell_input → yrs+mirror.
    // They cover the three intent variants (Clear / Literal / Parse) plus
    // the parse sub-cases (empty, formula, numeric, non-ASCII).
    // -----------------------------------------------------------------------

    /// `CellInput::Clear` removes the cell and leaves no stored value.
    #[test]
    fn clear_removes_existing_cell() {
        let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
        let mut grid = make_grid_index(sheet_id);

        // Pre-populate a cell so we can verify Clear removes it.
        {
            let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
            set_cell_value(
                &storage,
                doc,
                sheets,
                mirror,
                &sheet_id,
                0,
                0,
                CellInput::Parse {
                    text: "42".to_string(),
                },
                &*crate::storage::STORAGE_ID_ALLOC,
                &mut grid,
            );
        }
        assert!(get_effective_value(&mirror, &sheet_id, 0, 0).is_some());

        {
            let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
            set_cell_value(
                &storage,
                doc,
                sheets,
                mirror,
                &sheet_id,
                0,
                0,
                CellInput::Clear,
                &*crate::storage::STORAGE_ID_ALLOC,
                &mut grid,
            );
        }
        assert!(get_effective_value(&mirror, &sheet_id, 0, 0).is_none());
        assert_eq!(
            get_raw_value(
                &mirror,
                storage.doc(),
                storage.sheets(),
                &sheet_id,
                0,
                0,
                &grid,
            ),
            ""
        );
    }

    /// `Parse("=A1+1")` stores the formula body in yrs; mirror carries Null.
    #[test]
    fn parse_formula_stores_formula() {
        let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
        let mut grid = make_grid_index(sheet_id);

        {
            let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
            set_cell_value(
                &storage,
                doc,
                sheets,
                mirror,
                &sheet_id,
                0,
                1,
                CellInput::Parse {
                    text: "=A1+1".to_string(),
                },
                &*crate::storage::STORAGE_ID_ALLOC,
                &mut grid,
            );
        }

        let val = get_effective_value(&mirror, &sheet_id, 0, 1);
        assert_eq!(val, Some(CellValue::Null));

        let raw = get_raw_value(
            &mirror,
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            0,
            1,
            &grid,
        );
        assert_eq!(raw, "=A1+1");
    }

    /// `Parse("42")` classifies as number and stores numerically.
    #[test]
    fn parse_numeric_stores_as_number() {
        let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
        let mut grid = make_grid_index(sheet_id);

        {
            let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
            set_cell_value(
                &storage,
                doc,
                sheets,
                mirror,
                &sheet_id,
                0,
                0,
                CellInput::Parse {
                    text: "42".to_string(),
                },
                &*crate::storage::STORAGE_ID_ALLOC,
                &mut grid,
            );
        }
        let val = get_effective_value(&mirror, &sheet_id, 0, 0);
        assert_eq!(val, Some(CellValue::Number(FiniteF64::must(42.0))));
    }

    /// Forced-text input (apostrophe-prefixed) routes through
    /// `CellInput::Literal { text: stripped }` — stripped at the service
    /// layer, stored verbatim here. The stored value is the literal text
    /// `"42"` (never a number). This pins down the existing product
    /// semantics after the sub-scope/A reconcile.
    #[test]
    fn literal_stores_apostrophe_stripped_text() {
        let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
        let mut grid = make_grid_index(sheet_id);

        let raw = "'42";
        let stored = raw.strip_prefix('\'').unwrap();
        {
            let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
            set_cell_value(
                &storage,
                doc,
                sheets,
                mirror,
                &sheet_id,
                0,
                0,
                CellInput::Literal {
                    text: stored.to_string(),
                },
                &*crate::storage::STORAGE_ID_ALLOC,
                &mut grid,
            );
        }
        let val = get_effective_value(&mirror, &sheet_id, 0, 0);
        assert_eq!(val, Some(CellValue::Text("42".into())));
        let raw_view = get_raw_value(
            &mirror,
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            0,
            0,
            &grid,
        );
        assert_eq!(raw_view, "42");
    }

    /// Non-ASCII input must classify totally (no UTF-8 panic) and round-trip
    /// through storage. Borrows from the UTF-8 boundary regression pattern:
    /// multi-byte codepoints in both text and formula shapes exercise every
    /// `&str` slice on the path.
    #[test]
    fn parse_non_ascii_no_utf8_panic() {
        let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
        let mut grid = make_grid_index(sheet_id);

        let greek = "Πλήρης";
        {
            let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
            set_cell_value(
                &storage,
                doc,
                sheets,
                mirror,
                &sheet_id,
                0,
                0,
                CellInput::Parse {
                    text: greek.to_string(),
                },
                &*crate::storage::STORAGE_ID_ALLOC,
                &mut grid,
            );
        }
        assert_eq!(
            get_effective_value(&mirror, &sheet_id, 0, 0),
            Some(CellValue::Text(greek.into()))
        );

        let greek_formula = "=OFFSET(Π,0,0)";
        {
            let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
            set_cell_value(
                &storage,
                doc,
                sheets,
                mirror,
                &sheet_id,
                1,
                0,
                CellInput::Parse {
                    text: greek_formula.to_string(),
                },
                &*crate::storage::STORAGE_ID_ALLOC,
                &mut grid,
            );
        }
        let raw_view = get_raw_value(
            &mirror,
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            1,
            0,
            &grid,
        );
        assert_eq!(raw_view, greek_formula);
    }

    // -----------------------------------------------------------------------
    // Format-aware classifier (G1 percent, G3 fraction)
    //
    // These tests exercise `parse_input_value(s, target)` with the
    // format-category hint. This path implements the G1
    // (percent ÷100 on bare numbers) and G3 (fraction "n/d" → f64)
    // transforms, backed by regression tests for the parser behavior.
    // -----------------------------------------------------------------------

    /// G1: bare number into a percent-formatted cell divides by 100.
    #[test]
    fn parse_input_value_percent_hint_bare_number() {
        match parse_input_value("11", Some(FormatType::Percentage)) {
            ParsedValue::Number(n) => assert!((n - 0.11).abs() < 1e-12, "got {n}"),
            other => panic!("expected Number(0.11), got {other:?}"),
        }
    }

    /// G1: negative bare number into a percent cell.
    #[test]
    fn parse_input_value_percent_hint_negative_bare_number() {
        match parse_input_value("-5", Some(FormatType::Percentage)) {
            ParsedValue::Number(n) => assert!((n - -0.05).abs() < 1e-12, "got {n}"),
            other => panic!("expected Number(-0.05), got {other:?}"),
        }
    }

    /// G1 regression guard: input shape already has `%` — `parse_formatted_number`
    /// divides; the hint must NOT double-divide.
    #[test]
    fn parse_input_value_percent_hint_input_with_percent_does_not_double_divide() {
        match parse_input_value("50%", Some(FormatType::Percentage)) {
            ParsedValue::Number(n) => assert!((n - 0.5).abs() < 1e-12, "got {n}"),
            other => panic!("expected Number(0.5), got {other:?}"),
        }
    }

    /// Invariant: date-shaped input into an explicit non-date
    /// format (here Percentage) falls through to text rather than coercing
    /// to a date serial the format would misrender. Excel parity:
    /// "format-aware text fallback." Pairs with the Phase-1 stickiness
    /// guard in the engine — the cell keeps its Percentage format AND the
    /// value is text, not a serial under the wrong format.
    #[test]
    fn parse_input_value_percent_hint_date_input_falls_through_to_text() {
        match parse_input_value("3/14/2024", Some(FormatType::Percentage)) {
            ParsedValue::Text(s) => assert_eq!(s, "3/14/2024"),
            other => panic!("expected Text(\"3/14/2024\"), got {other:?}"),
        }
    }

    /// G1 regression guard: `"$100"` into a percent cell stays `Number(100)`.
    /// Currency-prefix path classifies via `parse_formatted_number`; hint
    /// must NOT divide.
    #[test]
    fn parse_input_value_percent_hint_currency_prefix_stays_unchanged() {
        match parse_input_value("$100", Some(FormatType::Percentage)) {
            ParsedValue::Number(n) => assert!((n - 100.0).abs() < 1e-12, "got {n}"),
            other => panic!("expected Number(100), got {other:?}"),
        }
    }

    /// G1 regression guard: format-blind path unchanged for bare number.
    #[test]
    fn parse_input_value_no_hint_bare_number_unchanged() {
        assert_eq!(parse_input_value("11", None), ParsedValue::Number(11.0));
    }

    /// G3: bare "1/2" into a fraction-formatted cell parses as 0.5.
    #[test]
    fn parse_input_value_fraction_hint_bare_fraction() {
        match parse_input_value("1/2", Some(FormatType::Fraction)) {
            ParsedValue::Number(n) => assert!((n - 0.5).abs() < 1e-12, "got {n}"),
            other => panic!("expected Number(0.5), got {other:?}"),
        }
    }

    /// Format-blind path uses the culture-aware date parser. Two-part slash
    /// dates use the parser's explicit default year (2000), so `"1/2"` is
    /// January 2, 2000 rather than a fraction.
    #[test]
    fn parse_input_value_no_hint_slash_date_uses_default_year() {
        match parse_input_value("1/2", None) {
            ParsedValue::Number(n) => assert!((n - 36527.0).abs() < 1e-9, "got {n}"),
            other => panic!("expected Number(36527), got {other:?}"),
        }
    }

    // ── Date-branch hint awareness ─────────────────────────────────────
    //
    // An explicit non-date target format suppresses date-shape coercion so
    // the input falls through to text rather than landing as a serial under
    // a format that will misrender it ("format-aware text fallback," Excel
    // parity). General/None/Date/Time/Custom remain permissive.
    /// `"3/15/2024"` into a Fraction-formatted cell is text — the
    /// fraction parser fails on this shape and we no longer fall back to
    /// the date branch.
    #[test]
    fn parse_input_value_fraction_hint_date_shaped_falls_through_to_text() {
        match parse_input_value("3/15/2024", Some(FormatType::Fraction)) {
            ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
            other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
        }
    }

    /// Phase-2: Number-formatted cell rejects date-shaped input.
    #[test]
    fn parse_input_value_number_hint_date_shaped_falls_through_to_text() {
        match parse_input_value("3/15/2024", Some(FormatType::Number)) {
            ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
            other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
        }
    }

    /// Phase-2: Currency-formatted cell rejects date-shaped input.
    #[test]
    fn parse_input_value_currency_hint_date_shaped_falls_through_to_text() {
        match parse_input_value("3/15/2024", Some(FormatType::Currency)) {
            ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
            other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
        }
    }

    /// Phase-2: Accounting-formatted cell rejects date-shaped input.
    #[test]
    fn parse_input_value_accounting_hint_date_shaped_falls_through_to_text() {
        match parse_input_value("3/15/2024", Some(FormatType::Accounting)) {
            ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
            other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
        }
    }

    /// Phase-2: Percentage-formatted cell rejects date-shaped input. Pairs
    /// with `parse_input_value_percent_hint_date_input_falls_through_to_text`
    /// which uses the older `"3/14/2024"` literal — keep both for breadth.
    #[test]
    fn parse_input_value_percentage_hint_date_shaped_falls_through_to_text() {
        match parse_input_value("3/15/2024", Some(FormatType::Percentage)) {
            ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
            other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
        }
    }

    /// Phase-2: Scientific-formatted cell rejects date-shaped input.
    #[test]
    fn parse_input_value_scientific_hint_date_shaped_falls_through_to_text() {
        match parse_input_value("3/15/2024", Some(FormatType::Scientific)) {
            ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
            other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
        }
    }

    /// Phase-2: Special-formatted cell (ZIP/Phone/SSN) rejects date-shaped
    /// input — like other non-date explicit formats, the user told us what
    /// shape this cell holds.
    #[test]
    fn parse_input_value_special_hint_date_shaped_falls_through_to_text() {
        match parse_input_value("3/15/2024", Some(FormatType::Special)) {
            ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
            other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
        }
    }

    /// Phase-2 negative control: `None` hint keeps the historical
    /// permissive behavior — date-shaped input lands as a serial.
    #[test]
    fn parse_input_value_no_hint_date_shaped_still_serial() {
        match parse_input_value("3/15/2024", None) {
            ParsedValue::Number(n) => {
                // 3/15/2024 → Excel serial 45366 on 1900 epoch.
                assert!((n - 45366.0).abs() < 1e-9, "got {n}");
            }
            other => panic!("expected Number(serial), got {other:?}"),
        }
    }

    /// Phase-2 negative control: `General` hint keeps the historical
    /// permissive behavior. Pairs with the engine-side auto-inference
    /// regression guard: General cells get an inferred date format
    /// applied after the parse.
    #[test]
    fn parse_input_value_general_hint_date_shaped_still_serial() {
        match parse_input_value("3/15/2024", Some(FormatType::General)) {
            ParsedValue::Number(n) => {
                assert!((n - 45366.0).abs() < 1e-9, "got {n}");
            }
            other => panic!("expected Number(serial), got {other:?}"),
        }
    }

    /// Phase-2 negative control: Date hint of course still parses as a
    /// serial — that's the format-matched case the date branch is for.
    #[test]
    fn parse_input_value_date_hint_date_shaped_still_serial() {
        match parse_input_value("3/15/2024", Some(FormatType::Date)) {
            ParsedValue::Number(n) => {
                assert!((n - 45366.0).abs() < 1e-9, "got {n}");
            }
            other => panic!("expected Number(serial), got {other:?}"),
        }
    }

    /// Phase-2 negative control: `Custom` stays permissive on the date
    /// branch — by definition we don't know what a custom format expects.
    /// Phase-1 stickiness still keeps the format string intact.
    #[test]
    fn parse_input_value_custom_hint_date_shaped_still_serial() {
        match parse_input_value("3/15/2024", Some(FormatType::Custom)) {
            ParsedValue::Number(n) => {
                assert!((n - 45366.0).abs() < 1e-9, "got {n}");
            }
            other => panic!("expected Number(serial), got {other:?}"),
        }
    }

    /// Phase-2 negative control: Time hint stays permissive — time and
    /// date share the serial space, so date-shaped input under a Time
    /// format still parses to the serial (the user can have a time-of-
    /// day-only formatted cell that nonetheless contains a full
    /// date-time value).
    #[test]
    fn parse_input_value_time_hint_date_shaped_still_serial() {
        match parse_input_value("3/15/2024", Some(FormatType::Time)) {
            ParsedValue::Number(n) => {
                assert!((n - 45366.0).abs() < 1e-9, "got {n}");
            }
            other => panic!("expected Number(serial), got {other:?}"),
        }
    }
}

// ---------------------------------------------------------------------------
// Cell read/write methods on YrsStorage (moved from mod.rs)
// ---------------------------------------------------------------------------

use cell_types::SheetPos;
use compute_document::cell_serde::{
    build_cell_prelim, read_identity_formula_from_yrs, write_identity_formula_to_yrs,
};
use formula_types::IdentityFormula;

use crate::storage::YrsStorage;

impl YrsStorage {
    /// Read a cell value directly from the yrs document.
    ///
    /// Returns (value, legacy_formula, identity_formula).
    pub fn read_cell_from_yrs(
        &self,
        sheet_id: &SheetId,
        cell_id: &CellId,
    ) -> Option<(CellValue, Option<String>, Option<IdentityFormula>)> {
        self.read_cell_from_yrs_full(sheet_id, cell_id)
            .map(|(v, f, idf, _ar)| (v, f, idf))
    }

    /// Like [`Self::read_cell_from_yrs`] but also returns the persisted
    /// CSE array-formula range (`KEY_ARRAY_REF`) when present.
    ///
    /// table dependency work T6: CSE markers are persisted into Yrs (anchor cells
    /// carry `KEY_ARRAY_REF = "A1:C5"` style range). Hydration paths
    /// (`build_sheet_snapshot_from_yrs`) call this so undo/redo restores
    /// the array-formula brace, not just the value.
    #[allow(clippy::type_complexity)]
    pub fn read_cell_from_yrs_full(
        &self,
        sheet_id: &SheetId,
        cell_id: &CellId,
    ) -> Option<(
        CellValue,
        Option<String>,
        Option<IdentityFormula>,
        Option<String>,
    )> {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let cell_hex = id_to_hex(cell_id.as_u128());

        let txn = self.doc.transact();
        let sheet_map = match self.sheets.get(&txn, &sheet_hex) {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let cells_map = match sheet_map.get(&txn, compute_document::schema::KEY_CELLS) {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let cell_map = match cells_map.get(&txn, &cell_hex) {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };

        let value = yrs_any_to_cell_value(&cell_map, &txn);
        let formula = match cell_map.get(&txn, compute_document::schema::KEY_FORMULA) {
            Some(yrs::Out::Any(yrs::Any::String(s))) => {
                let f = s.to_string();
                // KEY_FORMULA stores body only (without '='); re-add it for callers.
                if f.starts_with('=') {
                    Some(f)
                } else {
                    Some(format!("={}", f))
                }
            }
            _ => None,
        };
        let identity_formula = read_identity_formula_from_yrs(&cell_map, &txn);
        let array_ref = compute_document::cell_serde::read_array_ref_from_yrs(&cell_map, &txn);

        Some((value, formula, identity_formula, array_ref))
    }

    /// Read a cell's position from the yrs document.
    ///
    /// Reads `gridIndex/idToPos` (the authoritative yrs-side identity
    /// store post-GridIndex migration), decomposes the `"rowHex:colHex"` value, and
    /// resolves the row/column indices via the `rowOrder` / `colOrder`
    /// YArrays. Returns `None` when the mapping is absent (cell never
    /// written, or written before the yrs-side mirror was introduced).
    ///
    /// Used by observer-driven paths (`apply_cell_changes`) during
    /// undo/redo when the in-memory `GridIndex` has been cleared and
    /// must be re-populated from yrs.
    pub fn read_cell_position_from_yrs(
        &self,
        sheet_id: &SheetId,
        cell_id: &CellId,
    ) -> Option<SheetPos> {
        use crate::storage::infra::grid_helpers;
        use compute_document::schema::KEY_GRID_INDEX;

        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let cell_hex = id_to_hex(cell_id.as_u128());
        let txn = self.doc.transact();

        let sheet_map = match self.sheets.get(&txn, &sheet_hex) {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let gi_map = match sheet_map.get(&txn, KEY_GRID_INDEX) {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let id_to_pos = match gi_map.get(&txn, "idToPos") {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let pos_key = match id_to_pos.get(&txn, &cell_hex) {
            Some(yrs::Out::Any(yrs::Any::String(s))) => s.to_string(),
            _ => return None,
        };
        let (row_hex, col_hex) = pos_key.split_once(':')?;

        // Resolve row/col indices via rowOrder / colOrder arrays.
        let row_arr = grid_helpers::get_row_order_array(&sheet_map, &txn)?;
        let col_arr = grid_helpers::get_col_order_array(&sheet_map, &txn)?;
        let mut row_idx: Option<u32> = None;
        for i in 0..row_arr.len(&txn) {
            if let Some(yrs::Out::Any(yrs::Any::String(s))) = row_arr.get(&txn, i)
                && s.as_ref() == row_hex
            {
                row_idx = Some(i);
                break;
            }
        }
        let mut col_idx: Option<u32> = None;
        for i in 0..col_arr.len(&txn) {
            if let Some(yrs::Out::Any(yrs::Any::String(s))) = col_arr.get(&txn, i)
                && s.as_ref() == col_hex
            {
                col_idx = Some(i);
                break;
            }
        }
        Some(SheetPos::new(row_idx?, col_idx?))
    }

    /// Read which CellId currently owns a position in the yrs document.
    ///
    /// Reads `gridIndex/posToId` by constructing the `"rowHex:colHex"` key
    /// from the `rowOrder` / `colOrder` YArrays. Returns `None` when the
    /// position is unmapped. Consumers that have an in-memory `GridIndex`
    /// available should prefer that store — this method exists for paths
    /// (collaboration sync, observer recovery) where the in-memory index
    /// may be stale or absent.
    pub fn read_cell_id_at_pos(&self, sheet_id: &SheetId, row: u32, col: u32) -> Option<CellId> {
        use crate::storage::infra::grid_helpers;
        use compute_document::hex::hex_to_id;
        use compute_document::schema::KEY_GRID_INDEX;

        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let txn = self.doc.transact();

        let sheet_map = match self.sheets.get(&txn, &sheet_hex) {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let row_arr = grid_helpers::get_row_order_array(&sheet_map, &txn)?;
        let col_arr = grid_helpers::get_col_order_array(&sheet_map, &txn)?;
        let row_hex = match row_arr.get(&txn, row) {
            Some(yrs::Out::Any(yrs::Any::String(s))) => s.to_string(),
            _ => return None,
        };
        let col_hex = match col_arr.get(&txn, col) {
            Some(yrs::Out::Any(yrs::Any::String(s))) => s.to_string(),
            _ => return None,
        };
        let pos_key = format!("{}:{}", row_hex, col_hex);
        let gi_map = match sheet_map.get(&txn, KEY_GRID_INDEX) {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let pos_to_id = match gi_map.get(&txn, "posToId") {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let cell_hex = match pos_to_id.get(&txn, pos_key.as_str()) {
            Some(yrs::Out::Any(yrs::Any::String(s))) => s.to_string(),
            _ => return None,
        };
        hex_to_id(&cell_hex).map(CellId::from_raw)
    }

    /// Write a cell value + optional formula. Updates both yrs doc and mirror.
    #[allow(clippy::too_many_arguments)]
    pub fn set_cell(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        value: CellValue,
        formula: Option<String>,
        identity_formula: Option<IdentityFormula>,
    ) {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let cell_hex = id_to_hex(cell_id.as_u128());

        {
            let mut txn = self.doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

            // Navigate to cells map
            if let Some(yrs::Out::YMap(sheet_map)) = self.sheets.get(&txn, &sheet_hex)
                && let Some(yrs::Out::YMap(cells_map)) =
                    sheet_map.get(&txn, compute_document::schema::KEY_CELLS)
            {
                let cell_prelim =
                    build_cell_prelim(&value, formula.as_deref(), identity_formula.as_ref());
                let cell_map: yrs::MapRef = cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
                if let Some(idf) = &identity_formula
                    && let Err(e) = write_identity_formula_to_yrs(&cell_map, &mut txn, idf)
                {
                    tracing::error!("write_identity_formula_to_yrs failed: {e}");
                }
            }
        }

        // Update mirror with the identity formula.
        mirror.apply_edit(
            sheet_id,
            cell_id,
            SheetPos::new(row, col),
            value,
            identity_formula,
        );
    }

    /// Remove a cell from both yrs doc and mirror.
    pub fn remove_cell(&mut self, mirror: &mut CellMirror, sheet_id: &SheetId, cell_id: &CellId) {
        self.remove_cell_with_origin(mirror, sheet_id, cell_id, None);
    }

    /// Remove a cell with an explicit origin tag for the yrs transaction.
    pub fn remove_cell_with_origin(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        cell_id: &CellId,
        origin: Option<&[u8]>,
    ) {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let cell_hex = id_to_hex(cell_id.as_u128());

        {
            let mut txn = match origin {
                Some(o) => self.doc.transact_mut_with(yrs::Origin::from(o)),
                None => self.doc.transact_mut(),
            };
            if let Some(yrs::Out::YMap(sheet_map)) = self.sheets.get(&txn, &sheet_hex)
                && let Some(yrs::Out::YMap(cells_map)) =
                    sheet_map.get(&txn, compute_document::schema::KEY_CELLS)
            {
                cells_map.remove(&mut txn, &cell_hex);
            }
            // Also drop the yrs-side identity mapping so stale entries
            // don't leak into `read_cell_position_from_yrs` / CRDT sync.
            remove_cell_position_from_yrs(&mut txn, &self.sheets, &sheet_hex, &cell_hex);
        }

        mirror.remove_cell(cell_id);
    }
}
