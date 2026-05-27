//! Show Values As — 12 hierarchy-aware post-aggregation transforms.
//!
//! This module transforms aggregated pivot values into derived metrics:
//! percentages, ranks, running totals, differences, and index.
//!
//! # Architecture
//!
//! The ONLY public entry point is [`apply_show_values_as_with_hierarchy`].
//! It receives a [`GroupHierarchy`] that provides O(1) parent lookup,
//! group-scoped iteration, and group boundary detection — all of which
//! are impossible with a flat row list alone.
//!
//! Every `ShowValuesAs` variant works correctly for BOTH flat (single-level)
//! and hierarchical (multi-level) pivots. For flat pivots, the hierarchy
//! degenerates to a single root group containing all data rows, producing
//! identical behavior to the old global transforms.
//!
//! # Group Boundary Semantics
//!
//! The `base_field` in [`ShowValuesAsConfig`] determines which hierarchy
//! depth level controls group scoping:
//!
//! - `base_field = Some("Region")` → scope to Region groups
//! - `base_field = None` → default to innermost (leaf) level
//!
//! This affects `RunningTotal` (reset boundary), Rank (scope), and
//! Difference/PercentDifference (Previous/Next/Specific navigation).
//!
//! # Numerical Accuracy
//!
//! All summations use [`kahan_sum`] for compensated floating-point
//! accumulation. Tie detection in ranking uses [`cell_value_eq`] with
//! relative epsilon (1e-12).

use std::collections::HashMap;

use super::hierarchy::GroupHierarchy;
use super::types::{
    PivotGrandTotals, PivotRow, PivotTableResult, ShowValuesAs, ShowValuesAsConfig,
};
use super::values::kahan_sum;
use value_types::CellValue;

mod transforms;
use transforms::apply_transformation;

// ============================================================================
// Public Entry Point
// ============================================================================

/// Apply Show Values As transforms using hierarchy information.
///
/// This is the ONLY public entry point. All transforms are hierarchy-aware:
/// running totals reset at group boundaries, ranks are scoped within parent
/// groups, and Previous/Next navigation respects group membership.
///
/// # Arguments
///
/// - `rows` — mutable reference to the computed pivot rows (data + subtotal + grand total)
/// - `value_configs` — list of `(value_index, config)` pairs to apply
/// - `grand_totals` — precomputed grand totals from the engine
/// - `hierarchy` — the group hierarchy index built from the flattened rows
///
/// # Panics
///
/// Does not panic. All out-of-bounds accesses are guarded with bounds checks.
/// Division by zero produces `CellValue::Null`.
pub fn apply_show_values_as_with_hierarchy(
    rows: &mut [PivotRow],
    value_configs: &[(usize, ShowValuesAsConfig)],
    grand_totals: &PivotGrandTotals,
    hierarchy: &GroupHierarchy,
) {
    // Early exit if nothing to do
    if value_configs.is_empty() {
        return;
    }

    let has_transforms = value_configs
        .iter()
        .any(|(_, cfg)| cfg.calculation_type != ShowValuesAs::NoCalculation);
    if !has_transforms {
        return;
    }

    // Build the shared context once
    let ctx = ShowValuesAsContext::build(rows, grand_totals, hierarchy);

    // Apply each transform
    for (value_index, config) in value_configs {
        if config.calculation_type == ShowValuesAs::NoCalculation {
            continue;
        }
        apply_transformation(rows, *value_index, &ctx, config);
    }
}

/// Apply Show Values As transforms to the complete pivot output.
///
/// `PivotTableResult` stores body/subtotal rows separately from the bottom
/// grand-total row, right-side grand-total column, and corner cell. This wrapper
/// makes the public compute path a whole-result transform while preserving the
/// existing row transformer as the implementation for body/subtotal rows.
pub fn apply_show_values_as_to_result(
    result: &mut PivotTableResult,
    value_configs: &[(usize, ShowValuesAsConfig)],
    hierarchy: &GroupHierarchy,
) {
    if value_configs.is_empty() {
        return;
    }

    let has_transforms = value_configs
        .iter()
        .any(|(_, cfg)| cfg.calculation_type != ShowValuesAs::NoCalculation);
    if !has_transforms {
        return;
    }

    let raw_rows = result.rows.clone();
    let raw_grand_totals = result.grand_totals.clone();

    apply_show_values_as_with_hierarchy(
        &mut result.rows,
        value_configs,
        &raw_grand_totals,
        hierarchy,
    );

    let ctx = ShowValuesAsContext::build(&raw_rows, &raw_grand_totals, hierarchy);
    for (value_index, config) in value_configs {
        if config.calculation_type == ShowValuesAs::NoCalculation {
            continue;
        }
        apply_grand_total_transformation(
            &mut result.grand_totals,
            &raw_rows,
            *value_index,
            &ctx,
            config,
        );
    }
}

