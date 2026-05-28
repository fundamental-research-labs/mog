use super::super::misc::*;
use super::helpers::*;
use crate::{FunctionRegistry, PureFunction};
use value_types::CellError;

#[test]
fn test_formulatext_is_not_registered_as_stub() {
    let reg = FunctionRegistry::new();
    assert!(reg.get_by_name("FORMULATEXT").is_none());
    assert_eq!(reg.call("FORMULATEXT", &[text("A1")]), err(CellError::Name));
}

#[test]
fn test_hyperlink() {
    let f = FnHyperlink;
    // With friendly name
    assert_eq!(
        f.call(&[text("https://example.com"), text("Click here")]),
        text("Click here")
    );
    // Without friendly name
    assert_eq!(
        f.call(&[text("https://example.com")]),
        text("https://example.com")
    );
}
