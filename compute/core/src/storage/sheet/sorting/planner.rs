use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use cell_types::{CellId, SheetId};
use compute_document::cell_serde::yrs_any_to_cell_value;
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use domain_types::CellFormat;
use domain_types::domain::filter::SortOrder;
use value_types::CellValue;
use yrs::{Doc, Map, MapRef, Out, Transact};

use crate::storage::infra::grid_helpers::get_cells_map;

use super::compare::{compare_by_color, compare_by_custom_list, compare_cell_values};
use super::types::{CellRange, SortColumnCriterion, SortConfig, SortMode, SortOptions, SortResult};

/// Read a CellValue from the cells map given a cell's hex ID.
fn read_cell_value_from_maps<T: yrs::ReadTxn>(
    txn: &T,
    cells_map: &MapRef,
    cell_hex: &str,
) -> CellValue {
    match cells_map.get(txn, cell_hex) {
        Some(Out::YMap(cell_map)) => yrs_any_to_cell_value(&cell_map, txn),
        _ => CellValue::Null,
    }
}

// ---------------------------------------------------------------------------

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
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
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
    let hidden_rows: HashSet<u32> = if visible_rows_only {
        crate::storage::sheet::dimensions::get_hidden_rows(doc, sheets, &sheet_id)
            .into_iter()
            .collect()
    } else {
        HashSet::new()
    };

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

// -------------------------------------------------------------------
// compute_sorted_row_order
// -------------------------------------------------------------------

/// Compute the sorted order of rows in a range.
///
/// Uses `compare_cell_values()` for consistent comparison logic:
/// - Natural sort for strings with numbers ("Item 2" before "Item 10")
/// - Nulls handling (configurable: first or last)
/// - Type priority (numbers before strings)
///
/// Identity (position ↔ CellId) is resolved exclusively via the provided
/// `GridIndex`. The yrs `cells` map is read only for cell values (keyed by
/// cell_hex).
pub fn compute_sorted_row_order<F>(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    range: &CellRange,
    options: &SortOptions,
    grid_index: &GridIndex,
    get_cell_format: F,
) -> SortResult
where
    F: Fn(u32, u32) -> CellFormat,
{
    compute_sorted_row_order_with_scope(
        doc,
        sheets,
        sheet_id,
        range,
        options,
        grid_index,
        get_cell_format,
        false,
    )
}

/// Compute a sorted row order, optionally sorting only visible rows.
///
/// `visible_rows_only` matches Excel AutoFilter sort semantics: rows hidden by
/// the active filter remain in their current physical slots, and only the
/// visible row slots receive sorted visible rows.
pub fn compute_sorted_row_order_with_scope<F>(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    range: &CellRange,
    options: &SortOptions,
    grid_index: &GridIndex,
    get_cell_format: F,
    visible_rows_only: bool,
) -> SortResult
where
    F: Fn(u32, u32) -> CellFormat,
{
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let fail = || SortResult {
        sorted_indices: vec![],
        target_indices: vec![],
        rows_moved: 0,
        has_unresolved_criteria: true,
    };

    let cells_map = match get_cells_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return fail(),
    };

    let data_start_row = if options.has_headers {
        range.start_row() + 1
    } else {
        range.start_row()
    };
    let data_end_row = range.end_row();

    // Resolve all header CellIds to column positions via GridIndex.
    let mut resolved_criteria: Vec<ResolvedCriterion> = Vec::new();
    let mut has_unresolved_criteria = false;

    for criterion in &options.criteria {
        match grid_index.cell_position(&criterion.header_cell_id) {
            Some((_row, col)) => {
                resolved_criteria.push(ResolvedCriterion {
                    col,
                    direction: criterion.direction,
                    case_sensitive: criterion.case_sensitive,
                    mode: criterion.mode.clone(),
                });
            }
            None => {
                has_unresolved_criteria = true;
                // Skip unresolved criteria (column was deleted)
            }
        }
    }

    // If all criteria are unresolved, no sorting possible
    if resolved_criteria.is_empty() {
        return SortResult {
            sorted_indices: vec![],
            target_indices: vec![],
            rows_moved: 0,
            has_unresolved_criteria: true,
        };
    }

    // Build (row, col) -> CellId lookup for the data portion of the range,
    // by walking the GridIndex.
    let min_criterion_col = resolved_criteria
        .iter()
        .map(|c| c.col)
        .min()
        .unwrap_or(range.start_col());
    let max_criterion_col = resolved_criteria
        .iter()
        .map(|c| c.col)
        .max()
        .unwrap_or(range.end_col());

    let mut pos_to_cell_id: HashMap<(u32, u32), CellId> = HashMap::new();
    for (cell_id, r, c) in grid_index.cells_in_range(
        data_start_row,
        min_criterion_col,
        data_end_row,
        max_criterion_col,
    ) {
        pos_to_cell_id.insert((r, c), cell_id);
    }

    let get_cell_value = |row: u32, col: u32| -> CellValue {
        match pos_to_cell_id.get(&(row, col)) {
            Some(cell_id) => {
                let cell_hex = id_to_hex(cell_id.as_u128());
                read_cell_value_from_maps(&txn, &cells_map, &cell_hex)
            }
            None => CellValue::Null,
        }
    };

    compute_sorted_row_order_from_resolved(
        doc,
        sheets,
        sheet_id,
        range,
        options.has_headers,
        resolved_criteria,
        has_unresolved_criteria,
        get_cell_value,
        get_cell_format,
        visible_rows_only,
    )
}

/// Compute sorted row order from absolute column criteria and a positional
/// value accessor.
///
/// This is the bridge/API path: selected sort columns may be backed by imported
/// Range data without sparse CellIds, so value reads must go through a caller
/// supplied positional accessor rather than the Yrs `cells` map.
pub fn compute_sorted_row_order_by_columns_with_scope<F, G>(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
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
        doc,
        sheets,
        sheet_id,
        range,
        has_headers,
        resolved_criteria,
        has_unresolved_criteria,
        get_cell_value,
        get_cell_format,
        visible_rows_only,
    )
}
