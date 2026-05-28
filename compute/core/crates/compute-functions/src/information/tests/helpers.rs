use value_types::{CellError, CellValue};

pub(super) fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

pub(super) fn text(s: &str) -> CellValue {
    CellValue::Text(s.to_string().into())
}

pub(super) fn err(e: CellError) -> CellValue {
    CellValue::Error(e, None)
}

pub(super) fn bool_val(b: bool) -> CellValue {
    CellValue::Boolean(b)
}

pub(super) fn null() -> CellValue {
    CellValue::Null
}

pub(super) fn array(rows: Vec<Vec<CellValue>>) -> CellValue {
    CellValue::from_rows(rows)
}
