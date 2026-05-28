use value_types::{CellError, CellValue};

pub(super) const TOL: f64 = 1e-10;

pub(super) fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

pub(super) fn err(e: CellError) -> CellValue {
    CellValue::Error(e, None)
}

pub(super) fn null() -> CellValue {
    CellValue::Null
}

pub(super) fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

pub(super) fn reg() -> crate::FunctionRegistry {
    crate::FunctionRegistry::new()
}

pub(super) fn assert_is_err(actual: CellValue, expected: CellError) {
    match actual {
        CellValue::Error(e, _) => assert_eq!(e, expected, "wrong error variant"),
        other => panic!("expected Error({expected:?}), got {other:?}"),
    }
}

pub(super) fn assert_close(actual: CellValue, expected: f64) {
    match actual {
        CellValue::Number(n) => {
            let v = f64::from(n);
            assert!(
                (v - expected).abs() < TOL,
                "expected {expected}, got {v} (diff={})",
                (v - expected).abs()
            );
        }
        other => panic!("expected Number({expected}), got {other:?}"),
    }
}
