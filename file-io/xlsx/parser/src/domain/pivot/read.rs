//! Compatibility facade for pivot read APIs.
//!
//! Implementations live in contract-oriented modules:
//! `model`, `reader`, `parse`, `spec`, `package`, and `convert`.

#![allow(clippy::string_slice)]

pub use crate::domain::pivot::model::*;
pub use crate::domain::pivot::package::{
    ParsedPivotCaches, PivotCacheMap, PivotCachePackage, PivotCachePackageLink,
    PivotCachePathEntry, PivotCachePathList, PivotCacheRecordsLink, PivotCacheRecordsPathSource,
    PivotPackageDiscovery, parse_all_pivot_caches, parse_pivot_cache_packages,
    parse_pivot_tables_for_sheet_v2,
};
pub use crate::domain::pivot::parse::{
    parse_pivot_cache_definition, parse_pivot_cache_records, parse_pivot_table,
};

#[cfg(test)]
pub(crate) use crate::domain::pivot::parse::shared_items::parse_shared_items;
#[cfg(test)]
pub(crate) use crate::domain::pivot::parse::table_fields::{parse_data_fields, parse_pivot_items};
#[cfg(test)]
pub(crate) use crate::domain::pivot::reader::attrs::parse_item_type_attr;

#[cfg(test)]
mod tests;
