mod anchor_ranges;
mod color;
mod metadata;
pub(crate) use metadata::SheetMetadata;

pub(crate) mod annotations;
pub mod bindings;
pub mod cf_store;
pub(crate) mod comments;
mod copy_native;
pub mod crud;
pub(crate) mod dimensions;
pub mod filters;
pub(crate) mod floating_objects;
pub mod grouping;
pub(crate) mod hyperlinks;
pub(crate) mod merges;
pub(crate) mod order;
pub(crate) mod pivots;
pub mod print;
pub mod properties;
pub(crate) mod protection;
pub(crate) mod range_storage;
pub mod schemas;
pub mod settings;
pub(crate) mod sorting;
pub mod sparklines;
pub(crate) mod split_view;
pub(crate) mod structural;
pub(crate) mod view;
pub(crate) mod visibility;

#[cfg(test)]
pub(super) mod test_support;
