use super::super::basic::FnAbs;
use super::super::random::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_rand_is_volatile() {
    assert!(FnRand.is_volatile());
    assert!(FnRandBetween.is_volatile());
    assert!(FnRandArray.is_volatile());
    assert!(!FnAbs.is_volatile());
}

// --- Tests for new trigonometric functions ---

#[test]
fn test_randarray_rejects_arrays_larger_than_a_sheet() {
    let num = CellValue::number;
    for args in [
        vec![num(1_048_577.0)],
        vec![num(1.0), num(16_385.0)],
        vec![num(2_000.0), num(1_001.0)],
        vec![num(1e9), num(1e9)],
    ] {
        assert!(
            matches!(
                FnRandArray.call(&args),
                CellValue::Error(CellError::Calc, _)
            ),
            "RANDARRAY{args:?}"
        );
    }
}
