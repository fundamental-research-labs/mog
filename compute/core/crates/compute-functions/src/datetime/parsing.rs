// Mechanical split from datetime.rs; keep behavior changes out of this refactor.

use chrono::Timelike;

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

pub struct FnDatevalue;
impl PureFunction for FnDatevalue {
    fn name(&self) -> &'static str {
        "DATEVALUE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let text = match args[0].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let trimmed = text.trim();
        // Try date-only first, then datetime (discarding time portion like Excel).
        match value_types::date_serial::try_parse_date(trimmed)
            .or_else(|_| value_types::date_serial::try_parse_datetime(trimmed).map(|s| s.floor()))
        {
            Ok(serial) => CellValue::number(serial),
            Err(_) => CellValue::error_with_message(
                CellError::Value,
                format!("DATEVALUE: could not parse '{trimmed}' as a date"),
            ),
        }
    }
}

pub struct FnTimeValue;
impl PureFunction for FnTimeValue {
    fn name(&self) -> &'static str {
        "TIMEVALUE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let text = match args[0].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        // Try common time formats
        let formats = [
            "%H:%M:%S",
            "%H:%M",
            "%I:%M:%S %p",
            "%I:%M:%S %P",
            "%I:%M %p",
            "%I:%M %P",
        ];
        for fmt in &formats {
            if let Ok(t) = chrono::NaiveTime::parse_from_str(text.trim(), fmt) {
                let total_seconds =
                    t.hour() as f64 * 3600.0 + t.minute() as f64 * 60.0 + t.second() as f64;
                return CellValue::number(total_seconds / 86400.0);
            }
        }
        CellValue::error_with_message(
            CellError::Value,
            format!("TIMEVALUE: could not parse '{}' as a time", text.trim()),
        )
    }
}

pub(super) fn register_datevalue(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnDatevalue));
}

pub(super) fn register_timevalue(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnTimeValue));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PureFunction;
    use crate::datetime::test_helpers::*;
    use crate::helpers::date_serial::serial_to_date;
    use chrono::NaiveDate;
    use value_types::{CellError, CellValue};

    #[test]
    fn test_datevalue() {
        let f = FnDatevalue;
        let result = f.call(&[text("2024-01-15")]);
        if let CellValue::Number(n) = result {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2024, 1, 15).unwrap());
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_datevalue_invalid() {
        let f = FnDatevalue;
        assert_eq!(f.call(&[text("not a date")]), err(CellError::Value));
    }

    #[test]
    fn test_datevalue_datetime_strips_time() {
        // Excel: DATEVALUE("01/30/2026 03:50 PM") = 46052 (date only, time discarded)
        let f = FnDatevalue;
        let result = f.call(&[text("01/30/2026 03:50 PM")]);
        if let CellValue::Number(n) = result {
            assert_eq!(n.get(), 46052.0);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_datevalue_datetime_24h_strips_time() {
        let f = FnDatevalue;
        let result = f.call(&[text("01/30/2026 15:50")]);
        if let CellValue::Number(n) = result {
            assert_eq!(n.get(), 46052.0);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_datevalue_accepts_excel_1900_leap_day_forms() {
        let f = FnDatevalue;
        for text_value in ["2/29/1900", "1900-02-29", "February 29, 1900"] {
            let result = f.call(&[text(text_value)]);
            if let CellValue::Number(n) = result {
                assert_eq!(n.get(), 60.0, "failed for {text_value}");
            } else {
                panic!("Expected number for {text_value}, got {:?}", result);
            }
        }
    }

    #[test]
    fn test_datevalue_rejects_nearby_invalid_1900_date() {
        let f = FnDatevalue;
        assert_eq!(f.call(&[text("1900-02-30")]), err(CellError::Value));
    }

    #[test]
    fn test_timevalue() {
        let f = FnTimeValue;
        let result = f.call(&[text("12:30:45")]);
        if let CellValue::Number(n) = result {
            let expected = (12.0 * 3600.0 + 30.0 * 60.0 + 45.0) / 86400.0;
            assert!((n.get() - expected).abs() < 1e-10);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_timevalue_invalid() {
        let f = FnTimeValue;
        assert_eq!(f.call(&[text("not a time")]), err(CellError::Value));
    }
}
