use value_types::{CellError, CellValue};

pub(super) fn average(nums: &[f64]) -> CellValue {
    if nums.is_empty() {
        CellValue::error_with_message(
            CellError::Div0,
            "DAVERAGE: no numeric values in matching rows",
        )
    } else {
        CellValue::number(nums.iter().sum::<f64>() / nums.len() as f64)
    }
}

pub(super) fn max_or_zero(nums: &[f64]) -> CellValue {
    if nums.is_empty() {
        CellValue::number(0.0)
    } else {
        CellValue::number(nums.iter().cloned().fold(f64::NEG_INFINITY, f64::max))
    }
}

pub(super) fn min_or_zero(nums: &[f64]) -> CellValue {
    if nums.is_empty() {
        CellValue::number(0.0)
    } else {
        CellValue::number(nums.iter().cloned().fold(f64::INFINITY, f64::min))
    }
}

pub(super) fn product_or_zero(nums: &[f64]) -> CellValue {
    if nums.is_empty() {
        CellValue::number(0.0)
    } else {
        CellValue::number(nums.iter().product())
    }
}

pub(super) fn sample_variance(nums: &[f64], message: &'static str) -> Result<f64, CellValue> {
    if nums.len() < 2 {
        return Err(CellValue::error_with_message(CellError::Div0, message));
    }

    let mean = nums.iter().sum::<f64>() / nums.len() as f64;
    Ok(nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (nums.len() - 1) as f64)
}

pub(super) fn population_variance(nums: &[f64], message: &'static str) -> Result<f64, CellValue> {
    if nums.is_empty() {
        return Err(CellValue::error_with_message(CellError::Div0, message));
    }

    let mean = nums.iter().sum::<f64>() / nums.len() as f64;
    Ok(nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / nums.len() as f64)
}
