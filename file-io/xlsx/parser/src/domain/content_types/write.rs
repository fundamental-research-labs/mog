//! Content Types Manager for XLSX writing.
//!
//! This module handles the generation of `[Content_Types].xml`, which is the manifest
//! file at the root of every XLSX archive. It maps file extensions and specific paths
//! to their MIME types (content types).
//!
//! # XLSX Content Types Structure
//!
//! The `[Content_Types].xml` file contains two types of mappings:
//!
//! 1. **Default** - Maps file extensions to content types:
//!    ```xml
//!    <Default Extension="xml" ContentType="application/xml"/>
//!    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
//!    ```
//!
//! 2. **Override** - Maps specific paths to content types:
//!    ```xml
//!    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
//!    <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
//!    ```

use crate::write::xml_writer::XmlWriter;

// =============================================================================
// Content Type Constants
// =============================================================================

/// Content type for main workbook
pub const CT_WORKBOOK: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";

/// Content type for worksheets
pub const CT_WORKSHEET: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";

/// Content type for styles
pub const CT_STYLES: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml";

/// Content type for shared strings
pub const CT_SHARED_STRINGS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml";

/// Content type for theme
pub const CT_THEME: &str = "application/vnd.openxmlformats-officedocument.theme+xml";

/// Content type for relationships
pub const CT_RELATIONSHIPS: &str = "application/vnd.openxmlformats-package.relationships+xml";

/// Content type for core properties
pub const CT_CORE_PROPERTIES: &str = "application/vnd.openxmlformats-package.core-properties+xml";

/// Content type for extended properties (app.xml)
pub const CT_EXTENDED_PROPERTIES: &str =
    "application/vnd.openxmlformats-officedocument.extended-properties+xml";

/// Content type for custom properties (custom.xml)
pub const CT_CUSTOM_PROPERTIES: &str =
    "application/vnd.openxmlformats-officedocument.custom-properties+xml";

/// Content type for drawings
pub const CT_DRAWING: &str = "application/vnd.openxmlformats-officedocument.drawing+xml";

/// Content type for charts
pub const CT_CHART: &str = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";

/// Content type for tables
pub const CT_TABLE: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml";

/// Content type for comments
pub const CT_COMMENTS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml";

/// Content type for pivot tables
pub const CT_PIVOT_TABLE: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml";

/// Content type for pivot cache definition
pub const CT_PIVOT_CACHE: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml";

/// Content type for VBA projects
pub const CT_VBA: &str = "application/vnd.ms-office.vbaProject";

/// Content type for slicer parts (x14 extension)
pub const CT_SLICER: &str = "application/vnd.ms-excel.slicer+xml";

/// Content type for slicer cache definitions (x14 extension)
pub const CT_SLICER_CACHE: &str = "application/vnd.ms-excel.slicerCache+xml";

/// Content type for generic XML
pub const CT_XML: &str = "application/xml";

// SmartArt diagram content types

/// Content type for SmartArt diagram data
pub const CT_DIAGRAM_DATA: &str =
    "application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml";

/// Content type for SmartArt diagram layout definition
pub const CT_DIAGRAM_LAYOUT: &str =
    "application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml";

/// Content type for SmartArt diagram colors
pub const CT_DIAGRAM_COLORS: &str =
    "application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml";

/// Content type for SmartArt diagram style definition
pub const CT_DIAGRAM_STYLE: &str =
    "application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml";

/// Content type for SmartArt diagram drawing (Microsoft extension)
pub const CT_DIAGRAM_DRAWING: &str = "application/vnd.ms-office.drawingml.diagramDrawing+xml";

/// Content type for chart style (Microsoft 2011 extension)
pub const CT_CHART_STYLE: &str = "application/vnd.ms-office.chartstyle+xml";

/// Content type for chart color style (Microsoft 2011 extension)
pub const CT_CHART_COLOR_STYLE: &str = "application/vnd.ms-office.chartcolorstyle+xml";

// Image content types
/// Content type for PNG images
pub const CT_PNG: &str = "image/png";

/// Content type for JPEG images
pub const CT_JPEG: &str = "image/jpeg";

/// Content type for GIF images
pub const CT_GIF: &str = "image/gif";

