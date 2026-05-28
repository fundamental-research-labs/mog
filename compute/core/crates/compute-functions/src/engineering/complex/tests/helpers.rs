use value_types::CellValue;

use super::super::types::parse_complex;

pub(super) fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

pub(super) fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

pub(super) fn extract_f64(v: &CellValue) -> f64 {
    match v {
        CellValue::Number(n) => f64::from(*n),
        other => panic!("expected Number, got {:?}", other),
    }
}

pub(super) fn extract_text(v: &CellValue) -> String {
    match v {
        CellValue::Text(s) => s.to_string(),
        other => panic!("expected Text, got {:?}", other),
    }
}

pub(super) fn assert_num_approx(result: &CellValue, expected: f64, tol: f64) {
    let got = extract_f64(result);
    assert!(
        (got - expected).abs() < tol,
        "expected {expected}, got {got}, diff {}",
        (got - expected).abs()
    );
}

pub(super) fn assert_complex_approx(
    result: &CellValue,
    expected_re: f64,
    expected_im: f64,
    tol: f64,
) {
    let s = extract_text(result);
    let (re, im, _) =
        parse_complex(&s).unwrap_or_else(|| panic!("failed to parse complex result: {s:?}"));
    assert!(
        (re - expected_re).abs() < tol,
        "real part: expected {expected_re}, got {re} (from {s:?})"
    );
    assert!(
        (im - expected_im).abs() < tol,
        "imag part: expected {expected_im}, got {im} (from {s:?})"
    );
}
