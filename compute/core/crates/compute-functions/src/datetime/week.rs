// Mechanical split from datetime.rs; keep behavior changes out of this refactor.

use chrono::{Datelike, NaiveDate};

use value_types::{CellError, CellValue};

use crate::datetime::calendar::{excel_dow_from_serial, excel_iso_week_from_serial};
use crate::helpers::coercion::check_error;
use crate::helpers::date_serial::{date_to_serial, serial_to_date};
use crate::{FunctionRegistry, PureFunction};

pub struct FnWeekday;
impl PureFunction for FnWeekday {
    fn name(&self) -> &'static str {
        "WEEKDAY"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            1 => Some(CellValue::number(1.0)), // return_type defaults to 1 (Sunday=1)
            _ => None,
        }
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let return_type = if args.len() > 1 {
            match args[1].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };
        // Compute day-of-week directly from serial number to match Excel's
        // Lotus 1-2-3 bug calendar. Using chrono weekday would give the wrong
        // result for serials 1-59 (before the fake Feb 29, 1900).
        match excel_dow_from_serial(serial) {
            Some(dow) => {
                let dow = dow as i32; // 0=Sun, 1=Mon, ..., 6=Sat
                let result = match return_type {
                    1 => dow + 1, // 1=Sun, 7=Sat (default)
                    2 => {
                        // 1=Mon, 7=Sun
                        if dow == 0 { 7 } else { dow }
                    }
                    3 => {
                        // 0=Mon, 6=Sun
                        if dow == 0 { 6 } else { dow - 1 }
                    }
                    // Return types 11-17: ((dow - offset + 7) % 7) + 1
                    // 11: Mon=1..Sun=7  (offset=1)
                    // 12: Tue=1..Mon=7  (offset=2)
                    // 13: Wed=1..Tue=7  (offset=3)
                    // 14: Thu=1..Wed=7  (offset=4)
                    // 15: Fri=1..Thu=7  (offset=5)
                    // 16: Sat=1..Fri=7  (offset=6)
                    // 17: Sun=1..Sat=7  (offset=0)
                    11 => ((dow - 1 + 7) % 7) + 1,
                    12 => ((dow - 2 + 7) % 7) + 1,
                    13 => ((dow - 3 + 7) % 7) + 1,
                    14 => ((dow - 4 + 7) % 7) + 1,
                    15 => ((dow - 5 + 7) % 7) + 1,
                    16 => ((dow - 6 + 7) % 7) + 1,
                    17 => (dow % 7) + 1,
                    _ => {
                        return CellValue::error_with_message(
                            CellError::Num,
                            format!("WEEKDAY: invalid return_type {return_type}"),
                        );
                    }
                };
                CellValue::number(result as f64)
            }
            None => CellValue::error_with_message(
                CellError::Num,
                "WEEKDAY: invalid serial number".to_string(),
            ),
        }
    }
}
pub struct FnIsoWeekNum;

impl PureFunction for FnIsoWeekNum {
    fn name(&self) -> &'static str {
        "ISOWEEKNUM"
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
        let serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        // Use Excel serial-based ISO week calculation for Lotus bug consistency
        CellValue::number(excel_iso_week_from_serial(serial) as f64)
    }
}

pub struct FnWeekNum;
impl PureFunction for FnWeekNum {
    fn name(&self) -> &'static str {
        "WEEKNUM"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            1 => Some(CellValue::number(1.0)), // return_type defaults to 1 (Sunday start)
            _ => None,
        }
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let return_type = if args.len() > 1 {
            match args[1].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };
        let date = match serial_to_date(serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("WEEKNUM: invalid date serial number {serial}"),
                );
            }
        };

        if return_type == 21 {
            // ISO week number - use Excel serial-based calculation for
            // Lotus 1-2-3 bug consistency
            return CellValue::number(excel_iso_week_from_serial(serial) as f64);
        }

        // Determine first day of week based on return_type
        // return_type 1 or 17: Sunday=0, 2 or 11: Monday=0, etc.
        let week_start_dow = match return_type {
            1 => 0u32, // Sunday
            2 => 1,    // Monday
            11 => 1,   // Monday
            12 => 2,   // Tuesday
            13 => 3,   // Wednesday
            14 => 4,   // Thursday
            15 => 5,   // Friday
            16 => 6,   // Saturday
            17 => 0,   // Sunday
            _ => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("WEEKNUM: invalid return_type {return_type}"),
                );
            }
        };

        // Compute Jan 1 day-of-week using serial number arithmetic to match
        // Excel's Lotus 1-2-3 bug calendar (avoids chrono weekday mismatch for 1900).
        let jan1 = match NaiveDate::from_ymd_opt(date.year(), 1, 1) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    "WEEKNUM: failed to construct Jan 1",
                );
            }
        };
        let jan1_serial = date_to_serial(&jan1);
        let jan1_dow = excel_dow_from_serial(jan1_serial).expect("valid serial from NaiveDate");

        // Days from Jan 1 to the date
        let day_of_year = (date - jan1).num_days();

        // Calculate week number
        // Shift by week_start_dow
        let adjusted_jan1 = (jan1_dow + 7 - week_start_dow) % 7;
        let week = (day_of_year as u32 + adjusted_jan1) / 7 + 1;

        CellValue::number(week as f64)
    }
}

