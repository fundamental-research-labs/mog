//! Relationship Manager for XLSX files
//!
//! This module manages OPC (Open Packaging Conventions) relationships used in XLSX files.
//! Relationships define how parts of the package are connected to each other.
//!
//! # XLSX Relationship Structure
//!
//! XLSX files contain multiple `.rels` files:
//! - `_rels/.rels` - Root relationships (workbook, core properties)
//! - `xl/_rels/workbook.xml.rels` - Workbook relationships (sheets, styles, theme)
//! - `xl/worksheets/_rels/sheet1.xml.rels` - Sheet relationships (comments, drawings)
//!
//! # Example XML Output
//!
//! ```xml
//! <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
//! <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
//!   <Relationship Id="rId1" Type="http://...worksheet" Target="worksheets/sheet1.xml"/>
//!   <Relationship Id="rId2" Type="http://...styles" Target="styles.xml"/>
//! </Relationships>
//! ```

pub use crate::infra::opc::{
    REL_CALC_CHAIN, REL_CHART, REL_CHART_EX, REL_COMMENTS, REL_CORE_PROPERTIES,
    REL_CUSTOM_PROPERTIES, REL_DIAGRAM_COLORS, REL_DIAGRAM_DATA, REL_DIAGRAM_DRAWING,
    REL_DIAGRAM_LAYOUT, REL_DIAGRAM_QUICK_STYLE, REL_DRAWING, REL_EXTENDED_PROPERTIES,
    REL_EXTERNAL_LINK, REL_HYPERLINK, REL_METADATA, REL_OFFICE_DOCUMENT, REL_OLE_OBJECT,
    REL_PERSON, REL_PIVOT_CACHE, REL_PIVOT_TABLE, REL_PRINTER_SETTINGS, REL_SHARED_STRINGS,
    REL_SLICER, REL_SLICER_CACHE, REL_STYLES, REL_TABLE, REL_THEME, REL_THREADED_COMMENT,
    REL_VML_DRAWING, REL_WORKSHEET, RELATIONSHIPS_NS,
};

// =============================================================================
// Relationship Struct
// =============================================================================

/// Represents a single relationship entry in a .rels file
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relationship {
    /// Relationship ID (rId1, rId2, etc.)
    pub id: String,
    /// Relationship type URI (one of the REL_* constants)
    pub rel_type: String,
    /// Target path or URL
    pub target: String,
    /// Target mode - "External" for external resources like hyperlinks, None for internal
    pub target_mode: Option<String>,
}

impl Relationship {
    /// Create a new internal relationship
    pub fn new(
        id: impl Into<String>,
        rel_type: impl Into<String>,
        target: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            rel_type: rel_type.into(),
            target: target.into(),
            target_mode: None,
        }
    }

    /// Create a new external relationship (e.g., for hyperlinks)
    pub fn external(
        id: impl Into<String>,
        rel_type: impl Into<String>,
        target: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            rel_type: rel_type.into(),
            target: target.into(),
            target_mode: Some("External".to_string()),
        }
    }

    /// Check if this is an external relationship
    pub fn is_external(&self) -> bool {
        self.target_mode.as_deref() == Some("External")
    }
}

// =============================================================================
// RelationshipManager
// =============================================================================

/// Manages a collection of relationships for a .rels file
///
/// # Example
///
/// ```ignore
/// use xlsx_parser::write::relationships::{RelationshipManager, REL_WORKSHEET, REL_STYLES};
///
/// let mut rels = RelationshipManager::new();
/// let sheet_id = rels.add(REL_WORKSHEET, "worksheets/sheet1.xml");
/// let styles_id = rels.add(REL_STYLES, "styles.xml");
///
/// let xml = rels.to_xml();
/// // xml contains the .rels file content
/// ```
#[derive(Debug, Clone, Default)]
pub struct RelationshipManager {
    /// Collection of relationships
    relationships: Vec<Relationship>,
    /// Counter for generating unique IDs
    next_id: u32,
}

impl RelationshipManager {
    /// Create a new empty relationship manager
    pub fn new() -> Self {
        Self {
            relationships: Vec::new(),
            next_id: 1,
        }
    }

