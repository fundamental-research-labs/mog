//! Drill-down: retrieve source row indices for a specific pivot cell.

use value_types::CellValue;

use crate::filter::apply_filters_resolved;
use crate::grouper::{apply_date_grouping, apply_number_grouping, normalize_to_key};
use crate::resolved::ResolvedPivotConfig;
use crate::types::{AggregateFunction, PivotTableConfig};
use crate::values::{ARRAY_KEY, BLANK_KEY, LAMBDA_KEY};

use super::GRAND_TOTAL_KEY;
use super::validation::validate_and_resolve;

/// Get detail rows for a specific cell (drill-down).
///
/// Given row and column keys (e.g., "east" or "east\0widget"), returns the
/// indices of matching data rows.
///
/// Internally validates and resolves the config, then delegates to `drill_down_resolved()`.
#[must_use]
pub fn drill_down(
    config: &PivotTableConfig,
    data: &[Vec<CellValue>],
    row_key: &str,
    column_key: &str,
) -> Vec<usize> {
    match validate_and_resolve(config) {
        Err(_) => vec![],
        Ok(resolved) => drill_down_resolved(&resolved, data, row_key, column_key),
    }
}

/// Get detail rows for a specific cell (drill-down) from a pre-validated config.
///
/// Given row and column keys (e.g., "east" or "east\0widget"), returns the
/// indices of matching data rows.
#[must_use]
pub fn drill_down_resolved(
    config: &ResolvedPivotConfig,
    data: &[Vec<CellValue>],
    row_key: &str,
    column_key: &str,
) -> Vec<usize> {
    // Parse the row and column keys to extract field values
    let row_values = parse_tuple_key(row_key);
    let column_values = parse_tuple_key(column_key);

    // Filter data rows (apply the same filters as compute)
    let data_rows = if data.len() > 1 { &data[1..] } else { &[] };

    let all_indices: Vec<usize> = (0..data_rows.len()).collect();

    // Build value column indices for filter API
    let value_column_indices: Vec<(usize, AggregateFunction)> = config
        .value_placements()
        .iter()
        .map(|vp| (vp.column_index(), vp.aggregate_function()))
        .collect();

    let filtered_indices = apply_filters_resolved(
        data_rows,
        all_indices,
        config.filters(),
        &value_column_indices,
    );

    let row_placements = config.row_placements();
    let column_placements = config.column_placements();

    let mut matching_indices: Vec<usize> = Vec::new();

    for &i in &filtered_indices {
        let row = &data_rows[i];
        let mut matches = true;

        // Check row field matches (applying date/number grouping if configured)
        for j in 0..row_placements.len().min(row_values.len()) {
            let rp = &row_placements[j];
            let cell_value = row
                .get(rp.column_index())
                .cloned()
                .unwrap_or(CellValue::Null);
            // Apply the same grouping transformation the grouper uses
            let grouped_value = if let Some(dg) = rp.date_grouping() {
                apply_date_grouping(&cell_value, dg)
            } else if let Some(ng) = rp.number_grouping() {
                apply_number_grouping(&cell_value, ng)
            } else {
                cell_value
            };
            let normalized_cell = normalize_to_key(&grouped_value);
            if normalized_cell != row_values[j] {
                matches = false;
                break;
            }
        }

        // Check column field matches (applying date/number grouping if configured)
        if matches {
            for j in 0..column_placements.len().min(column_values.len()) {
                let cp = &column_placements[j];
                let cell_value = row
                    .get(cp.column_index())
                    .cloned()
                    .unwrap_or(CellValue::Null);
                // Apply the same grouping transformation the grouper uses
                let grouped_value = if let Some(dg) = cp.date_grouping() {
                    apply_date_grouping(&cell_value, dg)
                } else if let Some(ng) = cp.number_grouping() {
                    apply_number_grouping(&cell_value, ng)
                } else {
                    cell_value
                };
                let normalized_cell = normalize_to_key(&grouped_value);
                if normalized_cell != column_values[j] {
                    matches = false;
                    break;
                }
            }
        }

        if matches {
            matching_indices.push(i);
        }
    }

    matching_indices
}

fn parse_tuple_key(key: &str) -> Vec<&str> {
    if key == GRAND_TOTAL_KEY {
        return Vec::new();
    }

    let mut values = Vec::new();
    let mut rest = key;
    while !rest.is_empty() {
        if let Some(sentinel) = [BLANK_KEY, ARRAY_KEY, LAMBDA_KEY]
            .iter()
            .find(|sentinel| rest.starts_with(**sentinel))
        {
            values.push(*sentinel);
            rest = &rest[sentinel.len()..];
            if rest.starts_with('\x00') {
                rest = &rest[1..];
            }
            continue;
        }

        if let Some(separator) = rest.find('\x00') {
            values.push(&rest[..separator]);
            rest = &rest[separator + 1..];
        } else {
            values.push(rest);
            break;
        }
    }
    values
}
