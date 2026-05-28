use value_types::{CellError, CellValue};

/// Iterate two flattened ranges in lockstep, collecting (value, date) pairs.
/// Matches Excel behaviour:
///  - Errors in either position propagate immediately.
///  - Empty (Null) value cells are treated as 0 when the date is valid.
///  - Text entries are coerced to numbers (including date-like text -> serial).
///    If coercion fails, the pair is skipped.
///  - Boolean entries in either position cause the pair to be skipped.
///  - If the date is Null/Boolean the pair is skipped regardless.
pub(super) fn collect_value_date_pairs(
    flat_vals: &[CellValue],
    flat_dates: &[CellValue],
) -> Result<(Vec<f64>, Vec<f64>), CellError> {
    let len = flat_vals.len().max(flat_dates.len());
    let mut values = Vec::with_capacity(len);
    let mut dates = Vec::with_capacity(len);
    for i in 0..len {
        let v = flat_vals.get(i).unwrap_or(&CellValue::Null);
        let d = flat_dates.get(i).unwrap_or(&CellValue::Null);
        if let CellValue::Error(e, _) = v {
            return Err(*e);
        }
        if let CellValue::Error(e, _) = d {
            return Err(*e);
        }
        let date_val = match d {
            CellValue::Number(n) => n.get(),
            CellValue::Text(_) => match d.coerce_to_number() {
                Ok(n) => n,
                Err(_) => continue,
            },
            _ => continue,
        };
        let cash_flow = match v {
            CellValue::Number(n) => n.get(),
            CellValue::Null => 0.0,
            CellValue::Text(_) => match v.coerce_to_number() {
                Ok(n) => n,
                Err(_) => continue,
            },
            _ => continue,
        };
        values.push(cash_flow);
        dates.push(date_val);
    }
    Ok((values, dates))
}
