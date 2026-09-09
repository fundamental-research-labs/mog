// Mechanical split from datetime.rs; keep behavior changes out of this refactor.

use chrono::{Duration, NaiveDate};

use value_types::{CellError, CellValue};

use crate::datetime::array_lift::{array_get, broadcast_dims, has_any_array};
use crate::datetime::date_context::is_valid_canonical_date_serial;
#[cfg(test)]
use crate::datetime::date_context::{
    MAX_CANONICAL_DATE_SERIAL, MAX_CANONICAL_DATE_SERIAL_EXCLUSIVE,
};
use crate::helpers::coercion::check_error;
use crate::helpers::date_serial::date_to_serial;
use crate::{FunctionContext, FunctionRegistry, PureFunction};

pub struct FnDate;

fn date_scalar(args: &[CellValue]) -> CellValue {
    if let Some(e) = check_error(&args[0]) {
        return e;
    }
    if let Some(e) = check_error(&args[1]) {
        return e;
    }
    if let Some(e) = check_error(&args[2]) {
        return e;
    }
    let year = match args[0].coerce_to_number() {
        Ok(n) if n.is_finite() => {
            let y = n as i64;
            // Excel DATE function: year 0-1899 => year + 1900, 1900+ => literal.
            if (0..1900).contains(&y) { y + 1900 } else { y }
        }
        Ok(_) => return CellValue::Error(CellError::Value, None),
        Err(e) => return CellValue::Error(e, None),
    };
    let month = match args[1].coerce_to_number() {
        Ok(n) if n.is_finite() => n as i64,
        Ok(_) => return CellValue::Error(CellError::Value, None),
        Err(e) => return CellValue::Error(e, None),
    };
    let day = match args[2].coerce_to_number() {
        Ok(n) if n.is_finite() => n as i64,
        Ok(_) => return CellValue::Error(CellError::Value, None),
        Err(e) => return CellValue::Error(e, None),
    };

    // Handle out-of-range months and days
    let month_index = match month.checked_sub(1) {
        Some(month) => month,
        None => {
            return CellValue::error_with_message(
                CellError::Num,
                "DATE: resulting date is out of range".to_string(),
            );
        }
    };
    let month_offset = month_index.div_euclid(12);
    let adjusted_year = match year.checked_add(month_offset) {
        Some(year) => year,
        None => {
            return CellValue::error_with_message(
                CellError::Num,
                "DATE: resulting date is out of range".to_string(),
            );
        }
    };
    let adjusted_year = match i32::try_from(adjusted_year) {
        Ok(year) => year,
        Err(_) => {
            return CellValue::error_with_message(
                CellError::Num,
                "DATE: resulting date is out of range".to_string(),
            );
        }
    };
    let adjusted_month = (month_index.rem_euclid(12) + 1) as u32;

    match NaiveDate::from_ymd_opt(adjusted_year, adjusted_month, 1) {
        Some(base) => {
            let day_offset = match day.checked_sub(1).and_then(Duration::try_days) {
                Some(offset) => offset,
                None => {
                    return CellValue::error_with_message(
                        CellError::Num,
                        "DATE: resulting date is out of range".to_string(),
                    );
                }
            };
            let final_date = match base.checked_add_signed(day_offset) {
                Some(date) => date,
                None => {
                    return CellValue::error_with_message(
                        CellError::Num,
                        "DATE: resulting date is out of range".to_string(),
                    );
                }
            };
            let serial = date_to_serial(&final_date);

            if !is_valid_canonical_date_serial(serial) {
                return CellValue::error_with_message(
                    CellError::Num,
                    "DATE: resulting date is out of range".to_string(),
                );
            }

            // Handle the Lotus 1-2-3 leap year bug
            let mar1_1900 =
                NaiveDate::from_ymd_opt(1900, 3, 1).expect("1900-03-01 is always valid");
            if base < mar1_1900 && final_date >= mar1_1900 {
                CellValue::number(serial - 1.0)
            } else {
                CellValue::number(serial)
            }
        }
        None => CellValue::error_with_message(
            CellError::Num,
            "DATE: resulting date is out of range".to_string(),
        ),
    }
}

fn workbook_date_result(value: CellValue, context: &FunctionContext) -> CellValue {
    match value {
        CellValue::Number(number) if is_valid_canonical_date_serial(number.get()) => {
            CellValue::number(context.from_canonical_date_serial(number.get()))
        }
        CellValue::Number(_) => CellValue::Error(CellError::Num, None),
        CellValue::Array(array) => {
            let cols = array.cols();
            let values = array
                .data()
                .iter()
                .cloned()
                .map(|value| workbook_date_result(value, context))
                .collect();
            CellValue::array(values, cols)
        }
        other => other,
    }
}

