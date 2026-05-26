//! Regression functions:
//! FORECAST, FORECAST.LINEAR, SLOPE, INTERCEPT, RSQ, STEYX,
//! LINEST, LOGEST, TREND, GROWTH,
//! PROB

use value_types::{CellError, CellValue};

use super::correlation::FnCorrel;
use super::helpers::{extract_paired_numbers, linear_regression};
use crate::helpers::coercion::{extract_numbers_strict, flatten_values};
use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnForecastLinear;
impl PureFunction for FnForecastLinear {
    fn name(&self) -> &'static str {
        "FORECAST.LINEAR"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let x = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        match extract_paired_numbers(&[args[1].clone(), args[2].clone()]) {
            Ok((_ys, xs)) if xs.len() < 2 => CellValue::error_with_message(
                CellError::Na,
                format!(
                    "FORECAST.LINEAR: need at least 2 data points, got {}",
                    xs.len()
                ),
            ),
            Ok((ys, xs)) => match linear_regression(&xs, &ys) {
                Some((slope, intercept)) => CellValue::number(intercept + slope * x),
                None => CellValue::error_with_message(
                    CellError::Div0,
                    "FORECAST.LINEAR: all x values are identical",
                ),
            },
            Err(e) => CellValue::Error(e, None),
        }
    }
}

/// FORECAST is an alias for FORECAST.LINEAR
pub(super) struct FnForecast;
impl PureFunction for FnForecast {
    fn name(&self) -> &'static str {
        "FORECAST"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnForecastLinear.call(args)
    }
}

