//! Content Types parser for XLSX files
//!
//! This module parses the `[Content_Types].xml` file which is the manifest of an XLSX
//! archive. It maps file extensions and specific paths to their content types.
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
//!
//! # Common Content Types in XLSX
//!
//! - Workbook: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml`
//! - Worksheet: `application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml`
//! - Shared Strings: `application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml`
//! - Styles: `application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml`
//! - Theme: `application/vnd.openxmlformats-officedocument.theme+xml`

use std::collections::HashMap;

use quick_xml::events::{BytesStart, Event};
use quick_xml::name::{Namespace, ResolveResult};
use quick_xml::reader::NsReader;

// =============================================================================
// Constants - XLSX Content Type URIs
// =============================================================================

/// Content type for main workbook
pub const CONTENT_TYPE_WORKBOOK: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";

/// Content type for worksheets
pub const CONTENT_TYPE_WORKSHEET: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";

/// Content type for shared strings
pub const CONTENT_TYPE_SHARED_STRINGS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml";

/// Content type for styles
pub const CONTENT_TYPE_STYLES: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml";

/// Content type for theme
pub const CONTENT_TYPE_THEME: &str = "application/vnd.openxmlformats-officedocument.theme+xml";

/// Content type for relationships
pub const CONTENT_TYPE_RELATIONSHIPS: &str =
    "application/vnd.openxmlformats-package.relationships+xml";

/// Content type for chartsheets
pub const CONTENT_TYPE_CHARTSHEET: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml";

/// Content type for comments
pub const CONTENT_TYPE_COMMENTS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml";

/// Content type for tables
pub const CONTENT_TYPE_TABLE: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml";

/// Content type for pivot tables
pub const CONTENT_TYPE_PIVOT_TABLE: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml";

/// Content type for drawings
pub const CONTENT_TYPE_DRAWING: &str = "application/vnd.openxmlformats-officedocument.drawing+xml";

const CONTENT_TYPES_NS: &str = "http://schemas.openxmlformats.org/package/2006/content-types";

// =============================================================================
// Error Types
// =============================================================================

/// Error types for content types parsing
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    /// The XML is malformed or cannot be parsed
    MalformedXml,
    /// Missing required element
    MissingElement(&'static str),
    /// Invalid attribute value
    InvalidAttribute(&'static str),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::MalformedXml => write!(f, "Malformed XML in [Content_Types].xml"),
            ParseError::MissingElement(elem) => write!(f, "Missing element: {}", elem),
            ParseError::InvalidAttribute(attr) => write!(f, "Invalid attribute: {}", attr),
        }
    }
}

impl std::error::Error for ParseError {}

// =============================================================================
// ContentTypes Struct
// =============================================================================

/// Parsed content types from `[Content_Types].xml`
///
/// Provides efficient lookup of content types by path and discovery of
/// parts by content type.
#[derive(Debug, Clone, Default)]
pub struct ContentTypes {
    /// Override mappings: path -> content type
    /// Paths are normalized (leading slash removed)
    overrides: HashMap<String, String>,
    /// Default mappings: extension -> content type
    defaults: HashMap<String, String>,
    /// Ordered list of default entries, preserving original XML order for round-trip fidelity.
    ordered_defaults_list: Vec<(String, String)>,
    /// Ordered list of override entries, preserving original XML order for round-trip fidelity.
    ordered_overrides_list: Vec<(String, String)>,
}

impl ContentTypes {
    /// Create a new empty ContentTypes
    pub fn new() -> Self {
        Self {
            overrides: HashMap::new(),
            defaults: HashMap::new(),
            ordered_defaults_list: Vec::new(),
            ordered_overrides_list: Vec::new(),
        }
    }

