//! Sheet-level Conditional Formatting CRUD operations.
//!
//! Compatibility facade for sheet conditional-format storage. Implementation is
//! split by storage concern under `cf_store/` while preserving the original
//! `crate::storage::sheet::cf_store` API surface.

mod formats;
mod presets;
mod ranges;
mod rule_bodies;
mod rules;
mod yrs_io;

pub use crate::engine_types::cf::*;

pub use formats::{
    add_conditional_format, bump_priorities_for_sheet, clear_formats_for_sheet,
    delete_conditional_format, get_conditional_format, get_formats_for_cell, get_formats_for_sheet,
    has_cf_for_cell, reorder_conditional_formats, update_conditional_format,
};
pub use presets::{color_scale_presets, data_bar_presets, get_preset_by_id, icon_set_presets};
pub use ranges::update_cf_ranges;
pub use rule_bodies::{
    gc_orphan_cf_rule_body, list_cf_rule_body_keys, read_cf_rule_body, remove_cf_rule_body,
    store_cf_rule_body,
};
pub use rules::{add_cf_rule, delete_cf_rule, update_cf_rule};

pub(crate) use ranges::{
    cf_intersect_ranges, cf_is_valid_range, cf_range_contains, cf_ranges_overlap, cf_subtract_range,
};

#[cfg(test)]
mod formats_tests;
#[cfg(test)]
mod presets_tests;
#[cfg(test)]
mod ranges_tests;
#[cfg(test)]
mod rule_bodies_tests;
#[cfg(test)]
mod rules_tests;
#[cfg(test)]
mod test_support;
