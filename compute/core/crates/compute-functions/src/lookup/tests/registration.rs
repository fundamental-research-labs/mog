use super::super::dynamic_arrays::*;
use super::super::manipulation::*;
use super::super::stack::*;
use crate::PureFunction;

#[test]
fn test_array_markers_are_flagged() {
    assert!(FnArrayConstrain.returns_array());
    assert!(FnFlatten.returns_array());
    assert!(FnFilter.returns_array());
    assert!(FnSortN.returns_array());
    assert!(FnSort.returns_array());
    assert!(FnTrimRange.returns_array());
    assert!(FnUnique.returns_array());
    assert!(FnSequence.returns_array());
}

#[test]
fn test_new_array_functions_return_array() {
    assert!(FnSortBy.returns_array());
    assert!(FnChooseCols.returns_array());
    assert!(FnChooseRows.returns_array());
    assert!(FnDrop.returns_array());
    assert!(FnExpand.returns_array());
    assert!(FnTake.returns_array());
    assert!(FnTranspose.returns_array());
    assert!(FnHstack.returns_array());
    assert!(FnVstack.returns_array());
    assert!(FnToCol.returns_array());
    assert!(FnToRow.returns_array());
    assert!(FnWrapCols.returns_array());
    assert!(FnWrapRows.returns_array());
}
