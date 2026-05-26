//! Excel Table parser for XLSX files (xl/tables/table*.xml).
//!
//! This module parses Excel Table definitions according to ECMA-376 Part 1,
//! specifically CT_Table and related complex types from the SpreadsheetML schema.
//!
//! # Overview
//!
//! Excel Tables (also known as "List Objects") are structured ranges of data with:
//! - A header row with column names
//! - Optional totals row with aggregate functions
//! - AutoFilter capabilities
//! - Structured references for formulas
//! - Styling via TableStyleInfo
//!
//! # File Location
//!
//! Table definitions are stored in `xl/tables/table{N}.xml` where N is the table ID.
//! Each table file is referenced from a worksheet's relationships file.
//!
//! # Usage
//!
//! ```ignore
//! use xlsx_parser::tables::Table;
//!
//! let xml = include_bytes!("../test_data/table1.xml");
//! let table = Table::parse(xml);
//! if let Some(t) = table {
//!     println!("Table: {} ({})", t.display_name, t.ref_range);
//!     for col in &t.columns {
//!         println!("  Column: {}", col.name);
//!     }
//! }
//! ```
//!
//! # Performance
//!
//! - Uses SIMD-optimized scanning functions from the scanner module
//! - Zero-copy parsing where possible using byte slices
//! - Graceful handling of malformed input
//!
//! # ECMA-376 References
//!
//! - CT_Table: Part 1, Section 18.5.1
//! - CT_AutoFilter: Part 1, Section 18.3.1.2
//! - CT_TableColumn: Part 1, Section 18.5.1.3
//! - CT_TableStyleInfo: Part 1, Section 18.5.1.5

pub mod read;

// Submodules
pub mod filter;
pub mod sort;
pub mod style;
pub mod types;
pub mod write;

#[cfg(test)]
mod tests;

// Re-export main types for convenience
pub use filter::{
    AutoFilter, ColorFilter, CustomFilter, CustomFilters, DynamicFilter, DynamicFilterType,
    FilterColumn, FilterOperator, Filters, IconFilter, Top10Filter,
};
pub use sort::{SortCondition, SortState};
pub use style::{TableStyleInfo, parse_table_style_info};
pub use types::{SortOrder, Table, TableColumn, TableFormula, TableType, TotalsRowFunction};
