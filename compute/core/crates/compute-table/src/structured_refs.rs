//! Structured Reference parsing, resolution, adjustment, and formatting.
//!
//! Pure, stateless functions. No DOM, no Yjs, no React, no XState.
//! Ported from `table-engine/src/structured-refs.ts`.
//!
//! Supports Excel-style structured references:
//!   Table1[Column1]              — single column data
//!   Table1[@Column1]             — this row, single column
//!   Table1[#Headers]             — entire header row
//!   Table1[#Data]                — entire data area
//!   Table1[#Totals]              — entire totals row
//!   Table1[#All]                 — entire table
//!   Table1[#This Row]            — this row of data
//!   Table1[[#Headers],[Column1]] — header cell of Column1
//!   Table1[[#Totals],[Col1]:[Col3]] — totals row, columns 1-3
//!   Table1[[Col1]:[Col3]]        — data range across columns 1-3

// Re-export parsing functions for tests (accessible via `use super::*` in test modules)
#[cfg(test)]
use compute_parser::{
    find_outer_matching_bracket, is_valid_table_name, parse_bracket_content, parse_structured_ref,
    unescape_column_name,
};

// Re-export types needed by tests (accessible via `use super::*` in test modules)
#[cfg(test)]
pub(crate) use super::types::{
    SpecialItem, StructuredRef, StructuredRefSpecifier, Table, TableColumn, TableRange,
    TableStructureChange,
};

mod adjustment;
mod formatting;
mod resolution;

#[cfg(test)]
mod test_helpers;

#[cfg(test)]
mod tests;

pub use adjustment::*;
pub use formatting::*;
pub use resolution::*;

// ============================================================================
// Row bound helper
// ============================================================================

/// A resolved row range (start inclusive, end inclusive).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RowBound {
    pub(crate) start_row: u32,
    pub(crate) end_row: u32,
}

/// A resolved range from structured reference resolution.
///
/// Represents a rectangular region with row bounds and a set of absolute grid column indices.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedRange {
    pub start_row: u32,
    pub end_row: u32,
    pub columns: Vec<u32>,
}

/// Result of resolving a structured (table) reference.
/// Contains positional data only — no cell values.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedStructuredRef {
    pub sheet: cell_types::SheetId,
    pub ranges: Vec<ResolvedRange>,
}
