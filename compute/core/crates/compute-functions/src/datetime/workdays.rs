// Mechanical split from datetime.rs; keep behavior changes out of this refactor.

use chrono::NaiveDate;

use value_types::{CellError, CellValue};

use crate::datetime::calendar::{excel_dow_from_serial, is_excel_weekend, is_excel_weekend_mask};
use crate::helpers::coercion::{check_error, flatten_values};
use crate::helpers::date_serial::{date_to_serial, serial_to_date};
use crate::{FunctionRegistry, PureFunction};

pub struct FnNetworkdays;
impl PureFunction for FnNetworkdays {
    fn name(&self) -> &'static str {
        "NETWORKDAYS"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, index: usize) -> bool {
        index < 2
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let start_serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let end_serial = match args[1].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };

        // Optional holidays array
        let holidays: Vec<f64> = if args.len() > 2 {
            let flat = flatten_values(&[args[2].clone()]);
            flat.iter()
                .filter_map(|v| v.coerce_to_number().ok())
                .map(|n| n.floor())
                .collect()
        } else {
            Vec::new()
        };

        // Validate that serial numbers are within a plausible range
        if start_serial.floor() < 1.0 || end_serial.floor() < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                "NETWORKDAYS: date serial numbers must be >= 1".to_string(),
            );
        }

        let (from_serial, to_serial, sign) = if start_serial.floor() <= end_serial.floor() {
            (start_serial.floor(), end_serial.floor(), 1i32)
        } else {
            (end_serial.floor(), start_serial.floor(), -1)
        };

        // Count workdays by iterating over serial numbers directly.
        // This correctly handles the Lotus 1-2-3 bug range (serials 1-60)
        // without losing a day due to NaiveDate's inability to represent
        // the fake Feb 29, 1900 (serial 60).
        let mut count = 0i32;
        let mut s = from_serial;
        while s <= to_serial {
            if !is_excel_weekend(s) && !holidays.iter().any(|&h| (h - s).abs() < 0.5) {
                count += 1;
            }
            s += 1.0;
        }

        CellValue::number((count * sign) as f64)
    }
}

// ---------------------------------------------------------------------------
// Additional date/time functions
// ---------------------------------------------------------------------------
pub struct FnNetworkdaysIntl;

impl PureFunction for FnNetworkdaysIntl {
    fn name(&self) -> &'static str {
        "NETWORKDAYS.INTL"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn is_scalar_arg(&self, index: usize) -> bool {
        index < 3
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let start_serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let end_serial = match args[1].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };

        // Parse weekend parameter
        let weekend_mask = if args.len() > 2 {
            parse_weekend_param(&args[2])
        } else {
            Ok([false, false, false, false, false, true, true]) // Sat, Sun off
        };
        let weekend_mask = match weekend_mask {
            Ok(m) => m,
            Err(e) => return CellValue::Error(e, None),
        };

        // Optional holidays array
        let holidays: Vec<f64> = if args.len() > 3 {
            let flat = flatten_values(&[args[3].clone()]);
            flat.iter()
                .filter_map(|v| v.coerce_to_number().ok())
                .map(|n| n.floor())
                .collect()
        } else {
            Vec::new()
        };

        // Validate that serial numbers are within a plausible range
        if start_serial.floor() < 1.0 || end_serial.floor() < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                "NETWORKDAYS.INTL: date serial numbers must be >= 1".to_string(),
            );
        }

        let (from_serial, to_serial, sign) = if start_serial.floor() <= end_serial.floor() {
            (start_serial.floor(), end_serial.floor(), 1i32)
        } else {
            (end_serial.floor(), start_serial.floor(), -1)
        };

        // Count workdays by iterating over serial numbers directly.
        // This correctly handles the Lotus 1-2-3 bug range (serials 1-60).
        let mut count = 0i32;
        let mut s = from_serial;
        while s <= to_serial {
            if !is_excel_weekend_mask(s, &weekend_mask)
                && !holidays.iter().any(|&h| (h - s).abs() < 0.5)
            {
                count += 1;
            }
            s += 1.0;
        }

        CellValue::number((count * sign) as f64)
    }
}

pub struct FnWorkday;

impl PureFunction for FnWorkday {
    fn name(&self) -> &'static str {
        "WORKDAY"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, index: usize) -> bool {
        index < 2
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let start_serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let days = match args[1].coerce_to_number() {
            Ok(n) => n as i32,
            Err(e) => return CellValue::Error(e, None),
        };

        let holidays: Vec<f64> = if args.len() > 2 {
            let flat = flatten_values(&[args[2].clone()]);
            flat.iter()
                .filter_map(|v| v.coerce_to_number().ok())
                .map(|n| n.floor())
                .collect()
        } else {
            Vec::new()
        };

        let start = match serial_to_date(start_serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("WORKDAY: invalid start date serial number {start_serial}"),
                );
            }
        };

        // Weekend mask: Sat and Sun are off (standard)
        let weekend_mask = [false, false, false, false, false, true, true]; // Mon-Sun

        let result = advance_workdays(start, days, &weekend_mask, &holidays);
        match result {
            Some(d) => {
                let serial = date_to_serial(&d);
                // Excel WORKDAY returns #NUM! when result date is before the epoch (serial < 1)
                if serial < 1.0 {
                    CellValue::error_with_message(
                        CellError::Num,
                        "WORKDAY: resulting date is before the epoch".to_string(),
                    )
                } else {
                    CellValue::number(serial)
                }
            }
            None => CellValue::error_with_message(
                CellError::Num,
                format!("WORKDAY: could not compute workday after advancing {days} days"),
            ),
        }
    }
}

