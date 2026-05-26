//! Sorting module — port of `spreadsheet-model/src/sorting.ts`.
//!
//! Stream A1: Sort System (Cell Identity Model)
//!
//! Implements range sorting by reordering cell positions within a range,
//! preserving Cell Identity. CellIds stay with their data — only positions change.
//!
//! ARCHITECTURE (Cell Identity Model):
//!
//! Sort is a POSITION operation, not a DATA operation:
//! - Original "copy values" approach: destroys formulas, breaks CellId references
//! - Cell Identity approach: swap cell positions, CellIds follow data, formulas preserved
//!
//! Sort algorithm:
//! 1. Resolve header CellIds to current column positions
//! 2. Extract values from sort columns for comparison
//! 3. Compute sorted row order using `compare_cell_values()`
//! 4. Reorder cells by updating their row positions within the range
//! 5. Rebuild grid index for the sorted range

use std::cmp::Ordering;

use yrs::{Map, MapRef, Out, Transact};

use crate::storage::YrsStorage;
use crate::storage::infra::grid_helpers::get_cells_map;
use cell_types::{CellId, SheetId};
use compute_document::cell_serde::yrs_any_to_cell_value;
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use domain_types::CellFormat;
use domain_types::domain::filter::{ColorPosition, SortOrder};
use value_types::CellValue;
use yrs::Doc;

// ---------------------------------------------------------------------------
// Engine-internal sorting types (moved from domain_types/sorting.rs)
// ---------------------------------------------------------------------------

/// Configuration for cell value comparison.
#[derive(Debug, Clone)]
pub(crate) struct SortConfig {
    /// Sort direction. `None` means no-op (returns Equal).
    pub order: Option<SortOrder>,
    /// Whether null/empty values sort before non-null values.
    pub nulls_first: bool,
    /// Whether string comparison is case-sensitive.
    pub case_sensitive: bool,
    /// Whether to use natural sort for strings (e.g. "Item 2" before "Item 10").
    pub natural_sort: bool,
}

impl Default for SortConfig {
    fn default() -> Self {
        Self {
            order: Some(SortOrder::Asc),
            nulls_first: true,
            case_sensitive: false,
            natural_sort: true,
        }
    }
}

/// What aspect of a cell drives the sort comparator, plus the per-mode
/// auxiliary data (custom list, target color, etc.). Discriminated so
/// invalid combinations are unrepresentable.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(crate) enum SortMode {
    /// Sort by computed cell value. Optionally consult a custom list to
    /// override natural-order on matched values (Excel "sort by custom
    /// list" feature; values not in the list sort *after* list members).
    Value { custom_list: Option<Vec<CellValue>> },
    /// Sort by cell fill color. Matched rows are placed at the top or
    /// bottom of the range per `position`; ties fall through to natural
    /// value order.
    CellColor {
        target: String,
        position: ColorPosition,
    },
    /// Sort by font color. Same `Top`/`Bottom` semantics as `CellColor`.
    FontColor {
        target: String,
        position: ColorPosition,
    },
}

/// A single sort criterion referencing a column by its header CellId.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(crate) struct SortCriterion {
    /// The CellId of the header cell in the sort column.
    pub header_cell_id: CellId,
    /// Sort direction for this column. `None` means no-op.
    pub direction: Option<SortOrder>,
    /// Whether string comparison is case-sensitive for this criterion.
    pub case_sensitive: bool,
    /// What this criterion sorts on (value / cell color / font color)
    /// plus the per-mode auxiliary data.
    pub mode: SortMode,
}

/// Options for a sort operation.
#[derive(Debug, Clone)]
pub(crate) struct SortOptions {
    /// The sort criteria (one per column, evaluated in order).
    pub criteria: Vec<SortCriterion>,
    /// Whether the first row of the range is a header row (excluded from sort).
    pub has_headers: bool,
}

/// Result of computing a sorted row order.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(crate) struct SortResult {
    /// Original row indices in their new sorted order.
    pub sorted_indices: Vec<u32>,
    /// Destination row slots corresponding to `sorted_indices`.
    ///
    /// For normal sorts this is the contiguous data range. For filtered
    /// visible-row sorts it contains only non-hidden rows, preserving hidden
    /// row positions.
    pub target_indices: Vec<u32>,
    /// Number of rows that changed position.
    pub rows_moved: u32,
    /// Whether any criteria could not be resolved (e.g., column was deleted).
    pub has_unresolved_criteria: bool,
}

/// Position-only cell range (re-exported from compute-types for backward compat).
pub type CellRange = crate::PositionRange;

// ---------------------------------------------------------------------------
// Pure comparison functions
// ---------------------------------------------------------------------------

/// Get the type priority for sorting. Lower priority sorts first.
///
/// null=0, error=1, bool=2, number=3, string=4, other=5
pub(crate) fn get_type_priority(value: &CellValue) -> u8 {
    match value {
        CellValue::Null => 0,
        CellValue::Error(..) => 1,
        CellValue::Boolean(_) => 2,
        CellValue::Number(_) => 3,
        CellValue::Text(_) => 4,
        _ => 5,
    }
}

/// Natural comparison of two strings, treating embedded numeric chunks as numbers.
///
/// E.g., "Item 2" < "Item 10" (because 2 < 10).
pub(crate) fn natural_compare(a: &str, b: &str, case_sensitive: bool) -> Ordering {
    let str_a: String = if case_sensitive {
        a.to_string()
    } else {
        a.to_lowercase()
    };
    let str_b: String = if case_sensitive {
        b.to_string()
    } else {
        b.to_lowercase()
    };

    let chunks_a = split_natural_chunks(&str_a);
    let chunks_b = split_natural_chunks(&str_b);

    let max_len = chunks_a.len().max(chunks_b.len());
    for i in 0..max_len {
        let chunk_a = chunks_a.get(i).map(|s| s.as_str()).unwrap_or("");
        let chunk_b = chunks_b.get(i).map(|s| s.as_str()).unwrap_or("");

        let num_a = chunk_a.parse::<i64>();
        let num_b = chunk_b.parse::<i64>();

        match (num_a, num_b) {
            (Ok(na), Ok(nb)) => {
                let cmp = na.cmp(&nb);
                if cmp != Ordering::Equal {
                    return cmp;
                }
            }
            _ => {
                let cmp = chunk_a.cmp(chunk_b);
                if cmp != Ordering::Equal {
                    return cmp;
                }
            }
        }
    }
    Ordering::Equal
}

