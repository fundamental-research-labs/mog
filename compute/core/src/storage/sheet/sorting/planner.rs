use std::cmp::Ordering;
use std::collections::HashSet;

use domain_types::CellFormat;
use domain_types::domain::filter::SortOrder;
use value_types::CellValue;

use super::compare::{compare_by_color, compare_by_custom_list, compare_cell_values};
use super::types::{CellRange, SortColumnCriterion, SortConfig, SortMode, SortResult};

struct ResolvedCriterion {
    col: u32,
    direction: Option<SortOrder>,
    case_sensitive: bool,
    mode: SortMode,
}

struct RowData {
    original_row: u32,
    values: Vec<CellValue>,
    formats: Vec<Option<CellFormat>>,
}

#[allow(clippy::too_many_arguments)]
fn compute_sorted_row_order_from_resolved<F, G>(
    hidden_rows: &HashSet<u32>,
    range: &CellRange,
    has_headers: bool,
    resolved_criteria: Vec<ResolvedCriterion>,
    has_unresolved_criteria: bool,
    get_cell_value: G,
    get_cell_format: F,
    visible_rows_only: bool,
) -> SortResult
where
    F: Fn(u32, u32) -> CellFormat,
    G: Fn(u32, u32) -> CellValue,
{
    let data_start_row = if has_headers {
        range.start_row() + 1
    } else {
        range.start_row()
    };
    let data_end_row = range.end_row();

    if resolved_criteria.is_empty() {
        return SortResult {
            sorted_indices: vec![],
            target_indices: vec![],
            rows_moved: 0,
            has_unresolved_criteria: true,
        };
    }

    let needs_format: Vec<bool> = resolved_criteria
        .iter()
        .map(|c| {
            matches!(
                c.mode,
                SortMode::CellColor { .. } | SortMode::FontColor { .. }
            )
        })
        .collect();

    let target_indices: Vec<u32> = (data_start_row..=data_end_row)
        .filter(|row| !visible_rows_only || !hidden_rows.contains(row))
        .collect();

    let mut rows: Vec<RowData> = Vec::new();
    for &row in &target_indices {
        let mut values = Vec::with_capacity(resolved_criteria.len());
        let mut formats: Vec<Option<CellFormat>> = Vec::with_capacity(resolved_criteria.len());
        for (i, criterion) in resolved_criteria.iter().enumerate() {
            let col = criterion.col;
            values.push(get_cell_value(row, col));
            formats.push(if needs_format[i] {
                Some(get_cell_format(row, col))
            } else {
                None
            });
        }
        rows.push(RowData {
            original_row: row,
            values,
            formats,
        });
    }

    rows.sort_by(|a, b| {
        for (i, criterion) in resolved_criteria.iter().enumerate() {
            let a_val = &a.values[i];
            let b_val = &b.values[i];

            let config = SortConfig {
                order: criterion.direction,
                case_sensitive: criterion.case_sensitive,
                natural_sort: true,
                nulls_first: false,
            };

            let result = match &criterion.mode {
                SortMode::Value { custom_list: None } => compare_cell_values(a_val, b_val, &config),
                SortMode::Value {
                    custom_list: Some(list),
                } => compare_by_custom_list(a_val, b_val, list, &config),
                SortMode::CellColor { target, position } => {
                    let fa = a.formats[i]
                        .as_ref()
                        .expect("format pre-materialized for color criterion");
                    let fb = b.formats[i]
                        .as_ref()
                        .expect("format pre-materialized for color criterion");
                    compare_by_color(fa, fb, target, false, *position, &config)
                }
                SortMode::FontColor { target, position } => {
                    let fa = a.formats[i]
                        .as_ref()
                        .expect("format pre-materialized for color criterion");
                    let fb = b.formats[i]
                        .as_ref()
                        .expect("format pre-materialized for color criterion");
                    compare_by_color(fa, fb, target, true, *position, &config)
                }
            };

            if result != Ordering::Equal {
                return result;
            }
        }
        a.original_row.cmp(&b.original_row)
    });

    let sorted_indices: Vec<u32> = rows.iter().map(|r| r.original_row).collect();

    let mut rows_moved: u32 = 0;
    for (i, &idx) in sorted_indices.iter().enumerate() {
        if target_indices.get(i).copied() != Some(idx) {
            rows_moved += 1;
        }
    }

    SortResult {
        sorted_indices,
        target_indices,
        rows_moved,
        has_unresolved_criteria,
    }
}

/// Compute sorted row order from absolute column criteria and a positional
/// value accessor.
///
/// Selected sort columns can contain compact native ranges, so value reads
/// use the caller's positional accessor.
pub fn compute_sorted_row_order_by_columns_with_scope<F, G>(
    hidden_rows: &HashSet<u32>,
    range: &CellRange,
    criteria: &[SortColumnCriterion],
    has_headers: bool,
    get_cell_value: G,
    get_cell_format: F,
    visible_rows_only: bool,
) -> SortResult
where
    F: Fn(u32, u32) -> CellFormat,
    G: Fn(u32, u32) -> CellValue,
{
    let mut resolved_criteria: Vec<ResolvedCriterion> = Vec::new();
    let mut has_unresolved_criteria = false;

    for criterion in criteria {
        if criterion.column < range.start_col() || criterion.column > range.end_col() {
            has_unresolved_criteria = true;
            continue;
        }

        resolved_criteria.push(ResolvedCriterion {
            col: criterion.column,
            direction: criterion.direction,
            case_sensitive: criterion.case_sensitive,
            mode: criterion.mode.clone(),
        });
    }

    compute_sorted_row_order_from_resolved(
        hidden_rows,
        range,
        has_headers,
        resolved_criteria,
        has_unresolved_criteria,
        get_cell_value,
        get_cell_format,
        visible_rows_only,
    )
}
