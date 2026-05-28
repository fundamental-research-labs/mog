//! Core evaluation engine — AST dispatch, scope management, operators,
//! aggregation primitives, and special-eval functions.

pub(crate) mod aggregate;
pub(crate) mod eval_primitives;
pub(crate) mod evaluator;
pub(crate) mod higher_order;
pub(crate) mod operators;
pub(crate) mod special_forms;
pub(crate) mod formula_text;
pub(crate) mod logical_primitives;
pub(crate) mod operator_aliases;
pub(crate) mod reference_info;
pub(crate) mod statistical_primitives;