    /// Parse `[Content_Types].xml` from raw bytes
    pub fn parse(xml: &[u8]) -> Result<Self, ParseError> {
        let mut content_types = ContentTypes::new();
        let mut reader = NsReader::from_reader(xml);
        reader.config_mut().trim_text(false);
        reader.config_mut().expand_empty_elements = false;
        let mut buf = Vec::new();
        let mut saw_types = false;

        loop {
            let (ns, event) = reader
                .read_resolved_event_into(&mut buf)
                .map_err(|_| ParseError::MalformedXml)?;
            match event {
                Event::Start(start) | Event::Empty(start) => {
                    let local = start.local_name();
                    let local = local.as_ref();
                    if local == b"Types" && is_opc_content_types_ns(&ns) {
                        saw_types = true;
                    } else if local == b"Default" && is_opc_content_types_ns(&ns) {
                        if let Some((ext, content_type)) = parse_default_element(&start) {
                            content_types
                                .ordered_defaults_list
                                .push((ext.clone(), content_type.clone()));
                            content_types.defaults.insert(ext, content_type);
                        }
                    } else if local == b"Override"
                        && is_opc_content_types_ns(&ns)
                        && let Some((part_name, content_type)) = parse_override_element(&start)
                    {
                        let normalized = normalize_path(&part_name);
                        content_types
                            .ordered_overrides_list
                            .push((normalized.clone(), content_type.clone()));
                        content_types.overrides.insert(normalized, content_type);
                    }
                }
                Event::Eof => break,
                Event::End(_)
                | Event::Text(_)
                | Event::CData(_)
                | Event::Comment(_)
                | Event::Decl(_)
                | Event::PI(_)
                | Event::DocType(_) => {}
            }
            buf.clear();
        }

        if !saw_types {
            return Err(ParseError::MissingElement("Types"));
        }

        Ok(content_types)
    }

    /// Get the content type for a given path
    pub fn get_type(&self, path: &str) -> Option<&str> {
        let normalized = normalize_path(path);

        // First check overrides (more specific)
        if let Some(content_type) = self.overrides.get(&normalized) {
            return Some(content_type.as_str());
        }

        // Fall back to defaults based on extension
        if let Some(ext) = get_extension(&normalized) {
            if let Some(content_type) = self.defaults.get(ext) {
                return Some(content_type.as_str());
            }
        }

        None
    }

    /// Find all parts with a specific content type
    pub fn find_parts_by_type(&self, content_type: &str) -> Vec<&str> {
        self.overrides
            .iter()
            .filter(|(_, ct)| ct.as_str() == content_type)
            .map(|(path, _)| path.as_str())
            .collect()
    }

    /// Get all worksheet parts
    pub fn worksheet_parts(&self) -> Vec<&str> {
        self.find_parts_by_type(CONTENT_TYPE_WORKSHEET)
    }

    /// Check if a path is a worksheet
    pub fn is_worksheet(&self, path: &str) -> bool {
        self.get_type(path)
            .map(|ct| ct == CONTENT_TYPE_WORKSHEET)
            .unwrap_or(false)
    }

    /// Get the main workbook path
    pub fn workbook_path(&self) -> Option<&str> {
        self.find_parts_by_type(CONTENT_TYPE_WORKBOOK)
            .into_iter()
            .next()
    }

    /// Get the shared strings path
    pub fn shared_strings_path(&self) -> Option<&str> {
        self.find_parts_by_type(CONTENT_TYPE_SHARED_STRINGS)
            .into_iter()
            .next()
    }

    /// Get the styles path
    pub fn styles_path(&self) -> Option<&str> {
        self.find_parts_by_type(CONTENT_TYPE_STYLES)
            .into_iter()
            .next()
    }

    /// Get the theme path
    pub fn theme_path(&self) -> Option<&str> {
        self.find_parts_by_type(CONTENT_TYPE_THEME)
            .into_iter()
            .next()
    }

    /// Get all table parts
    pub fn table_parts(&self) -> Vec<&str> {
        self.find_parts_by_type(CONTENT_TYPE_TABLE)
    }

    /// Get all comment parts
    pub fn comment_parts(&self) -> Vec<&str> {
        self.find_parts_by_type(CONTENT_TYPE_COMMENTS)
    }

    /// Get all drawing parts
    pub fn drawing_parts(&self) -> Vec<&str> {
        self.find_parts_by_type(CONTENT_TYPE_DRAWING)
    }

    /// Get all chartsheet parts
    pub fn chartsheet_parts(&self) -> Vec<&str> {
        self.find_parts_by_type(CONTENT_TYPE_CHARTSHEET)
    }

