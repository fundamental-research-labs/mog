//! Formula updater for sheet and named-range renames.
//!
//! Rewrites authored formula text and native identity templates after renames.

mod named_range_rename;
mod named_refs;
mod sheet_refs;

pub use named_range_rename::update_store_formulas_on_named_range_rename;
pub(crate) use named_refs::formula_identifier_candidates;
pub(crate) use sheet_refs::{
    invalidate_sheet_references_in_a1_formula, replace_sheet_name_in_a1_formula,
};

#[cfg(test)]
mod tests;
