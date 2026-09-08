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

pub(in crate::storage::engine) use view_state::set_split_config;

#[cfg(test)]
pub(in crate::storage::engine) use print::{
    add_horizontal_page_break, add_vertical_page_break, clear_all_page_breaks,
    remove_horizontal_page_break, remove_vertical_page_break, set_print_area, set_print_settings,
    set_print_titles,
};
#[cfg(test)]
pub(in crate::storage::engine) use view_state::{set_frozen_panes, set_scroll_position};
