//! Pivot types — wrapper types that combine ooxml_types spec structs with
//! parser-specific facts.

use ooxml_types::pivot::{PivotCacheDefinition, PivotCacheRecords};

/// A parsed pivot cache: spec-complete definition + records.
#[derive(Debug, Clone)]
pub struct ParsedPivotCache {
    /// Full OOXML cache definition (CT_PivotCacheDefinition).
    pub definition: PivotCacheDefinition,
    /// Cache records (CT_PivotCacheRecords).
    pub records: PivotCacheRecords,
}