fn apply_grand_total_transformation(
    grand_totals: &mut PivotGrandTotals,
    raw_rows: &[PivotRow],
    value_index: usize,
    ctx: &ShowValuesAsContext,
    config: &ShowValuesAsConfig,
) {
    match config.calculation_type {
        ShowValuesAs::PercentOfGrandTotal => {
            let divisor = ctx.grand_total_for_value(value_index);
            transform_row_grand_total(grand_totals, value_index, ctx, |value, _col| {
                divide_or_null(value, divisor)
            });
            transform_column_grand_total(grand_totals, value_index, |value, _row| {
                divide_or_null(value, divisor)
            });
            transform_corner_grand_total(grand_totals, value_index, |value| {
                divide_or_null(value, divisor)
            });
        }
        ShowValuesAs::PercentOfColumnTotal => {
            transform_row_grand_total(grand_totals, value_index, ctx, |value, col| {
                divide_or_null(value, ctx.column_total(col, value_index))
            });
            transform_column_grand_total(grand_totals, value_index, |value, _row| {
                divide_or_null(value, ctx.grand_total_for_value(value_index))
            });
            transform_corner_grand_total(grand_totals, value_index, |value| {
                divide_or_null(value, ctx.grand_total_for_value(value_index))
            });
        }
        ShowValuesAs::PercentOfRowTotal => {
            transform_row_grand_total(grand_totals, value_index, ctx, |value, _col| {
                divide_or_null(value, ctx.grand_total_for_value(value_index))
            });
            transform_column_grand_total(grand_totals, value_index, |value, row_idx| {
                let divisor = raw_rows
                    .get(row_idx)
                    .and_then(|row| ctx.compute_row_total(row, value_index));
                divide_or_null(value, divisor)
            });
            transform_corner_grand_total(grand_totals, value_index, |value| {
                divide_or_null(value, ctx.grand_total_for_value(value_index))
            });
        }
        ShowValuesAs::PercentOfParentRowTotal => {
            set_row_grand_total_value(grand_totals, value_index, ctx, &CellValue::number(1.0));
            transform_column_grand_total(grand_totals, value_index, |value, row_idx| {
                let divisor = raw_rows.get(row_idx).and_then(|row| {
                    if row.depth == 0 || row.is_subtotal {
                        ctx.grand_total_for_value(value_index)
                    } else {
                        ctx.parent_row_total(row_idx, row.depth, value_index)
                    }
                });
                divide_or_null(value, divisor)
            });
            set_corner_grand_total_value(grand_totals, value_index, &CellValue::number(1.0));
        }
        ShowValuesAs::PercentOfParentColumnTotal => {
            transform_row_grand_total(grand_totals, value_index, ctx, |value, col| {
                divide_or_null(value, ctx.column_total(col, value_index))
            });
            set_column_grand_total_value(grand_totals, value_index, &CellValue::number(1.0));
            set_corner_grand_total_value(grand_totals, value_index, &CellValue::number(1.0));
        }
        ShowValuesAs::Index
        | ShowValuesAs::PercentRunningTotal
        | ShowValuesAs::RankAscending
        | ShowValuesAs::RankDescending => {
            set_row_grand_total_value(grand_totals, value_index, ctx, &CellValue::number(1.0));
            set_column_grand_total_value(grand_totals, value_index, &CellValue::number(1.0));
            set_corner_grand_total_value(grand_totals, value_index, &CellValue::number(1.0));
        }
        ShowValuesAs::Difference | ShowValuesAs::PercentDifference => {
            set_row_grand_total_value(grand_totals, value_index, ctx, &CellValue::Null);
            set_column_grand_total_value(grand_totals, value_index, &CellValue::Null);
            set_corner_grand_total_value(grand_totals, value_index, &CellValue::Null);
        }
        _ => {}
    }
}

fn transform_row_grand_total(
    grand_totals: &mut PivotGrandTotals,
    value_index: usize,
    ctx: &ShowValuesAsContext,
    mut f: impl FnMut(&CellValue, usize) -> CellValue,
) {
    let Some(row) = grand_totals.row.as_mut() else {
        return;
    };
    for col in 0..ctx.column_count {
        let idx = col * ctx.value_count + value_index;
        if idx < row.len() {
            row[idx] = f(&row[idx], col);
        }
    }
}