/// Content type for EMF images
pub const CT_EMF: &str = "image/x-emf";

/// Content type for WMF images
pub const CT_WMF: &str = "image/x-wmf";

/// Content type for spreadsheet metadata (xl/metadata.xml)
pub const CT_METADATA: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml";

/// Content type for the calculation chain part.
pub const CT_CALC_CHAIN: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml";

// =============================================================================
// Content Type Namespace
// =============================================================================

/// XML namespace for content types
const CONTENT_TYPES_NS: &str = "http://schemas.openxmlformats.org/package/2006/content-types";

// =============================================================================
// ContentTypeDefault
// =============================================================================

/// A default content type mapping for file extensions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentTypeDefault {
    /// The file extension (without the dot), e.g., "xml", "rels"
    pub extension: String,
    /// The content type MIME string
    pub content_type: String,
}

impl ContentTypeDefault {
    /// Create a new default content type mapping.
    pub fn new(extension: &str, content_type: &str) -> Self {
        Self {
            extension: extension.to_string(),
            content_type: content_type.to_string(),
        }
    }
}

// =============================================================================
// ContentTypeOverride
// =============================================================================

/// An override content type mapping for specific paths.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentTypeOverride {
    /// The part name (path with leading slash), e.g., "/xl/workbook.xml"
    pub part_name: String,
    /// The content type MIME string
    pub content_type: String,
}

impl ContentTypeOverride {
    /// Create a new override content type mapping.
    pub fn new(part_name: &str, content_type: &str) -> Self {
        // Ensure the path starts with a forward slash
        let part_name = if part_name.starts_with('/') {
            part_name.to_string()
        } else {
            format!("/{}", part_name)
        };

        Self {
            part_name,
            content_type: content_type.to_string(),
        }
    }
}

// =============================================================================
// ContentTypesManager
// =============================================================================

/// Manager for building `[Content_Types].xml` files.
///
/// This struct provides a builder-style API for creating the content types
/// manifest required by XLSX files.
///
/// # Example
///
/// ```
/// use xlsx_parser::write::{ContentTypesManager, CT_WORKBOOK};
///
/// let mut ct = ContentTypesManager::with_xlsx_defaults();
/// ct.add_workbook()
///   .add_worksheet(1)
///   .add_worksheet(2)
///   .add_styles()
///   .add_shared_strings();
///
/// let xml = ct.to_xml();
/// ```
#[derive(Debug, Clone, Default)]
pub struct ContentTypesManager {
    /// Default mappings (extension -> content type)
    defaults: Vec<ContentTypeDefault>,
    /// Override mappings (path -> content type)
    overrides: Vec<ContentTypeOverride>,
}

impl ContentTypesManager {
    /// Create a new empty ContentTypesManager.
    pub fn new() -> Self {
        Self {
            defaults: Vec::new(),
            overrides: Vec::new(),
        }
    }

    /// Create a ContentTypesManager with standard XLSX defaults.
    ///
    /// This adds the default mappings for:
    /// - `.rels` files -> relationships content type
    /// - `.xml` files -> generic XML content type
    pub fn with_xlsx_defaults() -> Self {
        let mut ct = Self::new();
        ct.add_default("rels", CT_RELATIONSHIPS);
        ct.add_default("xml", CT_XML);
        ct
    }

    /// Add a default mapping for a file extension.
    ///
    /// # Arguments
    /// * `extension` - The file extension (without the dot)
    /// * `content_type` - The content type MIME string
    pub fn add_default(&mut self, extension: &str, content_type: &str) -> &mut Self {
        // Check if this extension already exists
        if !self.defaults.iter().any(|d| d.extension == extension) {
            self.defaults
                .push(ContentTypeDefault::new(extension, content_type));
        }
        self
    }

    /// Add an override mapping for a specific path.
    ///
    /// # Arguments
    /// * `part_name` - The path (will be prefixed with '/' if not present)
    /// * `content_type` - The content type MIME string
    pub fn add_override(&mut self, part_name: &str, content_type: &str) -> &mut Self {
        let normalized = if part_name.starts_with('/') {
            part_name.to_string()
        } else {
            format!("/{}", part_name)
        };
        if !self.overrides.iter().any(|o| o.part_name == normalized) {
            self.overrides
                .push(ContentTypeOverride::new(&normalized, content_type));
        }
        self
    }

