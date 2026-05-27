// Mechanical split from datetime.rs; keep behavior changes out of this refactor.

use chrono::{Datelike, NaiveDate};

use value_types::{CellError, CellValue};

use crate::datetime::array_lift::{array_get, broadcast_dims, has_any_array};
use crate::datetime::calendar::{add_months, last_day_of_month};
use crate::helpers::coercion::check_error;
use crate::helpers::date_serial::{date_to_serial, serial_to_date};
use crate::{FunctionRegistry, PureFunction};

pub struct FnEdate;

fn edate_scalar(args: &[CellValue]) -> CellValue {
    if let Some(e) = check_error(&args[0]) {
        return e;
    }
    if let Some(e) = check_error(&args[1]) {
        return e;
    }
    let serial = match args[0].coerce_to_number() {
        Ok(n) => n,
        Err(e) => return CellValue::Error(e, None),
    };
    let months = match args[1].coerce_to_number() {
        Ok(n) => n as i32,
        Err(e) => return CellValue::Error(e, None),
    };
    match serial_to_date(serial) {
        Some(d) => match add_months(d, months) {
            Some(new_date) => {
                let serial = date_to_serial(&new_date);
                if serial < 1.0 {
                    CellValue::error_with_message(
                        CellError::Num,
                        "EDATE: resulting date is before the epoch".to_string(),
                    )
                } else {
                    CellValue::number(serial)
                }
            }
            None => CellValue::error_with_message(
                CellError::Num,
                format!("EDATE: could not compute date after adding {months} months"),
            ),
        },
        None => CellValue::error_with_message(
            CellError::Num,
            format!("EDATE: invalid start date serial number {serial}"),
        ),
    }
}

impl PureFunction for FnEdate {
    fn name(&self) -> &'static str {
        "EDATE"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // Array broadcasting for SUMPRODUCT compatibility
        if has_any_array(args) {
            let (max_rows, max_cols) = broadcast_dims(args);
            let mut result = Vec::with_capacity(max_rows);
            for row in 0..max_rows {
                let mut row_vals = Vec::with_capacity(max_cols);
                for col in 0..max_cols {
                    let scalar_args: Vec<CellValue> =
                        args.iter().map(|a| array_get(a, row, col)).collect();
                    row_vals.push(edate_scalar(&scalar_args));
                }
                result.push(row_vals);
            }
            return CellValue::from_rows(result);
        }
        edate_scalar(args)
    }
}

pub struct FnEomonth;

/// Scalar EOMONTH logic: takes two scalar CellValues (start_date, months).
fn eomonth_scalar(args: &[CellValue]) -> CellValue {
    if let Some(e) = check_error(&args[0]) {
        return e;
    }
    if let Some(e) = check_error(&args[1]) {
        return e;
    }
    let serial = match args[0].coerce_to_number() {
        Ok(n) => n,
        Err(e) => return CellValue::Error(e, None),
    };
    let months = match args[1].coerce_to_number() {
        Ok(n) => n as i32,
        Err(e) => return CellValue::Error(e, None),
    };
    match serial_to_date(serial) {
        Some(d) => {
            let target_year = d.year() + (d.month0() as i32 + months).div_euclid(12);
            let target_month = ((d.month0() as i32 + months).rem_euclid(12) + 1) as u32;
            let last_day = last_day_of_month(target_year, target_month);
            match NaiveDate::from_ymd_opt(target_year, target_month, last_day) {
                Some(end_date) => {
                    let serial = date_to_serial(&end_date);
                    if serial < 1.0 {
                        CellValue::error_with_message(
                            CellError::Num,
                            "EOMONTH: resulting date is before the epoch".to_string(),
                        )
                    } else {
                        CellValue::number(serial)
                    }
                }
                None => CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "EOMONTH: could not construct end-of-month date for {target_year}-{target_month}"
                    ),
                ),
            }
        }
        None => CellValue::error_with_message(
            CellError::Num,
            format!("EOMONTH: invalid start date serial number {serial}"),
        ),
    }
}

