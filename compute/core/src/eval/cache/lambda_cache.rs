//! Lambda expression cache — caches constant sub-expressions inside lambda
//! bodies iterated by BYROW/MAP/BYCOL/SCAN/REDUCE.
//!
//! During lambda iteration, sub-expressions that don't depend on the lambda
//! parameter produce the same result every time. We detect these at AST level
//! before the loop and cache their values after the first evaluation, so
//! subsequent iterations get an O(1) lookup instead of a full re-evaluation.

use rustc_hash::{FxHashMap, FxHashSet};

use compute_functions::helpers::VOLATILE_FUNCTIONS;
use compute_parser::{ASTNode, AstVisitor};

use crate::eval::eval_value::{EvalValue, LambdaParam};

use crate::eval::engine::reference_resolution::cell_ref_to_a1;

// ---------------------------------------------------------------------------
// Parameter-free analysis
// ---------------------------------------------------------------------------

/// Returns `true` if `node` (and all descendants) are independent of the
/// lambda parameters in `params`.
///
/// Conservative: returns `false` for *all* `Identifier` nodes (covers lambda
/// params, LET variables that could transitively depend on params, etc.).
/// Named ranges are also rejected — an acceptable false negative since named
/// range lookups are cheap.
pub(in crate::eval) fn is_parameter_free(node: &ASTNode, params: &[LambdaParam]) -> bool {
    let mut checker = ParameterFreeChecker { params, free: true };
    checker.visit(node);
    checker.free
}

struct ParameterFreeChecker<'a> {
    params: &'a [LambdaParam],
    free: bool,
}

impl AstVisitor for ParameterFreeChecker<'_> {
    fn visit(&mut self, node: &ASTNode) {
        if !self.free {
            return; // short-circuit
        }
        self.walk(node);
    }

    fn visit_identifier(&mut self, _name: &str) {
        // Identifiers are never cacheable (conservative)
        self.free = false;
    }

    fn visit_cell_ref(&mut self, r: &compute_parser::CellRefNode) {
        // Cell references: check A1 text against param names
        let a1 = cell_ref_to_a1(&r.reference);
        if self
            .params
            .iter()
            .any(|param| a1.eq_ignore_ascii_case(&param.name))
        {
            self.free = false;
        }
    }

    fn visit_function(&mut self, name: &str, args: &[ASTNode]) {
        // Reject volatile functions
        let upper = name.to_ascii_uppercase();
        if VOLATILE_FUNCTIONS.contains(&upper.as_str()) {
            self.free = false;
            return;
        }
        for arg in args {
            self.visit(arg);
        }
    }
}

// ---------------------------------------------------------------------------
// Cacheable node collection
// ---------------------------------------------------------------------------

/// Collect pointers to all AST nodes whose evaluation result is constant
/// across lambda iterations. Children of cacheable parents are pruned — if
/// a parent is cacheable, we cache the parent's result and never independently
/// visit the children.
pub(in crate::eval) fn collect_cacheable_nodes(
    body: &ASTNode,
    params: &[LambdaParam],
) -> FxHashSet<*const ASTNode> {
    let mut set = FxHashSet::default();
    collect_inner(body, params, &mut set);
    set
}

fn collect_inner(node: &ASTNode, params: &[LambdaParam], set: &mut FxHashSet<*const ASTNode>) {
    let mut collector = CacheableCollector { params, set };
    collector.visit(node);
}

struct CacheableCollector<'a> {
    params: &'a [LambdaParam],
    set: &'a mut FxHashSet<*const ASTNode>,
}

impl AstVisitor for CacheableCollector<'_> {
    fn visit(&mut self, node: &ASTNode) {
        if is_parameter_free(node, self.params) {
            // This entire subtree is constant — cache it and don't recurse.
            self.set.insert(node as *const ASTNode);
            return;
        }
        // Node depends on a param — recurse into children to find cacheable subtrees.
        self.walk(node);
    }
}

// ---------------------------------------------------------------------------
// LambdaExprCache
// ---------------------------------------------------------------------------

/// Cache for constant sub-expressions inside a lambda body being iterated
/// by BYROW/MAP/BYCOL/SCAN/REDUCE.
///
/// SAFETY: Uses raw `*const ASTNode` pointers as keys. This is safe because:
/// - The AST is immutable and owned by the formula cell throughout evaluation
/// - Each ASTNode has a unique address within a single formula's AST
/// - The cache lifetime is bounded by the BYROW/MAP/etc. call (shorter than AST lifetime)
pub(in crate::eval) struct LambdaExprCache {
    /// Set of AST node pointers that are parameter-free (can be cached).
    /// Computed once before the iteration loop.
    pub(in crate::eval) cacheable: FxHashSet<*const ASTNode>,
    /// Cached evaluation results, populated during first iteration,
    /// hit on subsequent iterations.
    pub(in crate::eval) values: FxHashMap<*const ASTNode, EvalValue>,
}
