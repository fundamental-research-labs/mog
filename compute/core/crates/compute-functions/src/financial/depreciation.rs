//! Depreciation: SLN, SYD, DB, DDB, VDB, AMORLINC, AMORDEGRC

use value_types::{CellError, CellValue};

use super::helpers::{arg_num, err_val, num_or_err_msg, req_num, year_frac};
use crate::{FunctionRegistry, PureFunction};

// ===========================================================================
// SLN
// ===========================================================================

pub(super) struct FnSln;
impl PureFunction for FnSln {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "SLN"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let cost = req_num(args, 0).map_err(err_val)?;
            let salvage = req_num(args, 1).map_err(err_val)?;
            let life = req_num(args, 2).map_err(err_val)?;
            if life == 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Div0,
                    "SLN: life must not be 0",
                ));
            }
            if life < 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("SLN: life must be > 0, got {life}"),
                ));
            }
            Ok((cost - salvage) / life)
        })())
    }
}

// ===========================================================================
// SYD
// ===========================================================================

pub(super) struct FnSyd;
impl PureFunction for FnSyd {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "SYD"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let cost = req_num(args, 0).map_err(err_val)?;
            let salvage = req_num(args, 1).map_err(err_val)?;
            let life = req_num(args, 2).map_err(err_val)?;
            let per = req_num(args, 3).map_err(err_val)?;
            if life <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("SYD: life must be > 0, got {life}"),
                ));
            }
            if per < 1.0 || per > life {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("SYD: per must be in 1..{life}, got {per}"),
                ));
            }
            let sum_of_years = life * (life + 1.0) / 2.0;
            Ok((cost - salvage) * (life - per + 1.0) / sum_of_years)
        })())
    }
}

// ===========================================================================
// DB
// ===========================================================================

pub(super) struct FnDb;
impl PureFunction for FnDb {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "DB"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            4 => Some(CellValue::number(12.0)), // month defaults to 12
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let cost = req_num(args, 0).map_err(err_val)?;
            let salvage = req_num(args, 1).map_err(err_val)?;
            let life = req_num(args, 2).map_err(err_val)?;
            let period = req_num(args, 3).map_err(err_val)?;
            let month = arg_num(args, 4, 12.0).map_err(err_val)?;
            if cost < 0.0 || salvage < 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("DB: cost and salvage must be >= 0 (cost={cost}, salvage={salvage})"),
                ));
            }
            if life == 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Div0,
                    "DB: life must not be 0",
                ));
            }
            if life < 0.0 || period < 1.0 || period > life + 1.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("DB: invalid life/period (life={life}, period={period})"),
                ));
            }
            if !(1.0..=12.0).contains(&month) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("DB: month must be 1..12, got {month}"),
                ));
            }
            let month = month.round();

            let rate = if salvage == 0.0 {
                1.0
            } else {
                let raw = 1.0 - (salvage / cost).powf(1.0 / life);
                (raw * 1000.0).round() / 1000.0
            };

            let mut total_dep = 0.0;
            let mut remaining = cost;
            for i in 1..=(period as i32) {
                let dep = if i == 1 {
                    cost * rate * month / 12.0
                } else if i == (life as i32 + 1) {
                    remaining * rate * (12.0 - month) / 12.0
                } else {
                    remaining * rate
                };
                if i == period as i32 {
                    return Ok(dep);
                }
                total_dep += dep;
                remaining = cost - total_dep;
            }
            Err(CellValue::error_with_message(
                CellError::Num,
                "DB: period out of range for given life",
            ))
        })())
    }
}

// ===========================================================================
// DDB
// ===========================================================================

