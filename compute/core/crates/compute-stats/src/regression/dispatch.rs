use crate::{Point, RegressionMethod, RegressionOutput};

use super::linear::linear_regression;
use super::polynomial::polynomial_regression;
use super::transformed::{exponential_regression, logarithmic_regression, power_regression};
use super::types::RegressionOptions;

/// Dispatch to the appropriate regression function based on method.
#[must_use]
pub fn create_regression(
    data: &[Point],
    method: RegressionMethod,
    degree: u32,
    options: &RegressionOptions,
) -> RegressionOutput {
    match method {
        RegressionMethod::Linear => linear_regression(data, options),
        RegressionMethod::Log => logarithmic_regression(data, options),
        RegressionMethod::Exp => exponential_regression(data, options),
        RegressionMethod::Pow => power_regression(data, options),
        RegressionMethod::Quad => polynomial_regression(data, 2, options),
        RegressionMethod::Poly => polynomial_regression(data, degree, options),
    }
}
