use super::super::basic::FnAbs;
use super::super::random::*;
use crate::PureFunction;

#[test]
fn test_rand_is_volatile() {
    assert!(FnRand.is_volatile());
    assert!(FnRandBetween.is_volatile());
    assert!(FnRandArray.is_volatile());
    assert!(!FnAbs.is_volatile());
}

// --- Tests for new trigonometric functions ---
