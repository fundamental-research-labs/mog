//! Excel Table writer for XLSX files (xl/tables/table*.xml).
//!
//! This module generates Excel Table definitions according to ECMA-376 Part 1,
//! specifically CT_Table and related complex types from the SpreadsheetML schema.

mod columns;
mod filters;
mod from_domain;
mod namespaces;
mod sort;
mod style;
mod writer;

pub use columns::TableColumn;
pub use filters::{AutoFilterDef, CustomFilter, FilterColumn, FilterType};
pub use from_domain::{table_writer_from_domain, table_writer_from_domain_with_strict};
// Re-export canonical types from ooxml_types.
pub use ooxml_types::tables::{
    DynamicFilterType, FilterOperator, SortBy, TableFormula, TableStyleInfo, TotalsRowFunction,
    XmlColumnPr,
};
pub use sort::{SortCondition, SortState};
pub use style::default_table_style_info;
pub use writer::TableWriter;
