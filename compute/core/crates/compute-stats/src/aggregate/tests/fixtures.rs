use value_types::{CellError, CellValue};

pub(super) fn numbers() -> Vec<CellValue> {
    vec![
        CellValue::number(1.0),
        CellValue::number(2.0),
        CellValue::number(3.0),
        CellValue::number(4.0),
        CellValue::number(5.0),
    ]
}

pub(super) fn mixed_numbers() -> Vec<CellValue> {
    vec![
        CellValue::number(10.0),
        CellValue::number(20.0),
        CellValue::Null,
        CellValue::number(30.0),
        CellValue::Text("text".into()),
        CellValue::number(40.0),
    ]
}

pub(super) fn strings() -> Vec<CellValue> {
    vec![
        CellValue::Text("apple".into()),
        CellValue::Text("banana".into()),
        CellValue::Text("cherry".into()),
    ]
}

pub(super) fn with_nulls() -> Vec<CellValue> {
    vec![
        CellValue::number(1.0),
        CellValue::Null,
        CellValue::number(2.0),
        CellValue::Null,
        CellValue::number(3.0),
    ]
}

pub(super) fn empty() -> Vec<CellValue> {
    vec![]
}

pub(super) fn all_nulls() -> Vec<CellValue> {
    vec![CellValue::Null, CellValue::Null, CellValue::Null]
}

pub(super) fn div0_error() -> CellValue {
    CellValue::Error(CellError::Div0, None)
}

pub(super) fn with_errors() -> Vec<CellValue> {
    vec![
        CellValue::number(1.0),
        div0_error(),
        CellValue::number(2.0),
        CellValue::number(3.0),
    ]
}

pub(super) fn assert_close(val: CellValue, expected: f64, tolerance: f64) {
    match val {
        CellValue::Number(n) => {
            assert!(
                (n.get() - expected).abs() < tolerance,
                "expected {} to be close to {} (tolerance {})",
                n,
                expected,
                tolerance,
            );
        }
        other => panic!("expected Number, got {:?}", other),
    }
}

pub(super) fn assert_num(val: CellValue, expected: f64) {
    match val {
        CellValue::Number(n) => {
            assert!(
                (n.get() - expected).abs() < 1e-10,
                "expected {} but got {}",
                expected,
                n,
            );
        }
        other => panic!("expected Number({}), got {:?}", expected, other),
    }
}

pub(super) fn assert_null(val: CellValue) {
    assert!(
        matches!(val, CellValue::Null),
        "expected Null, got {:?}",
        val,
    );
}
