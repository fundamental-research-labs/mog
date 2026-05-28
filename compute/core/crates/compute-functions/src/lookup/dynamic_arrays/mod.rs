//! Dynamic array functions: FILTER, SORT, UNIQUE, SEQUENCE, SORTBY.

mod common;
mod filter;
mod sequence;
mod sort;
mod sortby;
mod sortn;
mod unique;

pub(super) use filter::FnFilter;
pub(super) use sequence::FnSequence;
pub(super) use sort::FnSort;
pub(super) use sortby::FnSortBy;
pub(super) use sortn::FnSortN;
pub(super) use unique::FnUnique;

use crate::FunctionRegistry;

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnFilter));
    registry.register(Box::new(FnSort));
    registry.register(Box::new(FnSortN));
    registry.register(Box::new(FnUnique));
    registry.register(Box::new(FnSequence));
    registry.register(Box::new(FnSortBy));
}
