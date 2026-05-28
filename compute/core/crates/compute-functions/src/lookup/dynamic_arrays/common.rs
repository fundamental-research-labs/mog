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

pub(super) fn is_truthy(v: &CellValue) -> bool {
    match v {
        CellValue::Boolean(b) => *b,
        CellValue::Number(n) => n.get() != 0.0,
        _ => false,
    }
}
