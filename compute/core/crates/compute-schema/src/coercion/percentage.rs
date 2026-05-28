use value_types::CellValue;

use crate::types::{CellValueResult, CoercionResult};

pub(super) fn coerce_to_percentage(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Number(n) => {
            let v = n.get();
            if v.abs() > 1.0 {
                CoercionResult::ok(CellValueResult::Number(v / 100.0))
            } else {
                CoercionResult::ok(CellValueResult::Number(v))
            }
        }
        CellValue::Text(s) => {
            let trimmed = s.trim();
            if let Some(before_pct) = trimmed.strip_suffix('%')
                && let Ok(n) = before_pct.trim().parse::<f64>()
            {
                return CoercionResult::ok(CellValueResult::Number(n / 100.0));
            }
            if let Ok(n) = trimmed.parse::<f64>()
                && n.is_finite()
            {
                return if n.abs() <= 1.0 {
                    CoercionResult::ok(CellValueResult::Number(n))
                } else {
                    CoercionResult::ok(CellValueResult::Number(n / 100.0))
                };
            }
            CoercionResult::err(format!("Cannot coerce \"{s}\" to percentage"))
        }
        _ => CoercionResult::err("Cannot coerce value to percentage"),
    }
}
