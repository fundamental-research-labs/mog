//! Sheet-level row/column grouping (outline) storage API.
//!
//! This facade preserves the historical `storage::sheet::grouping` API while
//! keeping Yrs storage, CRUD, query, rendering, auto-outline, and subtotal
//! behavior in focused submodules.

mod auto_outline;
mod collapse;
mod crud;
mod hierarchy;
mod ids;
mod outline;
mod queries;
mod render;
mod settings;
mod subtotals;
mod types;
mod yrs_io;

pub use auto_outline::auto_outline;
pub use collapse::{
    collapse_all, expand_all, set_group_collapsed, set_level_collapsed, toggle_group_collapsed,
};
pub use crud::{
    clear_all_grouping, clear_column_grouping, clear_row_grouping, group_columns, group_rows,
    ungroup_columns, ungroup_rows,
};
pub use hierarchy::{calculate_group_level, find_parent_group};
pub use outline::{
    get_column_outline_levels, get_row_outline_levels, is_column_visible_by_groups,
    is_row_visible_by_groups,
};
pub use queries::{
    get_affected_columns_by_group, get_affected_rows_by_group,
    get_columns_hidden_by_collapsed_groups, get_group, get_group_in_sheet, get_groups,
    get_max_outline_level, get_rows_hidden_by_collapsed_groups,
};
pub use render::{
    get_outline_gutter_dimensions, get_outline_level_buttons, get_outline_render_data,
    get_outline_symbols, should_render_outlines,
};
pub use settings::set_outline_settings;
pub use subtotals::{
    build_subtotal_formula, create_subtotals, find_group_boundaries, is_subtotal_row,
    remove_subtotals,
};
pub use types::{
    CellRange, GroupAxis, GroupBoundary, GroupDefinition, MAX_OUTLINE_LEVEL, OutlineLevel,
    OutlineLevelButton, OutlineRenderData, OutlineSettingsUpdate, OutlineSymbol,
    SheetGroupingConfig, SubtotalFunction, SubtotalOptions, SubtotalResult, SubtotalsCellAccessor,
    Viewport,
};
pub use yrs_io::get_sheet_grouping_config;
pub(crate) use yrs_io::{config_to_yrs_map, set_sheet_grouping_config};

#[cfg(test)]
mod tests;
