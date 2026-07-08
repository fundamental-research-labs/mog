//! Regression functions:
//! FORECAST, FORECAST.LINEAR, SLOPE, INTERCEPT, RSQ, STEYX,
//! LINEST, LOGEST, TREND, GROWTH,
//! PROB

use nalgebra::{DMatrix, DVector};
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

struct RegressionFit {
    slopes: Vec<f64>,
    intercept: f64,
    slope_standard_errors: Vec<f64>,
    intercept_standard_error: Option<f64>,
    r_squared: f64,
    standard_error_y: f64,
    f_statistic: f64,
    degrees_of_freedom: f64,
    ss_regression: f64,
    ss_residual: f64,
}

struct RegressionInput {
    ys: Vec<f64>,
    xs: Vec<Vec<f64>>,
}

#[derive(Clone, Copy)]
enum DesignColumn {
    Intercept,
    Predictor(usize),
}

fn coerce_optional_bool(
    args: &[CellValue],
    index: usize,
    default: bool,
) -> Result<bool, CellError> {
    match args.get(index) {
        Some(value) => value.coerce_to_bool(),
        None => Ok(default),
    }
}

fn scalar_numbers_from_array(
    value: &CellValue,
    function_name: &str,
) -> Result<Vec<f64>, CellValue> {
    let flat = flatten_values(std::slice::from_ref(value));
    match extract_numbers_strict(&flat) {
        Ok(values) if values.is_empty() => Err(CellValue::error_with_message(
            CellError::Na,
            format!("{function_name}: known_ys array is empty"),
        )),
        Ok(values) => Ok(values),
        Err(e) => Err(CellValue::Error(e, None)),
    }
}

fn array_dimensions(value: &CellValue) -> Option<(usize, usize)> {
    value.as_array().map(|array| (array.rows(), array.cols()))
}

fn numeric_rows(value: &CellValue) -> Result<Vec<Vec<f64>>, CellError> {
    match value {
        CellValue::Error(e, _) => Err(*e),
        CellValue::Array(array) => {
            let mut rows = Vec::with_capacity(array.rows());
            for row in array.rows_iter() {
                let mut values = Vec::with_capacity(row.len());
                for cell in row {
                    match cell {
                        CellValue::Error(e, _) => return Err(*e),
                        CellValue::Number(n) => values.push(n.get()),
                        _ => {}
                    }
                }
                rows.push(values);
            }
            Ok(rows)
        }
        CellValue::Number(n) => Ok(vec![vec![n.get()]]),
        _ => Ok(vec![Vec::new()]),
    }
}

fn build_regression_input(
    args: &[CellValue],
    function_name: &str,
) -> Result<RegressionInput, CellValue> {
    let ys = scalar_numbers_from_array(&args[0], function_name)?;
    let n = ys.len();

    let xs = if args.len() > 1 {
        let x_rows = match numeric_rows(&args[1]) {
            Ok(rows) => rows,
            Err(e) => return Err(CellValue::Error(e, None)),
        };
        let (x_row_count, x_col_count) = array_dimensions(&args[1]).unwrap_or((1, 1));
        let (y_row_count, y_col_count) = array_dimensions(&args[0]).unwrap_or((n, 1));

        if x_row_count == n && x_col_count > 0 {
            x_rows
        } else if x_col_count == n && x_row_count > 0 {
            (0..n)
                .map(|observation| {
                    x_rows
                        .iter()
                        .map(|row| row.get(observation).copied().unwrap_or(0.0))
                        .collect::<Vec<_>>()
                })
                .collect()
        } else if y_row_count == 1 && x_col_count == n && x_row_count > 0 {
            (0..n)
                .map(|observation| {
                    x_rows
                        .iter()
                        .map(|row| row.get(observation).copied().unwrap_or(0.0))
                        .collect::<Vec<_>>()
                })
                .collect()
        } else if y_col_count == 1 && x_row_count == n && x_col_count > 0 {
            x_rows
        } else {
            return Err(CellValue::error_with_message(
                CellError::Na,
                format!(
                    "{function_name}: known_xs shape {x_row_count}x{x_col_count} must align with known_ys length {n}",
                ),
            ));
        }
    } else {
        (1..=n).map(|i| vec![i as f64]).collect()
    };

    if xs.len() != n || xs.is_empty() || xs.iter().any(Vec::is_empty) {
        return Err(CellValue::error_with_message(
            CellError::Na,
            format!(
                "{function_name}: known_xs length ({}) must match known_ys length ({n}) and be >= 2",
                xs.len(),
            ),
        ));
    }
    let predictor_count = xs[0].len();
    if xs.iter().any(|row| row.len() != predictor_count) {
        return Err(CellValue::error_with_message(
            CellError::Na,
            format!("{function_name}: known_xs rows must have consistent predictor counts"),
        ));
    }
    if n < 2 || predictor_count == 0 {
        return Err(CellValue::error_with_message(
            CellError::Na,
            format!(
                "{function_name}: known_xs length ({}) must match known_ys length ({n}) and be >= 2",
                xs.len(),
            ),
        ));
    }

    Ok(RegressionInput { ys, xs })
}

