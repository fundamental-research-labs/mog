//! Byte operations (DBCS/SBCS aware): LEFTB, RIGHTB, MIDB, LENB, FINDB,
//! SEARCHB, REPLACEB
//!
//! In SBCS systems these behave identically to their non-B counterparts.
//! For simplicity, implemented as aliases (correct for non-DBCS locales).

use value_types::CellValue;

use super::extraction::{FnLeft, FnLen, FnMid, FnRight};
use super::search::{FnFind, FnReplace, FnSearch};
use crate::{FunctionRegistry, PureFunction};

pub(crate) struct FnLeftB;
impl PureFunction for FnLeftB {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "LEFTB"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnLeft.call(args)
    }
}

pub(crate) struct FnRightB;
impl PureFunction for FnRightB {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "RIGHTB"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnRight.call(args)
    }
}

pub(crate) struct FnMidB;
impl PureFunction for FnMidB {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "MIDB"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnMid.call(args)
    }
}

pub(crate) struct FnLenB;
impl PureFunction for FnLenB {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "LENB"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnLen.call(args)
    }
}

pub(crate) struct FnFindB;
impl PureFunction for FnFindB {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "FINDB"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnFind.call(args)
    }
}

pub(crate) struct FnSearchB;
impl PureFunction for FnSearchB {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "SEARCHB"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnSearch.call(args)
    }
}

pub(crate) struct FnReplaceB;
impl PureFunction for FnReplaceB {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "REPLACEB"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnReplace.call(args)
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnLeftB));
    registry.register(Box::new(FnRightB));
    registry.register(Box::new(FnMidB));
    registry.register(Box::new(FnLenB));
    registry.register(Box::new(FnFindB));
    registry.register(Box::new(FnSearchB));
    registry.register(Box::new(FnReplaceB));
}
