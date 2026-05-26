//! Group-by aggregation prepass for COUNTIFS/SUMIFS/AVERAGEIFS/MAXIFS/MINIFS.
//!
//! Detects groups of consecutive cells sharing the same conditional-aggregation pattern
//! and evaluates them via a single hash-map build + O(1) lookups per cell.
//! Works with all three recalc strategies (demand, topo, ready-queue) — no feature gate.

use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

use cell_types::{CellId, SheetId, SheetPos};
use compute_functions::helpers::criteria::parse_criteria;
use compute_functions::helpers::frequency_cache::{NormalizedKey, is_exact_match_criteria};
use compute_parser::{ASTNode, CellRefNode, RangeRef};
use formula_types::{CellRef, RangeType};
use value_types::{CellError, CellValue, KahanSum};

use crate::mirror::CellMirror;

/// Type alias to reduce complexity in type annotations for static criteria filter closures.
type StaticFilterVec = SmallVec<[Option<Box<dyn Fn(&CellValue) -> bool>>; 4]>;

mod hashmap;
mod pattern;
mod sorted_range;

pub use hashmap::*;
pub use pattern::*;
pub(super) use sorted_range::*;

#[cfg(test)]
mod tests;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Which aggregation function the formula uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AggFn {
    CountIf,
    CountIfs,
    SumIf,
    SumIfs,
    AverageIf,
    AverageIfs,
    MaxIfs,
    MinIfs,
}

/// How a single criteria argument is sourced.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum CriteriaSource {
    /// Row-relative cell reference (changes per output row).
    Dynamic { sheet: SheetId, col: u32 },
    /// Literal value that can be looked up via exact hash match.
    StaticExact { key: NormalizedKey },
    /// Literal text with operators/wildcards — requires `parse_criteria` closure.
    StaticFilter { text: String },
    /// Concatenation criteria: prefix + dynamic cell value (e.g., `">="&$CY109`).
    /// The dynamic cell column changes per output row; prefix is a fixed string.
    DynamicWithPrefix {
        sheet: SheetId,
        col: u32,
        prefix: String,
    },
    /// Absolute-row cell reference (e.g., `BK$4`). Constant across the group.
    StaticFromCell { sheet: SheetId, row: u32, col: u32 },
}

/// Optional arithmetic operation applied after the aggregation result.
/// E.g., `SUMIFS(...) / $DD$2` stores `PostOp { op: Div, operand: ... }`.
#[derive(Debug, Clone)]
pub struct PostOp {
    pub op: compute_parser::BinOp,
    pub operand: PostOpOperand,
}

#[derive(Debug, Clone)]
pub enum PostOpOperand {
    /// A literal number.
    Number(f64),
    /// A cell reference (resolved to sheet, row, col).
    Cell { sheet: SheetId, row: u32, col: u32 },
}

/// One (criteria_range, criteria) pair in the aggregation pattern.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AggCriteriaPair {
    pub data_sheet: SheetId,
    pub data_col: u32,
    pub data_start_row: u32,
    pub data_end_row: u32,
    pub criteria: CriteriaSource,
}

/// The complete aggregation pattern for a formula.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AggPattern {
    pub agg_fn: AggFn,
    /// For SUM/AVERAGE/MAX/MIN: the value column to aggregate.
    /// `(sheet, col, start_row, end_row)`
    pub value_range: Option<(SheetId, u32, u32, u32)>,
    pub pairs: SmallVec<[AggCriteriaPair; 4]>,
}

/// A detected group of consecutive cells that share the same aggregation pattern.
pub struct AggFormulaGroup {
    #[allow(dead_code)]
    // Diagnostic field — retained for debug logging and future per-group metrics
    pub sheet: SheetId,
    #[allow(dead_code)]
    // Diagnostic field — retained for debug logging and future per-group metrics
    pub col: u32,
    pub start_row: u32,
    #[allow(dead_code)]
    // Diagnostic field — retained for debug logging and future per-group metrics
    pub end_row: u32,
    pub pattern: AggPattern,
    /// Optional arithmetic post-operation (e.g., `/ $DD$2`) applied to each result.
    pub post_op: Option<PostOp>,
    pub cell_ids: Vec<CellId>,
}

/// Composite key for hash-map lookup (one entry per unique combination of criterion values).
pub type AggKey = SmallVec<[NormalizedKey; 4]>;