fn transform_column_grand_total(
    grand_totals: &mut PivotGrandTotals,
    value_index: usize,
    mut f: impl FnMut(&CellValue, usize) -> CellValue,
) {
    let Some(column) = grand_totals.column.as_mut() else {
        return;
    };
    for (row_idx, values) in column.iter_mut().enumerate() {
        if value_index < values.len() {
            values[value_index] = f(&values[value_index], row_idx);
        }
    }
}

fn transform_corner_grand_total(
    grand_totals: &mut PivotGrandTotals,
    value_index: usize,
    mut f: impl FnMut(&CellValue) -> CellValue,
) {
    let Some(grand) = grand_totals.grand.as_mut() else {
        return;
    };
    if value_index < grand.len() {
        grand[value_index] = f(&grand[value_index]);
    }
}

fn set_row_grand_total_value(
    grand_totals: &mut PivotGrandTotals,
    value_index: usize,
    ctx: &ShowValuesAsContext,
    value: &CellValue,
) {
    transform_row_grand_total(grand_totals, value_index, ctx, |_current, _col| {
        value.clone()
    });
}

fn set_column_grand_total_value(
    grand_totals: &mut PivotGrandTotals,
    value_index: usize,
    value: &CellValue,
) {
    transform_column_grand_total(grand_totals, value_index, |_current, _row| value.clone());
}

fn set_corner_grand_total_value(
    grand_totals: &mut PivotGrandTotals,
    value_index: usize,
    value: &CellValue,
) {
    transform_corner_grand_total(grand_totals, value_index, |_current| value.clone());
}

fn divide_or_null(value: &CellValue, divisor: Option<f64>) -> CellValue {
    match (value, divisor) {
        (CellValue::Number(n), Some(d)) => CellValue::number(n.get() / d),
        _ => CellValue::Null,
    }
}

// ============================================================================
// Context
// ============================================================================

/// Precomputed context for `ShowValuesAs` calculations.
///
/// Built once per `apply_show_values_as_with_hierarchy` call. Provides
/// efficient access to totals, row structure, and hierarchy information.
struct ShowValuesAsContext<'a> {
    /// Grand total corner value (one per value field).
    /// Used by `PercentOfGrandTotal` and `PercentRunningTotal`.
    grand_total_corner: Vec<f64>,

    /// Number of column leaves.
    column_count: usize,

    /// Number of value fields.
    value_count: usize,

    /// The group hierarchy for parent/sibling/boundary lookups.
    hierarchy: &'a GroupHierarchy,

    /// Indices of data rows (not subtotal, not grand total) in the flat list.
    data_row_indices: Vec<usize>,

    /// Reverse lookup: flat row index → local data index. O(1) instead of linear scan.
    data_row_index_map: HashMap<usize, usize>,

    /// Indices of subtotal rows, sorted by descending depth (deepest first).
    /// Processing in this order ensures shallower parents are still raw when children read them.
    /// Retained for `subtotal_depth_pairs` computation during `build()`.
    #[allow(dead_code)] // Written during build, retained for future subtotal queries
    subtotal_row_indices: Vec<usize>,

    /// (depth, `row_idx`) pairs for subtotal rows, pre-sorted by descending depth.
    /// Populated during `build()` so `subtotal_peers_by_depth()` doesn't need rows at call time.
    subtotal_depth_pairs: Vec<(usize, usize)>,

    /// Index of the grand total row, if present.
    grand_total_row_index: Option<usize>,

    /// Row totals: `row_totals[local_data_index * value_count + val_idx]`.
    /// Sum across all columns for each data row, per value field.
    row_totals: Vec<f64>,

    /// Column totals: `column_totals[col_idx * value_count + val_idx]`.
    /// Sum across all data rows for each column, per value field.
    column_totals: Vec<f64>,

    /// Raw parent row totals keyed by `(row_depth, parent_key, value_index)`.
    /// Built before transforms mutate rows, so percent-of-parent can work when
    /// rendered subtotal rows are hidden.
    parent_row_totals: HashMap<(usize, String, usize), f64>,
}