impl PureFunction for FnDate {
    fn name(&self) -> &'static str {
        "DATE"
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
        // Array broadcasting for SUMPRODUCT compatibility
        if has_any_array(args) {
            let (max_rows, max_cols) = broadcast_dims(args);
            let mut result = Vec::with_capacity(max_rows);
            for row in 0..max_rows {
                let mut row_vals = Vec::with_capacity(max_cols);
                for col in 0..max_cols {
                    let scalar_args: Vec<CellValue> =
                        args.iter().map(|a| array_get(a, row, col)).collect();
                    row_vals.push(date_scalar(&scalar_args));
                }
                result.push(row_vals);
            }
            return CellValue::from_rows(result);
        }
        date_scalar(args)
    }

    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        if !context.date1904 {
            return self.call(args);
        }
        workbook_date_result(self.call(args), context)
    }
}

pub struct FnEpochToDate;
impl PureFunction for FnEpochToDate {
    fn name(&self) -> &'static str {
        "EPOCHTODATE"
    }
    fn min_args(&self) -> usize {
        1
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
        let timestamp = match args[0].coerce_to_number() {
            Ok(n) if n.is_finite() => n,
            Ok(_) => return CellValue::Error(CellError::Value, None),
            Err(e) => return CellValue::Error(e, None),
        };
        if timestamp < 0.0 {
            return CellValue::Error(CellError::Num, None);
        }

        let unit = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(n) if n.is_finite() => n.trunc() as i32,
                Ok(_) => return CellValue::Error(CellError::Value, None),
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };

        let millis = match unit {
            1 => timestamp * 1000.0,
            2 => timestamp.trunc(),
            3 => (timestamp / 1000.0).trunc(),
            _ => return CellValue::Error(CellError::Num, None),
        };
        if !millis.is_finite() {
            return CellValue::Error(CellError::Num, None);
        }

        let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).expect("1970-01-01 is valid");
        let serial = millis / 86_400_000.0 + date_to_serial(&epoch);
        if is_valid_canonical_date_serial(serial) {
            CellValue::number(serial)
        } else {
            CellValue::Error(CellError::Num, None)
        }
    }

    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        if !context.date1904 {
            return self.call(args);
        }
        workbook_date_result(self.call(args), context)
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnDate));
    registry.register(Box::new(FnEpochToDate));
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
    fn test_epochtodate_direct_examples() {
        let f = FnEpochToDate;
        assert_eq!(f.call(&[num(0.0)]), num(25569.0));
        assert_eq!(f.call(&[num(86400.0)]), num(25570.0));
        assert_num_close(f.call(&[num(1655906710.0)]), 44_734.586_921_296_29);
        assert_num_close(f.call(&[num(1655906568893.0), num(2.0)]), 44734.58528811343);
        assert_num_close(
            f.call(&[num(1656356678000410.0), num(3.0)]),
            44739.79488425926,
        );
        assert_num_close(f.call(&[num(1.0), num(1.9)]), 25569.000011574073);
        assert_eq!(f.call(&[num(1.0), num(0.9)]), err(CellError::Num));
        assert_eq!(f.call(&[text("x")]), err(CellError::Value));
        assert_eq!(f.call(&[num(-1.0)]), err(CellError::Num));
        assert_eq!(f.call(&[num(1.0), num(4.0)]), err(CellError::Num));
    }

    #[test]
    fn test_epochtodate_direct_scalar_coercions() {
        let f = FnEpochToDate;
        assert_num_close(f.call(&[bool_val(true)]), 25569.000011574073);
        assert_eq!(f.call(&[bool_val(false)]), num(25569.0));
        assert_eq!(f.call(&[null()]), num(25569.0));
        assert_num_close(f.call(&[control(true)]), 25569.000011574073);
        assert_num_close(f.call(&[text("1")]), 25569.000011574073);
        assert_eq!(f.call(&[text("")]), err(CellError::Value));

        let date_like = f.call(&[text("2020-01-01")]);
        assert_num_close(date_like, 43831.0 / 86400.0 + 25569.0);
    }

    #[test]
    fn test_epochtodate_registry_lookup_case_prefix_and_array_lift() {
        let reg = crate::FunctionRegistry::new();
        let (_, f) = reg
            .get_by_name("EPOCHTODATE")
            .expect("EPOCHTODATE registered");
        assert_eq!(f.min_args(), 1);
        assert_eq!(f.max_args(), Some(2));

        assert_eq!(reg.call("epochtodate", &[num(0.0)]), num(25569.0));
        assert_eq!(reg.call("EpochToDate", &[num(86400.0)]), num(25570.0));
        assert_eq!(reg.call("_xlfn.EPOCHTODATE", &[num(0.0)]), num(25569.0));
        assert_eq!(
            reg.call("_xlfn._xlws.EPOCHTODATE", &[num(0.0)]),
            num(25569.0)
        );

        let result = reg.call(
            "EPOCHTODATE",
            &[CellValue::from_rows(vec![vec![num(0.0), num(86400.0)]])],
        );
        assert_eq!(
            result,
            CellValue::from_rows(vec![vec![num(25569.0), num(25570.0)]])
        );
    }

    #[test]
    fn test_date_function() {
        let f = FnDate;
        // DATE(2024, 1, 15)
        let serial = f.call(&[num(2024.0), num(1.0), num(15.0)]);
        if let CellValue::Number(n) = serial {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2024, 1, 15).unwrap());
        } else {
            panic!("Expected number");
        }
    }

    #[test]
    fn test_date_overflow_month() {
        let f = FnDate;
        // DATE(2024, 13, 1) = DATE(2025, 1, 1)
        let serial = f.call(&[num(2024.0), num(13.0), num(1.0)]);
        if let CellValue::Number(n) = serial {
            let d = serial_to_date(n.get()).unwrap();
            assert_eq!(d, NaiveDate::from_ymd_opt(2025, 1, 1).unwrap());
        } else {
            panic!("Expected number");
        }
    }

    /// Test DATE(1900, 2, 29) — the Lotus 1-2-3 fake leap day.
    /// Excel returns serial 60 for this date; our DATE function should too.
    #[test]
    fn test_date_fake_leap_day_1900() {
        let f = FnDate;
        let result = f.call(&[num(1900.0), num(2.0), num(29.0)]);
        // Excel: DATE(1900, 2, 29) = serial 60
        assert_eq!(
            result,
            num(60.0),
            "DATE(1900,2,29) should be serial 60 (Lotus bug)"
        );
    }

    /// Test DATE function near the Lotus bug boundary.
    #[test]
    fn test_date_near_lotus_boundary() {
        let f = FnDate;
        // DATE(1900, 2, 28) = serial 59
        assert_eq!(f.call(&[num(1900.0), num(2.0), num(28.0)]), num(59.0));
        // DATE(1900, 3, 1) = serial 61
        assert_eq!(f.call(&[num(1900.0), num(3.0), num(1.0)]), num(61.0));
        // DATE(1900, 1, 1) = serial 1
        assert_eq!(f.call(&[num(1900.0), num(1.0), num(1.0)]), num(1.0));
        // DATE(2023, 1, 1) = serial 44927
        assert_eq!(f.call(&[num(2023.0), num(1.0), num(1.0)]), num(44927.0));
        // DATE(1900, 2, 30) should overflow to Mar 1, serial 61
        assert_eq!(f.call(&[num(1900.0), num(2.0), num(30.0)]), num(61.0));
        // DATE(1900, 1, 60) should be serial 60 (the fake Feb 29)
        assert_eq!(f.call(&[num(1900.0), num(1.0), num(60.0)]), num(60.0));
    }

    #[test]
    fn test_date_rejects_out_of_range_and_huge_components_promptly() {
        let f = FnDate;
        assert_eq!(
            f.call(&[num(9999.0), num(12.0), num(31.0)]),
            num(MAX_CANONICAL_DATE_SERIAL)
        );
        assert!(matches!(
            f.call(&[num(9999.0), num(12.0), num(32.0)]),
            CellValue::Error(CellError::Num, _)
        ));
        assert!(matches!(
            f.call(&[num(1.0e300), num(1.0), num(1.0)]),
            CellValue::Error(CellError::Num, _)
        ));
        assert!(matches!(
            f.call(&[num(2024.0), num(1.0e300), num(1.0)]),
            CellValue::Error(CellError::Num, _)
        ));
    }

    #[test]
    fn test_epoch_to_date_rejects_next_day_after_9999() {
        let f = FnEpochToDate;
        let timestamp = (MAX_CANONICAL_DATE_SERIAL_EXCLUSIVE - 25_569.0) * 86_400.0;
        assert!(matches!(
            f.call(&[num(timestamp)]),
            CellValue::Error(CellError::Num, _)
        ));
        assert_eq!(
            f.call(&[num((MAX_CANONICAL_DATE_SERIAL - 25_569.0) * 86_400.0)]),
            num(MAX_CANONICAL_DATE_SERIAL)
        );
    }
}
