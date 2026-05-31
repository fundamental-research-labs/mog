//! Core pivot computation: orchestrates grouping, aggregation, and result building.

use value_types::CellValue;

use crate::hierarchy::build_group_hierarchy_from_aggregated_tree;
use crate::resolved::ResolvedPivotConfig;
use crate::show_values_as::apply_show_values_as_to_result;
use crate::types::{PivotExpansionState, PivotTableConfig, PivotTableResult, ShowValuesAsConfig};

use super::validation::validate_and_resolve;

/// Compute a pivot table from source data.
///
/// This is the main entry point. Takes a configuration, source data (2D array where
/// the first row is headers), and optional expansion state for hierarchies.
///
/// Internally validates and resolves the config, then delegates to `compute_resolved()`.
#[must_use]
pub fn compute(
    config: &PivotTableConfig,
    data: &[Vec<CellValue>],
    expansion_state: Option<&PivotExpansionState>,
) -> PivotTableResult {
    match validate_and_resolve(config) {
        Err(e) => PivotTableResult::empty(0, Some(vec![e.to_string()])),
        Ok(resolved) => compute_resolved(&resolved, data, expansion_state),
    }
}

/// Compute a pivot table from a pre-validated resolved configuration.
///
/// This is the core implementation. Accepts a `ResolvedPivotConfig` where all field
/// references are resolved, all defaults are filled in, and all types are validated.
/// No `unwrap_or` fallbacks needed — the resolved config is trusted.
#[must_use]
pub fn compute_resolved(
    config: &ResolvedPivotConfig,
    data: &[Vec<CellValue>],
    expansion_state: Option<&PivotExpansionState>,
) -> PivotTableResult {
    let data_rows = if data.len() > 1 { &data[1..] } else { &[] };
    if data_rows.is_empty() {
        return PivotTableResult::empty(0, None);
    }

    let query = crate::presenter::pivot_config_to_query(config);
    match compute_relational::execute(&query, data) {
        Ok(query_result) => {
            crate::presenter::query_result_to_pivot(&query_result, config, expansion_state)
        }
        Err(e) => PivotTableResult::empty(data_rows.len(), Some(vec![e.to_string()])),
    }
}

/// Compute a pivot table with "Show Values As" transformations applied.
///
/// Convenience method that chains `compute()` with `apply_show_values_as_with_grand_totals()`.
/// Internally validates and resolves the config, then delegates to `compute_with_show_values_as_resolved()`.
#[must_use]
pub fn compute_with_show_values_as(
    config: &PivotTableConfig,
    data: &[Vec<CellValue>],
    expansion_state: Option<&PivotExpansionState>,
) -> PivotTableResult {
    match validate_and_resolve(config) {
        Err(e) => PivotTableResult::empty(0, Some(vec![e.to_string()])),
        Ok(resolved) => compute_with_show_values_as_resolved(&resolved, data, expansion_state),
    }
}

/// Compute a pivot table with "Show Values As" transformations from a pre-validated config.
///
/// Chains `compute_resolved()` with `apply_show_values_as_with_grand_totals()`.
#[must_use]
pub fn compute_with_show_values_as_resolved(
    config: &ResolvedPivotConfig,
    data: &[Vec<CellValue>],
    expansion_state: Option<&PivotExpansionState>,
) -> PivotTableResult {
    let data_rows = if data.len() > 1 { &data[1..] } else { &[] };
    if data_rows.is_empty() {
        return PivotTableResult::empty(0, None);
    }

    // Use the relational engine pipeline directly
    let query = crate::presenter::pivot_config_to_query(config);

    let query_result = match compute_relational::execute(&query, data) {
        Ok(r) => r,
        Err(e) => {
            return PivotTableResult::empty(data_rows.len(), Some(vec![e.to_string()]));
        }
    };

    let mut result =
        crate::presenter::query_result_to_pivot(&query_result, config, expansion_state);

    if let Some(ref errors) = result.errors
        && !errors.is_empty()
    {
        return result;
    }

    // Extract ShowValuesAs configs
    let configs: Vec<(usize, ShowValuesAsConfig)> = config
        .value_placements()
        .iter()
        .enumerate()
        .filter_map(|(i, vp)| vp.show_values_as().cloned().map(|sva| (i, sva)))
        .collect();

    if !configs.is_empty() {
        let row_field_names: Vec<String> = config
            .row_placements()
            .iter()
            .map(|rp| rp.field_id().to_string())
            .collect();

        let expanded_set = expansion_state.and_then(|es| {
            let set = &es.expanded_rows;
            if set.is_empty() { None } else { Some(set) }
        });

        // Build GroupHierarchy directly from AggregatedNode tree (no GroupNode conversion)
        let hierarchy = build_group_hierarchy_from_aggregated_tree(
            &query_result.row_tree,
            &result.rows,
            &row_field_names,
            expanded_set,
        );

        apply_show_values_as_to_result(&mut result, &configs, &hierarchy);
    }

    result
}
