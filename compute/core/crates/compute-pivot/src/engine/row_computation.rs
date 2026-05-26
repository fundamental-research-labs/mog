//! Row computation: calculated field application for pivot values.

use std::collections::HashMap;

use value_types::CellValue;

use crate::calc_field::{CalcFieldExpr, evaluate_calc_field};

/// Apply calculated fields to a flat values array.
///
/// Given a values Vec laid out as `[col0_val0, col0_val1, ..., col1_val0, col1_val1, ...]`
/// (C column leaves x V value placements), this function inserts calculated field values
/// after each column-leaf group, producing a new layout:
/// `[col0_val0, ..., col0_valV-1, col0_calc0, ..., col1_val0, ..., col1_valV-1, col1_calc0, ...]`
///
/// The resulting Vec has length `C * (V + K)` where K = number of valid calculated fields.
pub(crate) fn apply_calc_fields_to_values(
    values: &[CellValue],
    num_columns: usize,
    num_values: usize,
    parsed_exprs: &[Option<&CalcFieldExpr>],
    value_field_names: &[String],
) -> Vec<CellValue> {
    let num_calc = parsed_exprs.len();
    let new_stride = num_values + num_calc;
    let mut result = Vec::with_capacity(num_columns * new_stride);

    for col_idx in 0..num_columns {
        let start = col_idx * num_values;

        // Copy regular values for this column leaf, padding with Null if needed
        for i in 0..num_values {
            let val = values.get(start + i).cloned().unwrap_or(CellValue::Null);
            result.push(val);
        }

        // Build field name -> value map from the regular values for this column
        let mut field_map: HashMap<&str, f64> = HashMap::new();
        for (i, name) in value_field_names.iter().enumerate() {
            if let Some(CellValue::Number(n)) = values.get(start + i)
                && n.is_finite()
            {
                field_map.insert(name.as_str(), n.get());
            }
        }

        // Evaluate each calculated field
        for expr_opt in parsed_exprs {
            match expr_opt {
                Some(expr) => match evaluate_calc_field(expr, &field_map) {
                    Some(v) => result.push(CellValue::number(v)),
                    None => result.push(CellValue::Null),
                },
                None => result.push(CellValue::Null),
            }
        }
    }

    result
}
