//! Duration and modified duration function wrappers.

use value_types::{CellError, CellValue};

use super::super::helpers::{
    arg_num, count_coupons_remaining, coupdaysnc_calc, days_in_coupon_period, err_val,
    num_or_err_msg, req_num,
};
use crate::PureFunction;

pub(super) struct FnDuration;
impl PureFunction for FnDuration {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "DURATION"
    }
    fn min_args(&self) -> usize {
        5
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let coupon = req_num(args, 2).map_err(err_val)?;
            let yld = req_num(args, 3).map_err(err_val)?;
            let frequency = req_num(args, 4).map_err(err_val)? as i32;
            let basis = arg_num(args, 5, 0.0).map_err(err_val)? as i32;
            if settlement >= maturity {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "DURATION: settlement must be before maturity",
                ));
            }
            if coupon < 0.0 || yld < 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "DURATION: coupon and yield must be >= 0 (coupon={coupon}, yield={yld})"
                    ),
                ));
            }
            if frequency != 1 && frequency != 2 && frequency != 4 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("DURATION: frequency must be 1, 2, or 4, got {frequency}"),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("DURATION: basis must be 0..4, got {basis}"),
                ));
            }

            let n = count_coupons_remaining(settlement, maturity, frequency);
            let coupon_payment = (100.0 * coupon) / frequency as f64;
            let yld_per = yld / frequency as f64;
            let dsc = coupdaysnc_calc(settlement, maturity, frequency, basis);
            let e = days_in_coupon_period(settlement, maturity, frequency, basis);
            if e == 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "DURATION: coupon period has zero days",
                ));
            }
            let dsc_frac = dsc / e;

            let mut price = 0.0;
            let mut weighted_sum = 0.0;
            let n_int = n as i32;
            for k in 1..=n_int {
                let t = k as f64 - 1.0 + dsc_frac;
                let df = (1.0 + yld_per).powf(t);
                let pv = coupon_payment / df;
                price += pv;
                weighted_sum += (t / frequency as f64) * pv;
            }
            let t_mat = n - 1.0 + dsc_frac;
            let df_mat = (1.0 + yld_per).powf(t_mat);
            let pv_red = 100.0 / df_mat;
            price += pv_red;
            weighted_sum += (t_mat / frequency as f64) * pv_red;
            if price <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "DURATION: computed price is non-positive",
                ));
            }
            Ok(weighted_sum / price)
        })())
    }
}

pub(super) struct FnMduration;
impl PureFunction for FnMduration {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "MDURATION"
    }
    fn min_args(&self) -> usize {
        5
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let mac_dur = FnDuration.call(args);
        match mac_dur {
            CellValue::Number(d) => {
                let yld = match req_num(args, 3) {
                    Ok(y) => y,
                    Err(e) => return CellValue::Error(e, None),
                };
                let frequency = match req_num(args, 4) {
                    Ok(f) => f,
                    Err(e) => return CellValue::Error(e, None),
                };
                CellValue::number(d.get() / (1.0 + yld / frequency))
            }
            other => other,
        }
    }
}
