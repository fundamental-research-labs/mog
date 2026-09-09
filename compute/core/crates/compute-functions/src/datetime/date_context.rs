//! Date-serial coercion at workbook date-system boundaries.
//!
//! `CellValue::coerce_to_number` follows the value layer's precedence: finite
//! numeric text is parsed first, then civil date/datetime text, then time-only
//! text. Civil date and datetime text already produce canonical 1900 serials;
//! workbook serials from numeric values (including blanks and booleans) still
//! need the 1904 offset applied here.

use value_types::date_serial::{try_parse_date, try_parse_datetime};
use value_types::{CellError, CellValue};

use crate::FunctionContext;

/// Number of whole serial days in the supported canonical date range.
pub(crate) const MAX_CANONICAL_DATE_SPAN: i64 = 2_958_466;

/// Last supported canonical 1900 serial (31 December 9999).
pub(crate) const MAX_CANONICAL_DATE_SERIAL: f64 = MAX_CANONICAL_DATE_SPAN as f64 - 1.0;

/// Exclusive upper bound: the next serial is 1 January 10000.
///
/// Fractional values on 31 December 9999 remain valid because date consumers
/// floor the serial before extracting the calendar date.
pub(crate) const MAX_CANONICAL_DATE_SERIAL_EXCLUSIVE: f64 = MAX_CANONICAL_DATE_SPAN as f64;

/// Validate a canonical Excel date serial without changing the existing
/// lower-bound policy of individual datetime functions. Date functions have
/// historically reported negative inputs through their own `#NUM!` paths, so
/// this shared guard only rejects non-finite values and dates after 9999-12-31.
#[inline]
pub(crate) fn validate_canonical_date_serial(serial: f64) -> Result<f64, CellError> {
    if !serial.is_finite() || serial >= MAX_CANONICAL_DATE_SERIAL + 1.0 {
        Err(CellError::Num)
    } else {
        Ok(serial)
    }
}

/// Whether a canonical serial is a valid supported date/time value.
#[inline]
pub(crate) fn is_valid_canonical_date_serial(serial: f64) -> bool {
    serial.is_finite() && (0.0..MAX_CANONICAL_DATE_SERIAL_EXCLUSIVE).contains(&serial)
}

/// Convert one workbook date argument to the canonical 1900 serial system.
///
/// The value layer's numeric coercion remains the source of truth for blanks,
/// booleans, controls, errors, arrays, numeric text, and time-only text. A
/// text value recognized as a civil date or datetime is already canonical and
/// must not be shifted a second time for a 1904 workbook.
pub(crate) fn canonical_date_value(
    value: &CellValue,
    context: &FunctionContext,
) -> Result<f64, CellError> {
    let serial = value.coerce_to_number()?;

    if let CellValue::Text(text) = value
        && is_civil_date_text(text)
    {
        return validate_canonical_date_serial(serial);
    }

    if serial < 0.0 {
        // Preserve the existing extraction functions' #NUM! behavior for
        // values before their supported epoch.
        validate_canonical_date_serial(serial)
    } else {
        validate_canonical_date_serial(context.to_canonical_date_serial(serial))
    }
}

/// Match the date/datetime branch after the value layer's finite numeric-text
/// branch. Time-only text deliberately remains a numeric serial so it follows
/// the workbook date-system boundary like any other fractional serial.
fn is_civil_date_text(text: &str) -> bool {
    let trimmed = text.trim();
    if fast_float::parse::<f64, _>(trimmed)
        .ok()
        .filter(|value| value.is_finite())
        .is_some()
    {
        return false;
    }

    try_parse_date(trimmed)
        .or_else(|_| try_parse_datetime(trimmed))
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FunctionContext;

    fn date1904_context() -> FunctionContext {
        FunctionContext {
            date1904: true,
            ..FunctionContext::default()
        }
    }

    #[test]
    fn numeric_and_numeric_text_receive_the_workbook_offset() {
        let context = date1904_context();
        assert_eq!(
            canonical_date_value(&CellValue::number(43_830.0), &context).unwrap(),
            45_292.0
        );
        assert_eq!(
            canonical_date_value(&CellValue::from("43830"), &context).unwrap(),
            45_292.0
        );
    }

    #[test]
    fn civil_date_and_datetime_text_is_already_canonical() {
        let context = date1904_context();
        assert_eq!(
            canonical_date_value(&CellValue::from("1/1/2024"), &context).unwrap(),
            45_292.0
        );
        assert_eq!(
            canonical_date_value(&CellValue::from("2024-01-01 12:00"), &context).unwrap(),
            45_292.5
        );
    }

    #[test]
    fn blank_boolean_and_time_text_keep_numeric_coercion_semantics() {
        let context = date1904_context();
        assert_eq!(
            canonical_date_value(&CellValue::Null, &context).unwrap(),
            1_462.0
        );
        assert_eq!(
            canonical_date_value(&CellValue::Boolean(true), &context).unwrap(),
            1_463.0
        );
        assert_eq!(
            canonical_date_value(&CellValue::from("1:00"), &context).unwrap(),
            1_462.0 + 1.0 / 24.0
        );
    }

    #[test]
    fn max_supported_date_allows_fractional_day_but_rejects_next_day() {
        assert!(validate_canonical_date_serial(MAX_CANONICAL_DATE_SERIAL).is_ok());
        assert!(validate_canonical_date_serial(MAX_CANONICAL_DATE_SERIAL + 0.999_999).is_ok());
        assert_eq!(
            validate_canonical_date_serial(MAX_CANONICAL_DATE_SERIAL_EXCLUSIVE),
            Err(CellError::Num)
        );
        assert_eq!(validate_canonical_date_serial(1.0e300), Err(CellError::Num));
        assert!(!is_valid_canonical_date_serial(-0.001));
        assert!(is_valid_canonical_date_serial(
            MAX_CANONICAL_DATE_SERIAL + 0.5
        ));
    }
}
