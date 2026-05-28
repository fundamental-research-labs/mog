//! # Dependency extraction
//!
//! Extracts static dependencies from formula ASTs for the dependency graph.
//! Uses [`AstVisitor`] to walk AST trees and collect cell/range references
//! as `DepTarget` entries.
//!
//! ## Dynamic Reference Strategy Taxonomy
//!
//! Functions interact with range arguments in three ways, each handled differently:
//!
//! ### 1. Aggregate (default)
//! Functions that read **every cell** in a range: SUM, AVERAGE, COUNTIF, etc.
//! - Dep extraction: `DepTarget::Range(range, RangeAccess::Aggregate)`
//! - Cycle detection: self-containment = definite cycle (caught by both edit-time
//!   and recalc-time paths)
//! - Barrier graph: full containment edges for all cells in range
//!
//! ### 2. Selective (`selective_range_arg_pattern`)
//! Functions that read a **statically-known subset** determined by other args:
//! INDEX, CHOOSE, XLOOKUP, VLOOKUP, HLOOKUP, MATCH, LOOKUP, SWITCH, IFS.
//! - Dep extraction: `DepTarget::Range(range, RangeAccess::Selective)`
//! - Cycle detection: self-containment deferred — back-edge filtering in
//!   `analysis.rs::is_selective_back_edge` excludes false cycles
//! - Barrier graph: containment edges with back-edge exclusion
//!
//! ### 3. Volatile-dynamic (no static deps)
//! Functions whose reference target is **runtime-determined** from evaluated args:
//! INDIRECT, OFFSET.
//! - Dep extraction: no range deps extracted (reference unknown at parse time)
//! - Volatility: marked volatile → re-evaluated every recalc
//! - This is correct: INDIRECT("A" & B1) depends on B1's value, which is only
//!   known at eval time. Static dep extraction cannot help here.
//!
//! ## Dual Cycle Detection
//!
//! Cycles are detected at two points:
//! 1. **Edit-time** (`analysis.rs::would_create_cycle`): per-cell check when a
//!    formula is entered. Provides immediate user feedback. Called from
//!    `formula_reg.rs::parse_and_register_formula`.
//! 2. **Recalc-time** (Kahn's algorithm in `analysis.rs::build_barrier_graph` /
//!    `subset_levels`): catches cycles that emerge from bulk operations where
//!    `skip_cycle_check=true` (file open, paste). Routes cycle cells through
//!    `cycles.rs::handle_cycles_and_recalc`.
//!
//! Both paths use the same `RangeAccess` tags and back-edge filtering logic.
//! The edit-time path is a fast-reject optimization; the recalc-time path is
//! the authoritative safety net.

use super::*;

use crate::formula_text::FormulaTextDepTarget;
use crate::mirror::CellMirror;
use cell_types::SheetId;
use compute_parser::{ASTNode, AstVisitor};
#[cfg(test)]
use compute_parser::{AbsFlags, CellRefNode, RangeRef};
#[cfg(test)]
use formula_types::CellRef;

mod formula_text;
mod policy;
mod refs;
mod visitor;

#[cfg(test)]
use policy::{is_static_ref, selective_range_arg_pattern};
#[cfg(test)]
use refs::cell_ref_to_dep_targets;
use visitor::DepExtractor;

/// Walk the AST tree, collecting all cell and range references as `DepTarget` entries.
/// The `mirror` parameter enables position lookup for Resolved CellRefs in ranges.
#[cfg(test)]
pub(super) fn extract_dependencies(ast: &ASTNode, current_sheet: &SheetId) -> Vec<DepTarget> {
    let mut deps = Vec::new();
    collect_deps(ast, current_sheet, &mut deps);
    // Deduplicate
    let mut seen = FxHashSet::default();
    deps.retain(|d| seen.insert(d.clone()));
    deps
}

#[cfg(test)]
pub(super) fn collect_deps(node: &ASTNode, current_sheet: &SheetId, deps: &mut Vec<DepTarget>) {
    collect_deps_with_mirror(node, current_sheet, &CellMirror::new(), deps);
}

/// Thin wrapper: delegates to the production `collect_deps_and_volatility`,
/// discarding the volatility and current_row parameters.
/// This avoids duplicating ~220 lines of AST-walking logic.
#[cfg(test)]
pub(super) fn collect_deps_with_mirror(
    node: &ASTNode,
    current_sheet: &SheetId,
    mirror: &CellMirror,
    deps: &mut Vec<DepTarget>,
) {
    collect_deps_and_volatility(node, current_sheet, mirror, deps, &mut false, None);
}

/// Extract dependencies and check volatility in a single AST walk.
///
/// This combines dependency collection and volatile-function detection into
/// one pass, avoiding a redundant traversal of the AST tree.
pub(super) fn extract_deps_and_volatility(
    ast: &ASTNode,
    current_sheet: &SheetId,
    mirror: &CellMirror,
    ordered_sheets: &[SheetId],
    current_row: Option<u32>,
) -> ExtractedFormulaDeps {
    let mut extractor = DepExtractor::new(current_sheet, mirror, ordered_sheets, current_row);
    extractor.visit(ast);
    let mut deps = extractor.deps;
    // Deduplicate — pre-size to avoid inner FxHashSet rehash storms.
    let mut seen = FxHashSet::with_capacity_and_hasher(deps.len(), Default::default());
    deps.retain(|d| seen.insert(d.clone()));
    let mut formula_text_deps = extractor.formula_text_deps;
    let mut seen_formula_text =
        FxHashSet::with_capacity_and_hasher(formula_text_deps.len(), Default::default());
    formula_text_deps.retain(|d| seen_formula_text.insert(d.clone()));
    ExtractedFormulaDeps {
        value_deps: deps,
        formula_text_deps,
        is_volatile: extractor.is_volatile,
    }
}

pub(super) struct ExtractedFormulaDeps {
    pub value_deps: Vec<DepTarget>,
    pub formula_text_deps: Vec<FormulaTextDepTarget>,
    pub is_volatile: bool,
}

/// Backwards-compatible helper: collects dependency targets AND checks for
/// volatile function calls. Used by test wrappers that pass out-params.
#[allow(dead_code)]
pub(super) fn collect_deps_and_volatility(
    node: &ASTNode,
    current_sheet: &SheetId,
    mirror: &CellMirror,
    deps: &mut Vec<DepTarget>,
    is_volatile: &mut bool,
    current_row: Option<u32>,
) {
    let mut extractor = DepExtractor::new(current_sheet, mirror, &[], current_row);
    extractor.visit(node);
    deps.extend(extractor.deps);
    *is_volatile |= extractor.is_volatile;
}

#[cfg(test)]
mod tests;
