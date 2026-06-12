//! Row height, column width, and hidden rows/columns operations on Yrs storage.
//!
//! This facade preserves the historical `storage::sheet::dimensions` API while
//! keeping row dimensions, column dimensions, visibility ownership, and scan
//! behavior in focused submodules.
//!
//! ## Yrs Storage Layout
//!
//! Per-sheet maps:
//! ```text
//! sheets/{sheetId}/rowHeights: Y.Map<RowId, f64>        - custom row heights
//! sheets/{sheetId}/colWidths: Y.Map<ColId, f64>         - custom column widths
//! sheets/{sheetId}/manualHiddenRows: Y.Map<RowId, true> - user/manual row hides
//! sheets/{sheetId}/filterHiddenRows: Y.Map<FilterId, Y.Map<RowId, true>>
//! sheets/{sheetId}/hiddenRows: Y.Map<string, true>      - effective hidden cache
//! sheets/{sheetId}/hiddenCols: Y.Map<string, true>      - hidden col indices
//! ```

mod col_visibility;
mod cols;
mod row_visibility;
mod rows;
mod scans;
mod yrs_access;

#[cfg(test)]
mod tests;

pub use col_visibility::{get_hidden_columns, hide_columns, is_column_hidden, unhide_columns};
pub use cols::{
    DEFAULT_COL_WIDTH, get_col_width, get_col_width_explicit, get_col_width_stored,
    get_col_width_with_default, get_sheet_default_col_width, set_col_width,
};
pub use row_visibility::{
    clear_filter_hidden_rows, clear_filter_hidden_rows_in_txn, finalize_imported_hidden_row_cache,
    get_hidden_rows, get_row_visibility_ownership, hide_manual_rows, is_row_hidden,
    is_row_hidden_by_any_filter, is_row_hidden_by_filter, is_row_hidden_only_by_filter,
    is_row_manually_hidden, normalize_imported_filter_hidden_rows, set_filter_hidden_rows,
    unhide_manual_rows,
};
#[cfg(test)]
pub use row_visibility::{hide_rows, unhide_rows};
pub use rows::{
    DEFAULT_ROW_HEIGHT, get_row_height, get_row_height_explicit, get_row_height_stored,
    set_row_height,
};
pub use scans::{get_all_custom_col_widths, get_all_custom_row_heights, get_max_materialized_col};
