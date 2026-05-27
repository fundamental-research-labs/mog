use cell_types::SheetId;
use compute_document::identity::GridIndex;

use crate::storage::YrsStorage;

use super::types::CellRange;

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
    let merges = crate::storage::sheet::merges::get_merges_in_range(
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