impl<'a> ShowValuesAsContext<'a> {
    /// Build the context from rows, grand totals, and hierarchy.
    fn build(
        rows: &[PivotRow],
        grand_totals: &PivotGrandTotals,
        hierarchy: &'a GroupHierarchy,
    ) -> Self {
        // Extract grand total corner values
        let grand_total_corner: Vec<f64> = grand_totals
            .grand
            .as_ref()
            .map(|g| {
                g.iter()
                    .map(|v| match v {
                        CellValue::Number(n) => n.get(),
                        _ => 0.0,
                    })
                    .collect()
            })
            .unwrap_or_default();

        // Determine value_count from grand total corner, or from row grand totals
        let value_count = if grand_total_corner.is_empty() {
            // Cannot infer value_count from grand totals; default to 1
            1
        } else {
            grand_total_corner.len()
        };

        // Collect data row indices
        let data_row_indices: Vec<usize> = rows
            .iter()
            .enumerate()
            .filter(|(_, r)| !r.is_grand_total && !r.is_subtotal)
            .map(|(i, _)| i)
            .collect();

        // Collect subtotal row indices, sorted by descending depth.
        // Processing deepest first ensures shallower parents are still raw when read.
        let mut subtotal_row_indices: Vec<usize> = rows
            .iter()
            .enumerate()
            .filter(|(_, r)| r.is_subtotal)
            .map(|(i, _)| i)
            .collect();
        subtotal_row_indices.sort_by(|&a, &b| rows[b].depth.cmp(&rows[a].depth));

        let subtotal_depth_pairs: Vec<(usize, usize)> = subtotal_row_indices
            .iter()
            .map(|&idx| (rows[idx].depth, idx))
            .collect();

        let grand_total_row_index = rows.iter().position(|r| r.is_grand_total);

        // Determine column count from first data row
        let column_count = data_row_indices
            .first()
            .and_then(|&i| rows.get(i))
            .map_or(0, |r| {
                if value_count > 0 {
                    r.values.len() / value_count
                } else {
                    0
                }
            });

        // Compute row totals: for each data row, sum across columns per value field
        let mut row_totals = vec![0.0_f64; data_row_indices.len() * value_count];
        for (local_i, &row_idx) in data_row_indices.iter().enumerate() {
            let row = &rows[row_idx];
            for v in 0..value_count {
                let values_iter = (0..column_count).filter_map(|c| {
                    let idx = c * value_count + v;
                    row.values
                        .get(idx)
                        .and_then(value_types::CellValue::as_number)
                });
                row_totals[local_i * value_count + v] = kahan_sum(values_iter);
            }
        }

        // Compute column totals: for each column, sum across data rows per value field
        let mut column_totals = vec![0.0_f64; column_count * value_count];
        for v in 0..value_count {
            for c in 0..column_count {
                let idx = c * value_count + v;
                let values_iter = data_row_indices.iter().filter_map(|&row_idx| {
                    rows.get(row_idx)
                        .and_then(|r| r.values.get(idx))
                        .and_then(value_types::CellValue::as_number)
                });
                column_totals[c * value_count + v] = kahan_sum(values_iter);
            }
        }

        let mut parent_row_totals: HashMap<(usize, String, usize), f64> = HashMap::new();
        for &row_idx in &data_row_indices {
            let row_depth = rows[row_idx].depth;
            if row_depth == 0 {
                continue;
            }
            let parent_key = hierarchy.parent_path_key_at_depth(row_idx, row_depth);
            for v in 0..value_count {
                let values_iter = (0..column_count).filter_map(|c| {
                    let idx = c * value_count + v;
                    rows[row_idx]
                        .values
                        .get(idx)
                        .and_then(value_types::CellValue::as_number)
                });
                let total = kahan_sum(values_iter);
                *parent_row_totals
                    .entry((row_depth, parent_key.clone(), v))
                    .or_insert(0.0) += total;
            }
        }

        let data_row_index_map: HashMap<usize, usize> = data_row_indices
            .iter()
            .enumerate()
            .map(|(local_i, &row_idx)| (row_idx, local_i))
            .collect();

        ShowValuesAsContext {
            grand_total_corner,
            column_count,
            value_count,
            hierarchy,
            data_row_indices,
            data_row_index_map,
            subtotal_row_indices,
            subtotal_depth_pairs,
            grand_total_row_index,
            row_totals,
            column_totals,
            parent_row_totals,
        }
    }

    /// Get the grand total corner value for a specific value field.
    fn grand_total_for_value(&self, value_index: usize) -> Option<f64> {
        self.grand_total_corner
            .get(value_index)
            .copied()
            .filter(|n| *n != 0.0)
    }

    /// Get the row total for a data row (by local index) and value field.
    fn row_total(&self, local_data_index: usize, value_index: usize) -> Option<f64> {
        let idx = local_data_index * self.value_count + value_index;
        self.row_totals.get(idx).copied().filter(|n| *n != 0.0)
    }

    /// Get the column total for a column and value field.
    fn column_total(&self, col_index: usize, value_index: usize) -> Option<f64> {
        let idx = col_index * self.value_count + value_index;
        self.column_totals.get(idx).copied().filter(|n| *n != 0.0)
    }