impl PureFunction for FnEomonth {
    fn name(&self) -> &'static str {
        "EOMONTH"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // Array broadcasting for SUMPRODUCT compatibility
        if has_any_array(args) {
            let (max_rows, max_cols) = broadcast_dims(args);
            let mut result = Vec::with_capacity(max_rows);
            for row in 0..max_rows {
                let mut row_vals = Vec::with_capacity(max_cols);
                for col in 0..max_cols {
                    let scalar_args: Vec<CellValue> =
                        args.iter().map(|a| array_get(a, row, col)).collect();
                    row_vals.push(eomonth_scalar(&scalar_args));
                }
                result.push(row_vals);
            }
            return CellValue::from_rows(result);
        }
        eomonth_scalar(args)
    }
}
pub struct FnDatedif;
impl PureFunction for FnDatedif {
    fn name(&self) -> &'static str {
        "DATEDIF"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        if let Some(e) = check_error(&args[2]) {
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
        let unit = match args[2].coerce_to_string() {
            Ok(s) => s.to_uppercase(),
            Err(e) => return CellValue::Error(e, None),
        };
        if start_serial > end_serial {
            return CellValue::error_with_message(
                CellError::Num,
                "DATEDIF: start date must not be after end date".to_string(),
            );
        }
        let start = match serial_to_date(start_serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("DATEDIF: invalid start date serial number {start_serial}"),
                );
            }
        };
        let end = match serial_to_date(end_serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("DATEDIF: invalid end date serial number {end_serial}"),
                );
            }
        };
        let result = match unit.as_str() {
            "Y" => {
                // Complete years
                let mut years = end.year() - start.year();
                if (end.month(), end.day()) < (start.month(), start.day()) {
                    years -= 1;
                }
                years as f64
            }
            "M" => {
                // Complete months
                let mut months =
                    (end.year() - start.year()) * 12 + end.month() as i32 - start.month() as i32;
                if end.day() < start.day() {
                    months -= 1;
                }
                months as f64
            }
            "D" => {
                // Use serial difference directly to account for the Lotus 1-2-3
                // fake Feb 29, 1900 (serial 60) which NaiveDate can't represent.
                end_serial.floor() - start_serial.floor()
            }
            "MD" => {
                // Days ignoring months and years
                let mut days = end.day() as i32 - start.day() as i32;
                if days < 0 {
                    // Get days in previous month
                    let prev_month = if end.month() == 1 {
                        NaiveDate::from_ymd_opt(end.year() - 1, 12, 1)
                    } else {
                        NaiveDate::from_ymd_opt(end.year(), end.month() - 1, 1)
                    };
                    if let Some(pm) = prev_month {
                        let days_in_prev = last_day_of_month(pm.year(), pm.month());
                        days += days_in_prev as i32;
                    }
                }
                days as f64
            }
            "YM" => {
                // Months ignoring years
                let mut months = end.month() as i32 - start.month() as i32;
                if end.day() < start.day() {
                    months -= 1;
                }
                if months < 0 {
                    months += 12;
                }
                months as f64
            }
            "YD" => {
                // Days ignoring years
                let end_adjusted = NaiveDate::from_ymd_opt(start.year(), end.month(), end.day());
                let end_adjusted = match end_adjusted {
                    Some(ea) if ea >= start => Some(ea),
                    _ => NaiveDate::from_ymd_opt(start.year() + 1, end.month(), end.day()),
                };
                match end_adjusted {
                    Some(ea) => {
                        let mut days = (ea - start).num_days() as f64;
                        // Account for the Lotus 1-2-3 fake Feb 29, 1900 (serial 60).
                        // NaiveDate can't represent it, so if the adjusted range crosses
                        // where serial 60 would be (start <= 59 and end_adjusted >= Mar 1, 1900),
                        // we need to add 1 day.
                        let start_s = date_to_serial(&start);
                        let ea_s = date_to_serial(&ea);
                        if start_s <= 59.0 && ea_s >= 61.0 {
                            days += 1.0;
                        }
                        days
                    }
                    None => {
                        return CellValue::error_with_message(
                            CellError::Num,
                            "DATEDIF: could not compute YD difference".to_string(),
                        );
                    }
                }
            }
            _ => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("DATEDIF: invalid unit '{unit}', expected Y, M, D, MD, YM, or YD"),
                );
            }
        };
        CellValue::number(result)
    }
}

pub struct FnDays;
impl PureFunction for FnDays {
    fn name(&self) -> &'static str {
        "DAYS"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let end_serial = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let start_serial = match args[1].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        // DAYS(end_date, start_date) = end - start
        CellValue::number(end_serial.floor() - start_serial.floor())
    }
}
pub struct FnDays360;

