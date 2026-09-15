//! OOXML-specific cell parser optimized for worksheet structure.
//!
//! This module provides high-performance parsing of OOXML worksheet XML
//! with zero allocations in the hot path and direct output to shared buffers.
//!
//! Cell scanning and metadata extraction are shared by the unified worksheet stream.

// Internal submodules
mod adapters;
mod full_convert;
mod helpers;
mod parsing;
pub mod types;

#[cfg(test)]
pub(crate) mod tests;

// Re-export public types and constants
pub use types::{
    AuthoredStyleOnlyCell, CELL_TYPE_BOOL, CELL_TYPE_DATE, CELL_TYPE_EMPTY, CELL_TYPE_ERROR,
    CELL_TYPE_FORMULA, CELL_TYPE_FORMULA_STRING, CELL_TYPE_NUMBER, CELL_TYPE_STRING, CellData,
    ParseExtras, SharedFormulaInfo, VALUE_TYPE_CACHED_FORMULA, VALUE_TYPE_DECODED_STRING,
    VALUE_TYPE_FORMULA, VALUE_TYPE_INLINE, VALUE_TYPE_NONE, VALUE_TYPE_SHARED_STRING,
};

pub(crate) use full_convert::{
    apply_parse_extras, build_col_style_ranges_from_widths, coalesce_authored_style_only_cells,
    col_style_range_at, convert_cell_data, data_table_info,
};
#[cfg(test)]
pub(crate) use helpers::post_sheet_data_region;
pub(crate) use helpers::{
    find_closing_tag_span, find_start_tag, matches_tag, parse_row_number, scan_cell, start_tag_at,
};
pub(crate) use parsing::{
    CellExtrasInput, apply_fast_row_attrs, collect_cell_extras, collect_formula_extras,
};

// Re-export public helper functions
pub use helpers::{
    adjust_formula_references, col_to_letters, extract_cell_value_fast,
    extract_formula_extras_fused, extract_shared_formula_info, parse_a1_reference,
    parse_cell_ref_fast, parse_cell_type, parse_style_idx,
};
