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
        return Ok(serial);
    }

    if serial < 0.0 {
        // Preserve the existing extraction functions' #NUM! behavior for
        // values before their supported epoch.
        Ok(serial)
    } else {
        Ok(context.to_canonical_date_serial(serial))
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
}