/// Accumulator for a single bucket in the aggregation map.
#[derive(Clone, Debug)]
pub enum AggAccum {
    Count(u64),
    Sum { acc: KahanSum, count: u64 },
    Max { val: f64, count: u64 },
    Min { val: f64, count: u64 },
}

/// Resolved range info: (sheet, col, start_row, end_row).
/// `end_row` is exclusive.
pub(super) type RangeInfo = (SheetId, u32, u32, u32);

// ---------------------------------------------------------------------------
// apply_post_op (shared between hashmap and sorted_range)
// ---------------------------------------------------------------------------

/// Apply an arithmetic post-operation to an aggregation result.
pub(super) fn apply_post_op(value: CellValue, post_op: &PostOp, mirror: &CellMirror) -> CellValue {
    let raw = match &value {
        CellValue::Number(n) => n.get(),
        _ => return value, // errors/non-numeric pass through
    };

    let operand_val = match &post_op.operand {
        PostOpOperand::Number(n) => *n,
        PostOpOperand::Cell { sheet, row, col } => {
            match mirror.get_cell_value_at(sheet, SheetPos::new(*row, *col)) {
                Some(CellValue::Number(n)) => n.get(),
                _ => return CellValue::Error(CellError::Value, None),
            }
        }
    };

    use compute_parser::BinOp;
    let result = match post_op.op {
        BinOp::Div => {
            if operand_val == 0.0 {
                return CellValue::Error(CellError::Div0, None);
            }
            raw / operand_val
        }
        BinOp::Mul => raw * operand_val,
        BinOp::Add => raw + operand_val,
        BinOp::Sub => raw - operand_val,
        _ => return value, // unsupported op — pass through
    };
    CellValue::number(result)
}

// ---------------------------------------------------------------------------
// ComputeCore integration helper
// ---------------------------------------------------------------------------

pub(super) const AGG_MIN_GROUP_SIZE: usize = 8;

