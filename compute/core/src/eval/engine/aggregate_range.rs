//! Argument shape shared by aggregate evaluation and range scheduling.

use compute_parser::{ASTNode, RangeRef};

/// A direct range that aggregate evaluation can consume through column access.
/// Keep wrappers aligned with the evaluator's reference resolution; more complex
/// expressions still need their intermediate arrays.
pub(crate) fn direct_aggregate_range(args: &[ASTNode]) -> Option<&RangeRef> {
    let [arg] = args else { return None };
    let arg = match arg {
        ASTNode::SheetRef { inner, .. } | ASTNode::Paren(inner) => inner.as_ref(),
        other => other,
    };
    match arg {
        ASTNode::Range(range) => Some(range),
        _ => None,
    }
}