/// Split a string into alternating numeric and non-numeric chunks.
/// E.g., "Item 10 foo" -> ["Item ", "10", " foo"]
fn split_natural_chunks(s: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut in_digit = false;

    for ch in s.chars() {
        let is_digit = ch.is_ascii_digit();
        if !current.is_empty() && is_digit != in_digit {
            chunks.push(std::mem::take(&mut current));
        }
        current.push(ch);
        in_digit = is_digit;
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// Compare two cell values according to the given sort config.
///
/// Comparison order:
/// - Nulls are handled according to `nulls_first`
/// - Different types: sorted by type priority (null < error < bool < number < string)
/// - Same type: compared within type (errors by string, bools by value, numbers by value,
///   strings by natural sort or lexicographic)
/// - Direction applied at the end (desc reverses)
pub(crate) fn compare_cell_values(a: &CellValue, b: &CellValue, config: &SortConfig) -> Ordering {
    if config.order.is_none() {
        return Ordering::Equal;
    }

    let a_is_null = matches!(a, CellValue::Null);
    let b_is_null = matches!(b, CellValue::Null);

    if a_is_null && b_is_null {
        return Ordering::Equal;
    }
    if a_is_null {
        return if config.nulls_first {
            Ordering::Less
        } else {
            Ordering::Greater
        };
    }
    if b_is_null {
        return if config.nulls_first {
            Ordering::Greater
        } else {
            Ordering::Less
        };
    }

    let priority_a = get_type_priority(a);
    let priority_b = get_type_priority(b);

    if priority_a != priority_b {
        let result = priority_a.cmp(&priority_b);
        return if config.order == Some(SortOrder::Desc) {
            result.reverse()
        } else {
            result
        };
    }

    let result = match (a, b) {
        (CellValue::Error(ea, None), CellValue::Error(eb, None)) => ea.as_str().cmp(eb.as_str()),
        (CellValue::Boolean(ba), CellValue::Boolean(bb)) => {
            // false(0) < true(1)
            match (ba, bb) {
                (false, true) => Ordering::Less,
                (true, false) => Ordering::Greater,
                _ => Ordering::Equal,
            }
        }
        (CellValue::Number(na), CellValue::Number(nb)) => {
            na.get().partial_cmp(&nb.get()).unwrap_or(Ordering::Equal)
        }
        (CellValue::Text(sa), CellValue::Text(sb)) => {
            if config.natural_sort {
                natural_compare(sa, sb, config.case_sensitive)
            } else if config.case_sensitive {
                sa.cmp(sb)
            } else {
                sa.to_lowercase().cmp(&sb.to_lowercase())
            }
        }
        _ => Ordering::Equal,
    };

    if config.order == Some(SortOrder::Desc) {
        result.reverse()
    } else {
        result
    }
}

/// Compare two cell values via a custom sort list (Excel parity).
///
/// Values present in `list` sort by their list position. Values not in
/// the list sort *after* all list members. Within "not in list", ties
/// fall through to `compare_cell_values` so the secondary natural order
/// is honoured. Direction (asc/desc) is applied last by reversing the
/// final ordering — same convention as `compare_cell_values`.
///
/// `list` membership uses `==` on the typed `CellValue`. Strings are
/// case-insensitive when `config.case_sensitive` is false; numbers
/// match by exact value.
pub(crate) fn compare_by_custom_list(
    a: &CellValue,
    b: &CellValue,
    list: &[CellValue],
    config: &SortConfig,
) -> Ordering {
    if config.order.is_none() {
        return Ordering::Equal;
    }

    let pos_a = find_in_custom_list(a, list, config.case_sensitive);
    let pos_b = find_in_custom_list(b, list, config.case_sensitive);

    let result = match (pos_a, pos_b) {
        // Both in list: order by list index.
        (Some(ia), Some(ib)) => ia.cmp(&ib),
        // Only `a` in list: a sorts before b.
        (Some(_), None) => Ordering::Less,
        // Only `b` in list: b sorts before a.
        (None, Some(_)) => Ordering::Greater,
        // Neither in list: fall through to natural-order on value. Use
        // ascending natural order regardless of direction here — the
        // outer `if config.order == Some(SortOrder::Desc)` reverses
        // both buckets uniformly. (For symmetry with `compare_by_color`,
        // this preserves the "values not in list go to the end"
        // invariant under both directions.)
        (None, None) => {
            let nat_config = SortConfig {
                order: Some(SortOrder::Asc),
                ..config.clone()
            };
            compare_cell_values(a, b, &nat_config)
        }
    };

    if config.order == Some(SortOrder::Desc) {
        result.reverse()
    } else {
        result
    }
}

fn find_in_custom_list(
    value: &CellValue,
    list: &[CellValue],
    case_sensitive: bool,
) -> Option<usize> {
    list.iter()
        .position(|item| values_match(item, value, case_sensitive))
}

fn values_match(a: &CellValue, b: &CellValue, case_sensitive: bool) -> bool {
    match (a, b) {
        (CellValue::Text(sa), CellValue::Text(sb)) => {
            if case_sensitive {
                sa == sb
            } else {
                sa.to_lowercase() == sb.to_lowercase()
            }
        }
        _ => a == b,
    }
}

/// Compare two `CellFormat`s by color match against `target` for a
/// color-mode sort.
///
/// Color comparison is case-insensitive on the hex string. A `None`
/// resolved color never matches a non-empty target.
///
/// Semantics: `Top` = matched < non-matched (matched rows go first
/// under ascending sort); `Bottom` = matched > non-matched. The caller's
/// `direction` is then applied — `Desc` reverses, so "color on top
/// descending" puts non-matched first.
///
/// Ties (both rows match or neither matches) return `Equal`. The caller
/// either advances to the next criterion in the multi-criterion loop,
/// or — if there are no further criteria — the stable sort preserves
/// the rows' original relative order. This matches Excel: a single
/// color criterion keeps within-bucket rows in their original order.
pub(crate) fn compare_by_color(
    format_a: &CellFormat,
    format_b: &CellFormat,
    target: &str,
    is_font: bool,
    position: ColorPosition,
    config: &SortConfig,
) -> Ordering {
    if config.order.is_none() {
        return Ordering::Equal;
    }

    let color_a = if is_font {
        format_a.font_color.as_deref()
    } else {
        format_a.background_color.as_deref()
    };
    let color_b = if is_font {
        format_b.font_color.as_deref()
    } else {
        format_b.background_color.as_deref()
    };

    let match_a = color_matches(color_a, target);
    let match_b = color_matches(color_b, target);

    let primary = match (match_a, match_b) {
        (true, true) | (false, false) => Ordering::Equal,
        (true, false) => match position {
            ColorPosition::Top => Ordering::Less,
            ColorPosition::Bottom => Ordering::Greater,
        },
        (false, true) => match position {
            ColorPosition::Top => Ordering::Greater,
            ColorPosition::Bottom => Ordering::Less,
        },
    };

    if config.order == Some(SortOrder::Desc) {
        primary.reverse()
    } else {
        primary
    }
}

fn color_matches(resolved: Option<&str>, target: &str) -> bool {
    match resolved {
        Some(c) => c.eq_ignore_ascii_case(target),
        None => false,
    }
}

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

// -------------------------------------------------------------------
// check_sort_range_merges
// -------------------------------------------------------------------

/// Check if a range contains any merged cells.
///
/// Excel refuses to sort ranges that contain merged cells.
/// Returns `(has_merges, optional_error_message)`.
pub fn check_sort_range_merges(
    storage: &YrsStorage,
    sheet_id: SheetId,
    grid: &GridIndex,
    range: &CellRange,
) -> (bool, Option<String>) {
    let merges = super::merges::get_merges_in_range(
        storage.doc(),
        storage.sheets(),
        sheet_id,
        grid,
        range.start_row(),
        range.start_col(),
        range.end_row(),
        range.end_col(),
    );

    if !merges.is_empty() {
        return (
            true,
            Some(
                "This operation requires the merged cells to be identically sized. \
                 To sort or filter a range with merged cells, you must unmerge them first."
                    .to_string(),
            ),
        );
    }

    (false, None)
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
    let hidden_rows: std::collections::HashSet<u32> = if visible_rows_only {
        super::dimensions::get_hidden_rows(doc, sheets, &sheet_id)
            .into_iter()
            .collect()
    } else {
        std::collections::HashSet::new()
    };
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

    /// Local resolved-criterion view that owns the per-criterion data needed
    /// by the comparator. We index per-criterion vectors by criterion index,
    /// which lets us avoid re-resolving headers / re-fetching formats inside
    /// the O(n log n) comparator.
    struct ResolvedCriterion {
        col: u32,
        direction: Option<SortOrder>,
        case_sensitive: bool,
        mode: SortMode,
    }

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

    let mut pos_to_cell_id: std::collections::HashMap<(u32, u32), CellId> =
        std::collections::HashMap::new();
    for (cell_id, r, c) in grid_index.cells_in_range(
        data_start_row,
        min_criterion_col,
        data_end_row,
        max_criterion_col,
    ) {
        pos_to_cell_id.insert((r, c), cell_id);
    }

    // Build row data for sorting. We pre-materialize per-criterion values
    // and (for color-mode criteria) per-criterion CellFormats so the
    // comparator stays read-only and O(1) per cmp.
    struct RowData {
        original_row: u32,
        values: Vec<CellValue>,
        // Per-criterion-index format. Empty for criteria whose mode does
        // not need the format.
        formats: Vec<Option<CellFormat>>,
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
            let value = match pos_to_cell_id.get(&(row, col)) {
                Some(cell_id) => {
                    let cell_hex = id_to_hex(cell_id.as_u128());
                    read_cell_value_from_maps(&txn, &cells_map, &cell_hex)
                }
                None => CellValue::Null,
            };
            values.push(value);
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

    // Sort: per-criterion dispatch on `mode`.
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
        // Stable sort: preserve original order for equal elements
        a.original_row.cmp(&b.original_row)
    });

    // Extract sorted row indices
    let sorted_indices: Vec<u32> = rows.iter().map(|r| r.original_row).collect();

    // Count rows that moved
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
// reorder_rows_in_range
// -------------------------------------------------------------------

/// Reorder rows within a range based on a sorted index array.
///
/// Cell Identity Model: the canonical identity store is
/// `GridIndex`. Row reordering is a pure identity-position remap — no yrs
/// cell data needs to move because values are keyed by cell_hex, not by
/// (row, col). This function therefore has no yrs mutations to perform;
/// the caller is responsible for invoking `GridIndex::sort_rows` with the
/// equivalent permutation to update identity positions.
///
/// All arguments are kept for call-site compatibility, and the
/// `grid_index` parameter documents that identity is expected to be
/// maintained externally via the same authority.
#[allow(unused_variables)]
pub fn reorder_rows_in_range(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    range: &CellRange,
    sorted_row_indices: &[u32],
    has_headers: bool,
    grid_index: &GridIndex,
) {
    // Intentional no-op. See doc comment above.
}

// -------------------------------------------------------------------
// sort_range
// -------------------------------------------------------------------

/// Sort a range of cells.
///
/// Main entry point for the sorting domain. Computes sort order and
/// reorders rows in a single operation.
///
/// Cell Identity Model: Sort updates positions, not data. CellIds stay
/// with their values.
///
/// Returns the number of rows that changed position.
#[allow(dead_code)] // pub(crate) module — engine uses EngineMutation::SortRange; kept for tests and direct callers
pub fn sort_range<F>(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    range: &CellRange,
    options: &SortOptions,
    grid_index: &GridIndex,
    get_cell_format: F,
) -> u32
where
    F: Fn(u32, u32) -> CellFormat,
{
    // Compute sorted order
    let sort_result = compute_sorted_row_order(
        doc,
        sheets,
        sheet_id,
        range,
        options,
        grid_index,
        get_cell_format,
    );

    if sort_result.sorted_indices.is_empty() || sort_result.rows_moved == 0 {
        return 0;
    }

    // Reorder rows (no-op for yrs; identity updated by caller via GridIndex::sort_rows)
    reorder_rows_in_range(
        doc,
        sheets,
        sheet_id,
        range,
        &sort_result.sorted_indices,
        options.has_headers,
        grid_index,
    );

    sort_result.rows_moved
}

// -------------------------------------------------------------------
// sort_by_column
// -------------------------------------------------------------------

/// Simple sort by column index (position-based API).
///
/// Convenience function that uses column indices instead of CellId-based
/// criteria. Finds the CellId at the header position via `GridIndex` and
/// delegates to `sort_range`.
///
/// Returns the number of rows that changed position.
#[allow(dead_code)] // pub(crate) module — engine uses EngineMutation::SortRange; kept for tests and direct callers
pub fn sort_by_column(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    range: &CellRange,
    sort_column: u32,
    direction: Option<SortOrder>,
    has_headers: bool,
    grid_index: &GridIndex,
) -> u32 {
    // Try to find a CellId for the header row of the sort column.
    let mut header_cell_id: Option<CellId> = grid_index.cell_id_at(range.start_row(), sort_column);

    // If no cell at the header, scan down the column within the range.
    if header_cell_id.is_none() {
        for row in range.start_row()..=range.end_row() {
            if let Some(id) = grid_index.cell_id_at(row, sort_column) {
                header_cell_id = Some(id);
                break;
            }
        }
    }

    // If still no cell, column is empty — nothing to sort by.
    let header_cell_id = match header_cell_id {
        Some(id) => id,
        None => return 0,
    };

    let criterion = SortCriterion {
        header_cell_id,
        direction,
        case_sensitive: false,
        mode: SortMode::Value { custom_list: None },
    };

    let options = SortOptions {
        criteria: vec![criterion],
        has_headers,
    };

    // Value-only sort: a default-format closure is sufficient since color
    // modes aren't requested.
    sort_range(
        doc,
        sheets,
        sheet_id,
        range,
        &options,
        grid_index,
        |_r, _c| CellFormat::default(),
    )
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{KEY_VALUE, YrsStorage};
    use cell_types::{CellId, SheetId};
    use compute_document::undo::ORIGIN_USER_EDIT;
    use std::sync::Arc;
    use value_types::{CellError, CellValue, FiniteF64};
    use yrs::{Any, Map, MapPrelim, Origin, Out, Transact};

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    fn make_cell_id(n: u128) -> CellId {
        CellId::from_raw(n)
    }

    /// Create a storage with one sheet plus a fresh `GridIndex` that serves
    /// as the authoritative identity store for that sheet in the test.
    ///
    /// The GridIndex is built via `GridIndex::new` with a fresh
    /// `IdAllocator`; it does not share identities with the yrs rowOrder /
    /// colOrder arrays installed by `add_sheet`. Sort-path tests don't need
    /// that correspondence because, post-migration, sort consults only the
    /// GridIndex for identity/positions and only yrs for cell values.
    fn storage_with_sheet() -> (YrsStorage, SheetId, GridIndex) {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let sheet_id = make_sheet_id(1);
        storage
            .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
            .expect("add_sheet should succeed");

        let grid = GridIndex::new(sheet_id, 100, 26, Arc::new(cell_types::IdAllocator::new()));

        (storage, sheet_id, grid)
    }

    /// Place a cell with a given CellId, value, and position.
    /// Writes the value into the yrs `cells` map (keyed by cell_hex) and
    /// registers the CellId in the GridIndex at (row, col).
    fn place_cell(
        storage: &YrsStorage,
        grid: &mut GridIndex,
        sheet_id: SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        value: &CellValue,
    ) {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let cell_hex = id_to_hex(cell_id.as_u128());
        let mut txn = storage
            .doc()
            .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

        // Write cell into cells map (keyed by cell_hex — identity-only)
        if let Some(cells_map) = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
            let v = match value {
                CellValue::Number(n) => Any::Number(n.get()),
                CellValue::Text(s) => Any::String(Arc::clone(s)),
                CellValue::Boolean(b) => Any::Bool(*b),
                CellValue::Null => Any::Null,
                CellValue::Error(e, _) => Any::String(Arc::from(e.as_str())),
                _ => Any::Null,
            };
            let cell_prelim = MapPrelim::from([(KEY_VALUE, v)]);
            cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
        }

        drop(txn);

        // Register in GridIndex (sole identity authority).
        grid.register_cell(cell_id, row, col);
    }

    /// Read a cell's position via the GridIndex.
    fn read_cell_position(grid: &GridIndex, cell_id: CellId) -> Option<(u32, u32)> {
        grid.cell_position(&cell_id)
    }

    // ===================================================================
    // Test 1: compare_cell_values — nulls
    // ===================================================================

    #[test]
    fn test_compare_nulls() {
        let config = SortConfig::default();
        assert_eq!(
            compare_cell_values(&CellValue::Null, &CellValue::Null, &config),
            Ordering::Equal
        );
    }

    // ===================================================================
    // Test 2: compare_cell_values — null vs non-null, nulls_first=true
    // ===================================================================

    #[test]
    fn test_compare_null_vs_value_nulls_first() {
        let config = SortConfig {
            nulls_first: true,
            ..Default::default()
        };
        assert_eq!(
            compare_cell_values(
                &CellValue::Null,
                &CellValue::Number(FiniteF64::must(1.0)),
                &config
            ),
            Ordering::Less
        );
        assert_eq!(
            compare_cell_values(
                &CellValue::Number(FiniteF64::must(1.0)),
                &CellValue::Null,
                &config
            ),
            Ordering::Greater
        );
    }

    // ===================================================================
    // Test 3: compare_cell_values — null vs non-null, nulls_first=false
    // ===================================================================

    #[test]
    fn test_compare_null_vs_value_nulls_last() {
        let config = SortConfig {
            nulls_first: false,
            ..Default::default()
        };
        assert_eq!(
            compare_cell_values(
                &CellValue::Null,
                &CellValue::Number(FiniteF64::must(1.0)),
                &config
            ),
            Ordering::Greater
        );
    }

    // ===================================================================
    // Test 4: compare_cell_values — different types
    // ===================================================================

    #[test]
    fn test_compare_different_types() {
        let config = SortConfig::default();
        // error < bool
        assert_eq!(
            compare_cell_values(
                &CellValue::Error(CellError::Na, None),
                &CellValue::Boolean(true),
                &config
            ),
            Ordering::Less
        );
        // bool < number
        assert_eq!(
            compare_cell_values(
                &CellValue::Boolean(false),
                &CellValue::Number(FiniteF64::must(1.0)),
                &config
            ),
            Ordering::Less
        );
        // number < string
        assert_eq!(
            compare_cell_values(
                &CellValue::Number(FiniteF64::must(999.0)),
                &CellValue::Text("abc".into()),
                &config
            ),
            Ordering::Less
        );
    }

    // ===================================================================
    // Test 5: compare_cell_values — same type, numbers
    // ===================================================================

    #[test]
    fn test_compare_numbers() {
        let config = SortConfig::default();
        assert_eq!(
            compare_cell_values(
                &CellValue::Number(FiniteF64::must(1.0)),
                &CellValue::Number(FiniteF64::must(2.0)),
                &config
            ),
            Ordering::Less
        );
        assert_eq!(
            compare_cell_values(
                &CellValue::Number(FiniteF64::must(2.0)),
                &CellValue::Number(FiniteF64::must(2.0)),
                &config
            ),
            Ordering::Equal
        );
        assert_eq!(
            compare_cell_values(
                &CellValue::Number(FiniteF64::must(3.0)),
                &CellValue::Number(FiniteF64::must(2.0)),
                &config
            ),
            Ordering::Greater
        );
    }

    // ===================================================================
    // Test 6: compare_cell_values — same type, booleans
    // ===================================================================

    #[test]
    fn test_compare_booleans() {
        let config = SortConfig::default();
        assert_eq!(
            compare_cell_values(
                &CellValue::Boolean(false),
                &CellValue::Boolean(true),
                &config
            ),
            Ordering::Less
        );
        assert_eq!(
            compare_cell_values(
                &CellValue::Boolean(true),
                &CellValue::Boolean(true),
                &config
            ),
            Ordering::Equal
        );
    }

    // ===================================================================
    // Test 7: compare_cell_values — same type, strings
    // ===================================================================

    #[test]
    fn test_compare_strings_natural() {
        let config = SortConfig::default();
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("abc".into()),
                &CellValue::Text("def".into()),
                &config
            ),
            Ordering::Less
        );
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("abc".into()),
                &CellValue::Text("ABC".into()),
                &config
            ),
            Ordering::Equal
        );
    }

    // ===================================================================
    // Test 8: compare_cell_values — descending reverses
    // ===================================================================

    #[test]
    fn test_compare_descending() {
        let config = SortConfig {
            order: Some(SortOrder::Desc),
            ..Default::default()
        };
        assert_eq!(
            compare_cell_values(
                &CellValue::Number(FiniteF64::must(1.0)),
                &CellValue::Number(FiniteF64::must(2.0)),
                &config
            ),
            Ordering::Greater
        );
    }

    // ===================================================================
    // Test 9: compare_cell_values — order=none returns Equal
    // ===================================================================

    #[test]
    fn test_compare_order_none() {
        let config = SortConfig {
            order: None,
            ..Default::default()
        };
        assert_eq!(
            compare_cell_values(
                &CellValue::Number(FiniteF64::must(1.0)),
                &CellValue::Number(FiniteF64::must(2.0)),
                &config
            ),
            Ordering::Equal
        );
    }

    // ===================================================================
    // Test 10: compare_cell_values — errors compared by string
    // ===================================================================

    #[test]
    fn test_compare_errors() {
        let config = SortConfig::default();
        let result = compare_cell_values(
            &CellValue::Error(CellError::Div0, None),
            &CellValue::Error(CellError::Na, None),
            &config,
        );
        // "#DIV/0!" < "#N/A" lexicographically
        assert_eq!(result, Ordering::Less);
    }

    // ===================================================================
    // Test 11: natural_compare — mixed numeric/alpha
    // ===================================================================

    #[test]
    fn test_natural_compare_basic() {
        assert_eq!(natural_compare("Item 2", "Item 10", false), Ordering::Less);
        assert_eq!(
            natural_compare("Item 10", "Item 10", false),
            Ordering::Equal
        );
        assert_eq!(
            natural_compare("Item 20", "Item 10", false),
            Ordering::Greater
        );
    }

    // ===================================================================
    // Test 12: natural_compare — case sensitivity
    // ===================================================================

    #[test]
    fn test_natural_compare_case_sensitive() {
        // Case insensitive: "abc" == "ABC"
        assert_eq!(natural_compare("abc", "ABC", false), Ordering::Equal);
        // Case sensitive: 'A'(65) < 'a'(97)
        assert_eq!(natural_compare("ABC", "abc", true), Ordering::Less);
    }

    // ===================================================================
    // Test 13: natural_compare — pure numeric
    // ===================================================================

    #[test]
    fn test_natural_compare_pure_numeric() {
        assert_eq!(natural_compare("2", "10", false), Ordering::Less);
        assert_eq!(natural_compare("100", "20", false), Ordering::Greater);
    }

    // ===================================================================
    // Test 14: get_type_priority — all types
    // ===================================================================

    #[test]
    fn test_get_type_priority() {
        assert_eq!(get_type_priority(&CellValue::Null), 0);
        assert_eq!(get_type_priority(&CellValue::Error(CellError::Na, None)), 1);
        assert_eq!(get_type_priority(&CellValue::Boolean(false)), 2);
        assert_eq!(
            get_type_priority(&CellValue::Number(FiniteF64::must(0.0))),
            3
        );
        assert_eq!(get_type_priority(&CellValue::Text("x".into())), 4);
    }

    // ===================================================================
    // Test 15: compute_sorted_row_order — single criterion, ascending
    // ===================================================================

    #[test]
    fn test_compute_sorted_row_order_single_asc() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        let c1 = make_cell_id(101);
        let c2 = make_cell_id(102);
        let c3 = make_cell_id(103);

        // Row 0: value 30
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c1,
            0,
            0,
            &CellValue::Number(FiniteF64::must(30.0)),
        );
        // Row 1: value 10
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c2,
            1,
            0,
            &CellValue::Number(FiniteF64::must(10.0)),
        );
        // Row 2: value 20
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c3,
            2,
            0,
            &CellValue::Number(FiniteF64::must(20.0)),
        );

        let range = CellRange::new(0, 0, 2, 0);

        let options = SortOptions {
            criteria: vec![SortCriterion {
                header_cell_id: c1, // column 0
                direction: Some(SortOrder::Asc),
                case_sensitive: false,
                mode: SortMode::Value { custom_list: None },
            }],
            has_headers: false,
        };

        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |_r, _c| CellFormat::default(),
        );
        // Sorted: 10(row1), 20(row2), 30(row0)
        assert_eq!(result.sorted_indices, vec![1, 2, 0]);
        assert_eq!(result.rows_moved, 3); // all three rows moved
        assert!(!result.has_unresolved_criteria);
    }

    #[test]
    fn test_compute_sorted_row_order_blanks_last_ascending() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        let c1 = make_cell_id(1201);
        let c2 = make_cell_id(1202);
        let c3 = make_cell_id(1203);
        let c4 = make_cell_id(1204);
        let c5 = make_cell_id(1205);

        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c1,
            0,
            0,
            &CellValue::Number(FiniteF64::must(3.0)),
        );
        grid.register_cell(c2, 1, 0);
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c3,
            2,
            0,
            &CellValue::Number(FiniteF64::must(1.0)),
        );
        grid.register_cell(c4, 3, 0);
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c5,
            4,
            0,
            &CellValue::Number(FiniteF64::must(2.0)),
        );

        let range = CellRange::new(0, 0, 4, 0);
        let options = SortOptions {
            criteria: vec![SortCriterion {
                header_cell_id: c1,
                direction: Some(SortOrder::Asc),
                case_sensitive: false,
                mode: SortMode::Value { custom_list: None },
            }],
            has_headers: false,
        };

        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |_r, _c| CellFormat::default(),
        );

        assert_eq!(result.sorted_indices, vec![2, 4, 0, 1, 3]);
    }

    // ===================================================================
    // Test 16: compute_sorted_row_order — descending
    // ===================================================================

    #[test]
    fn test_compute_sorted_row_order_desc() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        let c1 = make_cell_id(201);
        let c2 = make_cell_id(202);
        let c3 = make_cell_id(203);

        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c1,
            0,
            0,
            &CellValue::Number(FiniteF64::must(10.0)),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c2,
            1,
            0,
            &CellValue::Number(FiniteF64::must(30.0)),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c3,
            2,
            0,
            &CellValue::Number(FiniteF64::must(20.0)),
        );

        let range = CellRange::new(0, 0, 2, 0);

        let options = SortOptions {
            criteria: vec![SortCriterion {
                header_cell_id: c1,
                direction: Some(SortOrder::Desc),
                case_sensitive: false,
                mode: SortMode::Value { custom_list: None },
            }],
            has_headers: false,
        };

        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |_r, _c| CellFormat::default(),
        );
        // Sorted desc: 30(row1), 20(row2), 10(row0)
        assert_eq!(result.sorted_indices, vec![1, 2, 0]);
    }

    // ===================================================================
    // Test 17: compute_sorted_row_order — with headers
    // ===================================================================

    #[test]
    fn test_compute_sorted_row_order_with_headers() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        let c_header = make_cell_id(300);
        let c1 = make_cell_id(301);
        let c2 = make_cell_id(302);
        let c3 = make_cell_id(303);

        // Row 0: header "Name"
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c_header,
            0,
            0,
            &CellValue::Text("Name".into()),
        );
        // Row 1: value 30
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c1,
            1,
            0,
            &CellValue::Number(FiniteF64::must(30.0)),
        );
        // Row 2: value 10
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c2,
            2,
            0,
            &CellValue::Number(FiniteF64::must(10.0)),
        );
        // Row 3: value 20
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c3,
            3,
            0,
            &CellValue::Number(FiniteF64::must(20.0)),
        );

        let range = CellRange::new(0, 0, 3, 0);

        let options = SortOptions {
            criteria: vec![SortCriterion {
                header_cell_id: c_header,
                direction: Some(SortOrder::Asc),
                case_sensitive: false,
                mode: SortMode::Value { custom_list: None },
            }],
            has_headers: true,
        };

        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |_r, _c| CellFormat::default(),
        );
        // Data rows: 1(30), 2(10), 3(20) -> sorted: 2(10), 3(20), 1(30)
        assert_eq!(result.sorted_indices, vec![2, 3, 1]);
        assert_eq!(result.rows_moved, 3); // all three data rows moved
    }

    // ===================================================================
    // Test 18: compute_sorted_row_order — multi-criteria
    // ===================================================================

    #[test]
    fn test_compute_sorted_row_order_multi_criteria() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        // Two columns: col 0 (category), col 1 (value)
        let c_a0 = make_cell_id(401);
        let c_a1 = make_cell_id(402);
        let c_a2 = make_cell_id(403);
        let c_b0 = make_cell_id(411);
        let c_b1 = make_cell_id(412);
        let c_b2 = make_cell_id(413);

        // Row 0: "B", 20
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c_a0,
            0,
            0,
            &CellValue::Text("B".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c_b0,
            0,
            1,
            &CellValue::Number(FiniteF64::must(20.0)),
        );
        // Row 1: "A", 30
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c_a1,
            1,
            0,
            &CellValue::Text("A".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c_b1,
            1,
            1,
            &CellValue::Number(FiniteF64::must(30.0)),
        );
        // Row 2: "A", 10
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c_a2,
            2,
            0,
            &CellValue::Text("A".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c_b2,
            2,
            1,
            &CellValue::Number(FiniteF64::must(10.0)),
        );

        let range = CellRange::new(0, 0, 2, 1);

        let options = SortOptions {
            criteria: vec![
                SortCriterion {
                    header_cell_id: c_a0, // sort by col 0 asc first
                    direction: Some(SortOrder::Asc),
                    case_sensitive: false,
                    mode: SortMode::Value { custom_list: None },
                },
                SortCriterion {
                    header_cell_id: c_b0, // then by col 1 asc
                    direction: Some(SortOrder::Asc),
                    case_sensitive: false,
                    mode: SortMode::Value { custom_list: None },
                },
            ],
            has_headers: false,
        };

        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |_r, _c| CellFormat::default(),
        );
        // Sorted: A,10 (row2) -> A,30 (row1) -> B,20 (row0)
        assert_eq!(result.sorted_indices, vec![2, 1, 0]);
    }

    // ===================================================================
    // Test 19: compute_sorted_row_order — unresolved criteria
    // ===================================================================

    #[test]
    fn test_compute_sorted_row_order_unresolved() {
        let (storage, sheet_id, grid) = storage_with_sheet();

        let range = CellRange::new(0, 0, 2, 0);

        // Use a CellId that doesn't exist in the grid
        let nonexistent = make_cell_id(999999);
        let options = SortOptions {
            criteria: vec![SortCriterion {
                header_cell_id: nonexistent,
                direction: Some(SortOrder::Asc),
                case_sensitive: false,
                mode: SortMode::Value { custom_list: None },
            }],
            has_headers: false,
        };

        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |_r, _c| CellFormat::default(),
        );
        assert!(result.has_unresolved_criteria);
        assert_eq!(result.sorted_indices.len(), 0);
        assert_eq!(result.rows_moved, 0);
    }

    // ===================================================================
    // Test 20: sort_range — end-to-end
    // ===================================================================

    #[test]
    fn test_sort_range_end_to_end() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        let c1 = make_cell_id(501);
        let c2 = make_cell_id(502);
        let c3 = make_cell_id(503);

        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c1,
            0,
            0,
            &CellValue::Number(FiniteF64::must(30.0)),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c2,
            1,
            0,
            &CellValue::Number(FiniteF64::must(10.0)),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c3,
            2,
            0,
            &CellValue::Number(FiniteF64::must(20.0)),
        );

        let range = CellRange::new(0, 0, 2, 0);

        let options = SortOptions {
            criteria: vec![SortCriterion {
                header_cell_id: c1,
                direction: Some(SortOrder::Asc),
                case_sensitive: false,
                mode: SortMode::Value { custom_list: None },
            }],
            has_headers: false,
        };

        // Compute + apply permutation via GridIndex (production caller is
        // responsible for calling grid.sort_rows with the equivalent mapping).
        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |_r, _c| CellFormat::default(),
        );
        assert!(result.rows_moved > 0);

        let data_start = range.start_row();
        let permutation: Vec<(u32, u32)> = result
            .sorted_indices
            .iter()
            .enumerate()
            .filter_map(|(new_offset, &original_row)| {
                let new_row = data_start + new_offset as u32;
                if original_row != new_row {
                    Some((original_row, new_row))
                } else {
                    None
                }
            })
            .collect();
        grid.sort_rows(&permutation);

        // Also call sort_range to cover the whole code path (no yrs
        // mutations, but verifies the function signature + return value).
        let moved = sort_range(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |_r, _c| CellFormat::default(),
        );
        // After grid.sort_rows above the values are already in order, so
        // sort_range observes no further movement.
        assert_eq!(moved, 0);

        // After the identity-level sort: c2 (10) at row 0, c3 (20) at row 1,
        // c1 (30) at row 2.
        let pos_c1 = read_cell_position(&grid, c1);
        let pos_c2 = read_cell_position(&grid, c2);
        let pos_c3 = read_cell_position(&grid, c3);

        assert_eq!(pos_c2, Some((0, 0)), "c2 (10) should be at row 0");
        assert_eq!(pos_c3, Some((1, 0)), "c3 (20) should be at row 1");
        assert_eq!(pos_c1, Some((2, 0)), "c1 (30) should be at row 2");
    }

    // ===================================================================
    // Test 21: sort preserves CellIds (identity preservation)
    // ===================================================================

    #[test]
    fn test_sort_preserves_cell_ids() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        let c1 = make_cell_id(601);
        let c2 = make_cell_id(602);

        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c1,
            0,
            0,
            &CellValue::Number(FiniteF64::must(20.0)),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c2,
            1,
            0,
            &CellValue::Number(FiniteF64::must(10.0)),
        );

        let range = CellRange::new(0, 0, 1, 0);

        let options = SortOptions {
            criteria: vec![SortCriterion {
                header_cell_id: c1,
                direction: Some(SortOrder::Asc),
                case_sensitive: false,
                mode: SortMode::Value { custom_list: None },
            }],
            has_headers: false,
        };

        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |_r, _c| CellFormat::default(),
        );

        let data_start = range.start_row();
        let permutation: Vec<(u32, u32)> = result
            .sorted_indices
            .iter()
            .enumerate()
            .filter_map(|(new_offset, &original_row)| {
                let new_row = data_start + new_offset as u32;
                if original_row != new_row {
                    Some((original_row, new_row))
                } else {
                    None
                }
            })
            .collect();
        grid.sort_rows(&permutation);

        // c2 (value 10) should now be at row 0, c1 (value 20) at row 1,
        // but each keeps its CellId.
        let pos_c1 = read_cell_position(&grid, c1).unwrap();
        let pos_c2 = read_cell_position(&grid, c2).unwrap();

        assert_eq!(pos_c1, (1, 0), "c1 moved to row 1 but keeps its CellId");
        assert_eq!(pos_c2, (0, 0), "c2 moved to row 0 but keeps its CellId");

        // Identity authority: GridIndex should agree on the reverse lookup.
        assert_eq!(grid.cell_id_at(0, 0), Some(c2));
        assert_eq!(grid.cell_id_at(1, 0), Some(c1));
    }

    // ===================================================================
    // Test 22: sort_range — no movement returns 0
    // ===================================================================

    #[test]
    fn test_sort_range_already_sorted() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        let c1 = make_cell_id(701);
        let c2 = make_cell_id(702);
        let c3 = make_cell_id(703);

        // Already sorted ascending
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c1,
            0,
            0,
            &CellValue::Number(FiniteF64::must(10.0)),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c2,
            1,
            0,
            &CellValue::Number(FiniteF64::must(20.0)),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c3,
            2,
            0,
            &CellValue::Number(FiniteF64::must(30.0)),
        );

        let range = CellRange::new(0, 0, 2, 0);

        let options = SortOptions {
            criteria: vec![SortCriterion {
                header_cell_id: c1,
                direction: Some(SortOrder::Asc),
                case_sensitive: false,
                mode: SortMode::Value { custom_list: None },
            }],
            has_headers: false,
        };

        let moved = sort_range(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |_r, _c| CellFormat::default(),
        );
        assert_eq!(moved, 0);
    }

    // ===================================================================
    // Test 23: sort_by_column — convenience API
    // ===================================================================

    #[test]
    fn test_sort_by_column() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        let c1 = make_cell_id(801);
        let c2 = make_cell_id(802);
        let c3 = make_cell_id(803);

        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c1,
            0,
            0,
            &CellValue::Number(FiniteF64::must(30.0)),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c2,
            1,
            0,
            &CellValue::Number(FiniteF64::must(10.0)),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c3,
            2,
            0,
            &CellValue::Number(FiniteF64::must(20.0)),
        );

        let range = CellRange::new(0, 0, 2, 0);

        let moved = sort_by_column(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            0,
            Some(SortOrder::Asc),
            false,
            &grid,
        );
        assert!(moved > 0);

        // Apply permutation to the grid to verify end-to-end identity update.
        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &SortOptions {
                criteria: vec![SortCriterion {
                    header_cell_id: c1,
                    direction: Some(SortOrder::Asc),
                    case_sensitive: false,
                    mode: SortMode::Value { custom_list: None },
                }],
                has_headers: false,
            },
            &grid,
            |_r, _c| CellFormat::default(),
        );
        let data_start = range.start_row();
        let permutation: Vec<(u32, u32)> = result
            .sorted_indices
            .iter()
            .enumerate()
            .filter_map(|(new_offset, &original_row)| {
                let new_row = data_start + new_offset as u32;
                if original_row != new_row {
                    Some((original_row, new_row))
                } else {
                    None
                }
            })
            .collect();
        grid.sort_rows(&permutation);

        // Verify sorted order
        let pos_c2 = read_cell_position(&grid, c2).unwrap();
        assert_eq!(pos_c2, (0, 0), "c2 (10) should be at row 0 after sort");
    }

    // ===================================================================
    // Test 24: sort_by_column — empty column returns 0
    // ===================================================================

    #[test]
    fn test_sort_by_column_empty_column() {
        let (storage, sheet_id, grid) = storage_with_sheet();

        let range = CellRange::new(0, 0, 2, 0);

        let moved = sort_by_column(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            5,
            Some(SortOrder::Asc),
            false,
            &grid,
        );
        assert_eq!(moved, 0);
    }

    // ===================================================================
    // Test 25: check_sort_range_merges — no merges
    // ===================================================================

    #[test]
    fn test_check_sort_range_merges_no_merges() {
        let (storage, sheet_id, grid) = storage_with_sheet();
        let range = CellRange::new(0, 0, 5, 5);
        let (has_merges, msg) = check_sort_range_merges(&storage, sheet_id, &grid, &range);
        assert!(!has_merges);
        assert!(msg.is_none());
    }

    // ===================================================================
    // Test 26: check_sort_range_merges — with merges
    // ===================================================================

    #[test]
    fn test_check_sort_range_merges_with_merges() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        // Create a merge inside the sort range
        crate::storage::sheet::merges::merge_range(
            storage.doc(),
            storage.sheets(),
            sheet_id,
            &mut grid,
            1,
            1,
            2,
            2,
        )
        .expect("merge should succeed");

        let range = CellRange::new(0, 0, 5, 5);
        let (has_merges, msg) = check_sort_range_merges(&storage, sheet_id, &grid, &range);
        assert!(has_merges);
        assert!(msg.is_some());
        assert!(msg.unwrap().contains("merged cells"));
    }

    // ===================================================================
    // Test 27: sort with mixed value types
    // ===================================================================

    #[test]
    fn test_sort_mixed_types() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        let c1 = make_cell_id(901);
        let c2 = make_cell_id(902);
        let c3 = make_cell_id(903);
        let c4 = make_cell_id(904);

        // Row 0: "Hello"
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c1,
            0,
            0,
            &CellValue::Text("Hello".into()),
        );
        // Row 1: 42
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c2,
            1,
            0,
            &CellValue::Number(FiniteF64::must(42.0)),
        );
        // Row 2: null
        place_cell(&storage, &mut grid, sheet_id, c3, 2, 0, &CellValue::Null);
        // Row 3: true
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c4,
            3,
            0,
            &CellValue::Boolean(true),
        );

        let range = CellRange::new(0, 0, 3, 0);

        let options = SortOptions {
            criteria: vec![SortCriterion {
                header_cell_id: c1,
                direction: Some(SortOrder::Asc),
                case_sensitive: false,
                mode: SortMode::Value { custom_list: None },
            }],
            has_headers: false,
        };

        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |_r, _c| CellFormat::default(),
        );
        // Production range sort keeps blanks last, then applies type priority:
        // bool(row3) < number(row1) < string(row0) < null(row2).
        assert_eq!(result.sorted_indices, vec![3, 1, 0, 2]);
    }

    // ===================================================================
    // Test 28: sort_by_column — descending
    // ===================================================================

    #[test]
    fn test_sort_by_column_descending() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        let c1 = make_cell_id(1001);
        let c2 = make_cell_id(1002);
        let c3 = make_cell_id(1003);

        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c1,
            0,
            0,
            &CellValue::Number(FiniteF64::must(10.0)),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c2,
            1,
            0,
            &CellValue::Number(FiniteF64::must(30.0)),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c3,
            2,
            0,
            &CellValue::Number(FiniteF64::must(20.0)),
        );

        let range = CellRange::new(0, 0, 2, 0);

        let moved = sort_by_column(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            0,
            Some(SortOrder::Desc),
            false,
            &grid,
        );
        assert!(moved > 0);

        // Apply the permutation produced by compute to the grid.
        let options = SortOptions {
            criteria: vec![SortCriterion {
                header_cell_id: c1,
                direction: Some(SortOrder::Desc),
                case_sensitive: false,
                mode: SortMode::Value { custom_list: None },
            }],
            has_headers: false,
        };
        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |_r, _c| CellFormat::default(),
        );
        let data_start = range.start_row();
        let permutation: Vec<(u32, u32)> = result
            .sorted_indices
            .iter()
            .enumerate()
            .filter_map(|(new_offset, &original_row)| {
                let new_row = data_start + new_offset as u32;
                if original_row != new_row {
                    Some((original_row, new_row))
                } else {
                    None
                }
            })
            .collect();
        grid.sort_rows(&permutation);

        // After desc sort: 30 (c2) at row 0, 20 (c3) at row 1, 10 (c1) at row 2
        let pos_c2 = read_cell_position(&grid, c2).unwrap();
        let pos_c3 = read_cell_position(&grid, c3).unwrap();
        let pos_c1 = read_cell_position(&grid, c1).unwrap();

        assert_eq!(pos_c2, (0, 0));
        assert_eq!(pos_c3, (1, 0));
        assert_eq!(pos_c1, (2, 0));
    }

    // ===================================================================
    // Test 29: natural_compare — strings with no numbers
    // ===================================================================

    #[test]
    fn test_natural_compare_no_numbers() {
        assert_eq!(natural_compare("apple", "banana", false), Ordering::Less);
        assert_eq!(natural_compare("banana", "apple", false), Ordering::Greater);
        assert_eq!(natural_compare("apple", "apple", false), Ordering::Equal);
    }

    // ===================================================================
    // Test 30: sort with strings and natural sort
    // ===================================================================

    #[test]
    fn test_sort_strings_natural() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        let c1 = make_cell_id(1101);
        let c2 = make_cell_id(1102);
        let c3 = make_cell_id(1103);

        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c1,
            0,
            0,
            &CellValue::Text("Item 10".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c2,
            1,
            0,
            &CellValue::Text("Item 2".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c3,
            2,
            0,
            &CellValue::Text("Item 1".into()),
        );

        let range = CellRange::new(0, 0, 2, 0);

        let options = SortOptions {
            criteria: vec![SortCriterion {
                header_cell_id: c1,
                direction: Some(SortOrder::Asc),
                case_sensitive: false,
                mode: SortMode::Value { custom_list: None },
            }],
            has_headers: false,
        };

        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |_r, _c| CellFormat::default(),
        );
        // Natural sort: "Item 1" < "Item 2" < "Item 10"
        assert_eq!(result.sorted_indices, vec![2, 1, 0]);
    }

    // ===================================================================
    // Test 31: compare_cell_values — desc reverses type priority
    // ===================================================================

    #[test]
    fn test_compare_desc_reverses_type_priority() {
        let config = SortConfig {
            order: Some(SortOrder::Desc),
            ..Default::default()
        };
        // In desc mode, string should come before number (reversed priority)
        assert_eq!(
            compare_cell_values(
                &CellValue::Text("abc".into()),
                &CellValue::Number(FiniteF64::must(1.0)),
                &config,
            ),
            Ordering::Less
        );
    }

    // ===================================================================
    // Test 32: split_natural_chunks helper
    // ===================================================================

    #[test]
    fn test_split_natural_chunks() {
        let chunks = split_natural_chunks("Item 10 foo");
        assert_eq!(chunks, vec!["Item ", "10", " foo"]);

        let chunks2 = split_natural_chunks("abc");
        assert_eq!(chunks2, vec!["abc"]);

        let chunks3 = split_natural_chunks("123");
        assert_eq!(chunks3, vec!["123"]);

        let chunks4 = split_natural_chunks("");
        assert!(chunks4.is_empty());
    }

    // ===================================================================
    // Color and custom-list sort tests
    // ===================================================================

    /// Build a `CellFormat` with a single fill color set.
    fn fmt_fill(color: &str) -> CellFormat {
        CellFormat {
            background_color: Some(color.to_string()),
            ..Default::default()
        }
    }

    /// Build a `CellFormat` with a single font color set.
    fn fmt_font(color: &str) -> CellFormat {
        CellFormat {
            font_color: Some(color.to_string()),
            ..Default::default()
        }
    }

    // -------------------------------------------------------------------
    // Test 33: color-on-top with three matched rows preserves relative
    // order under stable sort.
    //
    // Layout:
    //   row 0: "alpha"  (yellow)
    //   row 1: "beta"   (white)
    //   row 2: "gamma"  (yellow)
    //   row 3: "delta"  (white)
    //   row 4: "epsilon" (yellow)
    //
    // Sort by cell color, target = yellow, position = Top, asc.
    // Expected order: row 0, row 2, row 4, row 1, row 3 (matched first
    // in original order, then non-matched in natural-value order).
    // -------------------------------------------------------------------
    #[test]
    fn test_sort_by_cell_color_top_preserves_order() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        let c0 = make_cell_id(2001);
        let c1 = make_cell_id(2002);
        let c2 = make_cell_id(2003);
        let c3 = make_cell_id(2004);
        let c4 = make_cell_id(2005);

        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c0,
            0,
            0,
            &CellValue::Text("alpha".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c1,
            1,
            0,
            &CellValue::Text("beta".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c2,
            2,
            0,
            &CellValue::Text("gamma".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c3,
            3,
            0,
            &CellValue::Text("delta".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c4,
            4,
            0,
            &CellValue::Text("epsilon".into()),
        );

        let range = CellRange::new(0, 0, 4, 0);
        let options = SortOptions {
            criteria: vec![SortCriterion {
                header_cell_id: c0,
                direction: Some(SortOrder::Asc),
                case_sensitive: false,
                mode: SortMode::CellColor {
                    target: "#FFFF00".into(),
                    position: ColorPosition::Top,
                },
            }],
            has_headers: false,
        };

        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |row, _col| match row {
                0 | 2 | 4 => fmt_fill("#FFFF00"),
                _ => fmt_fill("#FFFFFF"),
            },
        );
        // Matched rows first in original relative order: [0, 2, 4].
        // Non-matched in original relative order: [1, 3]. The single
        // color criterion returns Equal for color ties, so the stable
        // sort preserves original order within each bucket. (Excel
        // parity: Sort by Cell Color does not implicitly value-sort.)
        assert_eq!(result.sorted_indices, vec![0, 2, 4, 1, 3]);
    }

    // -------------------------------------------------------------------
    // Test 34: color-on-bottom inverts the bucket order — non-matched
    // rows precede matched rows.
    // -------------------------------------------------------------------
    #[test]
    fn test_sort_by_cell_color_bottom_inverts() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        let c0 = make_cell_id(2101);
        let c1 = make_cell_id(2102);
        let c2 = make_cell_id(2103);
        let c3 = make_cell_id(2104);
        let c4 = make_cell_id(2105);

        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c0,
            0,
            0,
            &CellValue::Text("alpha".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c1,
            1,
            0,
            &CellValue::Text("beta".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c2,
            2,
            0,
            &CellValue::Text("gamma".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c3,
            3,
            0,
            &CellValue::Text("delta".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c4,
            4,
            0,
            &CellValue::Text("epsilon".into()),
        );

        let range = CellRange::new(0, 0, 4, 0);
        let options = SortOptions {
            criteria: vec![SortCriterion {
                header_cell_id: c0,
                direction: Some(SortOrder::Asc),
                case_sensitive: false,
                mode: SortMode::CellColor {
                    target: "#FFFF00".into(),
                    position: ColorPosition::Bottom,
                },
            }],
            has_headers: false,
        };

        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |row, _col| match row {
                0 | 2 | 4 => fmt_fill("#FFFF00"),
                _ => fmt_fill("#FFFFFF"),
            },
        );
        // Non-matched first in original order [1, 3]; matched after in
        // original order [0, 2, 4]. Stable-sort tiebreak preserves
        // within-bucket order.
        assert_eq!(result.sorted_indices, vec![1, 3, 0, 2, 4]);
    }

    // -------------------------------------------------------------------
    // Test 35: custom-list sort with shuffled weekdays. Values present
    // in the list sort by list position; values not in the list fall to
    // the end (Excel parity).
    // -------------------------------------------------------------------
    #[test]
    fn test_sort_by_custom_list_weekdays() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();

        // Shuffled order: Wed, Mon, Fri, *Holiday* (off-list), Tue, Sun, Thu, Sat
        let inputs = ["Wed", "Mon", "Fri", "Holiday", "Tue", "Sun", "Thu", "Sat"];
        let mut ids = Vec::new();
        for (i, v) in inputs.iter().enumerate() {
            let id = make_cell_id(2200 + i as u128);
            place_cell(
                &storage,
                &mut grid,
                sheet_id,
                id,
                i as u32,
                0,
                &CellValue::Text((*v).into()),
            );
            ids.push(id);
        }

        let custom_list: Vec<CellValue> = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            .iter()
            .map(|s| CellValue::Text((*s).into()))
            .collect();

        let range = CellRange::new(0, 0, 7, 0);
        let options = SortOptions {
            criteria: vec![SortCriterion {
                header_cell_id: ids[0],
                direction: Some(SortOrder::Asc),
                case_sensitive: false,
                mode: SortMode::Value {
                    custom_list: Some(custom_list),
                },
            }],
            has_headers: false,
        };

        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |_r, _c| CellFormat::default(),
        );
        // Expected order by list position: Mon(1), Tue(4), Wed(0),
        // Thu(6), Fri(2), Sat(7), Sun(5), then off-list: Holiday(3).
        assert_eq!(result.sorted_indices, vec![1, 4, 0, 6, 2, 7, 5, 3]);
    }

    // -------------------------------------------------------------------
    // Test 36: multi-criterion sort — primary by cell color (yellow on
    // top), secondary by value ascending. Within each color bucket the
    // value comparator drives the order; ties on both keys preserve
    // original row order (stable sort).
    // -------------------------------------------------------------------
    #[test]
    fn test_sort_multi_criterion_color_then_value() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        // Two columns: column 0 is the color column (and also primary
        // header for resolution); column 1 is the value column.
        let c00 = make_cell_id(2301);
        let c01 = make_cell_id(2311);
        let c10 = make_cell_id(2302);
        let c11 = make_cell_id(2312);
        let c20 = make_cell_id(2303);
        let c21 = make_cell_id(2313);
        let c30 = make_cell_id(2304);
        let c31 = make_cell_id(2314);

        // Row 0: yellow / 30
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c00,
            0,
            0,
            &CellValue::Text("a".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c01,
            0,
            1,
            &CellValue::Number(FiniteF64::must(30.0)),
        );
        // Row 1: white / 10
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c10,
            1,
            0,
            &CellValue::Text("b".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c11,
            1,
            1,
            &CellValue::Number(FiniteF64::must(10.0)),
        );
        // Row 2: yellow / 20
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c20,
            2,
            0,
            &CellValue::Text("c".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c21,
            2,
            1,
            &CellValue::Number(FiniteF64::must(20.0)),
        );
        // Row 3: white / 5
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c30,
            3,
            0,
            &CellValue::Text("d".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c31,
            3,
            1,
            &CellValue::Number(FiniteF64::must(5.0)),
        );

        let range = CellRange::new(0, 0, 3, 1);
        let options = SortOptions {
            criteria: vec![
                SortCriterion {
                    header_cell_id: c00,
                    direction: Some(SortOrder::Asc),
                    case_sensitive: false,
                    mode: SortMode::CellColor {
                        target: "#FFFF00".into(),
                        position: ColorPosition::Top,
                    },
                },
                SortCriterion {
                    header_cell_id: c01,
                    direction: Some(SortOrder::Asc),
                    case_sensitive: false,
                    mode: SortMode::Value { custom_list: None },
                },
            ],
            has_headers: false,
        };

        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |row, col| {
                if col == 0 {
                    match row {
                        0 | 2 => fmt_fill("#FFFF00"),
                        _ => fmt_fill("#FFFFFF"),
                    }
                } else {
                    CellFormat::default()
                }
            },
        );
        // Yellow bucket: rows 0(30), 2(20) → ordered by value asc → [2, 0].
        // White bucket:  rows 1(10), 3(5)  → ordered by value asc → [3, 1].
        assert_eq!(result.sorted_indices, vec![2, 0, 3, 1]);
    }

    // -------------------------------------------------------------------
    // Test 37: font-color sort top inverts under desc — non-matched
    // first, then matched (the per-criterion direction reverses the
    // top/bottom verdict).
    // -------------------------------------------------------------------
    #[test]
    fn test_sort_by_font_color_top_desc_inverts() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        let c0 = make_cell_id(2401);
        let c1 = make_cell_id(2402);
        let c2 = make_cell_id(2403);

        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c0,
            0,
            0,
            &CellValue::Text("a".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c1,
            1,
            0,
            &CellValue::Text("b".into()),
        );
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            c2,
            2,
            0,
            &CellValue::Text("c".into()),
        );

        let range = CellRange::new(0, 0, 2, 0);
        let options = SortOptions {
            criteria: vec![SortCriterion {
                header_cell_id: c0,
                direction: Some(SortOrder::Desc),
                case_sensitive: false,
                mode: SortMode::FontColor {
                    target: "#FF0000".into(),
                    position: ColorPosition::Top,
                },
            }],
            has_headers: false,
        };

        let result = compute_sorted_row_order(
            storage.doc(),
            &storage.sheets_ref(),
            sheet_id,
            &range,
            &options,
            &grid,
            |row, _col| match row {
                1 => fmt_font("#FF0000"),
                _ => fmt_font("#000000"),
            },
        );
        // Top + Desc → matched goes after non-matched. Within-bucket
        // ties preserve original row order via the stable sort.
        // Non-matched in original order: [0, 2]. Matched: [1].
        assert_eq!(result.sorted_indices, vec![0, 2, 1]);
    }
}