    /// Add the workbook override (`/xl/workbook.xml`).
    pub fn add_workbook(&mut self) -> &mut Self {
        self.add_override("/xl/workbook.xml", CT_WORKBOOK)
    }

    /// Add a worksheet override.
    ///
    /// # Arguments
    /// * `index` - The 1-based sheet index (sheet1, sheet2, etc.)
    pub fn add_worksheet(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/worksheets/sheet{}.xml", index);
        self.add_override(&path, CT_WORKSHEET)
    }

    /// Add the styles override (`/xl/styles.xml`).
    pub fn add_styles(&mut self) -> &mut Self {
        self.add_override("/xl/styles.xml", CT_STYLES)
    }

    /// Add the shared strings override (`/xl/sharedStrings.xml`).
    pub fn add_shared_strings(&mut self) -> &mut Self {
        self.add_override("/xl/sharedStrings.xml", CT_SHARED_STRINGS)
    }

    /// Add the theme override (`/xl/theme/theme1.xml`).
    pub fn add_theme(&mut self) -> &mut Self {
        self.add_override("/xl/theme/theme1.xml", CT_THEME)
    }

    /// Add a table override.
    ///
    /// # Arguments
    /// * `index` - The 1-based table index (table1, table2, etc.)
    pub fn add_table(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/tables/table{}.xml", index);
        self.add_override(&path, CT_TABLE)
    }

    /// Add a chart override.
    ///
    /// # Arguments
    /// * `index` - The 1-based chart index (chart1, chart2, etc.)
    pub fn add_chart(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/charts/chart{}.xml", index);
        self.add_override(&path, CT_CHART)
    }

    pub fn add_chart_ex(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/charts/chartEx{}.xml", index);
        self.add_override(&path, "application/vnd.ms-office.chartex+xml")
    }

    /// Add a chart style override by explicit ZIP path.
    pub fn add_chart_style(&mut self, path: &str) -> &mut Self {
        let abs_path = if path.starts_with('/') {
            path.to_string()
        } else {
            format!("/{}", path)
        };
        self.add_override(&abs_path, CT_CHART_STYLE)
    }

    /// Add a chart color style override by explicit ZIP path.
    pub fn add_chart_color_style(&mut self, path: &str) -> &mut Self {
        let abs_path = if path.starts_with('/') {
            path.to_string()
        } else {
            format!("/{}", path)
        };
        self.add_override(&abs_path, CT_CHART_COLOR_STYLE)
    }

    /// Add a drawing override.
    ///
    /// # Arguments
    /// * `index` - The 1-based drawing index (drawing1, drawing2, etc.)
    pub fn add_drawing(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/drawings/drawing{}.xml", index);
        self.add_override(&path, CT_DRAWING)
    }

    /// Add a comments override for a specific sheet.
    ///
    /// # Arguments
    /// * `sheet_index` - The 1-based sheet index
    pub fn add_comments(&mut self, sheet_index: usize) -> &mut Self {
        let path = format!("/xl/comments{}.xml", sheet_index);
        self.add_override(&path, CT_COMMENTS)
    }

    /// Add a comments content type override with an explicit ZIP path.
    ///
    /// Used when the original file's comment numbering doesn't match the
    /// sequential sheet index (e.g. `comments6.xml` for sheet 7).
    pub fn add_comments_path(&mut self, zip_path: &str) -> &mut Self {
        let path = if zip_path.starts_with('/') {
            zip_path.to_string()
        } else {
            format!("/{}", zip_path)
        };
        self.add_override(&path, CT_COMMENTS)
    }

    /// Add core properties override (`/docProps/core.xml`).
    pub fn add_core_properties(&mut self) -> &mut Self {
        self.add_override("/docProps/core.xml", CT_CORE_PROPERTIES)
    }

    /// Add extended properties override (`/docProps/app.xml`).
    pub fn add_extended_properties(&mut self) -> &mut Self {
        self.add_override("/docProps/app.xml", CT_EXTENDED_PROPERTIES)
    }

    /// Add metadata override (`/xl/metadata.xml`).
    pub fn add_metadata(&mut self) -> &mut Self {
        self.add_override("/xl/metadata.xml", CT_METADATA)
    }