pub struct FnWorkdayIntl;
impl PureFunction for FnWorkdayIntl {
    fn name(&self) -> &'static str {
        "WORKDAY.INTL"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn is_scalar_arg(&self, index: usize) -> bool {
        index < 3
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let start_serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let days = match args[1].coerce_to_number() {
            Ok(n) => n as i32,
            Err(e) => return CellValue::Error(e, None),
        };

        let weekend_mask = if args.len() > 2 {
            parse_weekend_param(&args[2])
        } else {
            Ok([false, false, false, false, false, true, true])
        };
        let weekend_mask = match weekend_mask {
            Ok(m) => m,
            Err(e) => return CellValue::Error(e, None),
        };

        let holidays: Vec<f64> = if args.len() > 3 {
            let flat = flatten_values(&[args[3].clone()]);
            flat.iter()
                .filter_map(|v| v.coerce_to_number().ok())
                .map(|n| n.floor())
                .collect()
        } else {
            Vec::new()
        };

        let start = match serial_to_date(start_serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("WORKDAY.INTL: invalid start date serial number {start_serial}"),
                );
            }
        };

        let result = advance_workdays(start, days, &weekend_mask, &holidays);
        match result {
            Some(d) => {
                let serial = date_to_serial(&d);
                // Excel WORKDAY.INTL returns #NUM! when result date is before the epoch
                if serial < 1.0 {
                    CellValue::error_with_message(
                        CellError::Num,
                        "WORKDAY.INTL: resulting date is before the epoch".to_string(),
                    )
                } else {
                    CellValue::number(serial)
                }
            }
            None => CellValue::error_with_message(
                CellError::Num,
                format!("WORKDAY.INTL: could not compute workday after advancing {days} days"),
            ),
        }
    }
}
fn parse_weekend_param(val: &CellValue) -> Result<[bool; 7], CellError> {
    // Try as string first (7-char "0100000" format)
    if let Ok(s) = val.coerce_to_string()
        && s.len() == 7
        && s.chars().all(|c| c == '0' || c == '1')
    {
        let mut mask = [false; 7];
        for (i, ch) in s.chars().enumerate() {
            mask[i] = ch == '1';
        }
        return Ok(mask);
    }

    // Try as number
    match val.coerce_to_number() {
        Ok(n) => {
            let code = n as i32;
            // Excel NETWORKDAYS.INTL weekend codes:
            // [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
            let mask = match code {
                1 => [false, false, false, false, false, true, true], // Saturday, Sunday
                2 => [true, false, false, false, false, false, true], // Sunday, Monday
                3 => [true, true, false, false, false, false, false], // Monday, Tuesday
                4 => [false, true, true, false, false, false, false], // Tuesday, Wednesday
                5 => [false, false, true, true, false, false, false], // Wednesday, Thursday
                6 => [false, false, false, true, true, false, false], // Thursday, Friday
                7 => [false, false, false, false, true, true, false], // Friday, Saturday
                11 => [false, false, false, false, false, false, true], // Sunday only
                12 => [true, false, false, false, false, false, false], // Monday only
                13 => [false, true, false, false, false, false, false], // Tuesday only
                14 => [false, false, true, false, false, false, false], // Wednesday only
                15 => [false, false, false, true, false, false, false], // Thursday only
                16 => [false, false, false, false, true, false, false], // Friday only
                17 => [false, false, false, false, false, true, false], // Saturday only
                _ => return Err(CellError::Num),
            };
            Ok(mask)
        }
        Err(e) => Err(e),
    }
}

/// Advance by N workdays from a start date, skipping weekends and holidays.
/// Positive days = forward, negative = backward.
/// Uses Excel serial numbers directly to handle the Lotus 1-2-3 bug correctly.
fn advance_workdays(
    start: NaiveDate,
    days: i32,
    weekend_mask: &[bool; 7],
    holidays: &[f64],
) -> Option<NaiveDate> {
    if days == 0 {
        return Some(start);
    }
    let step: i64 = if days > 0 { 1 } else { -1 };
    let mut remaining = days.abs();
    let mut current_serial = date_to_serial(&start).floor() as i64;

    // Safety limit to prevent infinite loops
    let max_iterations = remaining as i64 * 3 + 1000;
    let mut iterations = 0i64;

    while remaining > 0 {
        current_serial += step;
        iterations += 1;
        if iterations > max_iterations {
            return None;
        }

        // Use Excel's serial-based DOW for weekend detection to handle
        // the Lotus 1-2-3 bug correctly for serials 1-59.
        if let Some(dow) = excel_dow_from_serial(current_serial as f64) {
            // dow: 0=Sun, 1=Mon, ..., 6=Sat
            // mask: 0=Mon, 1=Tue, ..., 5=Sat, 6=Sun
            let mask_idx = if dow == 0 { 6 } else { (dow - 1) as usize };
            if !weekend_mask[mask_idx] {
                let s = current_serial as f64;
                if !holidays.iter().any(|&h| (h - s).abs() < 0.5) {
                    remaining -= 1;
                }
            }
        }
    }
    serial_to_date(current_serial as f64)
}

