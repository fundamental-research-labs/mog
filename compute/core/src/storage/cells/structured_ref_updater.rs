//! Formula Structured Reference Updater
//!
//! Handles behavior-preserving structured reference formula rewrites and the
//! storage operations that apply them to Yrs formula cells.

mod ops;
mod range;
mod rewrite;
mod storage_scan;

pub use ops::{
    convert_structured_refs_to_a1, propagate_ref_error_for_column_delete,
    propagate_ref_error_for_table_delete, update_formulas_for_column_rename,
    update_formulas_for_table_rename,
};
pub use range::TableRangeInfo;
#[allow(unused_imports)]
pub use rewrite::{
    replace_column_name_in_formula, replace_column_ref_with_ref_error,
    replace_structured_refs_with_a1, replace_table_name_in_formula,
    replace_table_ref_with_ref_error, template_contains_column_ref, template_contains_table_ref,
};
