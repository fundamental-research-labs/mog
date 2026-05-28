use value_types::{CellError, CellValue};

use crate::PureFunction;

use super::aggregate::{
    average, max_or_zero, min_or_zero, population_variance, product_or_zero, sample_variance,
};
use super::collect::{extract_matching_numbers, get_matching_values};
use super::parse::parse_db_args;

macro_rules! database_function_args {
    () => {
        fn min_args(&self) -> usize {
            3
        }

        fn max_args(&self) -> Option<usize> {
            Some(3)
        }
    };
}

pub(super) struct FnDsum;
impl PureFunction for FnDsum {
    fn name(&self) -> &'static str {
        "DSUM"
    }

    database_function_args!();

    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);
        CellValue::number(nums.iter().sum())
    }
}

pub(super) struct FnDaverage;
impl PureFunction for FnDaverage {
    fn name(&self) -> &'static str {
        "DAVERAGE"
    }

    database_function_args!();

    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);
        average(&nums)
    }
}

pub(super) struct FnDcount;
impl PureFunction for FnDcount {
    fn name(&self) -> &'static str {
        "DCOUNT"
    }

    database_function_args!();

    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let count = values
            .iter()
            .filter(|v| matches!(v, CellValue::Number(_)))
            .count();
        CellValue::number(count as f64)
    }
}

pub(super) struct FnDcounta;
impl PureFunction for FnDcounta {
    fn name(&self) -> &'static str {
        "DCOUNTA"
    }

    database_function_args!();

    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let count = values
            .iter()
            .filter(|v| !matches!(v, CellValue::Null))
            .count();
        CellValue::number(count as f64)
    }
}

pub(super) struct FnDget;
impl PureFunction for FnDget {
    fn name(&self) -> &'static str {
        "DGET"
    }

    database_function_args!();

    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);

        match values.len() {
            0 => CellValue::error_with_message(
                CellError::Value,
                "DGET: no records match the criteria",
            ),
            1 => values[0].clone(),
            _ => CellValue::error_with_message(
                CellError::Num,
                "DGET: more than one record matches the criteria",
            ),
        }
    }
}

pub(super) struct FnDmax;
impl PureFunction for FnDmax {
    fn name(&self) -> &'static str {
        "DMAX"
    }

    database_function_args!();

    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);
        max_or_zero(&nums)
    }
}

pub(super) struct FnDmin;
impl PureFunction for FnDmin {
    fn name(&self) -> &'static str {
        "DMIN"
    }

    database_function_args!();

    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);
        min_or_zero(&nums)
    }
}

pub(super) struct FnDproduct;
impl PureFunction for FnDproduct {
    fn name(&self) -> &'static str {
        "DPRODUCT"
    }

    database_function_args!();

    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);
        product_or_zero(&nums)
    }
}

pub(super) struct FnDstdev;
impl PureFunction for FnDstdev {
    fn name(&self) -> &'static str {
        "DSTDEV"
    }

    database_function_args!();

    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);
        match sample_variance(
            &nums,
            "DSTDEV: need at least 2 numeric values for sample standard deviation",
        ) {
            Ok(variance) => CellValue::number(variance.sqrt()),
            Err(e) => e,
        }
    }
}

pub(super) struct FnDstdevp;
impl PureFunction for FnDstdevp {
    fn name(&self) -> &'static str {
        "DSTDEVP"
    }

    database_function_args!();

    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);
        match population_variance(&nums, "DSTDEVP: no numeric values in matching rows") {
            Ok(variance) => CellValue::number(variance.sqrt()),
            Err(e) => e,
        }
    }
}

pub(super) struct FnDvar;
impl PureFunction for FnDvar {
    fn name(&self) -> &'static str {
        "DVAR"
    }

    database_function_args!();

    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);
        match sample_variance(
            &nums,
            "DVAR: need at least 2 numeric values for sample variance",
        ) {
            Ok(variance) => CellValue::number(variance),
            Err(e) => e,
        }
    }
}

pub(super) struct FnDvarp;
impl PureFunction for FnDvarp {
    fn name(&self) -> &'static str {
        "DVARP"
    }

    database_function_args!();

    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);
        match population_variance(&nums, "DVARP: no numeric values in matching rows") {
            Ok(variance) => CellValue::number(variance),
            Err(e) => e,
        }
    }
}
