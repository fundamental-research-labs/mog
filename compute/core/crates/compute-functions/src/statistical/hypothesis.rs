//! Hypothesis testing functions:
//! T.TEST, TTEST, F.TEST, FTEST, CHISQ.TEST, CHITEST, Z.TEST, ZTEST

use value_types::{CellError, CellValue};

use crate::helpers::coercion::{extract_numbers_strict, flatten_values};
use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{ChiSquared, ContinuousCDF, FisherSnedecor, Normal, StudentsT};

/// Helper macro to construct a distribution, returning a #NUM! error with diagnostic message
/// if construction fails (e.g. due to NaN or other invalid parameters).
macro_rules! try_dist {
    ($expr:expr, $func_name:expr) => {
        match $expr {
            Ok(d) => d,
            Err(_) => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("{}: invalid distribution parameters", $func_name),
                )
            }
        }
    };
}

pub(super) struct FnTTest;
impl PureFunction for FnTTest {
    fn name(&self) -> &'static str {
        "T.TEST"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat1 = flatten_values(&[args[0].clone()]);
        let flat2 = flatten_values(&[args[1].clone()]);
        let tails = match args[2].coerce_to_number() {
            Ok(v) => v as i32,
            Err(e) => return CellValue::Error(e, None),
        };
        let ttype = match args[3].coerce_to_number() {
            Ok(v) => v as i32,
            Err(e) => return CellValue::Error(e, None),
        };
        if tails != 1 && tails != 2 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("T.TEST: tails must be 1 or 2, got {tails}"),
            );
        }
        if !(1..=3).contains(&ttype) {
            return CellValue::error_with_message(
                CellError::Num,
                format!("T.TEST: type must be 1, 2, or 3, got {ttype}"),
            );
        }
        let x1 = match extract_numbers_strict(&flat1) {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let x2 = match extract_numbers_strict(&flat2) {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let n1 = x1.len() as f64;
        let n2 = x2.len() as f64;
        if n1 < 2.0 || n2 < 2.0 {
            return CellValue::error_with_message(
                CellError::Div0,
                format!("T.TEST: need at least 2 data points in each array, got {n1} and {n2}"),
            );
        }
        let m1 = x1.iter().sum::<f64>() / n1;
        let m2 = x2.iter().sum::<f64>() / n2;
        let v1 = x1.iter().map(|x| (x - m1).powi(2)).sum::<f64>() / (n1 - 1.0);
        let v2 = x2.iter().map(|x| (x - m2).powi(2)).sum::<f64>() / (n2 - 1.0);
        let (t_stat, df) = match ttype {
            1 => {
                // Paired
                if x1.len() != x2.len() {
                    return CellValue::error_with_message(
                        CellError::Na,
                        format!(
                            "T.TEST: paired test requires equal-length arrays, got {} and {}",
                            x1.len(),
                            x2.len()
                        ),
                    );
                }
                let diffs: Vec<f64> = x1.iter().zip(x2.iter()).map(|(a, b)| a - b).collect();
                let md = diffs.iter().sum::<f64>() / n1;
                let vd = diffs.iter().map(|d| (d - md).powi(2)).sum::<f64>() / (n1 - 1.0);
                if vd < 1e-15 {
                    return CellValue::error_with_message(
                        CellError::Div0,
                        "T.TEST: paired differences have zero variance",
                    );
                }
                (md / (vd / n1).sqrt(), n1 - 1.0)
            }
            2 => {
                // Equal variance (pooled)
                let sp2 = ((n1 - 1.0) * v1 + (n2 - 1.0) * v2) / (n1 + n2 - 2.0);
                let se = (sp2 * (1.0 / n1 + 1.0 / n2)).sqrt();
                if se < 1e-15 {
                    return CellValue::error_with_message(
                        CellError::Div0,
                        "T.TEST: pooled standard error is zero",
                    );
                }
                ((m1 - m2) / se, n1 + n2 - 2.0)
            }
            3 => {
                // Unequal variance (Welch)
                let se = (v1 / n1 + v2 / n2).sqrt();
                if se < 1e-15 {
                    return CellValue::error_with_message(
                        CellError::Div0,
                        "T.TEST: Welch standard error is zero",
                    );
                }
                let df_num = (v1 / n1 + v2 / n2).powi(2);
                let df_den = (v1 / n1).powi(2) / (n1 - 1.0) + (v2 / n2).powi(2) / (n2 - 1.0);
                ((m1 - m2) / se, df_num / df_den)
            }
            _ => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("T.TEST: type must be 1, 2, or 3, got {ttype}"),
                );
            }
        };
        let dist = try_dist!(StudentsT::new(0.0, 1.0, df), self.name());
        let p = 1.0 - dist.cdf(t_stat.abs());
        if tails == 2 {
            CellValue::number(2.0 * p)
        } else {
            CellValue::number(p)
        }
    }
}

pub(super) struct FnTTestLegacy;
impl PureFunction for FnTTestLegacy {
    fn name(&self) -> &'static str {
        "TTEST"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnTTest.call(args)
    }
}

