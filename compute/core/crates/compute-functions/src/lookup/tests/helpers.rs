use value_types::{CellError, CellValue};

pub(super) fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

pub(super) fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

pub(super) fn err(e: CellError) -> CellValue {
    CellValue::Error(e, None)
}

pub(super) fn bool_val(b: bool) -> CellValue {
    CellValue::Boolean(b)
}

pub(super) fn test_array() -> CellValue {
    CellValue::from_rows(vec![
        vec![num(1.0), text("a"), num(100.0)],
        vec![num(2.0), text("b"), num(200.0)],
        vec![num(3.0), text("c"), num(300.0)],
    ])
}
