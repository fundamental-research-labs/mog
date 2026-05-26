//! Pivot types — wrapper types that combine ooxml_types spec structs with
//! parser-specific data (raw XML passthrough, archive paths).

use ooxml_types::pivot::{PivotCacheDefinition, PivotCacheRecords};

/// A parsed pivot cache: spec-complete definition + records + raw XML.
#[derive(Debug, Clone)]
pub struct ParsedPivotCache {
    /// Full OOXML cache definition (CT_PivotCacheDefinition).
    pub definition: PivotCacheDefinition,
    /// Cache records (CT_PivotCacheRecords).
    pub records: PivotCacheRecords,
    /// Raw XML bytes of the pivotCacheDefinition file.
    pub raw_definition_xml: Option<Vec<u8>>,
    /// Raw XML bytes of the pivotCacheRecords file.
    pub raw_records_xml: Option<Vec<u8>>,
}
