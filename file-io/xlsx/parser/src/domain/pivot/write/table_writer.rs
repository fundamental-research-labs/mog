//! Pivot Table Writer implementation.
//!
//! This module contains the PivotTableWriter struct for generating pivot table
//! definition XML files.

use super::types::*;
use crate::write::xml_writer::XmlWriter;
use domain_types::domain::pivot::{PivotRawXmlAttribute, PivotTableOoxmlPreservation};

/// SpreadsheetML namespace URI
const SPREADSHEETML_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

// ============================================================================
// Pivot Table Writer
// ============================================================================

/// Pivot table writer
#[derive(Debug, Clone)]
pub struct PivotTableWriter {
    /// Pivot table name
    pub name: String,
    /// Cache ID
    pub cache_id: u32,
    /// Location
    pub location: PivotLocation,
    /// Pivot fields
    pub fields: Vec<PivotFieldDef>,
    /// Row field indices
    pub row_fields: Vec<i32>,
    /// Column field indices
    pub col_fields: Vec<i32>,
    /// Page (filter) fields
    pub page_fields: Vec<PageFieldDef>,
    /// Data fields
    pub data_fields: Vec<DataFieldDef>,
    /// Row items for output
    pub row_items: Vec<RowColItem>,
    /// Column items for output
    pub col_items: Vec<RowColItem>,
    /// Style
    pub style: Option<PivotStyle>,
    /// Data on rows (true) or columns (false)
    pub data_on_rows: bool,
    /// Data caption
    pub data_caption: String,
    /// Custom label for grand total rows/columns.
    pub grand_total_caption: Option<String>,
    /// Custom row header caption.
    pub row_header_caption: Option<String>,
    /// Custom column header caption.
    pub col_header_caption: Option<String>,
    /// Whether row grand totals are shown.
    pub row_grand_totals: bool,
    /// Whether column grand totals are shown.
    pub col_grand_totals: bool,
    /// Whether classic grid drop zones are enabled.
    pub grid_drop_zones: bool,
    /// Caption shown for error values.
    pub error_caption: Option<String>,
    /// Whether error captions are displayed.
    pub show_error: bool,
    /// Caption shown for missing values.
    pub missing_caption: Option<String>,
    /// Whether missing captions are displayed.
    pub show_missing: bool,
    /// Writer-only preservation state for unsupported imported pivot XML.
    pub ooxml_preservation: PivotTableOoxmlPreservation,
}

impl PivotTableWriter {
    /// Create a new pivot table writer
    pub fn new(name: &str, cache_id: u32) -> Self {
        Self {
            name: name.to_string(),
            cache_id,
            location: PivotLocation::default(),
            fields: Vec::new(),
            row_fields: Vec::new(),
            col_fields: Vec::new(),
            page_fields: Vec::new(),
            data_fields: Vec::new(),
            row_items: Vec::new(),
            col_items: Vec::new(),
            style: None,
            data_on_rows: false,
            data_caption: "Values".to_string(),
            grand_total_caption: None,
            row_header_caption: None,
            col_header_caption: None,
            row_grand_totals: true,
            col_grand_totals: true,
            grid_drop_zones: false,
            error_caption: None,
            show_error: false,
            missing_caption: None,
            show_missing: true,
            ooxml_preservation: PivotTableOoxmlPreservation::default(),
        }
    }

    /// Set pivot table location
    pub fn set_location(&mut self, location: PivotLocation) -> &mut Self {
        self.location = location;
        self
    }

    /// Add a pivot field
    pub fn add_field(&mut self, field: PivotFieldDef) -> &mut Self {
        self.fields.push(field);
        self
    }

    /// Add row field by index
    pub fn add_row_field(&mut self, field_index: u32) -> &mut Self {
        self.row_fields.push(field_index as i32);
        self
    }

    /// Add column field by index
    pub fn add_col_field(&mut self, field_index: u32) -> &mut Self {
        self.col_fields.push(field_index as i32);
        self
    }

    /// Add page/filter field by index (simple variant)
    pub fn add_page_field(&mut self, field_index: u32) -> &mut Self {
        self.page_fields.push(PageFieldDef {
            field_index: field_index as i32,
            ..Default::default()
        });
        self
    }

    /// Add a full page field definition
    pub fn add_page_field_def(&mut self, page_field: PageFieldDef) -> &mut Self {
        self.page_fields.push(page_field);
        self
    }

    /// Add data field
    pub fn add_data_field(&mut self, data_field: DataFieldDef) -> &mut Self {
        self.data_fields.push(data_field);
        self
    }

    /// Add row item
    pub fn add_row_item(&mut self, item: RowColItem) -> &mut Self {
        self.row_items.push(item);
        self
    }

    /// Add column item
    pub fn add_col_item(&mut self, item: RowColItem) -> &mut Self {
        self.col_items.push(item);
        self
    }

    /// Set style
    pub fn set_style(&mut self, style: PivotStyle) -> &mut Self {
        self.style = Some(style);
        self
    }

    /// Set data caption
    pub fn set_data_caption(&mut self, caption: &str) -> &mut Self {
        self.data_caption = caption.to_string();
        self
    }

