use cell_types::{CellId, SheetId};
use compute_document::identity::GridIndex;
use domain_types::CellFormat;
use domain_types::domain::filter::SortOrder;
use yrs::{Doc, MapRef};

use super::planner::compute_sorted_row_order;
use super::types::{CellRange, SortCriterion, SortMode, SortOptions};

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