    /// Add a relationship and return its ID (rId1, rId2, etc.)
    ///
    /// # Arguments
    /// * `rel_type` - The relationship type URI (use REL_* constants)
    /// * `target` - The relative path to the target file
    ///
    /// # Returns
    /// The generated relationship ID (e.g., "rId1")
    pub fn add(&mut self, rel_type: &str, target: &str) -> String {
        let id = format!("rId{}", self.next_id);
        self.next_id += 1;

        self.relationships
            .push(Relationship::new(id.clone(), rel_type, target));

        id
    }

    /// Add a relationship with a specific ID (for round-trip fidelity).
    ///
    /// Also bumps `next_id` past the given ID to prevent future `add()` calls
    /// from generating a conflicting ID.
    pub fn add_with_id(&mut self, id: &str, rel_type: &str, target: &str) {
        // Parse the numeric suffix from "rIdN" and bump next_id past it.
        if let Some(num_str) = id.strip_prefix("rId") {
            if let Ok(num) = num_str.parse::<u32>() {
                if num >= self.next_id {
                    self.next_id = num + 1;
                }
            }
        }
        self.relationships
            .push(Relationship::new(id.to_string(), rel_type, target));
    }

    /// Find an existing relationship by target path.
    /// Returns the relationship ID if found, or `None` if no relationship targets this path.
    pub fn find_by_target(&self, target: &str) -> Option<String> {
        self.relationships
            .iter()
            .find(|r| r.target == target)
            .map(|r| r.id.clone())
    }

    /// Replace any relationship for the same type+target with the provided ID,
    /// or add it if it does not already exist.
    pub fn set_with_id(&mut self, id: &str, rel_type: &str, target: &str) {
        if let Some(num_str) = id.strip_prefix("rId") {
            if let Ok(num) = num_str.parse::<u32>() {
                if num >= self.next_id {
                    self.next_id = num + 1;
                }
            }
        }
        if let Some(existing) = self
            .relationships
            .iter_mut()
            .find(|r| r.rel_type == rel_type && r.target == target)
        {
            existing.id = id.to_string();
            existing.target_mode = None;
            return;
        }
        self.add_with_id(id, rel_type, target);
    }

    /// Add an external relationship (e.g., for hyperlinks)
    ///
    /// # Arguments
    /// * `rel_type` - The relationship type URI
    /// * `target` - The external URL or path
    ///
    /// # Returns
    /// The generated relationship ID (e.g., "rId1")
    pub fn add_external(&mut self, rel_type: &str, target: &str) -> String {
        let id = format!("rId{}", self.next_id);
        self.next_id += 1;

        self.relationships
            .push(Relationship::external(id.clone(), rel_type, target));

        id
    }

    /// Add an external relationship with a specific ID.
    pub fn add_external_with_id(&mut self, id: &str, rel_type: &str, target: &str) {
        if let Some(num_str) = id.strip_prefix("rId") {
            if let Ok(num) = num_str.parse::<u32>() {
                if num >= self.next_id {
                    self.next_id = num + 1;
                }
            }
        }
        self.relationships
            .push(Relationship::external(id.to_string(), rel_type, target));
    }

    /// Get all relationships
    pub fn relationships(&self) -> &[Relationship] {
        &self.relationships
    }

    /// Check if any relationships exist
    pub fn is_empty(&self) -> bool {
        self.relationships.is_empty()
    }

    /// Get the number of relationships
    pub fn len(&self) -> usize {
        self.relationships.len()
    }

    /// Get a relationship by its ID
    pub fn get_by_id(&self, id: &str) -> Option<&Relationship> {
        self.relationships.iter().find(|r| r.id == id)
    }

    /// Check if a relationship with the given type already exists.
    pub fn has_rel_type(&self, rel_type: &str) -> bool {
        self.relationships.iter().any(|r| r.rel_type == rel_type)
    }

    /// Add a relationship only if no relationship with the same type exists.
    /// Returns the ID of the existing or newly added relationship.
    pub fn add_if_missing(&mut self, rel_type: &str, target: &str) -> String {
        if let Some(existing) = self.relationships.iter().find(|r| r.rel_type == rel_type) {
            return existing.id.clone();
        }
        self.add(rel_type, target)
    }

    /// Create a RelationshipManager from resolved relationship records.
    pub fn from_relationships(relationships: Vec<Relationship>) -> Self {
        let next_id = relationships
            .iter()
            .filter_map(|r| r.id.strip_prefix("rId")?.parse::<u32>().ok())
            .max()
            .map_or(1, |max_id| max_id + 1);

        Self {
            relationships,
            next_id,
        }
    }