    /// Get a raw parent total for a data row at its current hierarchy depth.
    fn parent_row_total(
        &self,
        row_idx: usize,
        row_depth: usize,
        value_index: usize,
    ) -> Option<f64> {
        let parent_key = self.hierarchy.parent_path_key_at_depth(row_idx, row_depth);
        self.parent_row_totals
            .get(&(row_depth, parent_key, value_index))
            .copied()
            .filter(|n| *n != 0.0)
    }

    /// Find the local data index for a given flat row index.
    fn local_index_for_row(&self, row_idx: usize) -> Option<usize> {
        self.data_row_index_map.get(&row_idx).copied()
    }

    /// Resolve the hierarchy depth for grouping operations.
    ///
    /// If `base_field` is provided, find its depth. Otherwise, default to
    /// the innermost (deepest) level. For flat hierarchies, returns 0.
    fn resolve_depth(&self, config: &ShowValuesAsConfig) -> usize {
        config
            .base_field
            .as_ref()
            .and_then(|f| self.hierarchy.depth_for_field(f.as_ref()))
            .unwrap_or_else(|| self.hierarchy.depth().saturating_sub(1))
    }

    /// Compute the row total for any row (including subtotals) on-the-fly.
    /// Sum across all columns for the given value field.
    fn compute_row_total(&self, row: &PivotRow, value_index: usize) -> Option<f64> {
        let values_iter = (0..self.column_count).filter_map(|c| {
            let idx = c * self.value_count + value_index;
            row.values
                .get(idx)
                .and_then(value_types::CellValue::as_number)
        });
        let total = kahan_sum(values_iter);
        if total == 0.0 { None } else { Some(total) }
    }

    /// Set all column values for a row to a given percentage value.
    fn set_row_values_to(
        rows: &mut [PivotRow],
        row_idx: usize,
        value_index: usize,
        value: f64,
        column_count: usize,
        value_count: usize,
    ) {
        for c in 0..column_count {
            let idx = c * value_count + value_index;
            if idx < rows[row_idx].values.len() {
                rows[row_idx].values[idx] = CellValue::number(value);
            }
        }
    }

    /// Extract a numeric value from a specific cell.
    fn extract_value(
        &self,
        rows: &[PivotRow],
        row_idx: usize,
        col: usize,
        value_index: usize,
    ) -> Option<f64> {
        let idx = col * self.value_count + value_index;
        rows.get(row_idx)
            .and_then(|r| r.values.get(idx))
            .and_then(value_types::CellValue::as_number)
    }

    /// Group subtotal row indices by depth, sorted descending by depth,
    /// with peers within each depth in row order.
    fn subtotal_peers_by_depth(&self) -> Vec<(usize, Vec<usize>)> {
        let mut by_depth: HashMap<usize, Vec<usize>> = HashMap::new();
        for &(depth, row_idx) in &self.subtotal_depth_pairs {
            by_depth.entry(depth).or_default().push(row_idx);
        }
        for subs in by_depth.values_mut() {
            subs.sort_unstable(); // row order within depth
        }
        let mut result: Vec<(usize, Vec<usize>)> = by_depth.into_iter().collect();
        result.sort_by(|a, b| b.0.cmp(&a.0)); // descending depth
        result
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Collect data row groups at a given depth level.
///
/// Returns a vector of groups, where each group is a vector of flat row
/// indices belonging to the same parent at the given depth.
///
/// For flat hierarchies (depth 0 or single-level), returns one group
/// containing all data rows.
fn collect_groups_at_depth(ctx: &ShowValuesAsContext, depth: usize) -> Vec<Vec<usize>> {
    // Use an ordered approach: iterate data rows and group by parent key.
    // We use a Vec of (key, group) to preserve insertion order.
    let mut groups: Vec<(String, Vec<usize>)> = Vec::new();
    let mut key_to_idx: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    for &row_idx in &ctx.data_row_indices {
        let parent_key = ctx.hierarchy.parent_path_key_at_depth(row_idx, depth);
        if let Some(&group_idx) = key_to_idx.get(&parent_key) {
            groups[group_idx].1.push(row_idx);
        } else {
            let group_idx = groups.len();
            key_to_idx.insert(parent_key.clone(), group_idx);
            groups.push((parent_key, vec![row_idx]));
        }
    }

    groups.into_iter().map(|(_, group)| group).collect()
}

/// Set all values to null for a value field across all rows.
fn set_all_values_to_null(rows: &mut [PivotRow], value_index: usize, ctx: &ShowValuesAsContext) {
    for row in rows.iter_mut() {
        for c in 0..ctx.column_count {
            let idx = c * ctx.value_count + value_index;
            if idx < row.values.len() {
                row.values[idx] = CellValue::Null;
            }
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests;