pub(super) fn register_networkdays(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnNetworkdays));
}

pub(super) fn register_networkdays_intl(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnNetworkdaysIntl));
}

pub(super) fn register_workday(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnWorkday));
}

pub(super) fn register_workday_intl(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnWorkdayIntl));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PureFunction;
    use crate::datetime::test_helpers::*;
    use crate::helpers::date_serial::{date_to_serial, serial_to_date};
    use chrono::NaiveDate;
    use value_types::{CellError, CellValue};

    #[test]
    fn test_networkdays() {
        let f = FnNetworkdays;
        // Mon Jan 1 to Fri Jan 5, 2024 = 5 working days
        let mon = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let fri = NaiveDate::from_ymd_opt(2024, 1, 5).unwrap();
        assert_eq!(
            f.call(&[num(date_to_serial(&mon)), num(date_to_serial(&fri))]),
            num(5.0)
        );
    }

    #[test]
    fn test_networkdays_same_day_weekend() {
        let f = FnNetworkdays;
        // Saturday Jan 6, 2024 to itself = 0 (it's a weekend)
        let sat = NaiveDate::from_ymd_opt(2024, 1, 6).unwrap();
        let sat_serial = date_to_serial(&sat);
        assert_eq!(f.call(&[num(sat_serial), num(sat_serial)]), num(0.0));

        // Sunday Jan 7, 2024 to itself = 0 (it's a weekend)
        let sun = NaiveDate::from_ymd_opt(2024, 1, 7).unwrap();
        let sun_serial = date_to_serial(&sun);
        assert_eq!(f.call(&[num(sun_serial), num(sun_serial)]), num(0.0));

        // Monday Jan 8, 2024 to itself = 1 (it's a workday)
        let mon = NaiveDate::from_ymd_opt(2024, 1, 8).unwrap();
        let mon_serial = date_to_serial(&mon);
        assert_eq!(f.call(&[num(mon_serial), num(mon_serial)]), num(1.0));
    }

    #[test]
    fn test_workday() {
        let f = FnWorkday;
        // Start Monday 2024-01-01, add 5 workdays = Monday 2024-01-08
        // (Tue 2, Wed 3, Thu 4, Fri 5, skip Sat/Sun, Mon 8)
        let start = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let result = f.call(&[num(date_to_serial(&start)), num(5.0)]);
        if let CellValue::Number(n) = result {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2024, 1, 8).unwrap());
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_workday_skips_weekend() {
        let f = FnWorkday;
        // Start Friday 2024-01-05, add 1 workday = Monday 2024-01-08
        let start = NaiveDate::from_ymd_opt(2024, 1, 5).unwrap();
        let result = f.call(&[num(date_to_serial(&start)), num(1.0)]);
        if let CellValue::Number(n) = result {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2024, 1, 8).unwrap());
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_workday_negative() {
        let f = FnWorkday;
        // Start Monday 2024-01-08, subtract 1 workday = Friday 2024-01-05
        let start = NaiveDate::from_ymd_opt(2024, 1, 8).unwrap();
        let result = f.call(&[num(date_to_serial(&start)), num(-1.0)]);
        if let CellValue::Number(n) = result {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2024, 1, 5).unwrap());
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_workday_before_epoch_returns_error() {
        let f = FnWorkday;
        // Start from Jan 1, 1900 (serial 1), go back 1 workday -> before epoch -> #NUM!
        let result = f.call(&[num(1.0), num(-1.0)]);
        assert_eq!(result, err(CellError::Num));

        // Start from a date early in 1900, go back many workdays -> before epoch -> #NUM!
        let start = NaiveDate::from_ymd_opt(1900, 1, 10).unwrap();
        let result = f.call(&[num(date_to_serial(&start)), num(-252.0)]);
        assert_eq!(result, err(CellError::Num));
    }

    #[test]
    fn test_workday_intl() {
        let f = FnWorkdayIntl;
        // Same as workday test but with explicit weekend code 1
        let start = NaiveDate::from_ymd_opt(2024, 1, 5).unwrap();
        let result = f.call(&[num(date_to_serial(&start)), num(1.0), num(1.0)]);
        if let CellValue::Number(n) = result {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2024, 1, 8).unwrap());
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_networkdays_intl() {
        let f = FnNetworkdaysIntl;
        // Mon Jan 1 to Fri Jan 5, 2024 = 5 working days (standard weekend)
        let mon = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let fri = NaiveDate::from_ymd_opt(2024, 1, 5).unwrap();
        assert_eq!(
            f.call(&[
                num(date_to_serial(&mon)),
                num(date_to_serial(&fri)),
                num(1.0)
            ],),
            num(5.0)
        );
    }
}
