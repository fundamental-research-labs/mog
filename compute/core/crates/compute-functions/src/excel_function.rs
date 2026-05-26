//! ExcelFunction trait — declares argument signatures for framework-driven
//! error propagation.
//!
//! Unlike `PureFunction` (flat `&[CellValue]` with no arg-role semantics),
//! `ExcelFunction` provides a `FunctionSignature` so the dispatch framework
//! can enforce per-argument error propagation rules automatically.

use crate::signature::FunctionSignature;
use value_types::CellValue;

/// Trait for Excel-compatible functions with declarative argument signatures.
///
/// The `RegisteredFunction::call()` dispatch checks each argument against
/// `signature()` before invoking `call()`. For `Range`/`Scalar` args that
/// are `CellValue::Error`, it short-circuits. For `Criteria` args, errors
/// pass through to the function body.
pub trait ExcelFunction: Send + Sync {
    /// Execute the function with the given arguments.
    ///
    /// Called after the framework has applied signature-driven error
    /// propagation. Range/Scalar error args have already been caught,
    /// but defense-in-depth checks in the function body are fine.
    fn call(&self, args: &[CellValue]) -> CellValue;

    /// The canonical (uppercase) name of the function.
    fn name(&self) -> &'static str;

    /// Declarative signature with per-argument role metadata.
    fn signature(&self) -> &'static FunctionSignature;

    /// Whether this function is volatile (must recalculate every time).
    fn is_volatile(&self) -> bool {
        false
    }

    /// Whether this function returns an array (dynamic array formula).
    fn returns_array(&self) -> bool {
        false
    }

    /// Default value for an omitted optional argument at the given index.
    fn default_for_arg(&self, _index: usize) -> Option<CellValue> {
        None
    }
}
