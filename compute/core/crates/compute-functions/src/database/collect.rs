use value_types::CellValue;

use super::criteria::{preparse_criteria, row_matches_preparsed};
use super::model::{Criteria, Database};

/// Collect values from a specific field column for rows matching criteria.
pub(super) fn get_matching_values(
    db: &Database,
    field_idx: usize,
    criteria: &Criteria,
) -> Vec<CellValue> {
    let preparsed = preparse_criteria(db, criteria);
    let mut values = Vec::new();
    for row in &db.data {
        if row_matches_preparsed(row, &preparsed) {
            values.push(row.get(field_idx).cloned().unwrap_or(CellValue::Null));
        }
    }
    values
}

/// Extract numbers from matching values, skipping non-numeric.
pub(super) fn extract_matching_numbers(values: &[CellValue]) -> Vec<f64> {
    let mut nums = Vec::new();
    for v in values {
        if let CellValue::Number(n) = v {
            nums.push(n.get());
        }
    }
    nums
}
