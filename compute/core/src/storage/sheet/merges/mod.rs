//! Native merged rectangles anchored by stable CellIds.
mod data_loss;
mod mutations;
mod queries;
mod state;
#[cfg(test)]
mod tests;
pub use data_loss::check_merge_data_loss;
pub(crate) use mutations::reanchor_before_delete;
pub use mutations::{
    clear_all_merges, merge_across, merge_and_center, merge_range, unmerge_range,
    validate_and_clean_merges,
};
pub use queries::{
    get_all_merges, get_merge_for_cell, get_merges_in_range, is_merge_origin, iter_merge_bounds,
};
pub(crate) use state::StoredMerge;
