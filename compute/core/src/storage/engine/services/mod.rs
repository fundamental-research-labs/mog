//! Service modules containing the extracted engine logic as free functions.
//!
//! Each service module groups related functionality and declares its
//! dependencies via function parameter types. Bridge methods on
//! `YrsComputeEngine` delegate to these functions.

use crate::mirror::CellMirror;
use cell_types::SheetId;
use domain_types::CellFormat;
use value_types::CellValue;

pub(super) mod advanced_filter;
pub(super) mod autofit;
pub(super) mod cell_editing;
pub(super) mod cf_cache;
pub(super) mod delegations;
pub(super) mod export;
pub(super) mod features;
pub(super) mod filter_results;
pub(super) mod filters;
pub(super) mod formatting;
pub(super) mod imported_filter_shell;
pub(super) mod imported_filters;
pub(super) mod metadata_shift;
pub(super) mod mutation;
pub(super) mod mutation_handlers;
pub(super) mod objects;
pub(super) mod queries;
pub(super) mod resolved_formats;
pub(super) mod structural;
pub(super) mod styles;
pub(super) mod tables;
pub(super) mod undo;

// ---------------------------------------------------------------------------
// Shared helpers used across multiple service modules
// ---------------------------------------------------------------------------

/// Parse a non-formula value from input text using rich parsing.
///
/// Delegates to `cell_values::parse_input_value` which handles dates,
/// currency symbols, percentages, thousands separators, and accounting
/// negatives — in addition to plain numbers and booleans. Used by the
/// outer `set_cell` layer after formula and apostrophe sentinels have
/// been dispatched.
pub(crate) fn parse_rich_value(input: &str) -> CellValue {
    parse_rich_value_with_target(input, None)
}

/// Format-aware variant of [`parse_rich_value`] used by mutation handlers
/// that have resolved the cell's effective format-category hint.
///
/// Bare numeric input into a percent-formatted cell
/// (G1) divides by 100; bare `"n/d"` into a fraction-formatted cell (G3)
/// parses as a number. When `target == None`, behaviour matches
/// [`parse_rich_value`] verbatim.
pub(crate) fn parse_rich_value_with_target(
    input: &str,
    target: Option<compute_formats::FormatType>,
) -> CellValue {
    parse_rich_value_with_context(
        input,
        &crate::storage::cells::values::InputParseContext::default_for_target(target),
    )
    .0
}

pub(crate) fn parse_rich_value_with_context(
    input: &str,
    context: &crate::storage::cells::values::InputParseContext,
) -> (
    CellValue,
    Option<crate::snapshot::AutomaticConversionCategory>,
) {
    use crate::storage::cells::values::{ParsedValue, parse_input_value_with_context};
    let parsed = parse_input_value_with_context(input, context);
    let value = match parsed.value {
        ParsedValue::Empty => CellValue::Null,
        ParsedValue::Number(n) => CellValue::number(n),
        ParsedValue::Boolean(b) => CellValue::Boolean(b),
        ParsedValue::Error(e) => CellValue::Error(e, None),
        ParsedValue::Text(s) => CellValue::Text(s.into()),
    };
    (value, parsed.preserved_category)
}

pub(in crate::storage::engine) fn resolve_structured_format_at_cell(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellFormat> {
    let table_format = tables::resolve_table_format_at_cell(mirror, sheet_id, row, col);
    let pivot_format = objects::resolve_pivot_format_at_cell(mirror, sheet_id, row, col);

    match (table_format, pivot_format) {
        (Some(table_format), Some(pivot_format)) => Some(
            crate::storage::properties::merge_formats(&table_format, &pivot_format),
        ),
        (Some(table_format), None) => Some(table_format),
        (None, Some(pivot_format)) => Some(pivot_format),
        (None, None) => None,
    }
}
