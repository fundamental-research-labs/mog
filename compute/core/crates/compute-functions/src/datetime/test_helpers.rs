use value_types::{CellControl, CellError, CellValue};

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

pub(super) fn null() -> CellValue {
    CellValue::Null
}

pub(super) fn control(b: bool) -> CellValue {
    CellValue::Control(CellControl::checkbox(b))
}

pub(super) fn assert_num_close(value: CellValue, expected: f64) {
    match value {
        CellValue::Number(n) => {
            assert!(
                (n.get() - expected).abs() < 1e-9,
                "expected {expected}, got {}",
                n.get()
            );
        }
        other => panic!("Expected number {expected}, got {other:?}"),
    }
}