fn vector_dot(left: &[f64], right: &[f64]) -> f64 {
    left.iter()
        .zip(right.iter())
        .map(|(a, b)| a * b)
        .sum::<f64>()
}

fn vector_norm(values: &[f64]) -> f64 {
    vector_dot(values, values).sqrt()
}

fn independent_design_columns(
    input: &RegressionInput,
    constant: bool,
) -> Vec<(DesignColumn, Vec<f64>)> {
    let n = input.ys.len();
    let predictor_count = input.xs[0].len();
    let mut candidates = Vec::with_capacity(predictor_count + usize::from(constant));
    if constant {
        candidates.push((DesignColumn::Intercept, vec![1.0; n]));
    }
    for predictor_index in 0..predictor_count {
        candidates.push((
            DesignColumn::Predictor(predictor_index),
            input
                .xs
                .iter()
                .map(|row| row[predictor_index])
                .collect::<Vec<_>>(),
        ));
    }

    let mut selected = Vec::new();
    let mut orthonormal_basis: Vec<Vec<f64>> = Vec::new();
    for (column, values) in candidates {
        let original_norm = vector_norm(&values);
        if original_norm <= 1e-12 {
            continue;
        }

        let mut residual = values.clone();
        for basis in &orthonormal_basis {
            let projection = vector_dot(&residual, basis);
            for (value, basis_value) in residual.iter_mut().zip(basis.iter()) {
                *value -= projection * basis_value;
            }
        }

        let residual_norm = vector_norm(&residual);
        if residual_norm > 1e-10 * original_norm.max(1.0) {
            for value in &mut residual {
                *value /= residual_norm;
            }
            orthonormal_basis.push(residual);
            selected.push((column, values));
        }
    }

    selected
}

fn fit_linear_regression(
    input: &RegressionInput,
    constant: bool,
) -> Result<RegressionFit, CellValue> {
    let n = input.ys.len();
    let predictor_count = input.xs[0].len();
    let active_columns = independent_design_columns(input, constant);
    let active_parameter_count = active_columns.len();
    let active_predictor_count = active_columns
        .iter()
        .filter(|(column, _)| matches!(column, DesignColumn::Predictor(_)))
        .count();
    if active_parameter_count == 0 {
        return Err(CellValue::error_with_message(
            CellError::Div0,
            "LINEST: known_xs columns are linearly dependent",
        ));
    }

    let mut design_data = Vec::with_capacity(n * active_parameter_count);
    for row_index in 0..n {
        for (_, values) in &active_columns {
            design_data.push(values[row_index]);
        }
    }

    let design = DMatrix::from_row_slice(n, active_parameter_count, &design_data);
    let y = DVector::from_row_slice(&input.ys);
    let xtx = design.transpose() * &design;
    let Some(xtx_inverse) = xtx.try_inverse() else {
        return Err(CellValue::error_with_message(
            CellError::Div0,
            "LINEST: known_xs columns are linearly dependent",
        ));
    };

    let beta = &xtx_inverse * design.transpose() * y;
    let predictions = design * &beta;
    let residuals: Vec<f64> = input
        .ys
        .iter()
        .zip(predictions.iter())
        .map(|(actual, predicted)| actual - predicted)
        .collect();
    let ss_residual: f64 = residuals.iter().map(|value| value * value).sum();

    let (ss_total, ss_regression) = if constant {
        let mean_y = input.ys.iter().sum::<f64>() / n as f64;
        let ss_total = input
            .ys
            .iter()
            .map(|value| (value - mean_y).powi(2))
            .sum::<f64>();
        (ss_total, ss_total - ss_residual)
    } else {
        let ss_total = input.ys.iter().map(|value| value * value).sum::<f64>();
        (ss_total, ss_total - ss_residual)
    };

    let degrees_of_freedom = (n - active_parameter_count) as f64;
    let mean_square_error = if degrees_of_freedom > 0.0 {
        ss_residual / degrees_of_freedom
    } else {
        f64::NAN
    };

    let mut standard_errors = Vec::with_capacity(active_parameter_count);
    for i in 0..active_parameter_count {
        standard_errors.push((mean_square_error * xtx_inverse[(i, i)]).sqrt());
    }

    let mut slopes = vec![0.0; predictor_count];
    let mut slope_standard_errors = vec![0.0; predictor_count];
    let mut intercept = 0.0;
    let mut intercept_standard_error = None;
    for (active_index, (column, _)) in active_columns.iter().enumerate() {
        match *column {
            DesignColumn::Intercept => {
                intercept = beta[active_index];
                intercept_standard_error = Some(standard_errors[active_index]);
            }
            DesignColumn::Predictor(predictor_index) => {
                slopes[predictor_index] = beta[active_index];
                slope_standard_errors[predictor_index] = standard_errors[active_index];
            }
        }
    }

    let standard_error_y = mean_square_error.sqrt();
    let r_squared = if ss_total.abs() > 1e-15 {
        1.0 - ss_residual / ss_total
    } else if ss_residual.abs() < 1e-15 {
        1.0
    } else {
        f64::NAN
    };
    let regression_degrees_of_freedom = active_predictor_count as f64;
    let f_statistic = if regression_degrees_of_freedom > 0.0
        && degrees_of_freedom > 0.0
        && ss_residual.abs() > 1e-15
    {
        (ss_regression / regression_degrees_of_freedom) / mean_square_error
    } else if regression_degrees_of_freedom > 0.0
        && degrees_of_freedom > 0.0
        && ss_regression.abs() > 1e-15
    {
        f64::INFINITY
    } else {
        f64::NAN
    };

    Ok(RegressionFit {
        slopes,
        intercept: if constant { intercept } else { 0.0 },
        slope_standard_errors,
        intercept_standard_error: if constant {
            intercept_standard_error
        } else {
            None
        },
        r_squared,
        standard_error_y,
        f_statistic,
        degrees_of_freedom,
        ss_regression,
        ss_residual,
    })
}