pub(super) struct FnDdb;
impl PureFunction for FnDdb {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "DDB"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            4 => Some(CellValue::number(2.0)), // factor defaults to 2
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let cost = req_num(args, 0).map_err(err_val)?;
            let salvage = req_num(args, 1).map_err(err_val)?;
            let life = req_num(args, 2).map_err(err_val)?;
            let period = req_num(args, 3).map_err(err_val)?;
            let factor = arg_num(args, 4, 2.0).map_err(err_val)?;
            if cost < 0.0 || salvage < 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("DDB: cost and salvage must be >= 0 (cost={cost}, salvage={salvage})"),
                ));
            }
            if life == 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Div0,
                    "DDB: life must not be 0",
                ));
            }
            if life < 0.0 || period < 1.0 || period > life {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("DDB: invalid life/period (life={life}, period={period})"),
                ));
            }
            if factor <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("DDB: factor must be > 0, got {factor}"),
                ));
            }

            let rate = factor / life;
            let mut book_value = cost;
            for i in 1..=(period as i32) {
                let dep = (book_value * rate).min(book_value - salvage).max(0.0);
                if i == period as i32 {
                    return Ok(dep);
                }
                book_value -= dep;
            }
            Err(CellValue::error_with_message(
                CellError::Num,
                "DDB: period out of range for given life",
            ))
        })())
    }
}

// ===========================================================================
// VDB
// ===========================================================================

pub(super) struct FnVdb;
impl PureFunction for FnVdb {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "VDB"
    }
    fn min_args(&self) -> usize {
        5
    }
    fn max_args(&self) -> Option<usize> {
        Some(7)
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            5 => Some(CellValue::number(2.0)),    // factor defaults to 2
            6 => Some(CellValue::Boolean(false)), // no_switch defaults to false
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let cost = req_num(args, 0).map_err(err_val)?;
            let salvage = req_num(args, 1).map_err(err_val)?;
            let life = req_num(args, 2).map_err(err_val)?;
            let start_period = req_num(args, 3).map_err(err_val)?;
            let end_period = req_num(args, 4).map_err(err_val)?;
            let factor = arg_num(args, 5, 2.0).map_err(err_val)?;
            let no_switch = if args.len() >= 7 {
                match &args[6] {
                    CellValue::Boolean(b) => *b,
                    CellValue::Number(n) => n.get() != 0.0,
                    CellValue::Error(e, _) => return Err(CellValue::Error(*e, None)),
                    _ => false,
                }
            } else {
                false
            };
            if cost < 0.0 || salvage < 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("VDB: cost and salvage must be >= 0 (cost={cost}, salvage={salvage})"),
                ));
            }
            if life <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("VDB: life must be > 0, got {life}"),
                ));
            }
            if start_period < 0.0 || end_period < start_period || end_period > life {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "VDB: invalid period range (start={start_period}, end={end_period}, life={life})"
                    ),
                ));
            }
            if factor <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("VDB: factor must be > 0, got {factor}"),
                ));
            }

            let rate = factor / life;

            // Excel truncates fractional periods to integers (floor for positive numbers)
            let start_int = start_period.floor() as i64;
            let end_int = end_period.floor() as i64;

            // Helper: depreciation for a single period
            let get_dep = |bv: f64, remaining_life: f64| -> f64 {
                if bv <= salvage {
                    return 0.0;
                }
                let db_dep = bv * rate;
                let sln_dep = if remaining_life > 0.0 {
                    (bv - salvage) / remaining_life
                } else {
                    0.0
                };
                let dep = if no_switch {
                    db_dep
                } else {
                    db_dep.max(sln_dep)
                };
                dep.min(bv - salvage).max(0.0)
            };

            // Calculate book value at start_period
            let mut book_value = cost;
            for p in 0..start_int {
                let remaining_life = life - p as f64;
                let dep = get_dep(book_value, remaining_life);
                book_value -= dep;
            }

            // Accumulate depreciation from start to end
            let mut total = 0.0;
            for p in start_int..end_int {
                let remaining_life = life - p as f64;
                let dep = get_dep(book_value, remaining_life);
                total += dep;
                book_value -= dep;
            }
            Ok(total)
        })())
    }
}

// ===========================================================================
// AMORLINC
// ===========================================================================