    /// Create a RelationshipManager from original OPC relationships.
    ///
    /// This replays stored relationships with their original IDs, types, targets,
    /// and order — used during round-trip writing to preserve fidelity.
    pub fn from_original(rels: &[ooxml_types::shared::OpcRelationship]) -> Self {
        let relationships: Vec<Relationship> = rels
            .iter()
            .map(|r| Relationship {
                id: r.id.clone(),
                rel_type: r.rel_type.clone(),
                target: r.target.clone(),
                target_mode: r.target_mode.clone(),
            })
            .collect();

        Self::from_relationships(relationships)
    }

    /// Generate the .rels XML content
    ///
    /// # Returns
    /// The XML content as bytes, ready to be written to a .rels file
    pub fn to_xml(&self) -> Vec<u8> {
        let mut xml = Vec::with_capacity(512);

        // XML declaration
        xml.extend_from_slice(b"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n");

        // Relationships element with namespace
        xml.extend_from_slice(b"<Relationships xmlns=\"");
        xml.extend_from_slice(RELATIONSHIPS_NS.as_bytes());
        xml.extend_from_slice(b"\">");

        // Individual relationships
        for rel in &self.relationships {
            xml.extend_from_slice(b"<Relationship Id=\"");
            xml.extend_from_slice(rel.id.as_bytes());
            xml.extend_from_slice(b"\" Type=\"");
            xml.extend_from_slice(rel.rel_type.as_bytes());
            xml.extend_from_slice(b"\" Target=\"");
            // Escape XML special characters in target
            xml.extend_from_slice(&escape_xml_attr(&rel.target));
            xml.push(b'"');

            // Add TargetMode if external
            if let Some(ref mode) = rel.target_mode {
                xml.extend_from_slice(b" TargetMode=\"");
                xml.extend_from_slice(mode.as_bytes());
                xml.push(b'"');
            }

            xml.extend_from_slice(b"/>");
        }

        xml.extend_from_slice(b"</Relationships>");

        xml
    }
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Escape XML special characters in attribute values
fn escape_xml_attr(s: &str) -> Vec<u8> {
    let mut result = Vec::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'&' => result.extend_from_slice(b"&amp;"),
            b'<' => result.extend_from_slice(b"&lt;"),
            b'>' => result.extend_from_slice(b"&gt;"),
            b'"' => result.extend_from_slice(b"&quot;"),
            b'\'' => result.extend_from_slice(b"&apos;"),
            _ => result.push(byte),
        }
    }
    result
}

/// Create root relationships (_rels/.rels)
///
/// This creates the top-level relationships file that typically points to:
/// - The main workbook (xl/workbook.xml)
/// - Core properties (docProps/core.xml) - optional
/// - Extended properties (docProps/app.xml) - optional
///
/// # Arguments
/// * `workbook_path` - Path to the workbook, typically "xl/workbook.xml"
///
/// # Returns
/// A RelationshipManager with the root relationships
pub fn create_root_rels(workbook_path: &str) -> RelationshipManager {
    let mut rels = RelationshipManager::new();
    rels.add(REL_OFFICE_DOCUMENT, workbook_path);
    rels
}

/// Create root relationships with optional core and app properties
///
/// # Arguments
/// * `workbook_path` - Path to the workbook, typically "xl/workbook.xml"
/// * `has_core_props` - Include core properties relationship
/// * `has_app_props` - Include extended (app) properties relationship
///
/// # Returns
/// A RelationshipManager with the root relationships
pub fn create_root_rels_full(
    workbook_path: &str,
    has_core_props: bool,
    has_app_props: bool,
) -> RelationshipManager {
    create_root_rels_full_with_custom(workbook_path, has_core_props, has_app_props, false)
}

