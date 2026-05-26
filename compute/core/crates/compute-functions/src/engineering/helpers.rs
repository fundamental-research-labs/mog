//! Shared helpers for engineering functions.

use value_types::CellValue;

/// Coerce arg to f64, propagating errors (preserves diagnostic messages).
pub(crate) fn coerce_num(args: &[CellValue], idx: usize) -> Result<f64, CellValue> {
    let v = args.get(idx).unwrap_or(&CellValue::Null);
    if matches!(v, CellValue::Error(..)) {
        return Err(v.clone());
    }
    v.coerce_to_number().map_err(|e| CellValue::Error(e, None))
}

pub(crate) fn coerce_str(args: &[CellValue], idx: usize) -> Result<String, CellValue> {
    let v = args.get(idx).unwrap_or(&CellValue::Null);
    if matches!(v, CellValue::Error(..)) {
        return Err(v.clone());
    }
    v.coerce_to_string()
        .map(|s| s.into_owned())
        .map_err(|e| CellValue::Error(e, None))
}
