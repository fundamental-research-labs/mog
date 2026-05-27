// Mechanical split from datetime.rs; keep behavior changes out of this refactor.

use chrono::Datelike;

use value_types::{CellError, CellValue};

use crate::datetime::calendar::year_length_actual;
use crate::helpers::coercion::check_error;
use crate::helpers::date_serial::serial_to_date;
use crate::{FunctionRegistry, PureFunction};

pub struct FnYearFrac;
impl PureFunction for FnYearFrac {
    fn name(&self) -> &'static str {
        "YEARFRAC"
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
        let basis = if args.len() > 2 {
            match args[2].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };

        let (s_serial, e_serial) = if start_serial <= end_serial {
            (start_serial, end_serial)
        } else {
            (end_serial, start_serial)
        };

        let start = match serial_to_date(s_serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("YEARFRAC: invalid start date serial number {s_serial}"),
                );
            }
        };
        let end = match serial_to_date(e_serial) {
            Some(d) => d,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("YEARFRAC: invalid end date serial number {e_serial}"),
                );
            }
        };

        let result = match basis {
            0 => {
                // US (NASD) 30/360
                let mut sd = start.day() as i32;
                let sm = start.month() as i32;
                let sy = start.year();
                let mut ed = end.day() as i32;
                let em = end.month() as i32;
                let ey = end.year();

                if sd == 31 {
                    sd = 30;
                }
                if ed == 31 && sd >= 30 {
                    ed = 30;
                }

                let days = (ey - sy) * 360 + (em - sm) * 30 + (ed - sd);
                days as f64 / 360.0
            }
            1 => {
                // Actual/actual
                let actual_days = (end - start).num_days() as f64;
                let avg_year = year_length_actual(start, end);
                actual_days / avg_year
            }
            2 => {
                // Actual/360
                let actual_days = (end - start).num_days() as f64;
                actual_days / 360.0
            }
            3 => {
                // Actual/365
                let actual_days = (end - start).num_days() as f64;
                actual_days / 365.0
            }
            4 => {
                // European 30/360
                let mut sd = start.day() as i32;
                let sm = start.month() as i32;
                let sy = start.year();
                let mut ed = end.day() as i32;
                let em = end.month() as i32;
                let ey = end.year();

                if sd == 31 {
                    sd = 30;
                }
                if ed == 31 {
                    ed = 30;
                }

                let days = (ey - sy) * 360 + (em - sm) * 30 + (ed - sd);
                days as f64 / 360.0
            }
            _ => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("YEARFRAC: invalid basis {basis}, expected 0-4"),
                );
            }
        };

        CellValue::number(result)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnYearFrac));
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
    fn test_yearfrac_us_30_360() {
        let f = FnYearFrac;
        // Jan 1 to Jul 1, 2024 = exactly 0.5 year in 30/360
        let start = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let end = NaiveDate::from_ymd_opt(2024, 7, 1).unwrap();
        let result = f.call(&[
            num(date_to_serial(&start)),
            num(date_to_serial(&end)),
            num(0.0),
        ]);
        if let CellValue::Number(n) = result {
            assert!((n.get() - 0.5).abs() < 1e-10);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_yearfrac_actual_365() {
        let f = FnYearFrac;
        // Jan 1 to Dec 31, 2024: 365 days / 365 = 1.0 (basis 3, actual/365)
        let start = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let end = NaiveDate::from_ymd_opt(2024, 12, 31).unwrap();
        let result = f.call(&[
            num(date_to_serial(&start)),
            num(date_to_serial(&end)),
            num(3.0),
        ]);
        if let CellValue::Number(n) = result {
            // 365 days (Jan 1 to Dec 31) / 365 = 1.0
            assert!((n.get() - 365.0 / 365.0).abs() < 1e-10);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_yearfrac_invalid_basis() {
        let f = FnYearFrac;
        let start = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let end = NaiveDate::from_ymd_opt(2024, 7, 1).unwrap();
        assert_eq!(
            f.call(&[
                num(date_to_serial(&start)),
                num(date_to_serial(&end)),
                num(5.0)
            ],),
            err(CellError::Num)
        );
    }
}
