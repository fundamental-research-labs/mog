use std::sync::Arc;

use value_types::{CellArray, CellError, CellValue};

use super::super::helpers::cell_value_cmp;

pub(super) fn cell_value_cmp_sort(a: &CellValue, b: &CellValue) -> i32 {
    match (a, b) {
        (CellValue::Null, CellValue::Null) => 0,
        (CellValue::Null, _) => 1,
        (_, CellValue::Null) => -1,
        _ => cell_value_cmp(a, b),
    }
}

pub(super) fn to_array(v: &CellValue) -> Result<Arc<CellArray>, CellError> {
    match v {
        CellValue::Array(rows) => Ok(Arc::clone(rows)),
        CellValue::Error(e, _) => Err(*e),
        other => Ok(Arc::new(CellArray::new(vec![other.clone()], 1))),
    }
}

pub(super) fn rows_equal(a: &[CellValue], b: &[CellValue]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .all(|(x, y)| cell_value_cmp(x, y) == 0)
}

/// Parse the documented `sort_order` argument shared by SORT and SORTBY.
/// Excel accepts only 1 (ascending) and -1 (descending); a coercion error is
/// preserved so an error-valued order remains observable to the caller.
pub(super) fn parse_sort_order(value: &CellValue) -> Result<i32, CellValue> {
    match value.coerce_to_number() {
        Ok(1.0) => Ok(1),
        Ok(-1.0) => Ok(-1),
        Ok(_) => Err(CellValue::Error(CellError::Value, None)),
        Err(error) => Err(CellValue::Error(error, None)),
    }
}
