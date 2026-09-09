//! Native dimension metadata and independent visibility owners.

mod col_visibility;
mod cols;
pub(crate) use cols::get_col_width_by_id;
mod row_visibility;
mod rows;
mod scans;
mod state;
pub(crate) use state::{DimensionState, StoredAxisFormat};

#[cfg(test)]
mod tests;

pub use col_visibility::{get_hidden_columns, hide_columns, is_column_hidden, unhide_columns};
#[cfg(test)]
pub use cols::get_col_width_stored;
pub use cols::{DEFAULT_COL_WIDTH, get_col_width, get_col_width_explicit, set_col_width};
pub use row_visibility::{
    clear_filter_hidden_rows, get_hidden_rows, get_row_visibility_ownership, hide_manual_rows,
    is_row_hidden, is_row_hidden_by_any_filter, is_row_hidden_by_any_filter_id,
    normalize_imported_filter_hidden_rows, set_filter_hidden_rows, unhide_manual_rows,
};
#[cfg(test)]
pub use row_visibility::{is_row_hidden_by_filter, is_row_manually_hidden};
pub use rows::{
    DEFAULT_ROW_HEIGHT, get_row_height, get_row_height_explicit, get_row_height_stored,
    set_row_height,
};
pub use scans::{get_all_custom_col_widths, get_all_custom_row_heights, get_max_materialized_col};
