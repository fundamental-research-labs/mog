//! Workbook date-system boundaries for financial functions.
//!
//! The low-level date helpers intentionally use the canonical Excel 1900
//! serial system.  Financial wrappers receive workbook-relative serials, so
//! this module converts only at the `FunctionContext` boundary.  Date-like
//! text is already parsed by `value-types` into a canonical civil-date serial;
//! numeric text remains a workbook serial and follows numeric coercion.

use value_types::date_serial::{try_parse_date, try_parse_datetime};
use value_types::{CellError, CellValue};

use crate::FunctionContext;

/// Last supported serial in Excel's 1904 date system (31 December 9999).
const MAX_1904_SERIAL: f64 = 2_957_003.0;

/// Last supported serial in the canonical 1900 date system (31 December 9999).
const MAX_CANONICAL_SERIAL: f64 = 2_958_465.0;

/// Convert one date argument to the canonical 1900 serial system.
///
/// `CellValue::Number`, numeric text, blanks, and booleans retain their
/// ordinary numeric coercion semantics.  Text recognized as a civil date or
/// datetime is already canonicalized by `value-types`, so it is not shifted a
/// second time in a 1904 workbook.  Direct calls with the default context
/// remain on the existing 1900 path and do not gain new range checks.
pub(crate) fn canonical_date_arg(
    args: &[CellValue],
    index: usize,
    context: &FunctionContext,
) -> Result<f64, CellError> {
    let value = args.get(index).ok_or(CellError::Value)?;
    canonical_date_value(value, context)
}

/// Convert one date argument and apply the date functions' integer-date rule.
pub(crate) fn canonical_date_arg_truncated(
    args: &[CellValue],
    index: usize,
    context: &FunctionContext,
) -> Result<f64, CellError> {
    let serial = canonical_date_arg(args, index, context)?;
    if !serial.is_finite() || serial < 0.0 {
        return Err(CellError::Num);
    }
    let truncated = serial.trunc();
    if truncated > MAX_CANONICAL_SERIAL {
        return Err(CellError::Num);
    }
    Ok(truncated)
}

/// Convert a date cell while preserving whether text was a civil date or a
/// numeric serial.  This is kept separate from argument indexing so range
/// collectors can retain their established skip/error behavior.
pub(crate) fn canonical_date_value(
    value: &CellValue,
    context: &FunctionContext,
) -> Result<f64, CellError> {
    if let CellValue::Error(error, _) = value {
        return Err(*error);
    }

    if let CellValue::Text(text) = value {
        if let Ok(serial) = try_parse_date(text).or_else(|_| try_parse_datetime(text)) {
            validate_civil_date(serial, context)?;
            return Ok(serial);
        }
    }

    let serial = value.coerce_to_number()?;
    canonical_numeric_serial(serial, context)
}

fn canonical_numeric_serial(serial: f64, context: &FunctionContext) -> Result<f64, CellError> {
    if !context.date1904 {
        return Ok(serial);
    }
    validate_1904_serial(serial)?;
    Ok(context.to_canonical_date_serial(serial))
}

fn validate_civil_date(serial: f64, context: &FunctionContext) -> Result<(), CellError> {
    if !serial.is_finite() {
        return Err(CellError::Value);
    }
    if context.date1904 {
        // The parser returns a canonical 1900 serial. Validate its equivalent
        // workbook serial against the context's Jan 1, 1904 epoch.
        validate_1904_serial(context.from_canonical_date_serial(serial))?;
    }
    Ok(())
}

fn validate_1904_serial(serial: f64) -> Result<(), CellError> {
    if !serial.is_finite() || serial < 0.0 || serial.trunc() > MAX_1904_SERIAL {
        return Err(CellError::Value);
    }
    Ok(())
}
