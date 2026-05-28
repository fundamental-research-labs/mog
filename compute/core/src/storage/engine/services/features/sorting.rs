use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::sorting;
use cell_types::SheetId;

pub(in crate::storage::engine) fn check_sort_range_merges(
    stores: &EngineStores,
    sheet_id: SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> serde_json::Value {
    let range = sorting::CellRange::new(start_row, start_col, end_row, end_col);
    let (has_merges, message) = match stores.grid_indexes.get(&sheet_id) {
        Some(grid) => sorting::check_sort_range_merges(&stores.storage, sheet_id, grid, &range),
        None => (false, None),
    };
    serde_json::json!({
        "hasMerges": has_merges,
        "message": message,
    })
}

// -------------------------------------------------------------------
// Cell Operations
