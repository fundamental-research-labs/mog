use super::super::super::dynamic_arrays::*;
use super::super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_sortn_default_and_unique_modes() {
    let f = FnSortN;
    let arr = CellValue::from_rows(vec![
        vec![text("b"), num(2.0)],
        vec![text("a"), num(1.0)],
        vec![text("a"), num(1.0)],
        vec![text("c"), num(3.0)],
    ]);
    assert_eq!(
        f.call(&[arr.clone(), num(2.0), num(0.0), num(2.0), bool_val(true)]),
        CellValue::from_rows(vec![vec![text("a"), num(1.0)], vec![text("a"), num(1.0)]])
    );
    assert_eq!(
        f.call(&[arr, num(2.0), num(2.0), num(2.0), bool_val(true)]),
        CellValue::from_rows(vec![vec![text("a"), num(1.0)], vec![text("b"), num(2.0)]])
    );
}