fn number_or_error(value: f64, error: CellError) -> CellValue {
    if value.is_finite() {
        CellValue::number(value)
    } else {
        CellValue::Error(error, None)
    }
}

fn reversed_numbers(values: &[f64]) -> Vec<CellValue> {
    values
        .iter()
        .rev()
        .map(|value| number_or_error(*value, CellError::Num))
        .collect()
}

fn linest_result(fit: &RegressionFit, stats: bool, output_columns: usize) -> CellValue {
    let mut coefficient_row = reversed_numbers(&fit.slopes);
    coefficient_row.push(number_or_error(fit.intercept, CellError::Num));

    if !stats {
        return CellValue::from_rows(vec![coefficient_row]);
    }

    let mut se_row = reversed_numbers(&fit.slope_standard_errors);
    se_row.push(match fit.intercept_standard_error {
        Some(value) => number_or_error(value, CellError::Div0),
        None => CellValue::Error(CellError::Na, None),
    });

    let mut r2_row = vec![
        number_or_error(fit.r_squared, CellError::Div0),
        number_or_error(fit.standard_error_y, CellError::Div0),
    ];
    let mut f_row = vec![
        number_or_error(fit.f_statistic, CellError::Div0),
        number_or_error(fit.degrees_of_freedom, CellError::Div0),
    ];
    let mut ss_row = vec![
        number_or_error(fit.ss_regression, CellError::Num),
        number_or_error(fit.ss_residual, CellError::Num),
    ];

    for row in [&mut r2_row, &mut f_row, &mut ss_row] {
        while row.len() < output_columns {
            row.push(CellValue::Error(CellError::Na, None));
        }
    }

    CellValue::from_rows(vec![coefficient_row, se_row, r2_row, f_row, ss_row])
}

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
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            2 => Some(CellValue::Boolean(true)),
            3 => Some(CellValue::Boolean(false)),
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let constant = match coerce_optional_bool(args, 2, true) {
            Ok(value) => value,
            Err(e) => return CellValue::Error(e, None),
        };
        let stats = match coerce_optional_bool(args, 3, false) {
            Ok(value) => value,
            Err(e) => return CellValue::Error(e, None),
        };

        let input = match build_regression_input(args, "LINEST") {
            Ok(input) => input,
            Err(error) => return error,
        };
        let output_columns = input.xs[0].len() + 1;
        match fit_linear_regression(&input, constant) {
            Ok(fit) => linest_result(&fit, stats, output_columns),
            Err(error) => error,
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
