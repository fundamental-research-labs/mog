use value_types::CellValue;

use super::number;
use crate::types::{CellValueResult, CoercionResult};

pub(super) fn coerce_to_currency(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Number(n) => CoercionResult::ok(CellValueResult::Number(n.get())),
        CellValue::Text(s) => {
            let trimmed = s.trim();
            let is_negative = trimmed.contains('(') || trimmed.contains('-');
            let cleaned = number::strip_currency_and_commas(&trimmed.replace(['(', ')'], ""));
            if let Ok(n) = cleaned.parse::<f64>()
                && n.is_finite()
            {
                let result = if is_negative && n > 0.0 { -n } else { n };
                return CoercionResult::ok(CellValueResult::Number(result));
            }
            number::coerce_to_number(value)
        }
        _ => number::coerce_to_number(value),
    }
}
