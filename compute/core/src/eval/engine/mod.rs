//! Core evaluation engine — AST dispatch, scope management, operators,
//! aggregation primitives, and special-eval functions.

pub(crate) mod aggregate;
pub(crate) mod eval_primitives;
pub(crate) mod evaluator;
pub(crate) mod higher_order;
pub(crate) mod operators;
pub(crate) mod special_forms;