    /// Generate pivotTable.xml
    pub fn to_xml(&self) -> Vec<u8> {
        let mut w = XmlWriter::new();

        w.write_declaration();

        // Start pivotTableDefinition
        w.start_element("pivotTableDefinition")
            .attr("xmlns", SPREADSHEETML_NS)
            .apply_preserved_attrs(
                &self.ooxml_preservation.root_namespace_declarations,
                &["xmlns"],
            )
            .attr("name", &self.name)
            .attr_num("cacheId", self.cache_id)
            .attr_bool("dataOnRows", self.data_on_rows)
            .attr("dataCaption", &self.data_caption)
            .attr_bool("rowGrandTotals", self.row_grand_totals)
            .attr_bool("colGrandTotals", self.col_grand_totals)
            .attr_bool("gridDropZones", self.grid_drop_zones)
            .attr_bool("showError", self.show_error)
            .attr_bool("showMissing", self.show_missing);

        if let Some(ref caption) = self.grand_total_caption {
            w.attr("grandTotalCaption", caption);
        }
        if let Some(ref caption) = self.row_header_caption {
            w.attr("rowHeaderCaption", caption);
        }
        if let Some(ref caption) = self.col_header_caption {
            w.attr("colHeaderCaption", caption);
        }
        if let Some(ref caption) = self.error_caption {
            w.attr("errorCaption", caption);
        }
        if let Some(ref caption) = self.missing_caption {
            w.attr("missingCaption", caption);
        }
        write_preserved_attrs(
            &mut w,
            &self.ooxml_preservation.root_attributes,
            &[
                "name",
                "cacheId",
                "dataOnRows",
                "dataCaption",
                "rowGrandTotals",
                "colGrandTotals",
                "gridDropZones",
                "showError",
                "showMissing",
                "grandTotalCaption",
                "rowHeaderCaption",
                "colHeaderCaption",
                "errorCaption",
                "missingCaption",
            ],
        );

        w.end_attrs();

        // Write location
        self.location.write_xml(&mut w);

        // Write pivot fields
        if !self.fields.is_empty() {
            w.start_element("pivotFields")
                .attr_num("count", self.fields.len())
                .end_attrs();

            for field in &self.fields {
                field.write_xml(&mut w);
            }

            w.end_element("pivotFields");
        }

        // Write row fields
        if !self.row_fields.is_empty() {
            w.start_element("rowFields")
                .attr_num("count", self.row_fields.len())
                .end_attrs();

            for x in &self.row_fields {
                let x_str = x.to_string();
                w.empty_element("field", &[("x", &x_str)]);
            }

            w.end_element("rowFields");
        }

        // Write row items
        if !self.row_items.is_empty() {
            w.start_element("rowItems")
                .attr_num("count", self.row_items.len())
                .end_attrs();

            for item in &self.row_items {
                item.write_xml(&mut w);
            }

            w.end_element("rowItems");
        }

        // Write column fields
        if !self.col_fields.is_empty() {
            w.start_element("colFields")
                .attr_num("count", self.col_fields.len())
                .end_attrs();

            for x in &self.col_fields {
                let x_str = x.to_string();
                w.empty_element("field", &[("x", &x_str)]);
            }

            w.end_element("colFields");
        }

        // Write column items
        if !self.col_items.is_empty() {
            w.start_element("colItems")
                .attr_num("count", self.col_items.len())
                .end_attrs();

            for item in &self.col_items {
                item.write_xml(&mut w);
            }

            w.end_element("colItems");
        }

        // Write page fields
        if !self.page_fields.is_empty() {
            w.start_element("pageFields")
                .attr_num("count", self.page_fields.len())
                .end_attrs();

            for pf in &self.page_fields {
                pf.write_xml(&mut w);
            }

            w.end_element("pageFields");
        }

        // Write data fields
        if !self.data_fields.is_empty() {
            w.start_element("dataFields")
                .attr_num("count", self.data_fields.len())
                .end_attrs();

            for df in &self.data_fields {
                df.write_xml(&mut w);
            }

            w.end_element("dataFields");
        }

        write_preserved_children(
            &mut w,
            &self.ooxml_preservation.children,
            &[
                "formats",
                "conditionalFormats",
                "chartFormats",
                "pivotHierarchies",
            ],
        );

        // Write style info
        if let Some(ref style) = self.style {
            style.write_xml(&mut w);
        }

        write_preserved_children(
            &mut w,
            &self.ooxml_preservation.children,
            &["filters", "rowHierarchiesUsage", "colHierarchiesUsage"],
        );
        for child in &self.ooxml_preservation.children {
            if ![
                "formats",
                "conditionalFormats",
                "chartFormats",
                "pivotHierarchies",
                "filters",
                "rowHierarchiesUsage",
                "colHierarchiesUsage",
            ]
            .contains(&child.local_name.as_str())
            {
                w.raw_str(&child.xml);
            }
        }

        w.end_element("pivotTableDefinition");

        w.finish()
    }
}

fn write_preserved_children(
    w: &mut XmlWriter,
    children: &[domain_types::domain::pivot::PivotRawXmlBlock],
    local_names: &[&str],
) {
    for child in children {
        if local_names.contains(&child.local_name.as_str()) {
            w.raw_str(&child.xml);
        }
    }
}

trait PivotWriterPreservedAttrs {
    fn apply_preserved_attrs(
        &mut self,
        attrs: &[PivotRawXmlAttribute],
        typed_local_names: &[&str],
    ) -> &mut Self;
}

impl PivotWriterPreservedAttrs for XmlWriter {
    fn apply_preserved_attrs(
        &mut self,
        attrs: &[PivotRawXmlAttribute],
        typed_local_names: &[&str],
    ) -> &mut Self {
        write_preserved_attrs(self, attrs, typed_local_names);
        self
    }
}

fn write_preserved_attrs(
    w: &mut XmlWriter,
    attrs: &[PivotRawXmlAttribute],
    typed_local_names: &[&str],
) {
    for attr in attrs {
        let local = attr
            .name
            .rsplit_once(':')
            .map(|(_, local)| local)
            .unwrap_or(attr.name.as_str());
        if !typed_local_names.contains(&local) {
            w.attr(&attr.name, &attr.value);
        }
    }
}