pub(super) struct FnFTest;
impl PureFunction for FnFTest {
    fn name(&self) -> &'static str {
        "F.TEST"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat1 = flatten_values(&[args[0].clone()]);
        let flat2 = flatten_values(&[args[1].clone()]);
        let x1 = match extract_numbers_strict(&flat1) {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let x2 = match extract_numbers_strict(&flat2) {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let n1 = x1.len() as f64;
        let n2 = x2.len() as f64;
        if n1 < 2.0 || n2 < 2.0 {
            return CellValue::error_with_message(
                CellError::Div0,
                format!("F.TEST: need at least 2 data points in each array, got {n1} and {n2}"),
            );
        }
        let m1 = x1.iter().sum::<f64>() / n1;
        let m2 = x2.iter().sum::<f64>() / n2;
        let v1 = x1.iter().map(|x| (x - m1).powi(2)).sum::<f64>() / (n1 - 1.0);
        let v2 = x2.iter().map(|x| (x - m2).powi(2)).sum::<f64>() / (n2 - 1.0);
        if v2 < 1e-15 {
            return CellValue::error_with_message(
                CellError::Div0,
                "F.TEST: second array has zero variance",
            );
        }
        let f_stat = v1 / v2;
        let dist = try_dist!(FisherSnedecor::new(n1 - 1.0, n2 - 1.0), self.name());
        let p = if f_stat >= 1.0 {
            2.0 * (1.0 - dist.cdf(f_stat))
        } else {
            2.0 * dist.cdf(f_stat)
        };
        CellValue::number(p.min(1.0))
    }
}

pub(super) struct FnFTestLegacy;
impl PureFunction for FnFTestLegacy {
    fn name(&self) -> &'static str {
        "FTEST"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnFTest.call(args)
    }
}

pub(super) struct FnChisqTest;
impl PureFunction for FnChisqTest {
    fn name(&self) -> &'static str {
        "CHISQ.TEST"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // Determine the 2D shape from the original Array argument before flattening
        let (rows, cols) = match &args[0] {
            CellValue::Array(arr) => (arr.rows(), arr.cols()),
            _ => (1, 1),
        };
        let flat_obs = flatten_values(&[args[0].clone()]);
        let flat_exp = flatten_values(&[args[1].clone()]);
        let obs = match extract_numbers_strict(&flat_obs) {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let exp = match extract_numbers_strict(&flat_exp) {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if obs.len() != exp.len() || obs.is_empty() {
            return CellValue::error_with_message(
                CellError::Na,
                format!(
                    "CHISQ.TEST: observed and expected arrays must be non-empty and same length, got {} and {}",
                    obs.len(),
                    exp.len()
                ),
            );
        }
        if exp.iter().any(|&e| e <= 0.0) {
            return CellValue::error_with_message(
                CellError::Num,
                "CHISQ.TEST: all expected values must be positive",
            );
        }
        let chi2: f64 = obs
            .iter()
            .zip(exp.iter())
            .map(|(o, e)| (o - e).powi(2) / e)
            .sum();
        // For 2D contingency tables: df = (rows-1) * (cols-1)
        // For 1D arrays: df = n-1
        let df = if rows > 1 && cols > 1 {
            ((rows - 1) * (cols - 1)).max(1) as f64
        } else {
            (obs.len() - 1).max(1) as f64
        };
        let dist = try_dist!(ChiSquared::new(df), self.name());
        CellValue::number(1.0 - dist.cdf(chi2))
    }
}

pub(super) struct FnChiTestLegacy;
impl PureFunction for FnChiTestLegacy {
    fn name(&self) -> &'static str {
        "CHITEST"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnChisqTest.call(args)
    }
}

pub(super) struct FnZTest;
impl PureFunction for FnZTest {
    fn name(&self) -> &'static str {
        "Z.TEST"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(&[args[0].clone()]);
        let x = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let nums = match extract_numbers_strict(&flat) {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if nums.is_empty() {
            return CellValue::error_with_message(
                CellError::Na,
                "Z.TEST: data array contains no numeric values",
            );
        }
        let n = nums.len() as f64;
        let mean = nums.iter().sum::<f64>() / n;
        let sigma = if args.len() > 2 {
            match args[2].coerce_to_number() {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            // Auto-calculated sigma requires at least 2 data points (divides by n-1)
            if nums.len() < 2 {
                return CellValue::error_with_message(
                    CellError::Num,
                    "Z.TEST: need at least 2 data points when sigma is not provided",
                );
            }
            let var = nums.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / (n - 1.0);
            var.sqrt()
        };
        if sigma <= 0.0 || n < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("Z.TEST: sigma must be positive, got {sigma}"),
            );
        }
        let z = (mean - x) / (sigma / n.sqrt());
        let dist = try_dist!(Normal::new(0.0, 1.0), self.name());
        CellValue::number(1.0 - dist.cdf(z))
    }
}

pub(super) struct FnZTestLegacy;
impl PureFunction for FnZTestLegacy {
    fn name(&self) -> &'static str {
        "ZTEST"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnZTest.call(args)
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnTTest));
    registry.register(Box::new(FnTTestLegacy));
    registry.register(Box::new(FnFTest));
    registry.register(Box::new(FnFTestLegacy));
    registry.register(Box::new(FnChisqTest));
    registry.register(Box::new(FnChiTestLegacy));
    registry.register(Box::new(FnZTest));
    registry.register(Box::new(FnZTestLegacy));
}