    /// Add calculation chain override (`/xl/calcChain.xml`).
    pub fn add_calc_chain(&mut self) -> &mut Self {
        self.add_override("/xl/calcChain.xml", CT_CALC_CHAIN)
    }

    /// Add custom properties override (`/docProps/custom.xml`).
    pub fn add_custom_properties(&mut self) -> &mut Self {
        self.add_override("/docProps/custom.xml", CT_CUSTOM_PROPERTIES)
    }

    /// Add docMetadata/LabelInfo.xml override (classification labels).
    pub fn add_doc_metadata_label_info(&mut self) -> &mut Self {
        self.add_override(
            "/docMetadata/LabelInfo.xml",
            "application/vnd.ms-office.classificationlabels+xml",
        )
    }

    /// Add a pivot table override.
    ///
    /// # Arguments
    /// * `index` - The 1-based pivot table index
    pub fn add_pivot_table(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/pivotTables/pivotTable{}.xml", index);
        self.add_override(&path, CT_PIVOT_TABLE)
    }

    /// Add a pivot cache definition override.
    ///
    /// # Arguments
    /// * `index` - The 1-based pivot cache index
    pub fn add_pivot_cache(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/pivotCache/pivotCacheDefinition{}.xml", index);
        self.add_override(&path, CT_PIVOT_CACHE)
    }

    /// Add a PNG image default.
    pub fn add_png_default(&mut self) -> &mut Self {
        self.add_default("png", CT_PNG)
    }

    /// Add a JPEG image default.
    pub fn add_jpeg_default(&mut self) -> &mut Self {
        self.add_default("jpeg", CT_JPEG);
        self.add_default("jpg", CT_JPEG)
    }

    /// Add a GIF image default.
    pub fn add_gif_default(&mut self) -> &mut Self {
        self.add_default("gif", CT_GIF)
    }

    /// Add VBA project default.
    pub fn add_vba_default(&mut self) -> &mut Self {
        self.add_default("bin", CT_VBA)
    }

    /// Add a slicer override.
    ///
    /// # Arguments
    /// * `index` - The 1-based slicer index (slicer1, slicer2, etc.)
    pub fn add_slicer(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/slicers/slicer{}.xml", index);
        self.add_override(&path, CT_SLICER)
    }

    /// Add a slicer cache override.
    ///
    /// # Arguments
    /// * `index` - The 1-based slicer cache index (slicerCache1, slicerCache2, etc.)
    pub fn add_slicer_cache(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/slicerCaches/slicerCache{}.xml", index);
        self.add_override(&path, CT_SLICER_CACHE)
    }

    /// Add a SmartArt diagram data override.
    ///
    /// # Arguments
    /// * `index` - The 1-based diagram data index (data1, data2, etc.)
    pub fn add_diagram_data(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/diagrams/data{}.xml", index);
        self.add_override(&path, CT_DIAGRAM_DATA)
    }

    /// Add a SmartArt diagram layout override.
    ///
    /// # Arguments
    /// * `index` - The 1-based diagram layout index (layout1, layout2, etc.)
    pub fn add_diagram_layout(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/diagrams/layout{}.xml", index);
        self.add_override(&path, CT_DIAGRAM_LAYOUT)
    }

    /// Add a SmartArt diagram colors override.
    ///
    /// # Arguments
    /// * `index` - The 1-based diagram colors index (colors1, colors2, etc.)
    pub fn add_diagram_colors(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/diagrams/colors{}.xml", index);
        self.add_override(&path, CT_DIAGRAM_COLORS)
    }

    /// Add a SmartArt diagram style override.
    ///
    /// # Arguments
    /// * `index` - The 1-based diagram style index (quickStyles1, quickStyles2, etc.)
    pub fn add_diagram_style(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/diagrams/quickStyles{}.xml", index);
        self.add_override(&path, CT_DIAGRAM_STYLE)
    }

    /// Add a SmartArt diagram drawing override (MS extension).
    ///
    /// # Arguments
    /// * `index` - The 1-based diagram drawing index (drawing1, drawing2, etc.)
    pub fn add_diagram_drawing(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/diagrams/drawing{}.xml", index);
        self.add_override(&path, CT_DIAGRAM_DRAWING)
    }

