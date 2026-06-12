//! Sheet-level hyperlink storage facade.
//!
//! Hyperlinks are stored as cell metadata in per-sheet Yrs cell maps. The
//! implementation is split into focused modules for serialized keys, decoding,
//! read queries, and mutations. Existing callers should continue to use
//! `crate::storage::sheet::hyperlinks::*`.

mod codec;
mod keys;
mod mutations;
mod queries;

#[cfg(test)]
mod mutation_metadata_tests;
#[cfg(test)]
mod tests;

pub use mutations::{remove_hyperlink, set_hyperlink};
pub use queries::{get_all_hyperlinks, get_hyperlink, get_hyperlink_full};
