//! Named Ranges Storage Module (spreadsheet-model elimination)
//!
//! Provides CRUD operations for Excel-style named ranges (defined names) stored
//! in the Yrs CRDT document. Named ranges are workbook-scoped and stored in the
//! `namedRanges` Y.Map at the workbook level.
//!
//! This is the Rust equivalent of `spreadsheet-model/src/named-ranges.ts`, porting
//! all named range storage management from TypeScript to Rust.
//!
//! # Storage Layout
//!
//! ```text
//! workbook: Y.Map
//!   +-- namedRanges: Y.Map
//!       +-- "REVENUE" -> structured Y.Map DefinedName (workbook scope)
//!       +-- "SALES:sheetId123" -> structured Y.Map DefinedName (sheet scope)
//! ```
//!
//! Legacy documents that stored defined names as JSON strings are still read as
//! a fallback, but all writes use structured Y.Map entries.
//!
//! # Key Format
//!
//! - Workbook scope: uppercase name (e.g., "REVENUE")
//! - Sheet scope: "NAME:sheetId" (e.g., "SALES:abc123")
//!
//! # Note on IdentityFormula
//!
//! The `refers_to` field stores a plain string. IdentityFormula conversion
//! (toA1Display / toIdentityFormula) is deferred to the integration layer
//! because it requires the formula parser, which is a separate crate.

mod keys;
mod mutations;
mod queries;
#[cfg(test)]
mod tests;
mod validation;
mod yrs_codec;

pub use domain_types::domain::named_range::*;
pub use mutations::{
    create_named_range, import_named_ranges, remove_named_range_by_id, remove_named_range_by_name,
    remove_named_ranges_by_scope, update_named_range, upsert_named_range,
};
pub use queries::{
    get_all_named_ranges, get_named_range_by_id, get_named_range_by_name,
    get_named_ranges_by_scope, get_visible_named_ranges, named_range_count, named_range_exists,
    resolve_named_range,
};
pub use validation::validate_name;
