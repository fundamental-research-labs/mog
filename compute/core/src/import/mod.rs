//! XLSX import pipeline: `ParseOutput` → `WorkbookSnapshot`.
//!
//! ## Pipeline
//!
//! `FullParseResult` → `full_parse_result_to_parse_output()` (xlsx-parser)
//! → `ParseOutput` → `parse_output_to_workbook_snapshot()` (this module)
//! → `WorkbookSnapshot` → `init_from_snapshot()` (compute engine)
//!
//! ## Sub-modules
//!
//! - [`parse_output_to_snapshot`]: Converts `ParseOutput` → `WorkbookSnapshot`.
//! - `phantom`: A1-style cell/range reference parsing utilities.
//!
//! ## History
//!
//! A sibling `sanitize` module hosted three byte-level shadow parsers
//! (`is_ref_error_only`, `is_broken_range_ref`, `is_broken_cell_ref`) that
//! panicked on non-ASCII inputs (UTF-8 boundary production incident). Typed formula boundary:
//! collapsed all three into [`compute_parser::ParsedExpr::classify`] which is
//! total over UTF-8, then deleted the module. Call sites now pattern-match
//! on typed `ParsedExpr` variants (`BrokenRef` / `Empty` / `Cell` / ...).

pub mod parse_output_to_snapshot;
pub mod phantom;
