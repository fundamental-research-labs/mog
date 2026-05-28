//! Lower-level delegation service facade.
//!
//! These helpers are shared by storage-engine delegation wrappers and keep their
//! historical path as `services::delegations::*`. The bridge-facing delegation
//! API lives under `storage::engine::delegations`.

#![allow(dead_code)] // Kept until bridge-facing cleanup wires or removes unused helpers.

mod compute_reachthrough;
mod named_ranges;
mod print;
mod scenarios_bindings;
mod settings_protection;
mod sheet_lifecycle;
#[cfg(test)]
mod tests;
mod view_state;
mod what_if_sync;

pub(in crate::storage::engine) use compute_reachthrough::{
    eval_cf, remove_named_range, set_named_range, to_a1_display, to_identity_formula,
};
pub(in crate::storage::engine) use named_ranges::{
    remove_named_range_by_id, remove_named_ranges_by_scope,
};
pub(in crate::storage::engine) use print::{
    add_horizontal_page_break, add_vertical_page_break, clear_all_page_breaks, get_page_breaks,
    get_print_area, get_print_titles, remove_horizontal_page_break, remove_vertical_page_break,
    set_print_area, set_print_settings, set_print_titles,
};
pub(in crate::storage::engine) use scenarios_bindings::{
    create_binding, create_scenario, get_active_scenario_state, get_all_bindings,
    get_all_scenarios, get_binding, get_bindings_for_connection, remove_binding,
    remove_bindings_for_connection, remove_scenario, set_active_scenario, update_binding,
    update_refresh_metadata, update_scenario,
};
pub(in crate::storage::engine) use settings_protection::{
    get_sheet_settings, protect_sheet, set_sheet_setting, unprotect_sheet,
};
pub(in crate::storage::engine) use sheet_lifecycle::{
    get_sheet_visibility, move_sheet, reorder_sheets, set_sheet_hidden, set_sheet_visibility,
    set_tab_color,
};
pub(in crate::storage::engine) use view_state::{
    get_split_config, set_frozen_panes, set_scroll_position, set_split_config, set_view_option,
};
pub(in crate::storage::engine) use what_if_sync::{data_table, goal_seek, solve, sync_full_state};
