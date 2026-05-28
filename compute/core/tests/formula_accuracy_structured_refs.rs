//! Integration tests for formula accuracy issue: structured table references.
//!
//! These tests exercise structured-reference formulas through workbook snapshot
//! hydration, the cell mirror, and `ComputeCore::init_from_snapshot`.

#[path = "formula_accuracy_structured_refs/conditional_aggregates.rs"]
mod conditional_aggregates;
#[path = "formula_accuracy_structured_refs/cross_sheet_and_errors.rs"]
mod cross_sheet_and_errors;
#[path = "formula_accuracy_structured_refs/support.rs"]
mod support;
#[path = "formula_accuracy_structured_refs/syntax_and_lookup.rs"]
mod syntax_and_lookup;
#[path = "formula_accuracy_structured_refs/this_row_basic.rs"]
mod this_row_basic;
#[path = "formula_accuracy_structured_refs/this_row_conditionals.rs"]
mod this_row_conditionals;
