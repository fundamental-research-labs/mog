//! Structural operation service facade.
//!
//! Child modules own behavior domains; this module preserves the existing
//! callable service surface for engine bridge callers.

mod dimensions;
mod floating_bounds;
mod formula_writeback;
mod identity;
mod merges;
mod pre_delete_reanchor;
mod range_virtual_cells;
mod structure_change;

pub(in crate::storage::engine) use self::dimensions::{
    hide_columns, hide_rows, set_col_width, set_col_width_chars, set_col_widths,
    set_col_widths_chars, set_row_height, unhide_columns, unhide_rows,
};
pub(in crate::storage::engine) use self::floating_bounds::recompute_floating_object_bounds;
pub(in crate::storage::engine) use self::identity::{
    collect_relocate_values, get_or_create_cell_id, update_cell_position,
};
pub(in crate::storage::engine) use self::merges::{
    check_merge_data_loss, clear_all_merges, is_merge_origin, merge_across, merge_and_center,
    merge_range, unmerge_range, validate_and_clean_merges,
};
pub(in crate::storage::engine) use self::structure_change::{
    apply_structure_change, build_structure_change_result, merge_viewport_patches_into_recalc,
};