impl super::ComputeCore {
    /// Run the aggregation prepass on a set of dirty cells.
    ///
    /// Detects groups of consecutive cells sharing the same conditional-aggregation
    /// pattern (COUNTIFS, SUMIFS, AVERAGEIFS, MAXIFS, MINIFS), builds a hash map
    /// per group in a single O(M) pass over the data range, and resolves each
    /// output cell via O(1) lookup.
    ///
    /// `already_evaluated` contains cells that have been evaluated in the current
    /// recalc epoch. Formula cells in data ranges are safe to read only if they
    /// are in this set (their mirror values are fresh). Formula cells NOT in this
    /// set may have stale snapshot values and trigger a bail to normal evaluation.
    ///
    /// Returns a tuple of:
    /// - `Vec<(CellId, CellValue)>` — resolved cell values (caller applies to mirror)
    /// - `Option<SumifsWarmData>` — pre-built SUMIFS cache entries to seed into
    ///   rayon worker threads (enables cross-thread cache sharing)
    ///
    /// Bails out (returns empty) if:
    /// - No groups are detected (< `AGG_MIN_GROUP_SIZE` consecutive matches)
    /// - Any data column contains unevaluated formula cells (stale values risk)
    pub(super) fn run_agg_prepass(
        &self,
        mirror: &CellMirror,
        dirty_set: &FxHashSet<CellId>,
        already_evaluated: &FxHashSet<CellId>,
        sumifs_epoch: compute_functions::helpers::sumifs_result_cache::SumifsCacheEpoch,
    ) -> (
        Vec<(CellId, CellValue)>,
        Option<compute_functions::helpers::sumifs_result_cache::SumifsWarmData>,
    ) {
        let span = tracing::info_span!(
            "agg_prepass",
            groups = tracing::field::Empty,
            total_cells = tracing::field::Empty,
            resolved_cells = tracing::field::Empty,
            skipped_cells = tracing::field::Empty,
            cache_only_patterns = tracing::field::Empty,
            cache_warmed = tracing::field::Empty,
        );
        let _entered = span.enter();

        let ast_cache = &self.ast_cache;

        let get_ast = |cell_id: &CellId| -> Option<&ASTNode> {
            ast_cache.get(cell_id).map(|entry| &entry.ast)
        };

        let groups = detect_agg_groups(dirty_set, get_ast, mirror, AGG_MIN_GROUP_SIZE);

        // Formula guard: check if any cell in a data column range has a formula
        // whose value might be stale.
        //
        // A formula cell's mirror value is safe to read if it has been evaluated
        // in the current recalc epoch (present in `already_evaluated`). Formula
        // cells that have NOT been evaluated may have stale snapshot values —
        // e.g., `=TRUE` loaded from Excel with cached value Number(1.0) that
        // will become Boolean(true) after evaluation.
        //
        // Non-formula cells are always safe (plain data values).
        let check_data_formulas =
            |sheet: &SheetId, col: u32, start_row: u32, end_row: u32| -> bool {
                let Some(sh) = mirror.get_sheet(sheet) else {
                    return true;
                };
                let clamped_end = end_row.min(sh.rows);
                for row in start_row..clamped_end {
                    if let Some(cell_id) = mirror.resolve_cell_id(sheet, SheetPos::new(row, col))
                        && ast_cache.contains_key(&cell_id)
                        && !already_evaluated.contains(&cell_id)
                    {
                        return true;
                    }
                }
                false
            };

        // Criteria staleness guard: checks if any position in a dynamic criteria
        // column has an unevaluated formula OR is covered by a spill projection
        // whose source formula hasn't been evaluated yet.
        let check_criteria_stale =
            |sheet: &SheetId, col: u32, start_row: u32, end_row: u32| -> bool {
                let Some(sh) = mirror.get_sheet(sheet) else {
                    return true;
                };
                let clamped_end = end_row.min(sh.rows);
                for row in start_row..clamped_end {
                    // Check 1: unevaluated formula cell at this position.
                    if let Some(cell_id) = mirror.resolve_cell_id(sheet, SheetPos::new(row, col))
                        && ast_cache.contains_key(&cell_id)
                        && !already_evaluated.contains(&cell_id)
                    {
                        return true;
                    }
                    // Check 2: stale spill projection — the position is covered by
                    // a projection whose source formula hasn't been evaluated yet.
                    if let Some((source_cell_id, _, _)) =
                        mirror.projection_registry.resolve(sheet, row, col)
                        && !already_evaluated.contains(&source_cell_id)
                    {
                        return true;
                    }
                }
                false
            };

        // Pass 1: Resolve direct SUMIFS groups (cell value = SUMIFS result)
        let mut results = Vec::new();
        let mut resolved_count = 0u64;
        let mut resolved_set = FxHashSet::default();

        if !groups.is_empty() {
            let total_group_cells: usize = groups.iter().map(|g| g.cell_ids.len()).sum();
            span.record("groups", groups.len() as u64);
            span.record("total_cells", total_group_cells as u64);

            tracing::info!(
                groups = groups.len(),
                total_cells = total_group_cells,
                "agg_prepass detected groups"
            );

            for group in &groups {
                if let Some(group_results) =
                    execute_agg_group(group, mirror, check_data_formulas, check_criteria_stale)
                {
                    for &(cell_id, _) in &group_results {
                        resolved_set.insert(cell_id);
                    }
                    resolved_count += group_results.len() as u64;
                    results.extend(group_results);
                }
            }
        }

        // Pass 2: Warm the SUMIFS result cache for wrapped formulas.
        //
        // Cells with IF/IFERROR-wrapped SUMIFS can't be directly resolved (their
        // value depends on the wrapper logic), but we can pre-build the cache that
        // the eval-time `sumifs_result_cache::sumifs_lookup()` will hit. This turns
        // O(N) per-formula scans into O(1) lookups during normal evaluation.
        let cache_only_patterns =
            detect_cache_only_patterns(dirty_set, &resolved_set, get_ast, mirror);

        if !cache_only_patterns.is_empty() {
            let warmed = warm_sumifs_result_cache(
                &cache_only_patterns,
                mirror,
                &check_data_formulas,
                sumifs_epoch,
            );
            span.record("cache_only_patterns", cache_only_patterns.len() as u64);
            span.record("cache_warmed", warmed as u64);

            tracing::info!(
                patterns = cache_only_patterns.len(),
                warmed = warmed,
                "agg_prepass warmed SUMIFS result cache for wrapped formulas"
            );
        }

        // Extract warmed SUMIFS cache entries from the main thread so they can
        // be seeded into rayon worker threads for cross-thread cache sharing.
        let warm_data =
            compute_functions::helpers::sumifs_result_cache::extract_warm_data(sumifs_epoch);

        span.record("resolved_cells", resolved_count);
        if !groups.is_empty() {
            let total_group_cells: usize = groups.iter().map(|g| g.cell_ids.len()).sum();
            span.record(
                "skipped_cells",
                (total_group_cells as u64).saturating_sub(resolved_count),
            );
        }

        tracing::info!(resolved_cells = resolved_count, "agg_prepass resolved");

        (results, warm_data)
    }
}
