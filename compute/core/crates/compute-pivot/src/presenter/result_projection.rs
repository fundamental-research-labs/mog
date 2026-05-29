use std::collections::HashMap;

use compute_relational::{AggregatedNode, QueryResult};

use crate::resolved::{ResolvedAxisPlacement, ResolvedPivotConfig};
use crate::types::{
    LayoutForm, PivotExpansionState, PivotRenderedBounds, PivotRow, PivotTableResult,
};

use super::column_headers::build_column_headers;
use super::grand_totals::build_grand_totals;
use super::row_flattening::{build_node_map, flatten_row_tree};
use super::value_remap::ColumnRemap;
use super::visibility::count_visible_leaves;

/// Convert a `QueryResult` to a `PivotTableResult`.
///
/// Applies expansion state, builds column headers, flattens the row tree,
/// converts grand totals, and computes rendered bounds.
#[must_use]
pub fn query_result_to_pivot(
    result: &QueryResult,
    config: &ResolvedPivotConfig,
    expansion_state: Option<&PivotExpansionState>,
) -> PivotTableResult {
    let data_row_count = result.source_row_count;

    if result.row_tree.is_empty() && result.column_tree.is_empty() && result.measure_count == 0 {
        return PivotTableResult::empty(data_row_count, None);
    }

    let row_expanded_set = expansion_state.and_then(|es| {
        let set = &es.expanded_rows;
        if set.is_empty() { None } else { Some(set) }
    });
    let col_expanded_set = expansion_state.and_then(|es| {
        let set = &es.expanded_columns;
        if set.is_empty() { None } else { Some(set) }
    });

    let column_headers = build_column_headers(
        &result.column_tree,
        config.column_placements(),
        config.value_placements(),
        config.calculated_fields(),
        col_expanded_set,
    );

    let show_subtotals: Vec<bool> = config
        .row_placements()
        .iter()
        .map(ResolvedAxisPlacement::show_subtotals)
        .collect();

    let is_tabular = matches!(config.layout().layout_form(), LayoutForm::Tabular);

    let mut node_map: HashMap<String, &AggregatedNode> = HashMap::new();
    build_node_map(&result.row_tree, &mut node_map);

    let col_remap = ColumnRemap::build(&result.column_tree, col_expanded_set, result.measure_count);

    let mut pivot_rows: Vec<PivotRow> = Vec::new();
    flatten_row_tree(
        &result.row_tree,
        row_expanded_set,
        &show_subtotals,
        is_tabular,
        0,
        &mut pivot_rows,
        &col_remap,
        &node_map,
    );

    let num_visible_col_leaves = if result.column_tree.is_empty() {
        1
    } else {
        count_visible_leaves(&result.column_tree, col_expanded_set)
    };
    let grand_totals = build_grand_totals(
        &result.grand_totals,
        &pivot_rows,
        config,
        result.measure_count,
        num_visible_col_leaves,
    );

    #[allow(clippy::cast_possible_truncation)]
    let row_header_cols = match config.layout().layout_form() {
        LayoutForm::Compact => u32::from(!config.row_placements().is_empty()),
        _ => config.row_placements().len() as u32,
    };
    #[allow(clippy::cast_possible_truncation)]
    let num_data_cols = column_headers
        .first()
        .map_or(0, |ch| ch.headers.iter().map(|h| h.span).sum::<usize>())
        as u32;
    #[allow(clippy::cast_possible_truncation)]
    let col_header_rows = std::cmp::max(
        column_headers.len() as u32,
        u32::from(!config.row_placements().is_empty()),
    );
    let has_row_gt = grand_totals.row.is_some();

    #[allow(clippy::cast_possible_truncation)]
    let rendered_bounds = PivotRenderedBounds {
        first_data_row: col_header_rows,
        first_data_col: row_header_cols,
        total_rows: col_header_rows + pivot_rows.len() as u32 + u32::from(has_row_gt),
        total_cols: row_header_cols
            + num_data_cols
            + if grand_totals.column.is_some() {
                grand_totals
                    .grand
                    .as_ref()
                    .map_or(1, |g| g.len().max(1) as u32)
            } else {
                0
            },
        num_data_cols,
    };

    PivotTableResult {
        column_headers,
        rows: pivot_rows,
        grand_totals,
        rendered_bounds,
        source_row_count: data_row_count,
        measure_descriptors: Vec::new(),
        value_records: Vec::new(),
        errors: None,
    }
}
