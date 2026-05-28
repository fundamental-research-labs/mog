//! Production evaluation bridge for sheet filters.

use cell_types::SheetId;
use value_types::CellValue;
use yrs::{Doc, MapRef};

use super::bridge::column_filter_to_table_criteria;
use super::crud::get_filter;
use super::{ColumnFilter, FilterEvaluationResult, FilterRecordCount};

// Evaluation Bridge
// -------------------------------------------------------------------

/// Evaluate filter criteria and return which rows match.
///
/// Delegates per-column evaluation to `compute_table::filter::evaluate_column_filter`,
/// which handles Values, Condition, TopBottom, Dynamic, and Color filter types.
///
/// The `get_cell_value` callback provides cell values for a given (row, col).
/// The `resolve_cell_id_to_pos` callback resolves a CellId string to (row, col).
///
/// Returns evaluation results for each data row. An empty result means
/// no column filters are active (all rows match).
pub fn evaluate_filter<F, G, R>(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    get_cell_value: F,
    get_cell_format: G,
    resolve_cell_id_to_pos: R,
) -> Vec<FilterEvaluationResult>
where
    F: Fn(u32, u32) -> CellValue,
    G: Fn(u32, u32) -> domain_types::CellFormat,
    R: Fn(&str) -> Option<(u32, u32)>,
{
    let filter = match get_filter(doc, sheets, sheet_id, filter_id) {
        Some(f) => f,
        None => return vec![],
    };

    // Resolve filter range corners to current positions
    let header_start = match resolve_cell_id_to_pos(&filter.header_start_cell_id) {
        Some(p) => p,
        None => return vec![],
    };
    let data_end = match resolve_cell_id_to_pos(&filter.data_end_cell_id) {
        Some(p) => p,
        None => return vec![],
    };

    let data_start_row = header_start.0 + 1;
    let data_end_row = data_end.0;

    if data_start_row > data_end_row {
        return vec![];
    }

    let row_count = (data_end_row - data_start_row + 1) as usize;

    if filter.column_filters.is_empty() {
        return (0..row_count)
            .map(|i| FilterEvaluationResult {
                row: data_start_row + i as u32,
                matches: true,
            })
            .collect();
    }

    // Current date for dynamic filters (today, this week, etc.). Reads through
    // the injected clock so cloud workers honor the session userTimezone — same
    // source as NOW()/TODAY().
    let now = Some(crate::eval::clock::current_calendar_date());

    // Build per-column bitmaps by delegating to compute-table
    let mut bitmaps: Vec<Vec<u8>> = Vec::new();

    for (header_cell_id, criteria) in &filter.column_filters {
        // Resolve header CellId to current column position
        let header_pos = match resolve_cell_id_to_pos(header_cell_id) {
            Some(p) => p,
            None => continue, // Header cell deleted — skip
        };
        let col = header_pos.1;

        // Convert domain-types ColumnFilter to compute-table FilterCriteria
        let table_criteria = column_filter_to_table_criteria(criteria);

        // Materialize column data as Vec<CellValue>
        let column_data: Vec<CellValue> = (0..row_count)
            .map(|i| get_cell_value(data_start_row + i as u32, col))
            .collect();

        // Materialize per-row CellFormat only when the criterion needs it
        // (color filter). Other criteria don't pay the resolution cost.
        let column_formats: Option<Vec<domain_types::CellFormat>> =
            if matches!(criteria, ColumnFilter::Color { .. }) {
                Some(
                    (0..row_count)
                        .map(|i| get_cell_format(data_start_row + i as u32, col))
                        .collect(),
                )
            } else {
                None
            };

        // Delegate evaluation to compute-table
        let bitmap = compute_table::filter::evaluate_column_filter(
            &table_criteria,
            &column_data,
            column_formats.as_deref(),
            now,
            None, // week_start_day — defaults to Sunday inside compute-table
        );

        bitmaps.push(bitmap);
    }

    if bitmaps.is_empty() {
        return vec![];
    }

    // Compose all per-column bitmaps (AND — row must pass all)
    let final_bitmap = if bitmaps.len() == 1 {
        bitmaps.into_iter().next().unwrap()
    } else {
        let mut composed = bitmaps[0].clone();
        for bitmap in &bitmaps[1..] {
            for i in 0..composed.len() {
                composed[i] &= bitmap[i];
            }
        }
        composed
    };

    // Convert bitmap to FilterEvaluationResult[]
    let mut results = Vec::with_capacity(row_count);
    for (i, &bit) in final_bitmap.iter().enumerate().take(row_count) {
        results.push(FilterEvaluationResult {
            row: data_start_row + i as u32,
            matches: bit == 1,
        });
    }

    results
}

