use super::super::*;

#[test]
fn try_from_finite_succeeds() {
    let v: Result<FiniteF64, _> = 42.0_f64.try_into();
    assert!(v.is_ok());
    assert_eq!(v.unwrap().get(), 42.0);
}

#[test]
fn try_from_nan_fails() {
    let v = FiniteF64::try_from(f64::NAN);
    assert!(v.is_err());
    assert_eq!(
        v.unwrap_err().to_string(),
        "expected finite f64, got NaN or Infinity"
    );
}

#[test]
fn try_from_infinity_fails() {
    assert!(FiniteF64::try_from(f64::INFINITY).is_err());
    assert!(FiniteF64::try_from(f64::NEG_INFINITY).is_err());
}

#[test]
fn non_finite_error_is_std_error() {
    fn assert_error<T: std::error::Error>() {}
    assert_error::<NonFiniteError>();
}

#[test]
fn display_format() {
    let v = FiniteF64::new(3.25).unwrap();
    assert_eq!(format!("{v}"), "3.25");
}

#[test]
fn debug_format() {
    let v = FiniteF64::new(3.25).unwrap();
    assert_eq!(format!("{v:?}"), "3.25");
}

#[test]
fn clone_and_copy() {
    let a = FiniteF64::new(1.0).unwrap();
    let b = a; // Copy
    let c = a; // Also Copy
    assert_eq!(a, b);
    assert_eq!(a, c);
}

#[test]
fn default_is_zero() {
    let d = FiniteF64::default();
    assert_eq!(d, FiniteF64::ZERO);
    assert_eq!(d.get(), 0.0);
}
