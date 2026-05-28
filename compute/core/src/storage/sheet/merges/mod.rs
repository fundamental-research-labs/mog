//! Merged cell storage operations.
//!
//! `GridIndex` remains the identity authority for resolving merge cell IDs to
//! positions. Runtime writes use structured Yrs maps under `KEY_MERGES`, while
//! hydration can still read legacy JSON `StoredMerge` strings. Inline
//! `sr/sc/er/ec` bounds are preserved for grid-free read paths such as data
//! bounds and export ordering.

mod codec;
mod data_loss;
mod mutations;
mod queries;
mod resolve;
mod yrs_io;

#[cfg(test)]
mod tests;

pub use codec::{StoredMerge, stored_merge_to_yrs_prelim};
pub use data_loss::check_merge_data_loss;
pub use domain_types::domain::merge::*;
pub use mutations::{
    clear_all_merges, merge_across, merge_and_center, merge_range, unmerge_range,
    validate_and_clean_merges,
};
pub use queries::{
    get_all_merges, get_merge_for_cell, get_merges_in_range, get_merges_in_viewport,
    is_merge_origin, iter_merge_bounds,
};
