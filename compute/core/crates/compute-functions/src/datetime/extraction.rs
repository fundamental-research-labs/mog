// Mechanical split from datetime.rs; keep behavior changes out of this refactor.

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

pub struct FnYear;
impl PureFunction for FnYear {
    fn name(&self) -> &'static str {
        "YEAR"
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
        match args[0].coerce_to_number() {
            Ok(n) => {
                if n < 0.0 {
                    CellValue::error_with_message(
                        CellError::Num,
                        format!("YEAR: serial number must be non-negative, got {n}"),
                    )
                } else {
                    let (y, _, _) = crate::helpers::date_serial::serial_to_ymd(n);
                    CellValue::number(y as f64)
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub struct FnMonth;
impl PureFunction for FnMonth {
    fn name(&self) -> &'static str {
        "MONTH"
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
        match args[0].coerce_to_number() {
            Ok(n) => {
                if n < 0.0 {
                    CellValue::error_with_message(
                        CellError::Num,
                        format!("MONTH: serial number must be non-negative, got {n}"),
                    )
                } else {
                    let (_, m, _) = crate::helpers::date_serial::serial_to_ymd(n);
                    CellValue::number(m as f64)
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub struct FnDay;
impl PureFunction for FnDay {
    fn name(&self) -> &'static str {
        "DAY"
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
        match args[0].coerce_to_number() {
            Ok(n) => {
                if n < 0.0 {
                    CellValue::error_with_message(
                        CellError::Num,
                        format!("DAY: serial number must be non-negative, got {n}"),
                    )
                } else {
                    let (_, _, d) = crate::helpers::date_serial::serial_to_ymd(n);
                    CellValue::number(d as f64)
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub struct FnHour;
impl PureFunction for FnHour {
    fn name(&self) -> &'static str {
        "HOUR"
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
        match args[0].coerce_to_number() {
            Ok(n) => {
                let frac = n - n.floor();
                let total_seconds = (frac * 86400.0).round() as u32;
                let hours = total_seconds / 3600;
                CellValue::number(hours as f64)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub struct FnMinute;
impl PureFunction for FnMinute {
    fn name(&self) -> &'static str {
        "MINUTE"
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
        match args[0].coerce_to_number() {
            Ok(n) => {
                let frac = n - n.floor();
                let total_seconds = (frac * 86400.0).round() as u32;
                let minutes = (total_seconds % 3600) / 60;
                CellValue::number(minutes as f64)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub struct FnSecond;
impl PureFunction for FnSecond {
    fn name(&self) -> &'static str {
        "SECOND"
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
        match args[0].coerce_to_number() {
            Ok(n) => {
                let frac = n - n.floor();
                let total_seconds = (frac * 86400.0).round() as u32;
                let seconds = total_seconds % 60;
                CellValue::number(seconds as f64)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnYear));
    registry.register(Box::new(FnMonth));
    registry.register(Box::new(FnDay));
    registry.register(Box::new(FnHour));
    registry.register(Box::new(FnMinute));
    registry.register(Box::new(FnSecond));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PureFunction;
    use crate::datetime::test_helpers::*;
    use crate::helpers::date_serial::date_to_serial;
    use chrono::NaiveDate;
    use value_types::{CellError, CellValue};

    #[test]
    fn test_year_month_day() {
        // 2024-01-15
        let d = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let serial = num(date_to_serial(&d));
        assert_eq!(FnYear.call(std::slice::from_ref(&serial)), num(2024.0));
        assert_eq!(FnMonth.call(std::slice::from_ref(&serial)), num(1.0));
        assert_eq!(FnDay.call(&[serial]), num(15.0));
    }

    #[test]
    fn test_hour_minute_second() {
        // 12:30:45 PM = 0.521354...
        let time = 0.5 + 30.0 / 1440.0 + 45.0 / 86400.0;
        let serial = num(45000.0 + time);
        assert_eq!(FnHour.call(std::slice::from_ref(&serial)), num(12.0));
        assert_eq!(FnMinute.call(std::slice::from_ref(&serial)), num(30.0));
        assert_eq!(FnSecond.call(&[serial]), num(45.0));
    }

    // -----------------------------------------------------------------------
    // Serial 60 (Lotus 1-2-3 bug: fictional Feb 29, 1900) tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_serial_0_year_month_day() {
        // Serial 0 = "January 0, 1900" (Excel quirk)
        assert_eq!(FnYear.call(&[num(0.0)]), num(1900.0));
        assert_eq!(FnMonth.call(&[num(0.0)]), num(1.0));
        assert_eq!(FnDay.call(&[num(0.0)]), num(0.0));
    }

    #[test]
    fn test_serial_negative_year_month_day() {
        // Negative serials should return #NUM!
        assert!(matches!(
            FnYear.call(&[num(-1.0)]),
            CellValue::Error(CellError::Num, _)
        ));
        assert!(matches!(
            FnMonth.call(&[num(-1.0)]),
            CellValue::Error(CellError::Num, _)
        ));
        assert!(matches!(
            FnDay.call(&[num(-1.0)]),
            CellValue::Error(CellError::Num, _)
        ));
    }

    #[test]
    fn test_serial_60_year_month_day() {
        // Serial 60 = fictional Feb 29, 1900
        assert_eq!(FnYear.call(&[num(60.0)]), num(1900.0));
        assert_eq!(FnMonth.call(&[num(60.0)]), num(2.0));
        assert_eq!(FnDay.call(&[num(60.0)]), num(29.0));
    }

    #[test]
    fn test_serial_61_year_month_day() {
        // Serial 61 = March 1, 1900 (first real date after the fake leap day)
        assert_eq!(FnYear.call(&[num(61.0)]), num(1900.0));
        assert_eq!(FnMonth.call(&[num(61.0)]), num(3.0));
        assert_eq!(FnDay.call(&[num(61.0)]), num(1.0));
    }
}
