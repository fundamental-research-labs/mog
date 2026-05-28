//! Bond price and yield function wrappers.

use value_types::{CellError, CellValue};

use super::super::helpers::{arg_num, err_val, num_or_err_msg, price_core, req_num};
use crate::PureFunction;

pub(super) struct FnPrice;
impl PureFunction for FnPrice {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "PRICE"
    }
    fn min_args(&self) -> usize {
        6
    }
    fn max_args(&self) -> Option<usize> {
        Some(7)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let rate = req_num(args, 2).map_err(err_val)?;
            let yld = req_num(args, 3).map_err(err_val)?;
            let redemption = req_num(args, 4).map_err(err_val)?;
            let frequency = req_num(args, 5).map_err(err_val)? as i32;
            let basis = arg_num(args, 6, 0.0).map_err(err_val)? as i32;
            if settlement >= maturity {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "PRICE: settlement must be before maturity",
                ));
            }
            if rate < 0.0 || yld < 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PRICE: rate and yield must be >= 0 (rate={rate}, yield={yld})"),
                ));
            }
            if redemption <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PRICE: redemption must be > 0, got {redemption}"),
                ));
            }
            if frequency != 1 && frequency != 2 && frequency != 4 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PRICE: frequency must be 1, 2, or 4, got {frequency}"),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PRICE: basis must be 0..4, got {basis}"),
                ));
            }
            let p = price_core(
                settlement, maturity, rate, yld, redemption, frequency, basis,
            );
            if p.is_nan() || p.is_infinite() {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "PRICE: result is not finite",
                ));
            }
            Ok(p)
        })())
    }
}

pub(super) struct FnYield;
impl PureFunction for FnYield {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "YIELD"
    }
    fn min_args(&self) -> usize {
        6
    }
    fn max_args(&self) -> Option<usize> {
        Some(7)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let rate = req_num(args, 2).map_err(err_val)?;
            let pr = req_num(args, 3).map_err(err_val)?;
            let redemption = req_num(args, 4).map_err(err_val)?;
            let frequency = req_num(args, 5).map_err(err_val)? as i32;
            let basis = arg_num(args, 6, 0.0).map_err(err_val)? as i32;
            if settlement >= maturity {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "YIELD: settlement must be before maturity",
                ));
            }
            if rate < 0.0 || pr <= 0.0 || redemption <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "YIELD: rate >= 0, pr > 0, redemption > 0 required (rate={rate}, pr={pr}, redemption={redemption})"
                    ),
                ));
            }
            if frequency != 1 && frequency != 2 && frequency != 4 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("YIELD: frequency must be 1, 2, or 4, got {frequency}"),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("YIELD: basis must be 0..4, got {basis}"),
                ));
            }

            let f = |yld: f64| -> f64 {
                price_core(
                    settlement, maturity, rate, yld, redemption, frequency, basis,
                ) - pr
            };
            let df = |yld: f64| -> f64 {
                let delta = 1e-7;
                let p1 = price_core(
                    settlement,
                    maturity,
                    rate,
                    yld + delta,
                    redemption,
                    frequency,
                    basis,
                );
                let p0 = price_core(
                    settlement, maturity, rate, yld, redemption, frequency, basis,
                );
                (p1 - p0) / delta
            };

            let config = compute_solver::SolverConfig {
                objective: compute_solver::Objective::Target(0.0),
                x0: vec![rate],
                bounds: vec![compute_solver::Bound::bounded(-1.0, 10.0)],
                ftol: 1e-7,
                xtol: 1e-10,
                max_evals: 500,
                max_time_ms: 0,
                ..Default::default()
            };

            let result = compute_solver::solve_root_nr(f, df, &config, &[0.0, 0.05, 0.1, 0.5]);

            if result.converged {
                Ok(result.x[0])
            } else {
                Err(CellValue::error_with_message(
                    CellError::Num,
                    "YIELD: failed to converge — check inputs",
                ))
            }
        })())
    }
}
