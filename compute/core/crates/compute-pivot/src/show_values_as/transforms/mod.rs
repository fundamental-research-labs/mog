use super::{ShowValuesAsContext, collect_groups_at_depth, set_all_values_to_null};
use crate::types::{
    PivotRow, RelativePosition, ShowValuesAs, ShowValuesAsBaseItem, ShowValuesAsConfig,
};
use value_types::CellValue;

mod difference;
mod index;
mod percentage;
mod rank;
mod running;

use difference::{Difference, DifferenceMode};
use index::Index;
use percentage::{PercentOfParentColumnTotal, PercentOfParentRowTotal, PercentOfRowTotal};
use rank::Rank;
use running::{PercentRunningTotal, RunningTotal};

// ============================================================================
// Phase-Dispatched Transform Trait
// ============================================================================

/// A `ShowValuesAs` transform that operates in 3 phases.
///
/// The dispatcher calls these methods in the correct order:
/// 1. `transform_leaves` — all leaf data rows, pre-grouped by parent
/// 2. `transform_subtotal_peers` — subtotal rows at each depth, deepest first
/// 3. `transform_grand_total` — the grand total row
///
/// Implementors MUST handle all 3 phases — the compiler enforces this.
trait ShowValuesAsTransform {
    fn transform_leaves(
        &self,
        rows: &mut [PivotRow],
        groups: &[Vec<usize>],
        depth: usize,
        value_index: usize,
        ctx: &ShowValuesAsContext,
    );

    fn transform_subtotal_peers(
        &self,
        rows: &mut [PivotRow],
        depth: usize,
        peers: &[usize],
        value_index: usize,
        ctx: &ShowValuesAsContext,
    );

    fn transform_grand_total(
        &self,
        rows: &mut [PivotRow],
        row_idx: usize,
        value_index: usize,
        ctx: &ShowValuesAsContext,
    );
}

/// Dispatch a 3-phase transform: leaves → subtotals (descending depth) → grand total.
///
/// Owns phase ordering, leaf grouping, and subtotal-by-depth grouping.
fn dispatch_transform(
    transform: &dyn ShowValuesAsTransform,
    rows: &mut [PivotRow],
    value_index: usize,
    ctx: &ShowValuesAsContext,
    config: &ShowValuesAsConfig,
) {
    let depth = ctx.resolve_depth(config);

    // Pass 1: Leaves grouped by parent at resolved depth
    let groups = collect_groups_at_depth(ctx, depth);
    transform.transform_leaves(rows, &groups, depth, value_index, ctx);

    // Pass 2: Subtotals grouped by depth, descending (deepest first)
    let subtotals_by_depth = ctx.subtotal_peers_by_depth();
    for (sub_depth, peers) in &subtotals_by_depth {
        transform.transform_subtotal_peers(rows, *sub_depth, peers, value_index, ctx);
    }

    // Pass 3: Grand total
    if let Some(gt_idx) = ctx.grand_total_row_index {
        transform.transform_grand_total(rows, gt_idx, value_index, ctx);
    }
}

// ============================================================================
// Transformation Dispatcher
// ============================================================================

