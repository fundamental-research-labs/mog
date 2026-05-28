use value_types::CellError;

use crate::PureFunction;
use crate::information::context::{FnCell, FnInfo, FnSheet, FnSheets};

use super::helpers::{bool_val, err, num, text};

#[test]
fn test_cell_type() {
    assert_eq!(FnCell.call(&[text("type")]), text("b"));
    assert_eq!(FnCell.call(&[text("type"), text("label")]), text("l"));
    assert_eq!(FnCell.call(&[text("type"), num(1.0)]), text("v"));
    assert_eq!(FnCell.call(&[text("type"), bool_val(false)]), text("v"));
    assert_eq!(
        FnCell.call(&[text("type"), err(CellError::Div0)]),
        text("v")
    );
}

#[test]
fn test_cell_contents() {
    assert_eq!(
        FnCell.call(&[text("contents"), text("value")]),
        text("value")
    );
    assert_eq!(
        FnCell.call(&[text("contents"), err(CellError::Ref)]),
        err(CellError::Ref)
    );
    assert_eq!(FnCell.call(&[text("contents")]), super::helpers::null());
}

#[test]
fn test_cell_info_type_errors() {
    assert_eq!(
        FnCell.call(&[err(CellError::Name), num(1.0)]),
        err(CellError::Name)
    );
    assert_eq!(FnCell.call(&[num(1.0), num(1.0)]), err(CellError::Value));
    assert_eq!(
        FnCell.call(&[text("address"), num(1.0)]),
        err(CellError::Na)
    );
}

#[test]
fn test_info_osversion() {
    assert_eq!(FnInfo.call(&[text("osversion")]), text("Shortcut"));
}

#[test]
fn test_info_recalc() {
    assert_eq!(FnInfo.call(&[text("recalc")]), text("Automatic"));
}

#[test]
fn test_info_system() {
    assert_eq!(FnInfo.call(&[text("system")]), text("pcdos"));
}

#[test]
fn test_info_unsupported() {
    assert_eq!(FnInfo.call(&[text("unknown")]), err(CellError::Na));
}

#[test]
fn test_sheet_no_args() {
    assert_eq!(FnSheet.call(&[]), num(1.0));
}

#[test]
fn test_sheet_with_arg() {
    assert_eq!(FnSheet.call(&[text("Sheet1")]), num(1.0));
}

#[test]
fn test_sheet_error_propagation() {
    assert_eq!(FnSheet.call(&[err(CellError::Ref)]), err(CellError::Ref));
}

#[test]
fn test_sheets_no_args() {
    assert_eq!(FnSheets.call(&[]), num(1.0));
}

#[test]
fn test_sheets_with_arg() {
    assert_eq!(FnSheets.call(&[num(1.0)]), num(1.0));
}

#[test]
fn test_sheets_error_propagation() {
    assert_eq!(FnSheets.call(&[err(CellError::Na)]), err(CellError::Na));
}
