use super::super::*;

#[test]
fn serde_roundtrip() {
    let v = FiniteF64::new(42.5).unwrap();
    let json = serde_json::to_string(&v).unwrap();
    let v2: FiniteF64 = serde_json::from_str(&json).unwrap();
    assert_eq!(v, v2);
    assert_eq!(v2.get(), 42.5);
}

#[test]
fn serde_roundtrip_zero() {
    let v = FiniteF64::new(0.0).unwrap();
    let json = serde_json::to_string(&v).unwrap();
    let v2: FiniteF64 = serde_json::from_str(&json).unwrap();
    assert_eq!(v, v2);
}