pub(super) struct FnSlope;
impl PureFunction for FnSlope {
    fn name(&self) -> &'static str {
        "SLOPE"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match extract_paired_numbers(args) {
            Ok((_ys, xs)) if xs.len() < 2 => CellValue::error_with_message(
                CellError::Div0,
                format!("SLOPE: need at least 2 data points, got {}", xs.len()),
            ),
            Ok((ys, xs)) => match linear_regression(&xs, &ys) {
                Some((slope, _)) => CellValue::number(slope),
                None => CellValue::error_with_message(
                    CellError::Div0,
                    "SLOPE: all x values are identical",
                ),
            },
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnIntercept;
impl PureFunction for FnIntercept {
    fn name(&self) -> &'static str {
        "INTERCEPT"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match extract_paired_numbers(args) {
            Ok((_ys, xs)) if xs.len() < 2 => CellValue::error_with_message(
                CellError::Div0,
                format!("INTERCEPT: need at least 2 data points, got {}", xs.len()),
            ),
            Ok((ys, xs)) => match linear_regression(&xs, &ys) {
                Some((_, intercept)) => CellValue::number(intercept),
                None => CellValue::error_with_message(
                    CellError::Div0,
                    "INTERCEPT: all x values are identical",
                ),
            },
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnRsq;
impl PureFunction for FnRsq {
    fn name(&self) -> &'static str {
        "RSQ"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match FnCorrel.call(args) {
            CellValue::Number(r) => CellValue::number(r.get() * r.get()),
            other => other,
        }
    }
}

pub(super) struct FnSteyx;
impl PureFunction for FnSteyx {
    fn name(&self) -> &'static str {
        "STEYX"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match extract_paired_numbers(args) {
            Ok((_ys, xs)) if xs.len() < 3 => CellValue::error_with_message(
                CellError::Div0,
                format!("STEYX: need at least 3 data points, got {}", xs.len()),
            ),
            Ok((ys, xs)) => match linear_regression(&xs, &ys) {
                Some((slope, intercept)) => {
                    let n = xs.len() as f64;
                    let sse: f64 = xs
                        .iter()
                        .zip(ys.iter())
                        .map(|(x, y)| (y - intercept - slope * x).powi(2))
                        .sum();
                    CellValue::number((sse / (n - 2.0)).sqrt())
                }
                None => CellValue::error_with_message(
                    CellError::Div0,
                    "STEYX: all x values are identical",
                ),
            },
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnLinest;
impl PureFunction for FnLinest {
    fn name(&self) -> &'static str {
        "LINEST"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat_y = flatten_values(&[args[0].clone()]);
        let ys: Vec<f64> = match extract_numbers_strict(&flat_y) {
            Ok(v) if v.is_empty() => {
                return CellValue::error_with_message(
                    CellError::Na,
                    "LINEST: known_ys array is empty",
                );
            }
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let xs: Vec<f64> = if args.len() > 1 {
            let flat_x = flatten_values(&[args[1].clone()]);
            match extract_numbers_strict(&flat_x) {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            (1..=ys.len()).map(|i| i as f64).collect()
        };
        if xs.len() != ys.len() || xs.len() < 2 {
            return CellValue::error_with_message(
                CellError::Na,
                format!(
                    "LINEST: known_xs length ({}) must match known_ys length ({}) and be >= 2",
                    xs.len(),
                    ys.len()
                ),
            );
        }
        match linear_regression(&xs, &ys) {
            Some((slope, intercept)) => CellValue::from_rows(vec![vec![
                CellValue::number(slope),
                CellValue::number(intercept),
            ]]),
            None => {
                CellValue::error_with_message(CellError::Div0, "LINEST: all x values are identical")
            }
        }
    }
}

pub(super) struct FnLogest;
impl PureFunction for FnLogest {
    fn name(&self) -> &'static str {
        "LOGEST"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat_y = flatten_values(&[args[0].clone()]);
        let ys: Vec<f64> = match extract_numbers_strict(&flat_y) {
            Ok(v) if v.is_empty() => {
                return CellValue::error_with_message(
                    CellError::Na,
                    "LOGEST: known_ys array is empty",
                );
            }
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if ys.iter().any(|&y| y <= 0.0) {
            return CellValue::error_with_message(
                CellError::Num,
                "LOGEST: all known_ys values must be positive",
            );
        }
        let log_ys: Vec<f64> = ys.iter().map(|y| y.ln()).collect();
        let xs: Vec<f64> = if args.len() > 1 {
            let flat_x = flatten_values(&[args[1].clone()]);
            match extract_numbers_strict(&flat_x) {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            (1..=ys.len()).map(|i| i as f64).collect()
        };
        if xs.len() != ys.len() || xs.len() < 2 {
            return CellValue::error_with_message(
                CellError::Na,
                format!(
                    "LOGEST: known_xs length ({}) must match known_ys length ({}) and be >= 2",
                    xs.len(),
                    ys.len()
                ),
            );
        }
        match linear_regression(&xs, &log_ys) {
            Some((slope, intercept)) => CellValue::from_rows(vec![vec![
                CellValue::number(slope.exp()),
                CellValue::number(intercept.exp()),
            ]]),
            None => {
                CellValue::error_with_message(CellError::Div0, "LOGEST: all x values are identical")
            }
        }
    }
}

pub(super) struct FnTrend;
impl PureFunction for FnTrend {
    fn name(&self) -> &'static str {
        "TREND"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat_y = flatten_values(&[args[0].clone()]);
        let ys: Vec<f64> = match extract_numbers_strict(&flat_y) {
            Ok(v) if v.is_empty() => {
                return CellValue::error_with_message(
                    CellError::Na,
                    "TREND: known_ys array is empty",
                );
            }
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let xs: Vec<f64> = if args.len() > 1 {
            let flat_x = flatten_values(&[args[1].clone()]);
            match extract_numbers_strict(&flat_x) {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            (1..=ys.len()).map(|i| i as f64).collect()
        };
        let new_xs: Vec<f64> = if args.len() > 2 {
            let flat_nx = flatten_values(&[args[2].clone()]);
            match extract_numbers_strict(&flat_nx) {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            xs.clone()
        };
        if xs.len() != ys.len() || xs.len() < 2 {
            return CellValue::error_with_message(
                CellError::Na,
                format!(
                    "TREND: known_xs length ({}) must match known_ys length ({}) and be >= 2",
                    xs.len(),
                    ys.len()
                ),
            );
        }
        match linear_regression(&xs, &ys) {
            Some((slope, intercept)) => {
                let predicted: Vec<CellValue> = new_xs
                    .iter()
                    .map(|x| CellValue::number(intercept + slope * x))
                    .collect();
                CellValue::row_array(predicted)
            }
            None => {
                CellValue::error_with_message(CellError::Div0, "TREND: all x values are identical")
            }
        }
    }
}

pub(super) struct FnGrowth;
impl PureFunction for FnGrowth {
    fn name(&self) -> &'static str {
        "GROWTH"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat_y = flatten_values(&[args[0].clone()]);
        let ys: Vec<f64> = match extract_numbers_strict(&flat_y) {
            Ok(v) if v.is_empty() => {
                return CellValue::error_with_message(
                    CellError::Na,
                    "GROWTH: known_ys array is empty",
                );
            }
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if ys.iter().any(|&y| y <= 0.0) {
            return CellValue::error_with_message(
                CellError::Num,
                "GROWTH: all known_ys values must be positive",
            );
        }
        let log_ys: Vec<f64> = ys.iter().map(|y| y.ln()).collect();
        let xs: Vec<f64> = if args.len() > 1 {
            let flat_x = flatten_values(&[args[1].clone()]);
            match extract_numbers_strict(&flat_x) {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            (1..=ys.len()).map(|i| i as f64).collect()
        };
        let new_xs: Vec<f64> = if args.len() > 2 {
            let flat_nx = flatten_values(&[args[2].clone()]);
            match extract_numbers_strict(&flat_nx) {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            xs.clone()
        };
        if xs.len() != ys.len() || xs.len() < 2 {
            return CellValue::error_with_message(
                CellError::Na,
                format!(
                    "GROWTH: known_xs length ({}) must match known_ys length ({}) and be >= 2",
                    xs.len(),
                    ys.len()
                ),
            );
        }
        match linear_regression(&xs, &log_ys) {
            Some((slope, intercept)) => {
                let predicted: Vec<CellValue> = new_xs
                    .iter()
                    .map(|x| CellValue::number((intercept + slope * x).exp()))
                    .collect();
                CellValue::row_array(predicted)
            }
            None => {
                CellValue::error_with_message(CellError::Div0, "GROWTH: all x values are identical")
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Advanced Regression: PROB
// ---------------------------------------------------------------------------

pub(super) struct FnProb;
impl PureFunction for FnProb {
    fn name(&self) -> &'static str {
        "PROB"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat_x = flatten_values(&[args[0].clone()]);
        let flat_p = flatten_values(&[args[1].clone()]);
        let lower = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let upper = if args.len() > 3 {
            match args[3].coerce_to_number() {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            lower
        };
        let xs = match extract_numbers_strict(&flat_x) {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let ps = match extract_numbers_strict(&flat_p) {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if xs.len() != ps.len() || xs.is_empty() {
            return CellValue::error_with_message(
                CellError::Na,
                format!(
                    "PROB: x_range length ({}) must match prob_range length ({}) and be non-empty",
                    xs.len(),
                    ps.len()
                ),
            );
        }
        if ps.iter().any(|&p| !(0.0..=1.0).contains(&p)) {
            return CellValue::error_with_message(
                CellError::Num,
                "PROB: all probabilities must be between 0 and 1",
            );
        }
        let sum_p: f64 = ps.iter().sum();
        // Excel uses a very loose tolerance for sum-of-probabilities check
        if (sum_p - 1.0).abs() > 0.01 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("PROB: probabilities must sum to 1, got {sum_p}"),
            );
        }
        let result: f64 = xs
            .iter()
            .zip(ps.iter())
            .filter(|(x, _)| **x >= lower && **x <= upper)
            .map(|(_, p)| *p)
            .sum();
        CellValue::number(result)
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnForecast));
    registry.register(Box::new(FnForecastLinear));
    registry.register(Box::new(FnSlope));
    registry.register(Box::new(FnIntercept));
    registry.register(Box::new(FnRsq));
    registry.register(Box::new(FnSteyx));
    registry.register(Box::new(FnLinest));
    registry.register(Box::new(FnLogest));
    registry.register(Box::new(FnTrend));
    registry.register(Box::new(FnGrowth));
    registry.register(Box::new(FnProb));
}
