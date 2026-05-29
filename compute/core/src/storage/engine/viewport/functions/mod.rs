//! Focused viewport service free functions.
//!
//! The child modules keep registry, formatting, patch, active-cell, and binary
//! render assembly paths separate while preserving the existing viewport facade.

mod active_cell;
mod cf_extras;
mod cf_format;
mod format_io;
mod materialized_cells;
mod patch_cells;
mod registry_ops;
mod render_cells;
mod render_data;

pub(crate) use cf_format::{apply_cf_to_format, apply_number_format_color, merge_cf_into_format};

pub(super) use active_cell::get_active_cell;
pub(super) use cf_format::build_cf_color_overrides;
pub(super) use format_io::{format_values, parse_date_input};
pub(super) use patch_cells::{build_comment_changed_cells, build_sparkline_changed_cells};
pub(super) use registry_ops::{
    get_registered_viewports, register_viewport, reset_sheet_viewports, reset_viewport_state,
    unregister_viewport, update_viewport_bounds, viewport_key_for_sheet,
};
pub(super) use render_data::build_viewport_render_data_inner;
