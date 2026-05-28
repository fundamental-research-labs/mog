use value_types::CellValue;

/// Tolerance for floating-point comparisons (matches TS `1e-10`).
pub(super) const TOLERANCE: f64 = 1e-10;

/// Extract all values as f64 if they are all `Number` variants.
pub(super) fn all_numbers(values: &[CellValue]) -> Option<Vec<f64>> {
    let mut nums = Vec::with_capacity(values.len());
    for v in values {
        match v {
            CellValue::Number(n) => nums.push(n.get()),
            _ => return None,
        }
    }
    Some(nums)
}

/// Extract all values as `&str` if they are all `Text` variants.
pub(super) fn all_texts(values: &[CellValue]) -> Option<Vec<&str>> {
    let mut texts = Vec::with_capacity(values.len());
    for v in values {
        match v {
            CellValue::Text(s) => texts.push(s.as_ref()),
            _ => return None,
        }
    }
    Some(texts)
}