/// Dispatch to the appropriate transform implementation.
pub(super) fn apply_transformation(
    rows: &mut [PivotRow],
    value_index: usize,
    ctx: &ShowValuesAsContext,
    config: &ShowValuesAsConfig,
) {
    match config.calculation_type {
        // Non-phase transforms (no 3-phase pattern)
        ShowValuesAs::PercentOfGrandTotal => apply_percent_of_grand_total(rows, value_index, ctx),
        ShowValuesAs::PercentOfColumnTotal => apply_percent_of_column_total(rows, value_index, ctx),

        // Phase-dispatched transforms
        ShowValuesAs::PercentOfRowTotal => {
            dispatch_transform(&PercentOfRowTotal, rows, value_index, ctx, config);
        }
        ShowValuesAs::PercentOfParentRowTotal => {
            dispatch_transform(&PercentOfParentRowTotal, rows, value_index, ctx, config);
        }
        ShowValuesAs::PercentOfParentColumnTotal => {
            dispatch_transform(&PercentOfParentColumnTotal, rows, value_index, ctx, config);
        }
        ShowValuesAs::Index => {
            let Some(gt) = ctx.grand_total_for_value(value_index) else {
                set_all_values_to_null(rows, value_index, ctx);
                return;
            };
            dispatch_transform(&Index { grand_total: gt }, rows, value_index, ctx, config);
        }
        ShowValuesAs::RunningTotal => {
            dispatch_transform(&RunningTotal, rows, value_index, ctx, config);
        }
        ShowValuesAs::PercentRunningTotal => {
            let Some(divisor) = ctx.grand_total_for_value(value_index) else {
                set_all_values_to_null(rows, value_index, ctx);
                return;
            };
            dispatch_transform(
                &PercentRunningTotal { divisor },
                rows,
                value_index,
                ctx,
                config,
            );
        }
        ShowValuesAs::RankAscending => {
            dispatch_transform(&Rank { ascending: true }, rows, value_index, ctx, config);
        }
        ShowValuesAs::RankDescending => {
            dispatch_transform(&Rank { ascending: false }, rows, value_index, ctx, config);
        }
        ShowValuesAs::Difference => {
            let base_item = config
                .base_item
                .clone()
                .unwrap_or(ShowValuesAsBaseItem::Relative {
                    position: RelativePosition::Previous,
                });
            dispatch_transform(
                &Difference {
                    mode: DifferenceMode::Absolute,
                    base_item,
                },
                rows,
                value_index,
                ctx,
                config,
            );
        }
        ShowValuesAs::PercentDifference => {
            let base_item = config
                .base_item
                .clone()
                .unwrap_or(ShowValuesAsBaseItem::Relative {
                    position: RelativePosition::Previous,
                });
            dispatch_transform(
                &Difference {
                    mode: DifferenceMode::Percent,
                    base_item,
                },
                rows,
                value_index,
                ctx,
                config,
            );
        }
        // non_exhaustive enum — unknown variants are no-ops
        _ => {}
    }
}

// ============================================================================
// Transform Implementations
// ============================================================================

/// Percent of Grand Total: `value / grand_total`.
///
/// Applies to ALL rows including subtotals and grand total.
/// Grand total row becomes 100%, subtotal rows show partial percentages.
/// This matches Excel pivot table behavior.
fn apply_percent_of_grand_total(
    rows: &mut [PivotRow],
    value_index: usize,
    ctx: &ShowValuesAsContext,
) {
    let Some(divisor) = ctx.grand_total_for_value(value_index) else {
        set_all_values_to_null(rows, value_index, ctx);
        return;
    };

    for row in rows.iter_mut() {
        for c in 0..ctx.column_count {
            let idx = c * ctx.value_count + value_index;
            if idx < row.values.len() {
                row.values[idx] = match &row.values[idx] {
                    CellValue::Number(n) => CellValue::number(n.get() / divisor),
                    _ => CellValue::Null,
                };
            }
        }
    }
}

/// Percent of Column Total: `value / column_total`.
///
/// Each column has its own total. Skips grand total rows.
fn apply_percent_of_column_total(
    rows: &mut [PivotRow],
    value_index: usize,
    ctx: &ShowValuesAsContext,
) {
    for row in rows.iter_mut() {
        if row.is_grand_total {
            continue;
        }
        for c in 0..ctx.column_count {
            let idx = c * ctx.value_count + value_index;
            if idx >= row.values.len() {
                continue;
            }
            let col_total = ctx.column_total(c, value_index);
            row.values[idx] = match (&row.values[idx], col_total) {
                (CellValue::Number(val), Some(ct)) => CellValue::number(val.get() / ct),
                _ => CellValue::Null,
            };
        }
    }
}