pub(super) fn register_weekday(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnWeekday));
}

pub(super) fn register_isoweeknum(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnIsoWeekNum));
}

pub(super) fn register_weeknum(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnWeekNum));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PureFunction;
    use crate::datetime::test_helpers::*;
    use crate::helpers::date_serial::date_to_serial;
    use chrono::NaiveDate;

    #[test]
    fn test_weekday() {
        let f = FnWeekday;
        // 2024-01-15 is a Monday
        let mon = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let serial = num(date_to_serial(&mon));
        assert_eq!(f.call(std::slice::from_ref(&serial)), num(2.0)); // type 1: Mon=2
        assert_eq!(f.call(&[serial.clone(), num(2.0)]), num(1.0)); // type 2: Mon=1
    }

    #[test]
    fn test_isoweeknum() {
        let f = FnIsoWeekNum;
        // 2024-01-01 is Monday, ISO week 1
        let d = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        assert_eq!(f.call(&[num(date_to_serial(&d))]), num(1.0));
        // 2024-12-30 is Monday of ISO week 1 of 2025
        let d2 = NaiveDate::from_ymd_opt(2024, 12, 30).unwrap();
        assert_eq!(f.call(&[num(date_to_serial(&d2))]), num(1.0));
    }

    #[test]
    fn test_isoweeknum_year_end() {
        let f = FnIsoWeekNum;
        // 2020-12-31 is Thursday, ISO week 53
        let d = NaiveDate::from_ymd_opt(2020, 12, 31).unwrap();
        assert_eq!(f.call(&[num(date_to_serial(&d))]), num(53.0));
        // 2021-01-01 is Friday, still ISO week 53 of 2020
        let d2 = NaiveDate::from_ymd_opt(2021, 1, 1).unwrap();
        assert_eq!(f.call(&[num(date_to_serial(&d2))]), num(53.0));
        // 2019-12-28 is Saturday, ISO week 52
        let d3 = NaiveDate::from_ymd_opt(2019, 12, 28).unwrap();
        assert_eq!(f.call(&[num(date_to_serial(&d3))]), num(52.0));
    }

    #[test]
    fn test_weeknum_sunday_start() {
        let f = FnWeekNum;
        // 2024-01-01 is Monday. Week 1 starts Sunday Dec 31, 2023.
        // So Jan 1 2024 is in week 1 with Sunday start (return_type=1).
        let d = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let result = f.call(&[num(date_to_serial(&d)), num(1.0)]);
        assert_eq!(result, num(1.0));
    }

    #[test]
    fn test_weeknum_iso() {
        let f = FnWeekNum;
        // ISO week: return_type=21
        let d = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let result = f.call(&[num(date_to_serial(&d)), num(21.0)]);
        assert_eq!(result, num(1.0));
    }

    #[test]
    fn test_weeknum_iso_year_end() {
        let f = FnWeekNum;
        // ISO week: return_type=21
        // 2019-12-28 is Saturday, ISO week 52
        let d = NaiveDate::from_ymd_opt(2019, 12, 28).unwrap();
        let result = f.call(&[num(date_to_serial(&d)), num(21.0)]);
        assert_eq!(result, num(52.0));
        // 2020-12-31 is Thursday, ISO week 53
        let d2 = NaiveDate::from_ymd_opt(2020, 12, 31).unwrap();
        let result2 = f.call(&[num(date_to_serial(&d2)), num(21.0)]);
        assert_eq!(result2, num(53.0));
    }

    // -----------------------------------------------------------------------
    // WEEKDAY return types 11-17
    // -----------------------------------------------------------------------

    #[test]
    fn test_weekday_return_types_11_to_17() {
        let f = FnWeekday;
        // 2024-01-15 is a Monday (dow_sun=1)
        let mon = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let serial = num(date_to_serial(&mon));

        // Type 11: Mon=1..Sun=7
        assert_eq!(f.call(&[serial.clone(), num(11.0)]), num(1.0));
        // Type 12: Tue=1..Mon=7 -> Mon=7
        assert_eq!(f.call(&[serial.clone(), num(12.0)]), num(7.0));
        // Type 13: Wed=1..Tue=7 -> Mon=6
        assert_eq!(f.call(&[serial.clone(), num(13.0)]), num(6.0));
        // Type 14: Thu=1..Wed=7 -> Mon=5
        assert_eq!(f.call(&[serial.clone(), num(14.0)]), num(5.0));
        // Type 15: Fri=1..Thu=7 -> Mon=4
        assert_eq!(f.call(&[serial.clone(), num(15.0)]), num(4.0));
        // Type 16: Sat=1..Fri=7 -> Mon=3
        assert_eq!(f.call(&[serial.clone(), num(16.0)]), num(3.0));
        // Type 17: Sun=1..Sat=7 -> Mon=2
        assert_eq!(f.call(&[serial.clone(), num(17.0)]), num(2.0));

        // Also test with Sunday (2024-01-14, dow_sun=0)
        let sun = NaiveDate::from_ymd_opt(2024, 1, 14).unwrap();
        let sun_serial = num(date_to_serial(&sun));
        // Type 11: Mon=1..Sun=7 -> Sun=7
        assert_eq!(f.call(&[sun_serial.clone(), num(11.0)]), num(7.0));
        // Type 17: Sun=1..Sat=7 -> Sun=1
        assert_eq!(f.call(&[sun_serial.clone(), num(17.0)]), num(1.0));
    }

    #[test]
    fn test_weekday_sunday_serial_44927() {
        let f = FnWeekday;
        // Serial 44927 = Jan 1, 2023 (Sunday)
        // WEEKDAY(44927, 1) should be 1 (Sunday in type 1)
        assert_eq!(f.call(&[num(44927.0)]), num(1.0));
        // WEEKDAY(44927, 2) should be 7 (Sunday in type 2)
        assert_eq!(f.call(&[num(44927.0), num(2.0)]), num(7.0));
        // WEEKDAY(44927, 3) should be 6 (Sunday in type 3)
        assert_eq!(f.call(&[num(44927.0), num(3.0)]), num(6.0));
    }

    /// Test WEEKDAY for serial 1 (Jan 1, 1900) — the Lotus 1-2-3 bug boundary.
    /// Excel considers serial 1 = Sunday. Our old chrono-based code returned Monday.
    #[test]
    fn test_weekday_serial_1_lotus_bug() {
        let f = FnWeekday;
        // Serial 1 = Jan 1, 1900. Excel says Sunday (dow=0).
        // WEEKDAY(1, 1) = 1 (Sunday)
        assert_eq!(f.call(&[num(1.0)]), num(1.0));
        // WEEKDAY(1, 2) = 7 (Sunday)
        assert_eq!(f.call(&[num(1.0), num(2.0)]), num(7.0));
        // WEEKDAY(1, 3) = 6 (Sunday)
        assert_eq!(f.call(&[num(1.0), num(3.0)]), num(6.0));

        // Serial 2 = Jan 2, 1900. Excel says Monday (dow=1). Type 1: 2
        assert_eq!(f.call(&[num(2.0)]), num(2.0));

        // Serial 7 = Jan 7, 1900. Excel says Saturday (dow=6). Type 1: 7
        assert_eq!(f.call(&[num(7.0)]), num(7.0));

        // Serial 8 = Jan 8, 1900. Excel says Sunday (dow=0). Type 1: 1
        assert_eq!(f.call(&[num(8.0)]), num(1.0));

        // Serial 59 = Feb 28, 1900. (59-1)%7=58%7=2 => Tuesday (dow=2). Type 1: 3
        assert_eq!(f.call(&[num(59.0)]), num(3.0));

        // Serial 60 = fake Feb 29, 1900. (60-1)%7=59%7=3 => Wednesday (dow=3). Type 1: 4
        assert_eq!(f.call(&[num(60.0)]), num(4.0));

        // Serial 61 = Mar 1, 1900. (61-1)%7=60%7=4 => Thursday (dow=4). Type 1: 5
        // Real calendar: Mar 1, 1900 is Thursday. Aligned!
        assert_eq!(f.call(&[num(61.0)]), num(5.0));
    }
}
