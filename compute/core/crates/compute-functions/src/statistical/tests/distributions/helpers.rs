use value_types::{CellError, CellValue};

// ===================================================================
// Distribution tests -- first-principles values from statistical tables
// ===================================================================

pub(super) const DIST_TOL: f64 = 1e-4;

pub(super) fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

pub(super) fn err(e: CellError) -> CellValue {
    CellValue::Error(e, None)
}

pub(super) fn assert_num(result: CellValue, expected: f64, tolerance: f64, label: &str) {
    if let CellValue::Number(n) = result {
        assert!(
            (n.get() - expected).abs() < tolerance,
            "{}: expected {}, got {}",
            label,
            expected,
            n.get()
        );
    } else {
        panic!(
            "{}: expected Number(~{}), got {:?}",
            label, expected, result
        );
    }
}

pub(super) fn assert_dist_near(result: CellValue, expected: f64, label: &str) {
    match result {
        CellValue::Number(n) => {
            let v = n.get();
            assert!(
                (v - expected).abs() < DIST_TOL,
                "{}: expected {}, got {}",
                label,
                expected,
                v
            );
        }
        other => panic!("{}: expected Number(~{}), got {:?}", label, expected, other),
    }
}

pub(super) fn assert_num_err(result: CellValue, label: &str) {
    assert_eq!(result, err(CellError::Num), "{}: expected #NUM!", label);
}

pub(super) fn bv(b: bool) -> CellValue {
    CellValue::Boolean(b)
}