    /// Get the number of default entries.
    pub fn default_count(&self) -> usize {
        self.defaults.len()
    }

    /// Get the number of override entries.
    pub fn override_count(&self) -> usize {
        self.overrides.len()
    }

    /// Check if a default exists for an extension.
    pub fn has_default(&self, extension: &str) -> bool {
        self.defaults.iter().any(|d| d.extension == extension)
    }

    /// Check if an override exists for a path.
    pub fn has_override(&self, part_name: &str) -> bool {
        let normalized = if part_name.starts_with('/') {
            part_name.to_string()
        } else {
            format!("/{}", part_name)
        };
        self.overrides.iter().any(|o| o.part_name == normalized)
    }

    /// Get all default entries.
    pub fn defaults(&self) -> &[ContentTypeDefault] {
        &self.defaults
    }

    /// Get all override entries.
    pub fn overrides(&self) -> &[ContentTypeOverride] {
        &self.overrides
    }

    /// Generate the `[Content_Types].xml` file content.
    pub fn to_xml(&self) -> Vec<u8> {
        let mut writer = XmlWriter::new();

        writer.xml_declaration();

        // Start Types element with namespace
        writer.start_element_with_attrs("Types", &[("xmlns", CONTENT_TYPES_NS)]);

        // Write all Default elements
        for default in &self.defaults {
            writer.empty_element(
                "Default",
                &[
                    ("Extension", &default.extension),
                    ("ContentType", &default.content_type),
                ],
            );
        }

        // Write all Override elements
        for over in &self.overrides {
            writer.empty_element(
                "Override",
                &[
                    ("PartName", &over.part_name),
                    ("ContentType", &over.content_type),
                ],
            );
        }

        writer.end_element("Types");

        writer.into_bytes()
    }
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Create a complete ContentTypesManager for a basic workbook.
///
/// This is a convenience function that creates a ContentTypesManager with
/// common components for an XLSX file.
///
/// # Arguments
/// * `sheet_count` - Number of worksheets
/// * `has_styles` - Whether to include styles.xml
/// * `has_shared_strings` - Whether to include sharedStrings.xml
/// * `has_theme` - Whether to include theme1.xml
/// * `table_count` - Number of tables
/// * `chart_count` - Number of charts
///
/// # Example
///
/// ```
/// use xlsx_parser::write::create_xlsx_content_types;
///
/// let ct = create_xlsx_content_types(3, true, true, true, 0, 0);
/// let xml = ct.to_xml();
/// ```
pub fn create_xlsx_content_types(
    sheet_count: usize,
    has_styles: bool,
    has_shared_strings: bool,
    has_theme: bool,
    table_count: usize,
    chart_count: usize,
) -> ContentTypesManager {
    let mut ct = ContentTypesManager::with_xlsx_defaults();

    ct.add_workbook();

    for i in 1..=sheet_count {
        ct.add_worksheet(i);
    }

    if has_styles {
        ct.add_styles();
    }
    if has_shared_strings {
        ct.add_shared_strings();
    }
    if has_theme {
        ct.add_theme();
    }
    for i in 1..=table_count {
        ct.add_table(i);
    }
    for i in 1..=chart_count {
        ct.add_chart(i);
    }

    ct
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_content_type_default_new() {
        let default = ContentTypeDefault::new("xml", CT_XML);
        assert_eq!(default.extension, "xml");
        assert_eq!(default.content_type, CT_XML);
    }

    #[test]
    fn test_content_type_override_new() {
        let over = ContentTypeOverride::new("/xl/workbook.xml", CT_WORKBOOK);
        assert_eq!(over.part_name, "/xl/workbook.xml");
        assert_eq!(over.content_type, CT_WORKBOOK);
    }

    #[test]
    fn test_content_type_override_auto_slash() {
        let over = ContentTypeOverride::new("xl/workbook.xml", CT_WORKBOOK);
        assert_eq!(over.part_name, "/xl/workbook.xml");
    }

    #[test]
    fn test_manager_new() {
        let ct = ContentTypesManager::new();
        assert_eq!(ct.default_count(), 0);
        assert_eq!(ct.override_count(), 0);
    }

    #[test]
    fn test_manager_with_xlsx_defaults() {
        let ct = ContentTypesManager::with_xlsx_defaults();
        assert_eq!(ct.default_count(), 2);
        assert!(ct.has_default("rels"));
        assert!(ct.has_default("xml"));
    }

    #[test]
    fn test_add_default() {
        let mut ct = ContentTypesManager::new();
        ct.add_default("png", CT_PNG);
        assert_eq!(ct.default_count(), 1);
        assert!(ct.has_default("png"));
    }

    #[test]
    fn test_add_default_no_duplicates() {
        let mut ct = ContentTypesManager::new();
        ct.add_default("xml", CT_XML);
        ct.add_default("xml", CT_XML);
        assert_eq!(ct.default_count(), 1);
    }

    #[test]
    fn test_add_override() {
        let mut ct = ContentTypesManager::new();
        ct.add_override("/xl/workbook.xml", CT_WORKBOOK);
        assert_eq!(ct.override_count(), 1);
        assert!(ct.has_override("/xl/workbook.xml"));
    }

    #[test]
    fn test_add_workbook() {
        let mut ct = ContentTypesManager::new();
        ct.add_workbook();
        assert!(ct.has_override("/xl/workbook.xml"));
    }

    #[test]
    fn test_add_worksheet() {
        let mut ct = ContentTypesManager::new();
        ct.add_worksheet(1);
        ct.add_worksheet(2);
        assert!(ct.has_override("/xl/worksheets/sheet1.xml"));
        assert!(ct.has_override("/xl/worksheets/sheet2.xml"));
        assert_eq!(ct.override_count(), 2);
    }

    #[test]
    fn test_add_styles() {
        let mut ct = ContentTypesManager::new();
        ct.add_styles();
        assert!(ct.has_override("/xl/styles.xml"));
    }

    #[test]
    fn test_add_shared_strings() {
        let mut ct = ContentTypesManager::new();
        ct.add_shared_strings();
        assert!(ct.has_override("/xl/sharedStrings.xml"));
    }

    #[test]
    fn test_add_theme() {
        let mut ct = ContentTypesManager::new();
        ct.add_theme();
        assert!(ct.has_override("/xl/theme/theme1.xml"));
    }

    #[test]
    fn test_add_table() {
        let mut ct = ContentTypesManager::new();
        ct.add_table(1);
        ct.add_table(2);
        assert!(ct.has_override("/xl/tables/table1.xml"));
        assert!(ct.has_override("/xl/tables/table2.xml"));
    }

    #[test]
    fn test_add_chart() {
        let mut ct = ContentTypesManager::new();
        ct.add_chart(1);
        assert!(ct.has_override("/xl/charts/chart1.xml"));
    }

    #[test]
    fn test_add_drawing() {
        let mut ct = ContentTypesManager::new();
        ct.add_drawing(1);
        assert!(ct.has_override("/xl/drawings/drawing1.xml"));
    }

    #[test]
    fn test_add_comments() {
        let mut ct = ContentTypesManager::new();
        ct.add_comments(1);
        ct.add_comments(2);
        assert!(ct.has_override("/xl/comments1.xml"));
        assert!(ct.has_override("/xl/comments2.xml"));
    }

    #[test]
    fn test_add_core_properties() {
        let mut ct = ContentTypesManager::new();
        ct.add_core_properties();
        assert!(ct.has_override("/docProps/core.xml"));
    }

    #[test]
    fn test_add_extended_properties() {
        let mut ct = ContentTypesManager::new();
        ct.add_extended_properties();
        assert!(ct.has_override("/docProps/app.xml"));
    }

    #[test]
    fn test_add_pivot_table() {
        let mut ct = ContentTypesManager::new();
        ct.add_pivot_table(1);
        assert!(ct.has_override("/xl/pivotTables/pivotTable1.xml"));
    }

    #[test]
    fn test_add_pivot_cache() {
        let mut ct = ContentTypesManager::new();
        ct.add_pivot_cache(1);
        assert!(ct.has_override("/xl/pivotCache/pivotCacheDefinition1.xml"));
    }

    #[test]
    fn test_add_slicer() {
        let mut ct = ContentTypesManager::new();
        ct.add_slicer(1);
        ct.add_slicer(2);
        assert!(ct.has_override("/xl/slicers/slicer1.xml"));
        assert!(ct.has_override("/xl/slicers/slicer2.xml"));
    }

    #[test]
    fn test_add_slicer_cache() {
        let mut ct = ContentTypesManager::new();
        ct.add_slicer_cache(1);
        ct.add_slicer_cache(2);
        assert!(ct.has_override("/xl/slicerCaches/slicerCache1.xml"));
        assert!(ct.has_override("/xl/slicerCaches/slicerCache2.xml"));
    }

    #[test]
    fn test_add_image_defaults() {
        let mut ct = ContentTypesManager::new();
        ct.add_png_default();
        ct.add_jpeg_default();
        ct.add_gif_default();
        assert!(ct.has_default("png"));
        assert!(ct.has_default("jpeg"));
        assert!(ct.has_default("jpg"));
        assert!(ct.has_default("gif"));
    }

    #[test]
    fn test_add_vba_default() {
        let mut ct = ContentTypesManager::new();
        ct.add_vba_default();
        assert!(ct.has_default("bin"));
    }

    #[test]
    fn test_builder_pattern_chaining() {
        let mut ct = ContentTypesManager::with_xlsx_defaults();
        ct.add_workbook()
            .add_worksheet(1)
            .add_worksheet(2)
            .add_styles()
            .add_shared_strings()
            .add_theme();

        assert_eq!(ct.default_count(), 2);
        // workbook + sheet1 + sheet2 + styles + sharedStrings + theme = 6 overrides
        assert_eq!(ct.override_count(), 6);
    }

    #[test]
    fn test_has_override_with_and_without_slash() {
        let mut ct = ContentTypesManager::new();
        ct.add_override("/xl/workbook.xml", CT_WORKBOOK);

        // Both should work
        assert!(ct.has_override("/xl/workbook.xml"));
        assert!(ct.has_override("xl/workbook.xml"));
    }

    #[test]
    fn test_defaults_accessor() {
        let mut ct = ContentTypesManager::new();
        ct.add_default("xml", CT_XML);
        ct.add_default("rels", CT_RELATIONSHIPS);

        let defaults = ct.defaults();
        assert_eq!(defaults.len(), 2);
    }

    #[test]
    fn test_overrides_accessor() {
        let mut ct = ContentTypesManager::new();
        ct.add_workbook();
        ct.add_worksheet(1);

        let overrides = ct.overrides();
        assert_eq!(overrides.len(), 2);
    }

    #[test]
    fn test_to_xml_basic() {
        let mut ct = ContentTypesManager::with_xlsx_defaults();
        ct.add_workbook();
        ct.add_worksheet(1);

        let xml = ct.to_xml();
        let xml_str = String::from_utf8_lossy(&xml);

        // Check XML declaration
        assert!(
            xml_str.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>")
        );

        // Check namespace
        assert!(
            xml_str
                .contains("xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"")
        );

        // Check defaults
        assert!(xml_str.contains("<Default Extension=\"rels\""));
        assert!(xml_str.contains("<Default Extension=\"xml\""));

        // Check overrides
        assert!(xml_str.contains("<Override PartName=\"/xl/workbook.xml\""));
        assert!(xml_str.contains("<Override PartName=\"/xl/worksheets/sheet1.xml\""));
    }

    #[test]
    fn test_to_xml_content_types() {
        let mut ct = ContentTypesManager::with_xlsx_defaults();
        ct.add_workbook();

        let xml = ct.to_xml();
        let xml_str = String::from_utf8_lossy(&xml);

        // Check that content types are correct
        assert!(xml_str.contains(CT_RELATIONSHIPS));
        assert!(xml_str.contains(CT_XML));
        assert!(xml_str.contains(CT_WORKBOOK));
    }

    #[test]
    fn test_to_xml_complete() {
        let mut ct = ContentTypesManager::with_xlsx_defaults();
        ct.add_workbook()
            .add_worksheet(1)
            .add_worksheet(2)
            .add_styles()
            .add_shared_strings()
            .add_theme();

        let xml = ct.to_xml();
        let xml_str = String::from_utf8_lossy(&xml);

        assert!(xml_str.contains(CT_STYLES));
        assert!(xml_str.contains(CT_SHARED_STRINGS));
        assert!(xml_str.contains(CT_THEME));
        assert!(xml_str.contains("/xl/worksheets/sheet2.xml"));
    }

    #[test]
    fn test_create_xlsx_content_types_basic() {
        let ct = create_xlsx_content_types(1, true, true, true, 0, 0);

        assert!(ct.has_default("rels"));
        assert!(ct.has_default("xml"));
        assert!(ct.has_override("/xl/workbook.xml"));
        assert!(ct.has_override("/xl/worksheets/sheet1.xml"));
        assert!(ct.has_override("/xl/styles.xml"));
        assert!(ct.has_override("/xl/sharedStrings.xml"));
        assert!(ct.has_override("/xl/theme/theme1.xml"));
    }

    #[test]
    fn test_create_xlsx_content_types_multiple_sheets() {
        let ct = create_xlsx_content_types(3, false, false, false, 0, 0);

        assert!(ct.has_override("/xl/worksheets/sheet1.xml"));
        assert!(ct.has_override("/xl/worksheets/sheet2.xml"));
        assert!(ct.has_override("/xl/worksheets/sheet3.xml"));
        assert!(!ct.has_override("/xl/styles.xml"));
        assert!(!ct.has_override("/xl/sharedStrings.xml"));
        assert!(!ct.has_override("/xl/theme/theme1.xml"));
    }

    #[test]
    fn test_create_xlsx_content_types_with_tables_and_charts() {
        let ct = create_xlsx_content_types(1, true, true, true, 2, 3);

        assert!(ct.has_override("/xl/tables/table1.xml"));
        assert!(ct.has_override("/xl/tables/table2.xml"));
        assert!(ct.has_override("/xl/charts/chart1.xml"));
        assert!(ct.has_override("/xl/charts/chart2.xml"));
        assert!(ct.has_override("/xl/charts/chart3.xml"));
    }

    #[test]
    fn test_create_xlsx_content_types_minimal() {
        let ct = create_xlsx_content_types(1, false, false, false, 0, 0);

        // Should have defaults plus workbook and one worksheet
        assert_eq!(ct.default_count(), 2);
        assert_eq!(ct.override_count(), 2);
    }

    #[test]
    fn test_xml_output_valid_xml() {
        let mut ct = ContentTypesManager::with_xlsx_defaults();
        ct.add_workbook()
            .add_worksheet(1)
            .add_styles()
            .add_shared_strings();

        let xml = ct.to_xml();
        let xml_str = String::from_utf8_lossy(&xml);

        // Check well-formed XML structure
        assert!(xml_str.starts_with("<?xml"));
        assert!(xml_str.contains("<Types"));
        assert!(xml_str.contains("</Types>"));

        // All elements should be self-closing
        assert!(xml_str.contains("/>"));
    }

    #[test]
    fn test_constants() {
        // Verify constants have expected values
        assert!(CT_WORKBOOK.contains("spreadsheetml.sheet.main"));
        assert!(CT_WORKSHEET.contains("spreadsheetml.worksheet"));
        assert!(CT_STYLES.contains("spreadsheetml.styles"));
        assert!(CT_SHARED_STRINGS.contains("sharedStrings"));
        assert!(CT_THEME.contains("theme"));
        assert!(CT_RELATIONSHIPS.contains("relationships"));
        assert!(CT_DRAWING.contains("drawing"));
        assert!(CT_CHART.contains("chart"));
        assert!(CT_TABLE.contains("table"));
        assert!(CT_COMMENTS.contains("comments"));
        assert!(CT_PIVOT_TABLE.contains("pivotTable"));
        assert!(CT_PIVOT_CACHE.contains("pivotCacheDefinition"));
        assert!(CT_VBA.contains("vbaProject"));
        assert_eq!(CT_XML, "application/xml");
        assert_eq!(CT_PNG, "image/png");
        assert_eq!(CT_JPEG, "image/jpeg");
        assert_eq!(CT_GIF, "image/gif");
    }

    #[test]
    fn test_default_impl() {
        let ct = ContentTypesManager::default();
        assert_eq!(ct.default_count(), 0);
        assert_eq!(ct.override_count(), 0);
    }
}
