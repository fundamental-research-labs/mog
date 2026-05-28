//! Structured Yrs read/write modules — one per domain.
//!
//! Each module defines:
//! - Key constants (field names in Y.Map)
//! - `to_yrs_prelim()` — write domain type to Y.Map entries for initial hydration
//! - `from_yrs_map()` — read domain type from Y.Map entries
//! - `update_field()` — update a single field on an existing Y.Map
//!
//! Follows the `cell_serde.rs` gold standard pattern from compute-core.

pub mod helpers;

// Tier 1: Flat Y.Map (every field is a native Yrs Any key)
pub mod cell_format;
pub mod cell_properties;
pub mod comment;
pub mod doc_properties;
pub mod file_sharing;
pub mod file_version;
pub mod frozen_panes;
pub mod hyperlink;
pub mod merge;
pub mod named_range;
pub mod page_breaks;
pub mod print;
pub mod protection;
pub mod sheet_properties;
pub mod sheet_view;
// outline module deleted — hydration now writes SheetGroupingConfig directly via storage layer
pub mod sparkline;
pub mod web_publishing;
pub mod workbook_properties;

// Tier 1b: Y.Map with JSON bridge for complex nested fields
pub mod column_schema;

// Tier 2: Y.Map with Y.Array for ordered sub-collections
pub mod conditional_format;
pub mod pivot_cache_records;
pub mod table;
pub mod validation;

// Tier 2½: Flat Y.Map sub-entries for filter sort state
pub mod filter_sort_state;

// Tier 3a: Edge-format JSON blobs inside a Y.Map (lossless OOXML round-trip)
pub mod auto_filter;
pub mod sort_state;

// Tier 3: Structured envelope + JSON definition blob
pub mod floating_object;
pub mod slicer;

#[cfg(test)]
mod tests;
