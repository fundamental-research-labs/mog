use value_types::{CellError, CellValue};

use super::super::helpers::num_or_err_msg;
use crate::PureFunction;
use crate::helpers::coercion::flatten_values;

pub(super) struct FnIrr;

impl PureFunction for FnIrr {
    fn name(&self) -> &'static str {
        "IRR"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let flat = flatten_values(&[args[0].clone()]);
            let mut cash_flows = Vec::new();
            for v in &flat {
                match v {
                    CellValue::Error(e, _) => return Err(CellValue::Error(*e, None)),
                    CellValue::Number(n) => cash_flows.push(n.get()),
                    _ => {}
                }
            }
            if cash_flows.len() < 2 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "IRR: need at least 2 cash flows",
                ));
            }
            let has_pos = cash_flows.iter().any(|&x| x > 0.0);
            let has_neg = cash_flows.iter().any(|&x| x < 0.0);
            if !has_pos || !has_neg {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "IRR: cash flows must have both positive and negative values",
                ));
            }

            let guess = if args.len() >= 2 {
                match args[1].coerce_to_number() {
                    Ok(g) => g,
                    Err(e) => return Err(CellValue::Error(e, None)),
                }
            } else {
                0.1
            };

            let scale = cash_flows
                .iter()
                .map(|v| v.abs())
                .fold(0.0_f64, f64::max)
                .max(1.0);

            let npv_at = |rate: f64| -> f64 {
                if rate <= -1.0 {
                    return f64::NAN;
                }
                let mut npv = 0.0;
                for (i, &cf) in cash_flows.iter().enumerate() {
                    npv += cf / (1.0 + rate).powi(i as i32);
                }
                npv
            };
            let dnpv_at = |rate: f64| -> f64 {
                if rate <= -1.0 {
                    return f64::NAN;
                }
                let mut d = 0.0;
                for (i, &cf) in cash_flows.iter().enumerate() {
                    if i > 0 {
                        d -= (i as f64) * cf / ((1.0 + rate).powi(i as i32) * (1.0 + rate));
                    }
                }
                d
            };

            let config = compute_solver::SolverConfig {
                objective: compute_solver::Objective::Target(0.0),
                x0: vec![guess],
                bounds: vec![compute_solver::Bound::bounded(-0.99, 1e6)],
                ftol: 1e-10 * scale,
                xtol: 1e-14,
                max_evals: 500,
                max_time_ms: 0,
                ..Default::default()
            };

            let result = compute_solver::solve_root_nr(
                npv_at,
                dnpv_at,
                &config,
                &[0.0, 0.5, -0.5, -0.9, 1.0],
            );
            if result.converged {
                Ok(result.x[0])
            } else {
                Err(CellValue::error_with_message(
                    CellError::Num,
                    "IRR: failed to converge — check that cash flows have both positive and negative values",
                ))
            }
        })())
    }
}
