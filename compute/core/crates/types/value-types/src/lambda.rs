//! Lambda body abstraction — breaks the concrete dependency from `EvalValue` to `ASTNode`.
//!
//! `compute-types` is the foundation layer: everything depends on it, it depends on nothing
//! internal. `EvalValue::Lambda` needs to hold a formula body, but the concrete `ASTNode` type
//! lives in the parser (a higher-level module). This trait lets `EvalValue` hold a type-erased
//! body that compute-core's evaluator downcasts back to `ASTNode` at the 2 call sites.

use std::any::Any;
use std::fmt;

/// Type-erased lambda body node. Implemented by `ASTNode` in compute-core.
///
/// Design note: only `eval/evaluator.rs` ever downcasts via `as_any()` (2 sites:
/// `eval_call_expression` and `invoke_lambda`). All other code that matches on
/// `EvalValue::Lambda { .. }` uses wildcard patterns and never touches the body.
pub trait LambdaNode: Send + Sync + fmt::Debug + LambdaNodeClone {
    /// Downcast support. Used exclusively by the evaluator to recover the concrete `ASTNode`.
    fn as_any(&self) -> &dyn Any;
}

/// Clone support for `Box<dyn LambdaNode>` — required because `CellValue` derives `Clone`.
pub trait LambdaNodeClone {
    /// Clone the lambda node into a new boxed trait object.
    fn clone_lambda(&self) -> Box<dyn LambdaNode>;
}

impl<T: Clone + LambdaNode + 'static> LambdaNodeClone for T {
    fn clone_lambda(&self) -> Box<dyn LambdaNode> {
        Box::new(self.clone())
    }
}

impl Clone for Box<dyn LambdaNode> {
    fn clone(&self) -> Self {
        self.clone_lambda()
    }
}
