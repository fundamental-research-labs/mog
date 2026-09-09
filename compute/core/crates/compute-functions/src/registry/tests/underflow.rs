use super::*;
use crate::{PureFunction, RegisteredFunction};

struct IdentityArray;

impl PureFunction for IdentityArray {
    fn call(&self, args: &[CellValue]) -> CellValue {
        args[0].clone()
    }

    fn name(&self) -> &'static str {
        "IDENTITY_ARRAY"
    }

    fn min_args(&self) -> usize {
        1
    }

    fn max_args(&self) -> Option<usize> {
        Some(1)
    }

    fn returns_array(&self) -> bool {
        true
    }
}

#[test]
fn direct_registry_results_flush_subnormal_numbers() {
    let registry = FunctionRegistry::new();
    let subnormal = f64::MIN_POSITIVE / 2.0;

    assert_eq!(
        registry.call("ABS", &[CellValue::number(subnormal)]),
        CellValue::number(0.0)
    );
    assert_eq!(
        registry.call(
            "ABS",
            &[CellValue::row_array(vec![
                CellValue::number(subnormal),
                CellValue::number(f64::MIN_POSITIVE),
            ])],
        ),
        CellValue::row_array(vec![
            CellValue::number(0.0),
            CellValue::number(f64::MIN_POSITIVE),
        ])
    );
}

#[test]
fn direct_registry_preserves_noop_array_identity() {
    let source = CellValue::row_array(vec![
        CellValue::number(f64::MIN_POSITIVE),
        CellValue::Text("x".into()),
    ]);
    let original = match &source {
        CellValue::Array(array) => std::sync::Arc::clone(array),
        _ => panic!("expected array"),
    };
    let function = RegisteredFunction::Pure(Box::new(IdentityArray));

    let result = function.call(std::slice::from_ref(&source));
    let returned = match result {
        CellValue::Array(array) => array,
        _ => panic!("expected array"),
    };
    assert!(std::sync::Arc::ptr_eq(&original, &returned));
}