    /// Get number of override entries
    pub fn override_count(&self) -> usize {
        self.overrides.len()
    }

    /// Get number of default entries
    pub fn default_count(&self) -> usize {
        self.defaults.len()
    }

    /// Check if a default exists for an extension
    pub fn has_default(&self, extension: &str) -> bool {
        self.defaults.contains_key(extension)
    }

    /// Check if an override exists for a path
    pub fn has_override(&self, path: &str) -> bool {
        let normalized = normalize_path(path);
        self.overrides.contains_key(&normalized)
    }

    /// Get an iterator over all override entries
    pub fn overrides(&self) -> impl Iterator<Item = (&str, &str)> {
        self.overrides.iter().map(|(k, v)| (k.as_str(), v.as_str()))
    }

    /// Get an iterator over all default entries
    pub fn defaults(&self) -> impl Iterator<Item = (&str, &str)> {
        self.defaults.iter().map(|(k, v)| (k.as_str(), v.as_str()))
    }

    /// Get an iterator over default entries in their original XML order.
    pub fn ordered_defaults(&self) -> impl Iterator<Item = (&str, &str)> {
        self.ordered_defaults_list
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
    }

    /// Get an iterator over override entries in their original XML order.
    pub fn ordered_overrides(&self) -> impl Iterator<Item = (&str, &str)> {
        self.ordered_overrides_list
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
    }
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Parse a Default element and extract Extension and ContentType
fn parse_default_element(start: &BytesStart<'_>) -> Option<(String, String)> {
    Some((
        attr_value(start, b"Extension")?,
        attr_value(start, b"ContentType")?,
    ))
}

/// Parse an Override element and extract PartName and ContentType
fn parse_override_element(start: &BytesStart<'_>) -> Option<(String, String)> {
    Some((
        attr_value(start, b"PartName")?,
        attr_value(start, b"ContentType")?,
    ))
}

fn attr_value(start: &BytesStart<'_>, name: &[u8]) -> Option<String> {
    for attr in start.attributes().flatten() {
        if attr.key.local_name().as_ref() == name {
            return attr.unescape_value().ok().map(|v| v.into_owned());
        }
    }
    None
}

fn is_opc_content_types_ns(ns: &ResolveResult<'_>) -> bool {
    match ns {
        ResolveResult::Bound(Namespace(uri)) => *uri == CONTENT_TYPES_NS.as_bytes(),
        ResolveResult::Unbound => true,
        ResolveResult::Unknown(_) => false,
    }
}

/// Normalize a path by removing the leading slash
fn normalize_path(path: &str) -> String {
    path.strip_prefix('/').unwrap_or(path).to_string()
}

/// Get the file extension from a path
fn get_extension(path: &str) -> Option<&str> {
    path.rsplit('.').next()
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_minimal_content_types() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).expect("Should parse successfully");
        assert_eq!(ct.default_count(), 2);
        assert_eq!(ct.override_count(), 0);
    }

    #[test]
    fn test_parse_with_overrides() {
        let xml = br#"<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).expect("Should parse successfully");
        assert_eq!(ct.default_count(), 1);
        assert_eq!(ct.override_count(), 2);
    }

    #[test]
    fn test_parse_empty_types() {
        let xml = br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
</Types>"#;

        let ct = ContentTypes::parse(xml).expect("Should parse successfully");
        assert_eq!(ct.default_count(), 0);
        assert_eq!(ct.override_count(), 0);
    }

    #[test]
    fn test_parse_missing_types_element() {
        let xml = br#"<?xml version="1.0"?>
<Something>
</Something>"#;

        let result = ContentTypes::parse(xml);
        assert!(matches!(result, Err(ParseError::MissingElement("Types"))));
    }

    #[test]
    fn test_get_type_from_override() {
        let xml = br#"<Types>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        assert_eq!(ct.get_type("/xl/workbook.xml"), Some(CONTENT_TYPE_WORKBOOK));
        assert_eq!(ct.get_type("xl/workbook.xml"), Some(CONTENT_TYPE_WORKBOOK));
    }

    #[test]
    fn test_get_type_from_default() {
        let xml = br#"<Types>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        assert_eq!(ct.get_type("some/path/file.xml"), Some("application/xml"));
        assert_eq!(ct.get_type("_rels/.rels"), Some(CONTENT_TYPE_RELATIONSHIPS));
    }

    #[test]
    fn test_get_type_override_takes_precedence() {
        let xml = br#"<Types>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        assert_eq!(ct.get_type("xl/workbook.xml"), Some(CONTENT_TYPE_WORKBOOK));
        assert_eq!(ct.get_type("xl/other.xml"), Some("application/xml"));
    }

    #[test]
    fn parses_prefixed_single_quoted_content_types() {
        let xml = br#"<ct:Types xmlns:ct="http://schemas.openxmlformats.org/package/2006/content-types">
  <ct:Default ContentType='application/xml' Extension='xml'/>
  <ct:Override ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml' PartName='/xl/workbook.xml'/>
</ct:Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        assert_eq!(ct.get_type("xl/workbook.xml"), Some(CONTENT_TYPE_WORKBOOK));
        assert_eq!(ct.get_type("xl/other.xml"), Some("application/xml"));
    }

    #[test]
    fn test_get_type_not_found() {
        let xml = br#"<Types>
  <Default Extension="xml" ContentType="application/xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        assert_eq!(ct.get_type("some/path/file.bin"), None);
    }

    #[test]
    fn test_find_parts_by_type_single() {
        let xml = br#"<Types>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        let worksheets = ct.find_parts_by_type(CONTENT_TYPE_WORKSHEET);
        assert_eq!(worksheets.len(), 1);
        assert!(worksheets.contains(&"xl/worksheets/sheet1.xml"));
    }

    #[test]
    fn test_find_parts_by_type_multiple() {
        let xml = br#"<Types>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        let worksheets = ct.find_parts_by_type(CONTENT_TYPE_WORKSHEET);
        assert_eq!(worksheets.len(), 3);
    }

    #[test]
    fn test_find_parts_by_type_none() {
        let xml = br#"<Types>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        let worksheets = ct.find_parts_by_type(CONTENT_TYPE_WORKSHEET);
        assert_eq!(worksheets.len(), 0);
    }

    #[test]
    fn test_worksheet_parts() {
        let xml = br#"<Types>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        let worksheets = ct.worksheet_parts();
        assert_eq!(worksheets.len(), 2);
    }

    #[test]
    fn test_is_worksheet_true() {
        let xml = br#"<Types>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        assert!(ct.is_worksheet("xl/worksheets/sheet1.xml"));
        assert!(ct.is_worksheet("/xl/worksheets/sheet1.xml"));
    }

    #[test]
    fn test_is_worksheet_false() {
        let xml = br#"<Types>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        assert!(!ct.is_worksheet("xl/workbook.xml"));
        assert!(!ct.is_worksheet("xl/worksheets/sheet1.xml"));
    }

    #[test]
    fn test_workbook_path() {
        let xml = br#"<Types>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        assert_eq!(ct.workbook_path(), Some("xl/workbook.xml"));
    }

    #[test]
    fn test_shared_strings_path() {
        let xml = br#"<Types>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        assert_eq!(ct.shared_strings_path(), Some("xl/sharedStrings.xml"));
    }

    #[test]
    fn test_styles_path() {
        let xml = br#"<Types>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        assert_eq!(ct.styles_path(), Some("xl/styles.xml"));
    }

    #[test]
    fn test_theme_path() {
        let xml = br#"<Types>
  <Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        assert_eq!(ct.theme_path(), Some("xl/theme/theme1.xml"));
    }

    #[test]
    fn test_has_default() {
        let xml = br#"<Types>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        assert!(ct.has_default("xml"));
        assert!(ct.has_default("rels"));
        assert!(!ct.has_default("bin"));
    }

    #[test]
    fn test_has_override() {
        let xml = br#"<Types>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        assert!(ct.has_override("xl/workbook.xml"));
        assert!(ct.has_override("/xl/workbook.xml"));
        assert!(!ct.has_override("xl/styles.xml"));
    }

    #[test]
    fn test_realistic_xlsx_content_types() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>
  <Override PartName="/xl/comments1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).expect("Should parse realistic XLSX");
        assert_eq!(ct.default_count(), 3);
        assert_eq!(ct.override_count(), 11);
        assert_eq!(ct.workbook_path(), Some("xl/workbook.xml"));
        assert_eq!(ct.shared_strings_path(), Some("xl/sharedStrings.xml"));
        assert_eq!(ct.styles_path(), Some("xl/styles.xml"));
        assert_eq!(ct.theme_path(), Some("xl/theme/theme1.xml"));
        assert_eq!(ct.worksheet_parts().len(), 3);
        assert_eq!(ct.table_parts().len(), 1);
        assert_eq!(ct.comment_parts().len(), 1);
    }

    #[test]
    fn test_overrides_iterator() {
        let xml = br#"<Types>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        let overrides: Vec<_> = ct.overrides().collect();
        assert_eq!(overrides.len(), 2);
    }

    #[test]
    fn test_defaults_iterator() {
        let xml = br#"<Types>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).unwrap();
        let defaults: Vec<_> = ct.defaults().collect();
        assert_eq!(defaults.len(), 2);
    }

    #[test]
    fn test_normalize_path() {
        assert_eq!(normalize_path("/xl/workbook.xml"), "xl/workbook.xml");
        assert_eq!(normalize_path("xl/workbook.xml"), "xl/workbook.xml");
        assert_eq!(normalize_path("/"), "");
        assert_eq!(normalize_path(""), "");
    }

    #[test]
    fn test_get_extension() {
        assert_eq!(get_extension("file.xml"), Some("xml"));
        assert_eq!(get_extension("path/to/file.xlsx"), Some("xlsx"));
        assert_eq!(get_extension(".rels"), Some("rels"));
        assert_eq!(get_extension("noextension"), Some("noextension"));
    }

    #[test]
    fn test_matches_tag_at() {
        let xml = b"<Default Extension=\"xml\"/>";
        let mut reader = NsReader::from_reader(xml.as_slice());
        let mut buf = Vec::new();
        match reader.read_event_into(&mut buf).expect("event") {
            Event::Empty(start) => {
                assert_eq!(start.local_name().as_ref(), b"Default");
                assert_ne!(start.local_name().as_ref(), b"Override");
            }
            event => panic!("expected empty element, got {event:?}"),
        }
    }

    #[test]
    fn test_parse_with_whitespace() {
        let xml = br#"<Types>
    <Default     Extension="xml"    ContentType="application/xml"/>
    <Override  PartName="/xl/workbook.xml"   ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"  />
</Types>"#;

        let ct = ContentTypes::parse(xml).expect("Should handle whitespace");
        assert_eq!(ct.default_count(), 1);
        assert_eq!(ct.override_count(), 1);
    }

    #[test]
    fn test_parse_with_newlines_in_element() {
        let xml = br#"<Types>
  <Default
    Extension="xml"
    ContentType="application/xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).expect("Should handle newlines in element");
        assert_eq!(ct.default_count(), 1);
    }

    #[test]
    fn test_empty_content_type() {
        let xml = br#"<Types>
  <Default Extension="xml" ContentType=""/>
</Types>"#;

        let ct = ContentTypes::parse(xml).expect("Should handle empty content type");
        assert_eq!(ct.get_type("file.xml"), Some(""));
    }

    #[test]
    fn test_content_types_new() {
        let ct = ContentTypes::new();
        assert_eq!(ct.default_count(), 0);
        assert_eq!(ct.override_count(), 0);
    }

    #[test]
    fn test_parse_error_display() {
        assert_eq!(
            format!("{}", ParseError::MalformedXml),
            "Malformed XML in [Content_Types].xml"
        );
        assert_eq!(
            format!("{}", ParseError::MissingElement("Types")),
            "Missing element: Types"
        );
        assert_eq!(
            format!("{}", ParseError::InvalidAttribute("foo")),
            "Invalid attribute: foo"
        );
    }

    #[test]
    fn test_xlsm_content_types() {
        let xml = br#"<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#;

        let ct = ContentTypes::parse(xml).expect("Should parse xlsm content types");
        assert_eq!(ct.worksheet_parts().len(), 1);
        assert!(ct.workbook_path().is_none()); // Standard workbook type not present
    }
}
