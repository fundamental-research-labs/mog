//! OOXML-specific cell parser optimized for worksheet structure.
//!
//! This module provides high-performance parsing of OOXML worksheet XML
//! with zero allocations in the hot path and direct output to shared buffers.
//!
//! # Error Recovery
//!
//! The parser supports three modes of operation via `ParseContext`:
//! - **Strict**: Fail on first error
//! - **Lenient**: Skip problematic cells, continue parsing, collect errors
//! - **Permissive**: Maximum recovery, use defaults for invalid data
//!
//! Use `parse_worksheet_with_context` for error recovery support, or
//! `parse_worksheet_fast` for backward-compatible behavior.

// Internal submodules
mod adapters;
mod full_convert;
mod helpers;
mod parsing;
mod recovery;
pub mod types;

#[cfg(test)]
mod tests;

// Re-export public types and constants
pub use types::{
    AuthoredStyleOnlyCell, CELL_TYPE_BOOL, CELL_TYPE_DATE, CELL_TYPE_EMPTY, CELL_TYPE_ERROR,
    CELL_TYPE_FORMULA, CELL_TYPE_FORMULA_STRING, CELL_TYPE_NUMBER, CELL_TYPE_STRING, CellData,
    ParseExtras, SharedFormulaInfo, VALUE_TYPE_CACHED_FORMULA, VALUE_TYPE_FORMULA,
    VALUE_TYPE_INLINE, VALUE_TYPE_NONE, VALUE_TYPE_SHARED_STRING,
};

// Re-export public parsing functions
pub use parsing::{
    parse_worksheet_fast, parse_worksheet_fast_with_extras, parse_worksheet_with_context,
};

pub(crate) use full_convert::{
    apply_parse_extras, build_col_styles_from_widths, coalesce_authored_style_only_cells,
    convert_cell_data, data_table_info,
};

// Re-export public helper functions
pub use helpers::{
    adjust_formula_references, col_to_letters, extract_cell_value_fast,
    extract_formula_extras_fused, extract_shared_formula_info, parse_a1_reference,
    parse_cell_ref_fast, parse_cell_type, parse_style_idx,
};
