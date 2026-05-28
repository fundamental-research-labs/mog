//! Sheet-level floating object storage facade.
//!
//! Floating objects (shapes, images, connectors, textboxes, group shapes) are stored as
//! structured Y.Map entries in per-sheet Yrs maps. The implementation is split into
//! focused submodules for storage codec, CRUD, z-order, constructors, mutations,
//! connector lookup, and layout projection. Keep new implementation logic in those
//! submodules and preserve this file as the compatibility path for existing callers.
//!
//! Public callers should continue to use `crate::storage::sheet::floating_objects::*`.

mod bounds;
mod codec;
mod connectors;
mod constructors;
mod groups;
mod ids;
mod keys;
mod mutations;
mod objects;
mod sheet_map;
mod units;
mod z_order;

#[cfg(test)]
mod tests;

pub use bounds::compute_object_pixel_bounds;
pub use connectors::find_connectors_for_shape;
#[allow(unused_imports)]
pub use constructors::{
    create_chart_object, create_shape_from_config, get_chart_objects, get_charts_linked_to_table,
};
pub use groups::{
    create_floating_object_group, delete_floating_object_group, get_all_floating_object_groups,
    get_all_floating_object_groups_typed, get_floating_object_group,
    get_floating_object_group_typed, set_floating_object_group, update_floating_object_group,
};
#[allow(unused_imports)]
pub use mutations::{
    duplicate_floating_object_typed, flip_floating_object_typed, move_floating_object_typed,
    resize_floating_object_typed, rotate_floating_object_typed, update_shape_style,
    update_shape_style_typed,
};
pub use objects::{
    create_floating_object, delete_floating_object, get_all_floating_objects,
    get_all_floating_objects_typed, get_floating_object, get_floating_object_typed,
    set_floating_object, update_floating_object,
};
pub use z_order::{
    bring_floating_object_forward, bring_floating_object_to_front, get_all_in_z_order,
    get_floating_object_max_z_index, get_floating_object_min_z_index,
    get_floating_objects_in_z_order, get_max_z_index_all, get_min_z_index_all,
    send_floating_object_backward, send_floating_object_to_back,
};
