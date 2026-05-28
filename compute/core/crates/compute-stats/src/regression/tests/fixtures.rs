use crate::Point;

use super::super::RegressionOptions;

pub(super) const EPS: f64 = 1e-6;

pub(super) fn pts(pairs: &[(f64, f64)]) -> Vec<Point> {
    pairs.iter().map(|&(x, y)| Point { x, y }).collect()
}

pub(super) fn default_opts() -> RegressionOptions {
    RegressionOptions::default()
}