impl PureFunction for FnDays360 {
    fn name(&self) -> &'static str {
        "DAYS360"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
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
        let european = if args.len() > 2 {
            match args[2].coerce_to_bool() {
                Ok(b) => b,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            false // US method (default)
        };

        let start = match serial_to_date(start_serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("DAYS360: invalid start date serial number {start_serial}"),
                );
            }
        };
        let end = match serial_to_date(end_serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("DAYS360: invalid end date serial number {end_serial}"),
                );
            }
        };

        let mut sd = start.day() as i32;
        let sm = start.month() as i32;
        let sy = start.year();
        let mut ed = end.day() as i32;
        let em = end.month() as i32;
        let ey = end.year();

        if european {
            // European method: if day > 30, set to 30
            if sd == 31 {
                sd = 30;
            }
            if ed == 31 {
                ed = 30;
            }
        } else {
            // US (NASD) method -- four rules applied in order:
            // 1. If start date is last day of February, set sd=30
            // 2. If start date is last day of February AND end date is last day
            //    of February, set ed=30
            // 3. If sd == 31, set sd=30
            // 4. If ed == 31 and sd >= 30, set ed=30
            let start_is_last_feb = sm == 2 && sd == last_day_of_month(sy, sm as u32) as i32;
            let end_is_last_feb = em == 2 && ed == last_day_of_month(ey, em as u32) as i32;

            // Rule 1: start is last day of February
            if start_is_last_feb {
                sd = 30;
            }
            // Rule 2: both start and end are last day of February
            if start_is_last_feb && end_is_last_feb {
                ed = 30;
            }
            // Rule 3: If start day is 31, set to 30
            if sd == 31 {
                sd = 30;
            }
            // Rule 4: If end day is 31 and start day >= 30, set end to 30
            if ed == 31 && sd >= 30 {
                ed = 30;
            }
        }

        let days = (ey - sy) * 360 + (em - sm) * 30 + (ed - sd);
        CellValue::number(days as f64)
    }
}

pub(super) fn register_edate_eomonth(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnEdate));
    registry.register(Box::new(FnEomonth));
}

pub(super) fn register_datedif_days(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnDatedif));
    registry.register(Box::new(FnDays));
}

