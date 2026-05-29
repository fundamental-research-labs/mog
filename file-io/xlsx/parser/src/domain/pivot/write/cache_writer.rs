//! Pivot Cache Writer implementation.
//!
//! This module contains the PivotCacheWriter struct for generating pivot cache
//! definition and records XML files.

use super::types::*;
use crate::write::xml_writer::XmlWriter;

/// SpreadsheetML namespace URI
const SPREADSHEETML_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/// Office Document Relationships namespace URI
const RELATIONSHIPS_NS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// ============================================================================
// Pivot Cache Writer
// ============================================================================

/// Pivot cache writer
#[derive(Debug, Clone)]
pub struct PivotCacheWriter {
    /// Cache ID
    pub cache_id: u32,
    /// Source definition
    pub source: CacheSource,
    /// Cache fields
    pub fields: Vec<CacheFieldDef>,
    /// Record count
    pub record_count: Option<u32>,
    /// Refreshed by user name
    pub refreshed_by: Option<String>,
    /// Refreshed date (as Excel serial date)
    pub refreshed_date: Option<f64>,
    /// Relationship id from this cache definition to its records part.
    pub records_relationship_id: String,
}

impl PivotCacheWriter {
    /// Create a new pivot cache writer
    pub fn new(cache_id: u32) -> Self {
        Self {
            cache_id,
            source: CacheSource::default(),
            fields: Vec::new(),
            record_count: None,
            refreshed_by: None,
            refreshed_date: None,
            records_relationship_id: "rId1".to_string(),
        }
    }

    /// Set source range
    pub fn set_source(&mut self, sheet: &str, range: &str) -> &mut Self {
        self.source = CacheSource::worksheet(sheet, range);
        self
    }

    /// Add a cache field
    pub fn add_field(&mut self, field: CacheFieldDef) -> &mut Self {
        self.fields.push(field);
        self
    }

    /// Set record count
    pub fn set_record_count(&mut self, count: u32) -> &mut Self {
        self.record_count = Some(count);
        self
    }

    /// Generate pivotCacheDefinition.xml
    pub fn to_definition_xml(&self) -> Vec<u8> {
        let mut w = XmlWriter::new();

        w.write_declaration();

        w.start_element("pivotCacheDefinition")
            .attr("xmlns", SPREADSHEETML_NS)
            .attr("xmlns:r", RELATIONSHIPS_NS);

        w.attr("r:id", &self.records_relationship_id);

        // Tell Excel to refresh pivot data when the workbook is opened.
        w.attr_bool("refreshOnLoad", true);

        if let Some(ref user) = self.refreshed_by {
            w.attr("refreshedBy", user);
        }

        if let Some(date) = self.refreshed_date {
            w.attr_num("refreshedDate", date);
        }

        if let Some(count) = self.record_count {
            w.attr_num("recordCount", count);
        }

        w.end_attrs();

        // Write cache source
        self.source.write_xml(&mut w);

        // Write cache fields
        if !self.fields.is_empty() {
            w.start_element("cacheFields")
                .attr_num("count", self.fields.len())
                .end_attrs();

            for field in &self.fields {
                field.write_xml(&mut w);
            }

            w.end_element("cacheFields");
        }

        w.end_element("pivotCacheDefinition");

        w.finish()
    }

    /// Generate pivotCacheRecords.xml
    pub fn to_records_xml(&self, records: &[Vec<SharedItem>]) -> Vec<u8> {
        let mut w = XmlWriter::new();

        w.write_declaration();

        w.start_element("pivotCacheRecords")
            .attr("xmlns", SPREADSHEETML_NS)
            .attr("xmlns:r", RELATIONSHIPS_NS)
            .attr_num("count", records.len())
            .end_attrs();

        for record in records {
            w.start_element("r").end_attrs();

            for item in record {
                item.write_xml(&mut w);
            }

            w.end_element("r");
        }

        w.end_element("pivotCacheRecords");

        w.finish()
    }
}
