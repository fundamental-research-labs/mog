//! Pivot Table writer for XLSX files.
//!
//! This module generates pivot table definitions including:
//! - `xl/pivotTables/pivotTable{n}.xml` - Pivot table definition
//! - `xl/pivotCache/pivotCacheDefinition{n}.xml` - Cache definition
//! - `xl/pivotCache/pivotCacheRecords{n}.xml` - Cached data (optional)
//!
//! # Overview
//!
//! Pivot tables in XLSX consist of three main parts:
//! 1. Pivot table definition - describes the layout and structure
//! 2. Pivot cache definition - defines the source data structure
//! 3. Pivot cache records - stores the actual cached data
//!
//! # Usage
//!
//! ```ignore
//! use xlsx_parser::write::pivot_writer::{
//!     PivotTableWriter, PivotCacheWriter, PivotFieldDef, DataFieldDef,
//!     PivotAxis, DataFieldFunction, CacheFieldDef, SharedItem, PivotLocation,
//! };
//!
//! // Create cache definition
//! let mut cache = PivotCacheWriter::new(1);
//! cache.set_source("Data", "A1:D100")
//!     .add_field(CacheFieldDef {
//!         name: "Category".to_string(),
//!         shared_items: vec![
//!             SharedItem::String("Electronics".to_string()),
//!             SharedItem::String("Clothing".to_string()),
//!         ],
//!         ..Default::default()
//!     });
//!
//! // Create pivot table
//! let mut pivot = PivotTableWriter::new("PivotTable1", 1);
//! pivot.set_location(PivotLocation {
//!         ref_range: "A3:C10".to_string(),
//!         first_data_row: 2,
//!         first_data_col: 1,
//!         ..Default::default()
//!     })
//!     .add_row_field(0)
//!     .add_data_field(DataFieldDef {
//!         name: "Sum of Sales".to_string(),
//!         field_index: 2,
//!         function: DataFieldFunction::Sum,
//!         ..Default::default()
//!     });
//!
//! let cache_def_xml = cache.to_definition_xml();
//! let pivot_xml = pivot.to_xml();
//! ```
//!
//! # ECMA-376 References
//!
//! - CT_pivotTableDefinition: Part 1, Section 18.10
//! - CT_pivotCacheDefinition: Part 1, Section 18.10.1
//! - CT_pivotCacheRecords: Part 1, Section 18.10.1.2

pub mod cache_writer;
pub mod convert;
pub mod table_writer;
pub mod types;

#[cfg(test)]
mod tests;

// Re-export all public types
pub use types::{
    CacheFieldDef, CacheSource, CacheSourceType, DataFieldDef, DataFieldFunction, PageFieldDef,
    PivotAxis, PivotFieldDef, PivotFieldItem, PivotItemType, PivotLocation, PivotStyle, RowColItem,
    SharedItem, WorksheetSource,
};

pub use cache_writer::PivotCacheWriter;
pub use table_writer::PivotTableWriter;
