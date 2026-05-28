use super::super::index_match::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::CellError;

#[test]
fn test_choose() {
    let f = FnChoose;
    assert_eq!(
        f.call(&[num(2.0), text("a"), text("b"), text("c")]),
        text("b")
    );
    assert_eq!(f.call(&[num(0.0), text("a")]), err(CellError::Value));
    assert_eq!(f.call(&[num(5.0), text("a")]), err(CellError::Value));
}
