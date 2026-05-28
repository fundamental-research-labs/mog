//! Slicer write module for XLSX files.
//!
//! This module serializes slicer definitions and slicer cache definitions
//! to OOXML XML for the write path:
//! - `xl/slicers/slicer{N}.xml` - slicer part (x14:slicers container)
//! - `xl/slicerCaches/slicerCache{N}.xml` - slicer cache definition
//!
//! It also provides helpers for writing slicer-related extLst entries
//! in worksheet and workbook XML.

mod attrs;
mod cache;
mod ext_refs;
mod namespaces;
mod slicer_part;
mod table_cache_ext;
mod tabular;

pub use cache::write_slicer_cache;
pub use ext_refs::{write_workbook_slicer_caches_ext, write_worksheet_slicer_ext};
pub use namespaces::{
    EXT_URI_SLICER_CACHES, EXT_URI_SLICER_LIST, EXT_URI_TABLE_SLICER_CACHE, NS_MC, NS_X14, NS_X15,
    NS_XR10,
};
pub use slicer_part::write_slicer_part;

#[cfg(test)]
mod tests;
