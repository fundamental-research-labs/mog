use value_types::CellValue;

use crate::patterns;
use crate::types::{CellValueResult, CoercionResult};

pub(super) fn coerce_to_date(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Number(n) => CoercionResult::ok(CellValueResult::Number(n.get())),
        CellValue::Text(s) => {
            let trimmed = s.trim();
            if patterns::is_date_string(trimmed) {
                return CoercionResult::ok(CellValueResult::Text(trimmed.to_string()));
            }
            if let Ok(n) = trimmed.parse::<f64>()
                && n.is_finite()
            {
                return CoercionResult::ok(CellValueResult::Number(n));
            }
            CoercionResult::err(format!("Cannot coerce \"{s}\" to date"))
        }
        _ => CoercionResult::err("Cannot coerce value to date"),
    }
}