/// Create root relationships with optional custom properties support.
///
/// # Arguments
/// * `workbook_path` - Path to the workbook, typically "xl/workbook.xml"
/// * `has_core_props` - Include core properties relationship
/// * `has_app_props` - Include extended (app) properties relationship
/// * `has_custom_props` - Include custom properties relationship
///
/// # Returns
/// A RelationshipManager with the root relationships
pub fn create_root_rels_full_with_custom(
    workbook_path: &str,
    has_core_props: bool,
    has_app_props: bool,
    has_custom_props: bool,
) -> RelationshipManager {
    let mut rels = RelationshipManager::new();
    // Root rels use absolute paths (leading /)
    let wb = if workbook_path.starts_with('/') {
        workbook_path.to_string()
    } else {
        format!("/{}", workbook_path)
    };
    rels.add(REL_OFFICE_DOCUMENT, &wb);

    if has_core_props {
        rels.add(REL_CORE_PROPERTIES, "/docProps/core.xml");
    }

    if has_app_props {
        rels.add(REL_EXTENDED_PROPERTIES, "/docProps/app.xml");
    }

    if has_custom_props {
        rels.add(REL_CUSTOM_PROPERTIES, "/docProps/custom.xml");
    }

    rels
}

/// Create workbook relationships (xl/_rels/workbook.xml.rels)
///
/// # Arguments
/// * `sheet_count` - Number of worksheets
/// * `has_styles` - Include styles relationship
/// * `has_theme` - Include theme relationship
/// * `has_shared_strings` - Include shared strings relationship
///
/// # Returns
/// A RelationshipManager with the workbook relationships
pub fn create_workbook_rels(
    sheet_count: usize,
    has_styles: bool,
    has_theme: bool,
    has_shared_strings: bool,
) -> RelationshipManager {
    let mut rels = RelationshipManager::new();

    // Add worksheet relationships
    for i in 1..=sheet_count {
        rels.add(REL_WORKSHEET, &format!("worksheets/sheet{}.xml", i));
    }

    // Add optional component relationships
    if has_styles {
        rels.add(REL_STYLES, "styles.xml");
    }

    if has_theme {
        rels.add(REL_THEME, "theme/theme1.xml");
    }

    if has_shared_strings {
        rels.add(REL_SHARED_STRINGS, "sharedStrings.xml");
    }

    rels
}

