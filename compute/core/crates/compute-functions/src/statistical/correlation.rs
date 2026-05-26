//! Correlation functions:
//! CORREL, PEARSON, COVAR, COVARIANCE.P, COVARIANCE.S, FISHER, FISHERINV

use value_types::{CellError, CellValue};

use super::helpers::extract_paired_numbers;
use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnCorrel;
impl PureFunction for FnCorrel {
    fn name(&self) -> &'static str {
        "CORREL"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match extract_paired_numbers(args) {
            Ok((xs, _ys)) if xs.len() < 2 => CellValue::error_with_message(
                CellError::Div0,
                "CORREL: need at least 2 paired data points",
            ),
            Ok((xs, ys)) => {
                let n = xs.len() as f64;
                let mx = xs.iter().sum::<f64>() / n;
                let my = ys.iter().sum::<f64>() / n;
                let cov: f64 = xs
                    .iter()
                    .zip(ys.iter())
                    .map(|(x, y)| (x - mx) * (y - my))
                    .sum();
                let sx: f64 = xs.iter().map(|x| (x - mx).powi(2)).sum::<f64>().sqrt();
                let sy: f64 = ys.iter().map(|y| (y - my).powi(2)).sum::<f64>().sqrt();
                if sx < 1e-15 || sy < 1e-15 {
                    CellValue::error_with_message(
                        CellError::Div0,
                        "CORREL: one or both arrays have zero variance",
                    )
                } else {
                    CellValue::number(cov / (sx * sy))
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnPearson;
impl PureFunction for FnPearson {
    fn name(&self) -> &'static str {
        "PEARSON"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnCorrel.call(args)
    }
}

pub(super) struct FnCovarianceP;
impl PureFunction for FnCovarianceP {
    fn name(&self) -> &'static str {
        "COVARIANCE.P"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match extract_paired_numbers(args) {
            Ok((xs, _ys)) if xs.is_empty() => CellValue::error_with_message(
                CellError::Div0,
                "COVARIANCE.P: need at least 1 paired data point",
            ),
            Ok((xs, ys)) => {
                let n = xs.len() as f64;
                let mx = xs.iter().sum::<f64>() / n;
                let my = ys.iter().sum::<f64>() / n;
                let cov: f64 = xs
                    .iter()
                    .zip(ys.iter())
                    .map(|(x, y)| (x - mx) * (y - my))
                    .sum::<f64>()
                    / n;
                CellValue::number(cov)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

/// COVAR is an alias for COVARIANCE.P (legacy name)
pub(super) struct FnCovar;
impl PureFunction for FnCovar {
    fn name(&self) -> &'static str {
        "COVAR"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnCovarianceP.call(args)
    }
}

pub(super) struct FnCovarianceS;
impl PureFunction for FnCovarianceS {
    fn name(&self) -> &'static str {
        "COVARIANCE.S"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match extract_paired_numbers(args) {
            Ok((xs, _ys)) if xs.len() < 2 => CellValue::error_with_message(
                CellError::Div0,
                "COVARIANCE.S: need at least 2 paired data points",
            ),
            Ok((xs, ys)) => {
                let n = xs.len() as f64;
                let mx = xs.iter().sum::<f64>() / n;
                let my = ys.iter().sum::<f64>() / n;
                let cov: f64 = xs
                    .iter()
                    .zip(ys.iter())
                    .map(|(x, y)| (x - mx) * (y - my))
                    .sum::<f64>()
                    / (n - 1.0);
                CellValue::number(cov)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnFisher;
impl PureFunction for FnFisher {
    fn name(&self) -> &'static str {
        "FISHER"
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
        match args[0].coerce_to_number() {
            Ok(x) if x <= -1.0 || x >= 1.0 => CellValue::error_with_message(
                CellError::Num,
                format!("FISHER: x must be strictly between -1 and 1, got {x}"),
            ),
            Ok(x) => CellValue::number(0.5 * ((1.0 + x) / (1.0 - x)).ln()),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnFisherInv;
impl PureFunction for FnFisherInv {
    fn name(&self) -> &'static str {
        "FISHERINV"
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
        match args[0].coerce_to_number() {
            Ok(y) => {
                let e2y = (2.0 * y).exp();
                CellValue::number((e2y - 1.0) / (e2y + 1.0))
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnCorrel));
    registry.register(Box::new(FnPearson));
    registry.register(Box::new(FnCovar));
    registry.register(Box::new(FnCovarianceP));
    registry.register(Box::new(FnCovarianceS));
    registry.register(Box::new(FnFisher));
    registry.register(Box::new(FnFisherInv));
}
