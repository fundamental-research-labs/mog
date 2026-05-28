use super::super::reference::*;
use super::helpers::*;
use crate::PureFunction;

#[test]
fn test_address() {
    let f = FnAddress;
    assert_eq!(f.call(&[num(1.0), num(1.0)]), text("$A$1"));
    assert_eq!(f.call(&[num(1.0), num(1.0), num(4.0)]), text("A1"));
    assert_eq!(
        f.call(&[num(1.0), num(1.0), num(1.0), bool_val(true), text("Sheet1")]),
        text("Sheet1!$A$1")
    );
}

#[test]
fn test_areas() {
    let f = FnAreas;
    assert_eq!(f.call(&[test_array()]), num(1.0));
}