/// Create a sheet relationships file (xl/worksheets/_rels/sheetN.xml.rels)
///
/// This is typically used when a worksheet has associated content like:
/// - Comments
/// - Drawings
/// - Tables
/// - Hyperlinks (external)
///
/// # Returns
/// A new empty RelationshipManager to be populated with sheet-specific relationships
pub fn create_sheet_rels() -> RelationshipManager {
    RelationshipManager::new()
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // Relationship struct tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_relationship_new() {
        let rel = Relationship::new("rId1", REL_WORKSHEET, "worksheets/sheet1.xml");

        assert_eq!(rel.id, "rId1");
        assert_eq!(rel.rel_type, REL_WORKSHEET);
        assert_eq!(rel.target, "worksheets/sheet1.xml");
        assert_eq!(rel.target_mode, None);
        assert!(!rel.is_external());
    }

    #[test]
    fn test_relationship_external() {
        let rel = Relationship::external("rId1", REL_HYPERLINK, "https://example.com");

        assert_eq!(rel.id, "rId1");
        assert_eq!(rel.rel_type, REL_HYPERLINK);
        assert_eq!(rel.target, "https://example.com");
        assert_eq!(rel.target_mode, Some("External".to_string()));
        assert!(rel.is_external());
    }

    // -------------------------------------------------------------------------
    // RelationshipManager tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_manager_new() {
        let mgr = RelationshipManager::new();

        assert!(mgr.is_empty());
        assert_eq!(mgr.len(), 0);
        assert_eq!(mgr.relationships().len(), 0);
    }

    #[test]
    fn test_manager_add() {
        let mut mgr = RelationshipManager::new();

        let id1 = mgr.add(REL_WORKSHEET, "worksheets/sheet1.xml");
        let id2 = mgr.add(REL_WORKSHEET, "worksheets/sheet2.xml");
        let id3 = mgr.add(REL_STYLES, "styles.xml");

        assert_eq!(id1, "rId1");
        assert_eq!(id2, "rId2");
        assert_eq!(id3, "rId3");
        assert_eq!(mgr.len(), 3);
        assert!(!mgr.is_empty());
    }

    #[test]
    fn test_manager_add_external() {
        let mut mgr = RelationshipManager::new();

        let id1 = mgr.add(REL_WORKSHEET, "worksheets/sheet1.xml");
        let id2 = mgr.add_external(REL_HYPERLINK, "https://example.com");

        assert_eq!(id1, "rId1");
        assert_eq!(id2, "rId2");
        assert_eq!(mgr.len(), 2);

        let rel = mgr.get_by_id("rId2").unwrap();
        assert!(rel.is_external());
    }

    #[test]
    fn test_manager_get_by_id() {
        let mut mgr = RelationshipManager::new();
        mgr.add(REL_WORKSHEET, "worksheets/sheet1.xml");
        mgr.add(REL_STYLES, "styles.xml");

        let rel = mgr.get_by_id("rId1").unwrap();
        assert_eq!(rel.target, "worksheets/sheet1.xml");

        let rel = mgr.get_by_id("rId2").unwrap();
        assert_eq!(rel.target, "styles.xml");

        assert!(mgr.get_by_id("rId999").is_none());
    }

    #[test]
    fn test_manager_empty_to_xml() {
        let mgr = RelationshipManager::new();
        let xml = mgr.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"));
        assert!(xml_str.contains(
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        ));
        assert!(xml_str.contains("</Relationships>"));
        // Note: We check for "<Relationship " (with space) to avoid matching "<Relationships"
        assert!(!xml_str.contains("<Relationship "));
    }

    #[test]
    fn test_manager_to_xml_single() {
        let mut mgr = RelationshipManager::new();
        mgr.add(REL_WORKSHEET, "worksheets/sheet1.xml");

        let xml = mgr.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("Id=\"rId1\""));
        assert!(xml_str.contains(&format!("Type=\"{}\"", REL_WORKSHEET)));
        assert!(xml_str.contains("Target=\"worksheets/sheet1.xml\""));
        assert!(!xml_str.contains("TargetMode="));
    }

    #[test]
    fn test_manager_to_xml_multiple() {
        let mut mgr = RelationshipManager::new();
        mgr.add(REL_WORKSHEET, "worksheets/sheet1.xml");
        mgr.add(REL_WORKSHEET, "worksheets/sheet2.xml");
        mgr.add(REL_STYLES, "styles.xml");

        let xml = mgr.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("Id=\"rId1\""));
        assert!(xml_str.contains("Id=\"rId2\""));
        assert!(xml_str.contains("Id=\"rId3\""));
        assert!(xml_str.contains("worksheets/sheet1.xml"));
        assert!(xml_str.contains("worksheets/sheet2.xml"));
        assert!(xml_str.contains("styles.xml"));
    }

    #[test]
    fn test_manager_to_xml_external() {
        let mut mgr = RelationshipManager::new();
        mgr.add_external(REL_HYPERLINK, "https://example.com");

        let xml = mgr.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("Id=\"rId1\""));
        assert!(xml_str.contains(&format!("Type=\"{}\"", REL_HYPERLINK)));
        assert!(xml_str.contains("Target=\"https://example.com\""));
        assert!(xml_str.contains("TargetMode=\"External\""));
    }

    #[test]
    fn test_manager_to_xml_escaping() {
        let mut mgr = RelationshipManager::new();
        mgr.add_external(REL_HYPERLINK, "https://example.com?foo=1&bar=2");

        let xml = mgr.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // & should be escaped as &amp;
        assert!(xml_str.contains("Target=\"https://example.com?foo=1&amp;bar=2\""));
    }

    #[test]
    fn test_manager_to_xml_escaping_quotes() {
        let mut mgr = RelationshipManager::new();
        mgr.add(REL_WORKSHEET, "sheet\"test.xml");

        let xml = mgr.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("Target=\"sheet&quot;test.xml\""));
    }

    // -------------------------------------------------------------------------
    // Helper function tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_create_root_rels() {
        let rels = create_root_rels("xl/workbook.xml");

        assert_eq!(rels.len(), 1);

        let rel = rels.get_by_id("rId1").unwrap();
        assert_eq!(rel.rel_type, REL_OFFICE_DOCUMENT);
        assert_eq!(rel.target, "xl/workbook.xml");
    }

    #[test]
    fn test_create_root_rels_full() {
        let rels = create_root_rels_full("xl/workbook.xml", true, true);

        assert_eq!(rels.len(), 3);

        let rel1 = rels.get_by_id("rId1").unwrap();
        assert_eq!(rel1.rel_type, REL_OFFICE_DOCUMENT);
        assert_eq!(rel1.target, "/xl/workbook.xml");

        let rel2 = rels.get_by_id("rId2").unwrap();
        assert_eq!(rel2.rel_type, REL_CORE_PROPERTIES);
        assert_eq!(rel2.target, "/docProps/core.xml");

        let rel3 = rels.get_by_id("rId3").unwrap();
        assert_eq!(rel3.rel_type, REL_EXTENDED_PROPERTIES);
        assert_eq!(rel3.target, "/docProps/app.xml");
    }

    #[test]
    fn test_create_root_rels_full_partial() {
        let rels = create_root_rels_full("xl/workbook.xml", true, false);

        assert_eq!(rels.len(), 2);

        let rel2 = rels.get_by_id("rId2").unwrap();
        assert_eq!(rel2.rel_type, REL_CORE_PROPERTIES);
        assert_eq!(rel2.target, "/docProps/core.xml");
    }

    #[test]
    fn test_create_workbook_rels_minimal() {
        let rels = create_workbook_rels(1, false, false, false);

        assert_eq!(rels.len(), 1);

        let rel = rels.get_by_id("rId1").unwrap();
        assert_eq!(rel.rel_type, REL_WORKSHEET);
        assert_eq!(rel.target, "worksheets/sheet1.xml");
    }

    #[test]
    fn test_create_workbook_rels_multiple_sheets() {
        let rels = create_workbook_rels(3, false, false, false);

        assert_eq!(rels.len(), 3);

        assert_eq!(
            rels.get_by_id("rId1").unwrap().target,
            "worksheets/sheet1.xml"
        );
        assert_eq!(
            rels.get_by_id("rId2").unwrap().target,
            "worksheets/sheet2.xml"
        );
        assert_eq!(
            rels.get_by_id("rId3").unwrap().target,
            "worksheets/sheet3.xml"
        );
    }

    #[test]
    fn test_create_workbook_rels_full() {
        let rels = create_workbook_rels(2, true, true, true);

        assert_eq!(rels.len(), 5);

        // Worksheets first
        assert_eq!(rels.get_by_id("rId1").unwrap().rel_type, REL_WORKSHEET);
        assert_eq!(rels.get_by_id("rId2").unwrap().rel_type, REL_WORKSHEET);

        // Then styles, theme, shared strings
        assert_eq!(rels.get_by_id("rId3").unwrap().rel_type, REL_STYLES);
        assert_eq!(rels.get_by_id("rId3").unwrap().target, "styles.xml");

        assert_eq!(rels.get_by_id("rId4").unwrap().rel_type, REL_THEME);
        assert_eq!(rels.get_by_id("rId4").unwrap().target, "theme/theme1.xml");

        assert_eq!(rels.get_by_id("rId5").unwrap().rel_type, REL_SHARED_STRINGS);
        assert_eq!(rels.get_by_id("rId5").unwrap().target, "sharedStrings.xml");
    }

    #[test]
    fn test_create_sheet_rels() {
        let rels = create_sheet_rels();
        assert!(rels.is_empty());
    }

    // -------------------------------------------------------------------------
    // XML escape tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_escape_xml_attr_no_escaping() {
        let result = escape_xml_attr("simple text");
        assert_eq!(result, b"simple text");
    }

    #[test]
    fn test_escape_xml_attr_ampersand() {
        let result = escape_xml_attr("a & b");
        assert_eq!(result, b"a &amp; b");
    }

    #[test]
    fn test_escape_xml_attr_all_entities() {
        let result = escape_xml_attr("<\"&'>test");
        assert_eq!(result, b"&lt;&quot;&amp;&apos;&gt;test");
    }

    // -------------------------------------------------------------------------
    // Constant tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_relationship_type_constants() {
        // Verify constants have expected prefixes
        assert!(REL_WORKSHEET.starts_with("http://schemas.openxmlformats.org/"));
        assert!(REL_STYLES.starts_with("http://schemas.openxmlformats.org/"));
        assert!(REL_THEME.starts_with("http://schemas.openxmlformats.org/"));
        assert!(REL_SHARED_STRINGS.starts_with("http://schemas.openxmlformats.org/"));
        assert!(REL_OFFICE_DOCUMENT.starts_with("http://schemas.openxmlformats.org/"));
        assert!(REL_CORE_PROPERTIES.starts_with("http://schemas.openxmlformats.org/"));
        assert!(REL_DRAWING.starts_with("http://schemas.openxmlformats.org/"));
        assert!(REL_COMMENTS.starts_with("http://schemas.openxmlformats.org/"));
        assert!(REL_TABLE.starts_with("http://schemas.openxmlformats.org/"));
        assert!(REL_CHART.starts_with("http://schemas.openxmlformats.org/"));
        assert!(REL_HYPERLINK.starts_with("http://schemas.openxmlformats.org/"));
        assert!(REL_PIVOT_CACHE.starts_with("http://schemas.openxmlformats.org/"));
    }

    #[test]
    fn test_relationships_namespace() {
        assert_eq!(
            RELATIONSHIPS_NS,
            "http://schemas.openxmlformats.org/package/2006/relationships"
        );
    }

    // -------------------------------------------------------------------------
    // Integration-style tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_realistic_workbook_rels_xml() {
        let rels = create_workbook_rels(2, true, true, true);
        let xml = rels.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // Verify XML structure
        assert!(
            xml_str.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>")
        );
        assert!(xml_str.contains(&format!("xmlns=\"{}\"", RELATIONSHIPS_NS)));

        // Verify all expected relationships are present
        assert!(xml_str.contains("worksheets/sheet1.xml"));
        assert!(xml_str.contains("worksheets/sheet2.xml"));
        assert!(xml_str.contains("styles.xml"));
        assert!(xml_str.contains("theme/theme1.xml"));
        assert!(xml_str.contains("sharedStrings.xml"));

        // Verify structure
        let relationship_count = xml_str.matches("<Relationship ").count();
        assert_eq!(relationship_count, 5);
    }

    #[test]
    fn test_realistic_root_rels_xml() {
        let rels = create_root_rels_full("xl/workbook.xml", true, true);
        let xml = rels.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("/xl/workbook.xml"));
        assert!(xml_str.contains("/docProps/core.xml"));
        assert!(xml_str.contains("/docProps/app.xml"));
        assert!(xml_str.contains(REL_OFFICE_DOCUMENT));
        assert!(xml_str.contains(REL_CORE_PROPERTIES));
        assert!(xml_str.contains(REL_EXTENDED_PROPERTIES));
    }

    #[test]
    fn test_sheet_rels_with_hyperlinks_and_comments() {
        let mut rels = create_sheet_rels();
        rels.add_external(REL_HYPERLINK, "https://google.com");
        rels.add_external(REL_HYPERLINK, "https://github.com");
        rels.add(REL_COMMENTS, "../comments1.xml");
        rels.add(REL_VML_DRAWING, "../drawings/vmlDrawing1.vml");

        let xml = rels.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert_eq!(rels.len(), 4);
        assert!(xml_str.contains("https://google.com"));
        assert!(xml_str.contains("https://github.com"));
        assert!(xml_str.contains("TargetMode=\"External\""));
        assert!(xml_str.contains("../comments1.xml"));
        assert!(xml_str.contains("../drawings/vmlDrawing1.vml"));

        // External links should have TargetMode, internal should not
        let external_count = xml_str.matches("TargetMode=\"External\"").count();
        assert_eq!(external_count, 2);
    }

    // -------------------------------------------------------------------------
    // from_original() round-trip fidelity tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_from_original_preserves_non_sequential_ids() {
        // Simulate an original file where styles/theme come before worksheets
        // (rId1=styles, rId2=theme, rId3=sheet1, rId4=sheet2)
        let original = vec![
            ooxml_types::shared::OpcRelationship {
                id: "rId1".into(),
                rel_type: REL_STYLES.into(),
                target: "styles.xml".into(),
                target_mode: None,
            },
            ooxml_types::shared::OpcRelationship {
                id: "rId2".into(),
                rel_type: REL_THEME.into(),
                target: "theme/theme1.xml".into(),
                target_mode: None,
            },
            ooxml_types::shared::OpcRelationship {
                id: "rId3".into(),
                rel_type: REL_WORKSHEET.into(),
                target: "worksheets/sheet1.xml".into(),
                target_mode: None,
            },
            ooxml_types::shared::OpcRelationship {
                id: "rId4".into(),
                rel_type: REL_WORKSHEET.into(),
                target: "worksheets/sheet2.xml".into(),
                target_mode: None,
            },
        ];

        let mgr = RelationshipManager::from_original(&original);

        assert_eq!(mgr.len(), 4);
        // IDs preserved — styles at rId1, NOT worksheets
        assert_eq!(mgr.get_by_id("rId1").unwrap().rel_type, REL_STYLES);
        assert_eq!(mgr.get_by_id("rId2").unwrap().rel_type, REL_THEME);
        assert_eq!(mgr.get_by_id("rId3").unwrap().rel_type, REL_WORKSHEET);
        assert_eq!(
            mgr.get_by_id("rId3").unwrap().target,
            "worksheets/sheet1.xml"
        );
        assert_eq!(mgr.get_by_id("rId4").unwrap().rel_type, REL_WORKSHEET);
    }

    #[test]
    fn test_from_original_preserves_gaps_in_ids() {
        // Original file with gaps: rId1, rId5, rId10
        let original = vec![
            ooxml_types::shared::OpcRelationship {
                id: "rId1".into(),
                rel_type: REL_WORKSHEET.into(),
                target: "worksheets/sheet1.xml".into(),
                target_mode: None,
            },
            ooxml_types::shared::OpcRelationship {
                id: "rId5".into(),
                rel_type: REL_STYLES.into(),
                target: "styles.xml".into(),
                target_mode: None,
            },
            ooxml_types::shared::OpcRelationship {
                id: "rId10".into(),
                rel_type: REL_SHARED_STRINGS.into(),
                target: "sharedStrings.xml".into(),
                target_mode: None,
            },
        ];

        let mgr = RelationshipManager::from_original(&original);

        assert_eq!(mgr.len(), 3);
        assert_eq!(
            mgr.get_by_id("rId1").unwrap().target,
            "worksheets/sheet1.xml"
        );
        assert_eq!(mgr.get_by_id("rId5").unwrap().target, "styles.xml");
        assert_eq!(mgr.get_by_id("rId10").unwrap().target, "sharedStrings.xml");

        // next_id should be past the highest original (10 + 1 = 11)
        let new_id = mgr.clone().add(REL_WORKSHEET, "worksheets/sheet2.xml");
        assert_eq!(new_id, "rId11");
    }

    #[test]
    fn test_from_original_xml_matches_original_ids() {
        // Verify the XML output uses original IDs, not sequential
        let original = vec![
            ooxml_types::shared::OpcRelationship {
                id: "rId5".into(),
                rel_type: REL_WORKSHEET.into(),
                target: "worksheets/sheet1.xml".into(),
                target_mode: None,
            },
            ooxml_types::shared::OpcRelationship {
                id: "rId3".into(),
                rel_type: REL_STYLES.into(),
                target: "styles.xml".into(),
                target_mode: None,
            },
        ];

        let mgr = RelationshipManager::from_original(&original);
        let xml = mgr.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // Must contain original IDs, NOT rId1/rId2
        assert!(xml_str.contains("Id=\"rId5\""));
        assert!(xml_str.contains("Id=\"rId3\""));
        assert!(!xml_str.contains("Id=\"rId1\""));
        assert!(!xml_str.contains("Id=\"rId2\""));
    }

    #[test]
    fn test_from_original_preserves_external_target_mode() {
        let original = vec![ooxml_types::shared::OpcRelationship {
            id: "rId7".into(),
            rel_type: REL_HYPERLINK.into(),
            target: "https://example.com".into(),
            target_mode: Some("External".into()),
        }];

        let mgr = RelationshipManager::from_original(&original);
        let rel = mgr.get_by_id("rId7").unwrap();

        assert_eq!(rel.target_mode, Some("External".to_string()));

        let xml = String::from_utf8(mgr.to_xml()).unwrap();
        assert!(xml.contains("TargetMode=\"External\""));
    }

    #[test]
    fn test_from_original_order_preserved() {
        // Verify relationships come out in the same order as input
        let original = vec![
            ooxml_types::shared::OpcRelationship {
                id: "rId3".into(),
                rel_type: REL_STYLES.into(),
                target: "styles.xml".into(),
                target_mode: None,
            },
            ooxml_types::shared::OpcRelationship {
                id: "rId1".into(),
                rel_type: REL_WORKSHEET.into(),
                target: "worksheets/sheet1.xml".into(),
                target_mode: None,
            },
        ];

        let mgr = RelationshipManager::from_original(&original);
        let rels = mgr.relationships();

        // Order matches input, not sorted by ID
        assert_eq!(rels[0].id, "rId3");
        assert_eq!(rels[0].rel_type, REL_STYLES);
        assert_eq!(rels[1].id, "rId1");
        assert_eq!(rels[1].rel_type, REL_WORKSHEET);
    }
}
