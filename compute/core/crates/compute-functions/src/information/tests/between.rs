use value_types::CellError;

use crate::information::between::FnIsBetween;
use crate::{FunctionRegistry, PureFunction};

use super::helpers::{array, bool_val, err, num, text};

#[test]
fn test_isbetween_defaults_and_inclusive_bounds() {
    assert_eq!(
        FnIsBetween.call(&[num(5.0), num(1.0), num(10.0)]),
        bool_val(true)
    );
    assert_eq!(
        FnIsBetween.call(&[num(1.0), num(1.0), num(10.0)]),
        bool_val(true)
    );
    assert_eq!(
        FnIsBetween.call(&[num(10.0), num(1.0), num(10.0)]),
        bool_val(true)
    );
    assert_eq!(
        FnIsBetween.call(&[num(0.0), num(1.0), num(10.0)]),
        bool_val(false)
    );
}

#[test]
fn test_isbetween_inclusivity_matrix_and_equal_bounds() {
    assert_eq!(
        FnIsBetween.call(&[num(1.0), num(1.0), num(10.0), bool_val(false)]),
        bool_val(false)
    );
    assert_eq!(
        FnIsBetween.call(&[
            num(10.0),
            num(1.0),
            num(10.0),
            bool_val(true),
            bool_val(false),
        ]),
        bool_val(false)
    );
    assert_eq!(
        FnIsBetween.call(&[num(5.0), num(5.0), num(5.0), bool_val(true), bool_val(true)]),
        bool_val(true)
    );
    assert_eq!(
        FnIsBetween.call(&[
            num(5.0),
            num(5.0),
            num(5.0),
            bool_val(false),
            bool_val(true),
        ]),
        bool_val(false)
    );
}

#[test]
fn test_isbetween_reversed_bounds_and_coercions() {
    assert_eq!(
        FnIsBetween.call(&[num(5.0), num(10.0), num(1.0)]),
        bool_val(false)
    );
    assert_eq!(
        FnIsBetween.call(&[text("5"), text("1"), text("10")]),
        bool_val(true)
    );
    assert_eq!(
        FnIsBetween.call(&[bool_val(true), num(1.0), num(1.0)]),
        bool_val(true)
    );
    assert_eq!(
        FnIsBetween.call(&[text("x"), num(1.0), num(2.0)]),
        err(CellError::Value)
    );
    assert_eq!(
        FnIsBetween.call(&[err(CellError::Ref), num(1.0), num(2.0)]),
        err(CellError::Ref)
    );
}

#[test]
fn test_isbetween_registry_array_broadcast() {
    let reg = FunctionRegistry::new();
    let values = array(vec![vec![num(0.0)], vec![num(5.0)], vec![num(10.0)]]);
    let result = reg.call("ISBETWEEN", &[values, num(1.0), num(10.0)]);
    assert_eq!(
        result,
        array(vec![
            vec![bool_val(false)],
            vec![bool_val(true)],
            vec![bool_val(true)],
        ])
    );

    let lower_bounds = array(vec![vec![num(0.0), num(6.0)]]);
    let result = reg.call("ISBETWEEN", &[num(5.0), lower_bounds, num(10.0)]);
    assert_eq!(result, array(vec![vec![bool_val(true), bool_val(false)]]));

    let incompatible = reg.call(
        "ISBETWEEN",
        &[
            array(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]),
            array(vec![vec![num(0.0)], vec![num(0.0)], vec![num(0.0)]]),
            num(10.0),
        ],
    );
    assert_eq!(incompatible, err(CellError::Value));
}