pub(super) struct FnAmorlinc;
impl PureFunction for FnAmorlinc {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "AMORLINC"
    }
    fn min_args(&self) -> usize {
        6
    }
    fn max_args(&self) -> Option<usize> {
        Some(7)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let cost = req_num(args, 0).map_err(err_val)?;
            let date_purchased = req_num(args, 1).map_err(err_val)?;
            let first_period = req_num(args, 2).map_err(err_val)?;
            let salvage = req_num(args, 3).map_err(err_val)?;
            let period = req_num(args, 4).map_err(err_val)?;
            let rate = req_num(args, 5).map_err(err_val)?;
            let basis = arg_num(args, 6, 0.0).map_err(err_val)? as i32;
            if cost < 0.0 || salvage < 0.0 || salvage > cost {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("AMORLINC: invalid cost/salvage (cost={cost}, salvage={salvage})"),
                ));
            }
            if rate <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("AMORLINC: rate must be > 0, got {rate}"),
                ));
            }
            if period < 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("AMORLINC: period must be >= 0, got {period}"),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("AMORLINC: basis must be 0..4, got {basis}"),
                ));
            }

            let period_int = period.floor() as i32;
            let dep_amount = cost * rate;

            if period_int == 0 {
                let yf = year_frac(date_purchased, first_period, basis);
                return Ok((dep_amount * yf).min(cost - salvage));
            }

            let first_yf = year_frac(date_purchased, first_period, basis);
            let mut accumulated = dep_amount * first_yf;
            for _ in 1..period_int {
                accumulated += dep_amount;
            }
            let remaining = cost - salvage - accumulated;
            if remaining <= 0.0 {
                return Ok(0.0);
            }
            Ok(dep_amount.min(remaining))
        })())
    }
}

// ===========================================================================
// AMORDEGRC
// ===========================================================================

