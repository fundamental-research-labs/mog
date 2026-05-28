//! Raw-byte OOXML cell parser helpers.
//!
//! This facade preserves the historical `domain::cells::helpers` API while the
//! implementation is split by parser concern: A1 utilities, opening-tag cell
//! attributes, value extraction, worksheet navigation, shared-formula metadata,
//! formula extras, formula reference rewriting, generic byte/XML helpers, and
//! the fused cell scanner.

mod a1;
mod bytes;
mod cell_attrs;
mod formula_extras;
mod formula_refs;
mod scan;
mod shared_formula;
mod value;
mod worksheet_scan;

pub use a1::{col_to_letters, parse_a1_reference};
pub(crate) use bytes::{extract_attribute, parse_u32};
pub use cell_attrs::{parse_cell_ref_fast, parse_cell_type, parse_style_idx};
pub(crate) use formula_extras::FormulaExtras;
pub use formula_extras::extract_formula_extras_fused;
pub use formula_refs::adjust_formula_references;
pub(crate) use scan::{ScanResult, scan_cell};
pub use shared_formula::extract_shared_formula_info;
pub use value::extract_cell_value_fast;
pub(crate) use worksheet_scan::{CellEnd, find_cell_end, find_sheet_data, parse_row_number};
