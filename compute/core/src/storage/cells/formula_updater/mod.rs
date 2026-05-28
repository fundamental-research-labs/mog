//! Formula updater for sheet and named-range renames.
//!
//! This module updates identity formula templates and persisted A1 formula
//! strings after sheet or named-range renames. The callable facade is kept
//! stable while rewrite logic, storage traversal, and operations live in
//! focused child modules.

mod named_range_rename;
mod named_refs;
mod sheet_refs;
mod sheet_rename;
mod storage_scan;

pub use named_range_rename::{
    update_formula_templates_on_named_range_rename, update_mirror_formulas_on_named_range_rename,
};
pub use sheet_rename::update_formula_templates_on_sheet_rename;

#[cfg(test)]
mod tests;