/// Get unique values in a filter column for populating dropdown.
///
/// Returns deduplicated cell values sorted: nulls first, then numbers, then strings.
pub fn get_unique_values<F, R>(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    header_cell_id: &str,
    get_cell_value: F,
    resolve_cell_id_to_pos: R,
) -> Vec<CellValue>
where
    F: Fn(u32, u32) -> CellValue,
    R: Fn(&str) -> Option<(u32, u32)>,
{
    let filter = match get_filter(doc, sheets, sheet_id, filter_id) {
        Some(f) => f,
        None => return vec![],
    };

    // Resolve filter range
    let header_start = match resolve_cell_id_to_pos(&filter.header_start_cell_id) {
        Some(p) => p,
        None => return vec![],
    };
    let data_end = match resolve_cell_id_to_pos(&filter.data_end_cell_id) {
        Some(p) => p,
        None => return vec![],
    };

    // Resolve header CellId to current column position
    let header_pos = match resolve_cell_id_to_pos(header_cell_id) {
        Some(p) => p,
        None => return vec![],
    };
    let col = header_pos.1;

    let data_start_row = header_start.0 + 1;
    let data_end_row = data_end.0;

    if data_start_row > data_end_row {
        return vec![];
    }

    let mut seen = std::collections::HashSet::new();
    let mut unique_values = Vec::new();

    for row in data_start_row..=data_end_row {
        let value = get_cell_value(row, col);
        let key = cell_value_dedup_key(&value);
        if seen.insert(key) {
            unique_values.push(value);
        }
    }

    // Sort: nulls first, then numbers, then strings
    unique_values.sort_by(|a, b| {
        use std::cmp::Ordering;
        let a_null = matches!(a, CellValue::Null);
        let b_null = matches!(b, CellValue::Null);
        if a_null && b_null {
            return Ordering::Equal;
        }
        if a_null {
            return Ordering::Less;
        }
        if b_null {
            return Ordering::Greater;
        }
        match (a, b) {
            (CellValue::Number(na), CellValue::Number(nb)) => {
                na.get().partial_cmp(&nb.get()).unwrap_or(Ordering::Equal)
            }
            _ => a.to_string().cmp(&b.to_string()),
        }
    });

    unique_values
}

/// Get filtered vs total record count for a specific filter.
pub fn get_filtered_record_count<F, G, R>(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    get_cell_value: F,
    get_cell_format: G,
    resolve_cell_id_to_pos: R,
) -> Option<FilterRecordCount>
where
    F: Fn(u32, u32) -> CellValue,
    G: Fn(u32, u32) -> domain_types::CellFormat,
    R: Fn(&str) -> Option<(u32, u32)>,
{
    let results = evaluate_filter(
        doc,
        sheets,
        sheet_id,
        filter_id,
        get_cell_value,
        get_cell_format,
        resolve_cell_id_to_pos,
    );
    if results.is_empty() {
        return None;
    }

    let visible = results.iter().filter(|r| r.matches).count();
    let total = results.len();

    Some(FilterRecordCount { visible, total })
}

// =============================================================================
// Dedup Helper
// =============================================================================

/// Create a typed string key for CellValue deduplication.
pub(super) fn cell_value_dedup_key(value: &CellValue) -> String {
    match value {
        CellValue::Null => "__NULL__".to_string(),
        CellValue::Boolean(b) => format!("__BOOL__:{}", b),
        CellValue::Number(n) => format!("__NUM__:{}", n.get()),
        CellValue::Text(s) => format!("__STR__:{}", s),
        CellValue::Error(e, _) => format!("__ERROR__:{}", e.as_str()),
        CellValue::Array(_) => "__ARRAY__".to_string(),
        CellValue::Control(c) => format!("__BOOL__:{}", c.value),
        CellValue::Image(image) => format!("__IMG__:{}", image.fallback_text()),
    }
}

// =============================================================================
// Tests
// =============================================================================
