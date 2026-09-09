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
    pub ooxml_preservation: Option<domain_types::domain::pivot::PivotCacheOoxmlPreservation>,
    /// Source definition
    pub source: CacheSource,
    /// Cache fields
    pub fields: Vec<CacheFieldDef>,
    /// Typed field definitions, including imported or refreshed metadata.
    pub typed_fields: Option<Vec<ooxml_types::pivot::PivotCacheField>>,
    /// Structural metadata retained when cache values are refreshed.
    pub field_templates: Vec<ooxml_types::pivot::PivotCacheField>,
    /// Record count
    pub record_count: Option<u32>,
    /// Refreshed by user name
    pub refreshed_by: Option<String>,
    /// Refreshed date (as Excel serial date)
    pub refreshed_date: Option<f64>,
    /// Relationship id from this cache definition to its records part.
    pub records_relationship_id: Option<String>,
}

impl PivotCacheWriter {
    /// Create a new pivot cache writer
    pub fn new(cache_id: u32) -> Self {
        Self {
            cache_id,
            ooxml_preservation: None,
            source: CacheSource::default(),
            fields: Vec::new(),
            typed_fields: None,
            field_templates: Vec::new(),
            record_count: None,
            refreshed_by: None,
            refreshed_date: None,
            records_relationship_id: Some("rId1".to_string()),
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

        if let Some(records_relationship_id) = &self.records_relationship_id {
            w.attr("r:id", records_relationship_id);
        } else {
            w.attr_bool("saveData", false);
        }

        if let Some(metadata) = &self.ooxml_preservation {
            for attr in &metadata.root_namespace_declarations {
                if attr.name != "xmlns:r" {
                    w.attr(&attr.name, &attr.value);
                }
            }
            for attr in &metadata.root_attributes {
                let overridden = (attr.name == "saveData"
                    && self.records_relationship_id.is_none())
                    || (attr.name == "refreshedBy" && self.refreshed_by.is_some())
                    || (attr.name == "refreshedDate" && self.refreshed_date.is_some());
                if !overridden {
                    w.attr(&attr.name, &attr.value);
                }
            }
        } else {
            // Newly constructed caches request an initial refresh.
            w.attr_bool("refreshOnLoad", true);
        }

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
        if let Some(fields) = &self.typed_fields {
            w.start_element("cacheFields")
                .attr_num("count", fields.len())
                .end_attrs();
            for (index, field) in fields.iter().enumerate() {
                super::typed_cache_fields::write_cache_field_with_preservation(
                    field,
                    &mut w,
                    self.ooxml_preservation
                        .as_ref()
                        .and_then(|p| p.fields.get(index)),
                );
            }
            w.end_element("cacheFields");
        } else if !self.fields.is_empty() {
            w.start_element("cacheFields")
                .attr_num("count", self.fields.len())
                .end_attrs();

            for (index, field) in self.fields.iter().enumerate() {
                if let Some(template) = self
                    .field_templates
                    .get(index)
                    .filter(|t| t.name == field.name)
                {
                    let mut refreshed = template.clone();
                    refreshed.shared_items = Some(super::typed_cache_fields::infer_shared_items(
                        &field.shared_items,
                    ));
                    super::typed_cache_fields::write_cache_field_with_preservation(
                        &refreshed,
                        &mut w,
                        self.ooxml_preservation
                            .as_ref()
                            .and_then(|p| p.fields.get(index)),
                    );
                } else {
                    field.write_xml(&mut w);
                }
            }

            w.end_element("cacheFields");
        }

        if let Some(metadata) = &self.ooxml_preservation {
            for child in &metadata.children {
                w.raw_str(&child.xml);
            }
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