pub(super) struct FnAmordegrc;
impl PureFunction for FnAmordegrc {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "AMORDEGRC"
    }
    fn min_args(&self) -> usize {
        6
    }
    fn max_args(&self) -> Option<usize> {
        Some(7)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let cost = req_num(args, 0).map_err(err_val)?;
            let date_purchased = req_num(args, 1).map_err(err_val)?;
            let first_period = req_num(args, 2).map_err(err_val)?;
            let salvage = req_num(args, 3).map_err(err_val)?;
            let period = req_num(args, 4).map_err(err_val)?;
            let rate = req_num(args, 5).map_err(err_val)?;
            let basis = arg_num(args, 6, 0.0).map_err(err_val)? as i32;
            if cost < 0.0 || salvage < 0.0 || salvage > cost {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("AMORDEGRC: invalid cost/salvage (cost={cost}, salvage={salvage})"),
                ));
            }
            if rate <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("AMORDEGRC: rate must be > 0, got {rate}"),
                ));
            }
            if period < 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("AMORDEGRC: period must be >= 0, got {period}"),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("AMORDEGRC: basis must be 0..4, got {basis}"),
                ));
            }

            let life = 1.0 / rate;
            let coeff = if life < 3.0 {
                1.0
            } else if life < 5.0 {
                1.5
            } else if life < 7.0 {
                2.0
            } else {
                2.5
            };
            let degressive_rate = rate * coeff;
            let period_int = period.floor() as i32;

            let first_yf = year_frac(date_purchased, first_period, basis);
            if period_int == 0 {
                let dep = cost * degressive_rate * first_yf;
                return Ok(dep.min(cost - salvage));
            }

            let mut book_value = cost;
            book_value -= cost * degressive_rate * first_yf;

            for _ in 1..period_int {
                let dep = book_value * degressive_rate;
                book_value -= dep;
                if book_value <= salvage {
                    book_value = salvage;
                    break;
                }
            }

            if book_value <= salvage {
                return Ok(0.0);
            }
            let dep = book_value * degressive_rate;
            Ok(dep.min(book_value - salvage))
        })())
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnSln));
    registry.register(Box::new(FnSyd));
    registry.register(Box::new(FnDb));
    registry.register(Box::new(FnDdb));
    registry.register(Box::new(FnVdb));
    registry.register(Box::new(FnAmorlinc));
    registry.register(Box::new(FnAmordegrc));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PureFunction;
    use value_types::{CellError, CellValue};

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }
    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }
    fn approx(a: &CellValue, expected: f64, tol: f64) -> bool {
        match a {
            CellValue::Number(n) => (n.get() - expected).abs() < tol,
            _ => false,
        }
    }

    #[test]
    fn test_sln() {
        let r = FnSln.call(&[num(10000.0), num(1000.0), num(5.0)]);
        assert!(approx(&r, 1800.0, 0.01));
    }

    #[test]
    fn test_syd() {
        let r = FnSyd.call(&[num(30000.0), num(7500.0), num(10.0), num(1.0)]);
        assert!(approx(&r, 4090.909, 0.01));
    }

    #[test]
    fn test_ddb() {
        let r = FnDdb.call(&[num(2400.0), num(300.0), num(10.0), num(1.0), num(2.0)]);
        assert!(approx(&r, 480.0, 0.01));
    }

    #[test]
    fn test_db_rate_calculation() {
        // DB(1000000, 100000, 6, 1) - Excel returns 319166.67 for period 1
        // rate = round((1 - (100000/1000000)^(1/6)) * 1000) / 1000
        //      = round((1 - 0.1^(1/6)) * 1000) / 1000
        //      = round(0.319... * 1000) / 1000 = 0.319
        // period 1 dep = 1000000 * 0.319 * 12/12 = 319000
        let r = FnDb.call(&[num(1000000.0), num(100000.0), num(6.0), num(1.0), num(12.0)]);
        match &r {
            CellValue::Number(n) => {
                // Excel gives 319000.00 for full first year with month=12
                assert!(
                    (n.get() - 319000.0).abs() < 1.0,
                    "DB(1000000,100000,6,1) = {}, expected ~319000",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    #[test]
    fn test_db_period_2() {
        // DB(1000000, 100000, 6, 2, 12) - period 2
        // rate = 0.319, period 1 dep = 319000, remaining = 681000
        // period 2 dep = 681000 * 0.319 = 217239
        let r = FnDb.call(&[num(1000000.0), num(100000.0), num(6.0), num(2.0), num(12.0)]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - 217239.0).abs() < 1.0,
                    "DB period 2 = {}, expected ~217239",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    #[test]
    fn test_sln_zero_life_div0() {
        let r = FnSln.call(&[num(100.0), num(0.0), num(0.0)]);
        assert_eq!(r, err(CellError::Div0));
    }

    #[test]
    fn test_db_zero_life_div0() {
        let r = FnDb.call(&[num(100.0), num(0.0), num(0.0), num(1.0)]);
        assert_eq!(r, err(CellError::Div0));
    }

    #[test]
    fn test_ddb_zero_life_div0() {
        let r = FnDdb.call(&[num(100.0), num(0.0), num(0.0), num(1.0)]);
        assert_eq!(r, err(CellError::Div0));
    }

    #[test]
    fn test_vdb_basic() {
        // VDB(2400, 300, 10, 0, 1) - first period, same as DDB
        // DDB: 2400 * 2/10 = 480
        let r = FnVdb.call(&[num(2400.0), num(300.0), num(10.0), num(0.0), num(1.0)]);
        assert!(
            approx(&r, 480.0, 0.01),
            "VDB(2400,300,10,0,1) = {:?}, expected 480",
            r
        );
    }

    #[test]
    fn test_vdb_multiple_periods() {
        // VDB(2400, 300, 10, 0, 3) - first 3 periods
        // Period 1: 2400 * 0.2 = 480, bv = 1920
        // Period 2: 1920 * 0.2 = 384, bv = 1536
        // Period 3: 1536 * 0.2 = 307.2, bv = 1228.8
        // Total = 480 + 384 + 307.2 = 1171.2
        let r = FnVdb.call(&[num(2400.0), num(300.0), num(10.0), num(0.0), num(3.0)]);
        assert!(
            approx(&r, 1171.2, 0.1),
            "VDB(2400,300,10,0,3) = {:?}, expected 1171.2",
            r
        );
    }

    #[test]
    fn test_vdb_fractional_periods_floor() {
        // VDB(2400, 300, 10, 0, 1) should equal VDB(2400, 300, 10, 0.9, 1)
        // because floor(0.9) = 0, so both start at period 0
        // But VDB(2400, 300, 10, 0, 1) accumulates period 0 only
        // VDB(2400, 300, 10, 0.9, 1) should also accumulate period 0 only
        // because floor(0.9)=0 and floor(1)=1, so we accumulate periods 0..1 = just period 0
        let r1 = FnVdb.call(&[num(2400.0), num(300.0), num(10.0), num(0.0), num(1.0)]);
        let r2 = FnVdb.call(&[num(2400.0), num(300.0), num(10.0), num(0.9), num(1.0)]);
        // With floor fix: both should give the same period 0 depreciation = 480
        match (&r1, &r2) {
            (CellValue::Number(n1), CellValue::Number(n2)) => {
                assert!(
                    (n1.get() - n2.get()).abs() < 0.01,
                    "VDB with fractional start should use floor: {} vs {}",
                    n1.get(),
                    n2.get()
                );
            }
            _ => panic!("Expected numbers, got {:?} and {:?}", r1, r2),
        }
    }

    #[test]
    fn test_vdb_no_switch() {
        // VDB with no_switch=TRUE uses declining balance only (no straight-line switch)
        let r = FnVdb.call(&[
            num(2400.0),
            num(300.0),
            num(10.0),
            num(0.0),
            num(1.0),
            num(2.0),
            CellValue::Boolean(true),
        ]);
        assert!(
            approx(&r, 480.0, 0.01),
            "VDB no_switch first period = {:?}",
            r
        );
    }

    #[test]
    fn test_vdb_single_period() {
        // VDB(2400, 300, 10, 1, 2) - period 2 only
        // Period 1: bv=2400, dep=480, bv=1920
        // Period 2: bv=1920, dep=384
        let r = FnVdb.call(&[num(2400.0), num(300.0), num(10.0), num(1.0), num(2.0)]);
        assert!(
            approx(&r, 384.0, 0.01),
            "VDB period 2 = {:?}, expected 384",
            r
        );
    }

    #[test]
    fn test_vdb_error_conditions() {
        // Negative cost
        assert_eq!(
            FnVdb.call(&[num(-100.0), num(0.0), num(5.0), num(0.0), num(1.0)]),
            err(CellError::Num)
        );
        // start > end
        assert_eq!(
            FnVdb.call(&[num(100.0), num(0.0), num(5.0), num(3.0), num(2.0)]),
            err(CellError::Num)
        );
        // life <= 0
        assert_eq!(
            FnVdb.call(&[num(100.0), num(0.0), num(0.0), num(0.0), num(1.0)]),
            err(CellError::Num)
        );
    }

    #[test]
    fn test_amorlinc_basic() {
        use super::super::helpers::ymd_to_serial;
        // AMORLINC(cost=2400, date_purchased, first_period, salvage=300, period=1, rate=0.15)
        let purchased = ymd_to_serial(2023, 1, 1);
        let first_per = ymd_to_serial(2023, 12, 31);
        let r = FnAmorlinc.call(&[
            num(2400.0),
            num(purchased),
            num(first_per),
            num(300.0),
            num(1.0),
            num(0.15),
            num(0.0),
        ]);
        match &r {
            CellValue::Number(n) => {
                // dep_amount = 2400 * 0.15 = 360 per period
                // period 0: prorated
                // period 1: full 360 (capped by remaining)
                assert!(
                    n.get() > 0.0 && n.get() <= 360.0,
                    "AMORLINC period 1 = {}, expected <= 360",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    #[test]
    fn test_amordegrc_basic() {
        use super::super::helpers::ymd_to_serial;
        let purchased = ymd_to_serial(2023, 1, 1);
        let first_per = ymd_to_serial(2023, 12, 31);
        let r = FnAmordegrc.call(&[
            num(2400.0),
            num(purchased),
            num(first_per),
            num(300.0),
            num(1.0),
            num(0.15),
            num(0.0),
        ]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    n.get() > 0.0,
                    "AMORDEGRC should produce positive depreciation, got {}",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }
}
