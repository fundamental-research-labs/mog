//! Table types (ECMA-376 Part 1, Sections 18.3.1 & 18.5.1 -- SpreadsheetML Tables).
//!
//! Unified superset of `xlsx-parser` read-side (`tables/types.rs`, `tables/filter.rs`,
//! `tables/sort.rs`, `tables/style.rs`) and write-side (`write/tables_writer.rs`) types.
//!
//! This module provides canonical enum types and shared structs with `from_ooxml` /
//! `to_ooxml` converters (and `from_bytes` for the read-side byte-level parser) so
//! both sides share one vocabulary.

mod columns;
mod dynamic_filters;
mod enums;
mod filters;
mod formula;
mod styles;
mod table;

#[cfg(test)]
mod tests;

pub use crate::worksheet::filter::{SortCondition, SortState};
pub use columns::{TableColumn, XmlColumnPr};
pub use dynamic_filters::{DateTimeGrouping, DynamicFilterType};
pub use enums::{SortBy, SortOrder, TableType, TotalsRowFunction};
pub use filters::{
    AutoFilter, ColorFilter, CustomFilter, CustomFilters, DynamicFilter, FilterColumn,
    FilterOperator, FilterType, Filters, IconFilter, Top10Filter,
};
pub use formula::TableFormula;
pub use styles::{TableStyleInfo, TableStyleType};
pub use table::Table;
