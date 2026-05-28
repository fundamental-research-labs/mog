use super::super::super::test_helpers::{bool_val, control, err, null, num, text};
use super::super::sheets_to::{FnToDate, FnToDollars, FnToPercent, FnToPureNumber, FnToText};
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_sheets_to_format_conversions_direct_scalar_classes() {
    let inputs = [
        num(12.5),
        text("12.5"),
        bool_val(true),
        null(),
        control(true),
        err(CellError::Div0),
    ];
    for function in [
        &FnToDate as &dyn crate::PureFunction,
        &FnToDollars,
        &FnToPercent,
        &FnToPureNumber,
    ] {
        for input in &inputs {
            assert_eq!(
                function.call(std::slice::from_ref(input)),
                input.clone(),
                "{} should return {:?} unchanged",
                function.name(),
                input
            );
        }
    }
}

#[test]
fn test_to_text_direct_scalar_classes() {
    let f = FnToText;
    assert_eq!(f.call(&[num(24.0)]), text("24"));
    assert_eq!(f.call(&[num(12.345678901234567)]), text("12.3456789012346"));
    assert_eq!(f.call(&[text("hello")]), text("hello"));
    assert_eq!(f.call(&[bool_val(false)]), bool_val(false));
    assert_eq!(f.call(&[null()]), null());
    assert_eq!(f.call(&[control(true)]), control(true));
    assert_eq!(f.call(&[err(CellError::Na)]), err(CellError::Na));
}

#[test]
fn test_sheets_to_conversion_registry_array_lift() {
    let reg = crate::FunctionRegistry::new();
    let arr = CellValue::from_rows(vec![
        vec![num(1.0), text("x")],
        vec![bool_val(true), null()],
    ]);

    for name in ["TO_DATE", "TO_DOLLARS", "TO_PERCENT", "TO_PURE_NUMBER"] {
        assert_eq!(reg.call(name, std::slice::from_ref(&arr)), arr);
    }

    assert_eq!(
        reg.call("TO_TEXT", &[arr]),
        CellValue::from_rows(vec![
            vec![text("1"), text("x")],
            vec![bool_val(true), null()]
        ])
    );
}