pub(super) fn register_days360(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnDays360));
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
    fn test_edate() {
        let f = FnEdate;
        // 2024-01-31 + 1 month = 2024-02-29 (leap year)
        let jan31 = NaiveDate::from_ymd_opt(2024, 1, 31).unwrap();
        let serial = num(date_to_serial(&jan31));
        let result = f.call(&[serial, num(1.0)]);
        if let CellValue::Number(n) = result {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2024, 2, 29).unwrap());
        } else {
            panic!("Expected number");
        }
    }

    #[test]
    fn test_eomonth() {
        let f = FnEomonth;
        let jan15 = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let serial = num(date_to_serial(&jan15));
        let result = f.call(&[serial, num(0.0)]);
        if let CellValue::Number(n) = result {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2024, 1, 31).unwrap());
        } else {
            panic!("Expected number");
        }
    }

    #[test]
    fn test_datedif_years() {
        let f = FnDatedif;
        let start = NaiveDate::from_ymd_opt(2020, 1, 15).unwrap();
        let end = NaiveDate::from_ymd_opt(2024, 3, 20).unwrap();
        let s = num(date_to_serial(&start));
        let e = num(date_to_serial(&end));
        assert_eq!(f.call(&[s.clone(), e.clone(), text("Y")]), num(4.0));
        assert_eq!(f.call(&[s.clone(), e.clone(), text("M")]), num(50.0));
    }

    #[test]
    fn test_datedif_start_after_end() {
        let f = FnDatedif;
        assert_eq!(
            f.call(&[num(45000.0), num(44000.0), text("D")]),
            err(CellError::Num)
        );
    }

    #[test]
    fn test_datedif_serial_zero() {
        let f = FnDatedif;
        // Serial 0 = "Jan 0, 1900" (mapped to Dec 31, 1899)
        // Serial 45000 ≈ Feb 18, 2023
        // DATEDIF(0, 45000, "Y") should work, not #NUM!
        let result = f.call(&[num(0.0), num(45000.0), text("Y")]);
        assert!(
            matches!(result, CellValue::Number(_)),
            "Expected number, got {:?}",
            result
        );

        // "D" unit (already works via serial arithmetic)
        assert_eq!(f.call(&[num(0.0), num(1.0), text("D")]), num(1.0));

        // "M" unit
        let result = f.call(&[num(0.0), num(45000.0), text("M")]);
        assert!(
            matches!(result, CellValue::Number(_)),
            "Expected number for M, got {:?}",
            result
        );

        // All units should NOT return #NUM!
        for unit in &["Y", "M", "D", "MD", "YM", "YD"] {
            let result = f.call(&[num(0.0), num(45000.0), text(unit)]);
            assert!(
                !matches!(result, CellValue::Error(..)),
                "DATEDIF(0, 45000, \"{}\") returned error: {:?}",
                unit,
                result
            );
        }
    }

    #[test]
    fn test_days() {
        let f = FnDays;
        // DAYS(end, start) = end - start
        let start = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let end = NaiveDate::from_ymd_opt(2024, 1, 31).unwrap();
        let s = num(date_to_serial(&start));
        let e = num(date_to_serial(&end));
        assert_eq!(f.call(&[e, s]), num(30.0));
    }

    // -----------------------------------------------------------------------
    // Additional datetime function tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_days360_us() {
        let f = FnDays360;
        // Jan 30 to Feb 28, 2024 (US method)
        let start = NaiveDate::from_ymd_opt(2024, 1, 30).unwrap();
        let end = NaiveDate::from_ymd_opt(2024, 2, 28).unwrap();
        let result = f.call(&[num(date_to_serial(&start)), num(date_to_serial(&end))]);
        if let CellValue::Number(n) = result {
            // 30/360: (0*360) + (1*30) + (28-30) = 28
            assert_eq!(n.get(), 28.0);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_days360_european() {
        let f = FnDays360;
        let start = NaiveDate::from_ymd_opt(2024, 1, 31).unwrap();
        let end = NaiveDate::from_ymd_opt(2024, 3, 31).unwrap();
        let result = f.call(&[
            num(date_to_serial(&start)),
            num(date_to_serial(&end)),
            bool_val(true),
        ]);
        if let CellValue::Number(n) = result {
            // European: both 31->30. (0*360) + (2*30) + (30-30) = 60
            assert_eq!(n.get(), 60.0);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    // -----------------------------------------------------------------------
    // DAYS360 US method with February end-of-month
    // -----------------------------------------------------------------------

    #[test]
    fn test_days360_us_feb_end_of_month() {
        let f = FnDays360;
        // DAYS360("2024-01-31", "2024-02-29", FALSE) -- US method
        // Start: Jan 31 (last day of Jan) -> sd=31, rule 3: sd=30
        // End: Feb 29 (last day of Feb) -> ed=29, not rule 2 (start not Feb), not rule 4
        // Result: (0*360) + (1*30) + (29-30) = 29
        let start = NaiveDate::from_ymd_opt(2024, 1, 31).unwrap();
        let end = NaiveDate::from_ymd_opt(2024, 2, 29).unwrap();
        let result = f.call(&[
            num(date_to_serial(&start)),
            num(date_to_serial(&end)),
            bool_val(false),
        ]);
        if let CellValue::Number(n) = result {
            assert_eq!(n.get(), 29.0);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_days360_us_feb_to_feb() {
        let f = FnDays360;
        // DAYS360("2024-02-29", "2025-02-28", FALSE) -- both start and end are last day of Feb
        // Start: Feb 29, 2024 (last day of Feb, leap year) -> rule 1: sd=30
        // End: Feb 28, 2025 (last day of Feb, non-leap year) -> rule 2: ed=30
        // Result: (1*360) + (0*30) + (30-30) = 360
        let start = NaiveDate::from_ymd_opt(2024, 2, 29).unwrap();
        let end = NaiveDate::from_ymd_opt(2025, 2, 28).unwrap();
        let result = f.call(&[
            num(date_to_serial(&start)),
            num(date_to_serial(&end)),
            bool_val(false),
        ]);
        if let CellValue::Number(n) = result {
            assert_eq!(n.get(), 360.0);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }
}
