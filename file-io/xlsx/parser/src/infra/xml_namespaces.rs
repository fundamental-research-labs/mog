//! Namespace declaration helpers for XLSX XML readers and writers.
//!
//! This module provides data structures and utilities for preserving XML namespace
//! declarations. XLSX files use many namespaces:
//!
//! - Main SpreadsheetML (`xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`)
//! - Extensions (`x14`, `x15`, etc.)
//! - DrawingML (`a`, `c`, `r`)
//! - Custom namespaces from third-party tools
//!
//! # Architecture
//!
//! During parsing:
//! - Namespace declarations are captured from root/parent elements
//! - Prefix-to-URI mappings are recorded
//! - Custom namespaces are preserved
//!
//! During writing:
//! - Standard namespaces are emitted with correct URIs
//! - Feature-owned namespace metadata can be re-emitted where required
//! - Namespace prefixes are preserved
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::namespaces::{NamespaceMap, NamespaceDeclaration};
//!
//! let mut ns = NamespaceMap::new();
//! ns.capture_from_element(b"<worksheet xmlns=\"http://...\" xmlns:x14=\"http://...\">");
//!
//! // Get URI for a prefix
//! let uri = ns.get_uri("x14");
//!
//! // Get all custom namespaces
//! for decl in ns.custom_namespaces() {
//!     println!("{}: {}", decl.prefix.as_deref().unwrap_or("(default)"), decl.uri);
//! }
//! ```
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file slices XML
//! namespace declarations at byte offsets produced by ASCII-only XML
//! syntax (`xmlns:`, `=`, `"`, `<`, `>`). Char-boundary by
//! construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use std::collections::HashMap;

// ============================================================================
// Standard XLSX Namespaces
// ============================================================================

/// SpreadsheetML main namespace (ECMA-376)
pub const NS_SPREADSHEET_ML: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/// Relationships namespace
pub const NS_RELATIONSHIPS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// Content Types namespace
pub const NS_CONTENT_TYPES: &str = "http://schemas.openxmlformats.org/package/2006/content-types";

/// Core Properties namespace
pub const NS_CORE_PROPERTIES: &str =
    "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";

/// Extended Properties namespace
pub const NS_EXTENDED_PROPERTIES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";

/// DrawingML main namespace
pub const NS_DRAWING_ML: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";

/// DrawingML chart namespace
pub const NS_DRAWING_CHART: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";

/// DrawingML spreadsheet drawing namespace
pub const NS_DRAWING_SPREADSHEET: &str =
    "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";

/// Office 2010 SpreadsheetML extensions (x14)
pub const NS_X14: &str = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";

/// Office 2010 AC extensions (x14ac)
pub const NS_X14AC: &str = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac";

/// Office 2013 SpreadsheetML extensions (x15)
pub const NS_X15: &str = "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main";

/// Office 2013 AC extensions (x15ac)
pub const NS_X15AC: &str = "http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac";

/// Markup Compatibility namespace
pub const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";

/// VML namespace (legacy drawing)
pub const NS_VML: &str = "urn:schemas-microsoft-com:vml";

/// XML namespace
pub const NS_XML: &str = "http://www.w3.org/XML/1998/namespace";

// ============================================================================
// Core Data Structures
// ============================================================================

/// A single namespace declaration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamespaceDeclaration {
    /// The namespace prefix (None for default namespace)
    pub prefix: Option<String>,
    /// The namespace URI
    pub uri: String,
    /// Whether this is a standard XLSX namespace
    pub is_standard: bool,
}

impl NamespaceDeclaration {
    /// Create a new namespace declaration.
    pub fn new(prefix: Option<impl Into<String>>, uri: impl Into<String>) -> Self {
        let uri_str = uri.into();
        let is_standard = Self::is_standard_uri(&uri_str);

        Self {
            prefix: prefix.map(|p| p.into()),
            uri: uri_str,
            is_standard,
        }
    }

    /// Create a default namespace declaration (no prefix).
    pub fn default_ns(uri: impl Into<String>) -> Self {
        Self::new(None::<String>, uri)
    }

    /// Create a prefixed namespace declaration.
    pub fn prefixed(prefix: impl Into<String>, uri: impl Into<String>) -> Self {
        Self::new(Some(prefix.into()), uri)
    }

    /// Get the xmlns attribute name for this declaration.
    pub fn attr_name(&self) -> String {
        match &self.prefix {
            Some(prefix) => format!("xmlns:{}", prefix),
            None => "xmlns".to_string(),
        }
    }

    /// Get the xmlns attribute value (the URI).
    pub fn attr_value(&self) -> &str {
        &self.uri
    }

    /// Check if a URI is a standard XLSX namespace.
    fn is_standard_uri(uri: &str) -> bool {
        matches!(
            uri,
            NS_SPREADSHEET_ML
                | NS_RELATIONSHIPS
                | NS_CONTENT_TYPES
                | NS_CORE_PROPERTIES
                | NS_EXTENDED_PROPERTIES
                | NS_DRAWING_ML
                | NS_DRAWING_CHART
                | NS_DRAWING_SPREADSHEET
                | NS_X14
                | NS_X14AC
                | NS_X15
                | NS_X15AC
                | NS_MC
                | NS_VML
                | NS_XML
        )
    }
}

/// Tracks namespace declarations for a document part.
#[derive(Debug, Clone, Default)]
pub struct NamespaceMap {
    /// All namespace declarations
    declarations: Vec<NamespaceDeclaration>,
    /// Prefix to URI lookup
    prefix_to_uri: HashMap<String, String>,
    /// URI to prefix lookup (for reverse mapping)
    uri_to_prefix: HashMap<String, String>,
    /// Default namespace URI (if any)
    default_namespace: Option<String>,
    /// Root-level markup compatibility attributes captured with the namespaces.
    mce_attributes: domain_types::MceAttributes,
}

impl NamespaceMap {
    /// Create a new empty namespace map.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a namespace map with standard XLSX namespaces.
    pub fn with_standard() -> Self {
        let mut map = Self::new();
        map.add_standard_namespaces();
        map
    }

    /// Add standard XLSX namespaces.
    pub fn add_standard_namespaces(&mut self) {
        // Default namespace
        self.add(NamespaceDeclaration::default_ns(NS_SPREADSHEET_ML));

        // Common prefixed namespaces
        self.add(NamespaceDeclaration::prefixed("r", NS_RELATIONSHIPS));
        self.add(NamespaceDeclaration::prefixed("mc", NS_MC));
    }

    /// Add a namespace declaration.
    pub fn add(&mut self, decl: NamespaceDeclaration) {
        // Update lookup maps
        if let Some(ref prefix) = decl.prefix {
            self.prefix_to_uri.insert(prefix.clone(), decl.uri.clone());
            self.uri_to_prefix.insert(decl.uri.clone(), prefix.clone());
        } else {
            self.default_namespace = Some(decl.uri.clone());
        }

        self.declarations.push(decl);
    }

    /// Add a namespace with prefix.
    pub fn add_prefixed(&mut self, prefix: impl Into<String>, uri: impl Into<String>) {
        self.add(NamespaceDeclaration::prefixed(prefix, uri));
    }

    /// Set the default namespace.
    pub fn set_default(&mut self, uri: impl Into<String>) {
        self.add(NamespaceDeclaration::default_ns(uri));
    }

    /// Get the URI for a prefix.
    pub fn get_uri(&self, prefix: &str) -> Option<&str> {
        self.prefix_to_uri.get(prefix).map(|s| s.as_str())
    }

    /// Get the prefix for a URI.
    pub fn get_prefix(&self, uri: &str) -> Option<&str> {
        self.uri_to_prefix.get(uri).map(|s| s.as_str())
    }

    /// Get the default namespace URI.
    pub fn default_namespace(&self) -> Option<&str> {
        self.default_namespace.as_deref()
    }

    /// Get all declarations.
    pub fn all(&self) -> &[NamespaceDeclaration] {
        &self.declarations
    }

    /// Get captured root-level MCE attributes.
    pub fn mce_attributes(&self) -> &domain_types::MceAttributes {
        &self.mce_attributes
    }

    /// Replace captured root-level MCE attributes.
    pub fn set_mce_attributes(&mut self, attrs: domain_types::MceAttributes) {
        self.mce_attributes = attrs;
    }

    /// Get only standard namespace declarations.
    pub fn standard(&self) -> Vec<&NamespaceDeclaration> {
        self.declarations.iter().filter(|d| d.is_standard).collect()
    }

    /// Get only custom (non-standard) namespace declarations.
    pub fn custom(&self) -> Vec<&NamespaceDeclaration> {
        self.declarations
            .iter()
            .filter(|d| !d.is_standard)
            .collect()
    }

    /// Check if a prefix is declared.
    pub fn has_prefix(&self, prefix: &str) -> bool {
        self.prefix_to_uri.contains_key(prefix)
    }

    /// Check if a URI is declared.
    pub fn has_uri(&self, uri: &str) -> bool {
        self.uri_to_prefix.contains_key(uri) || self.default_namespace.as_deref() == Some(uri)
    }

    /// Check if empty.
    pub fn is_empty(&self) -> bool {
        self.declarations.is_empty() && self.mce_attributes.is_empty()
    }

    /// Get the number of declarations.
    pub fn len(&self) -> usize {
        self.declarations.len()
    }

    /// Capture namespaces from an XML element.
    ///
    /// Parses xmlns:prefix="uri" and xmlns="uri" declarations.
    pub fn capture_from_element(&mut self, element_bytes: &[u8]) {
        let element_str = match std::str::from_utf8(element_bytes) {
            Ok(s) => s,
            Err(_) => return,
        };

        // Find all xmlns declarations
        let mut pos = 0;
        while let Some(xmlns_pos) = element_str[pos..].find("xmlns") {
            let abs_pos = pos + xmlns_pos;

            // Check for xmlns:prefix or xmlns=
            let after_xmlns = &element_str[abs_pos + 5..];

            if after_xmlns.starts_with(':') {
                // xmlns:prefix="uri"
                if let Some((prefix, uri)) = Self::parse_prefixed_xmlns(after_xmlns) {
                    self.add_prefixed(prefix, uri);
                }
            } else if after_xmlns.starts_with('=') {
                // xmlns="uri"
                if let Some(uri) = Self::parse_default_xmlns(after_xmlns) {
                    self.set_default(uri);
                }
            }

            pos = abs_pos + 5;
        }

        self.capture_mce_attributes_from_element(element_str);
    }

    /// Capture root-level MCE attributes from an XML element start tag.
    pub fn capture_mce_attributes_from_element(&mut self, element_str: &str) {
        let mc_prefix = self.get_prefix(NS_MC).unwrap_or("mc");
        let ignorable_name = format!("{}:Ignorable", mc_prefix);
        let process_content_name = format!("{}:ProcessContent", mc_prefix);
        let must_understand_name = format!("{}:MustUnderstand", mc_prefix);

        let mut attrs = domain_types::MceAttributes {
            ignorable: parse_xml_attr_value(element_str, &ignorable_name),
            process_content: parse_xml_attr_value(element_str, &process_content_name),
            must_understand: parse_xml_attr_value(element_str, &must_understand_name),
            diagnostics: Vec::new(),
        };

        validate_mce_prefix_list(
            attrs.ignorable.as_deref(),
            "Ignorable",
            self,
            &mut attrs.diagnostics,
        );
        validate_mce_prefix_list(
            attrs.process_content.as_deref(),
            "ProcessContent",
            self,
            &mut attrs.diagnostics,
        );
        validate_mce_prefix_list(
            attrs.must_understand.as_deref(),
            "MustUnderstand",
            self,
            &mut attrs.diagnostics,
        );

        if !attrs.is_empty() {
            self.mce_attributes = attrs;
        }
    }

    /// Parse a prefixed xmlns declaration (xmlns:prefix="uri").
    fn parse_prefixed_xmlns(s: &str) -> Option<(String, String)> {
        // s starts with ":"
        let s = &s[1..]; // Skip ':'

        // Find prefix end (space or =)
        let prefix_end = s.find(|c: char| c == '=' || c.is_whitespace())?;
        let prefix = s[..prefix_end].to_string();

        // Find = and quote
        let rest = &s[prefix_end..];
        let eq_pos = rest.find('=')?;
        let rest = &rest[eq_pos + 1..].trim_start();

        // Parse quoted value
        let quote = rest.chars().next()?;
        if quote != '"' && quote != '\'' {
            return None;
        }

        let rest = &rest[1..];
        let end_quote = rest.find(quote)?;
        let uri = rest[..end_quote].to_string();

        Some((prefix, uri))
    }

    /// Parse a default xmlns declaration (xmlns="uri").
    fn parse_default_xmlns(s: &str) -> Option<String> {
        // s starts with "="
        let rest = s[1..].trim_start();

        // Parse quoted value
        let quote = rest.chars().next()?;
        if quote != '"' && quote != '\'' {
            return None;
        }

        let rest = &rest[1..];
        let end_quote = rest.find(quote)?;
        let uri = rest[..end_quote].to_string();

        Some(uri)
    }

    /// Merge another namespace map into this one.
    pub fn merge(&mut self, other: &NamespaceMap) {
        for decl in &other.declarations {
            // Only add if not already present
            if let Some(ref prefix) = decl.prefix {
                if !self.has_prefix(prefix) {
                    self.add(decl.clone());
                }
            } else if self.default_namespace.is_none() {
                self.add(decl.clone());
            }
        }
    }
}

impl From<&NamespaceMap> for domain_types::XmlNamespaceDeclarations {
    fn from(map: &NamespaceMap) -> Self {
        Self {
            declarations: map
                .all()
                .iter()
                .map(|decl| domain_types::XmlNamespaceDeclaration {
                    prefix: decl.prefix.clone(),
                    uri: decl.uri.clone(),
                })
                .collect(),
            mce: map.mce_attributes().clone(),
        }
    }
}

impl From<&domain_types::XmlNamespaceDeclarations> for NamespaceMap {
    fn from(value: &domain_types::XmlNamespaceDeclarations) -> Self {
        let mut map = NamespaceMap::new();
        for decl in &value.declarations {
            map.add(NamespaceDeclaration::new(
                decl.prefix.clone(),
                decl.uri.clone(),
            ));
        }
        map.set_mce_attributes(value.mce.clone());
        map
    }
}

fn parse_xml_attr_value(element: &str, attr_name: &str) -> Option<String> {
    let mut pos = 0;
    while let Some(found) = element[pos..].find(attr_name) {
        let abs = pos + found;
        let before_ok = abs == 0
            || element.as_bytes()[abs - 1].is_ascii_whitespace()
            || element.as_bytes()[abs - 1] == b'<';
        let after_name = abs + attr_name.len();
        let rest = &element[after_name..];
        if before_ok && rest.trim_start().starts_with('=') {
            let after_eq = rest.trim_start()[1..].trim_start();
            let quote = after_eq.chars().next()?;
            if quote != '"' && quote != '\'' {
                return None;
            }
            let value = &after_eq[1..];
            let end = value.find(quote)?;
            return Some(value[..end].to_string());
        }
        pos = after_name;
    }
    None
}

fn validate_mce_prefix_list(
    value: Option<&str>,
    attr_name: &str,
    namespaces: &NamespaceMap,
    diagnostics: &mut Vec<String>,
) {
    let Some(value) = value else {
        return;
    };

    for token in value.split_whitespace() {
        if token == "mc" || token == "xmlns" || token.is_empty() {
            diagnostics.push(format!(
                "mc:{} contains reserved prefix '{}'",
                attr_name, token
            ));
        } else if !is_xml_prefix_token(token) {
            diagnostics.push(format!(
                "mc:{} contains invalid prefix '{}'",
                attr_name, token
            ));
        } else if !namespaces.has_prefix(token) {
            diagnostics.push(format!(
                "mc:{} references undeclared prefix '{}'",
                attr_name, token
            ));
        }
    }
}

fn is_xml_prefix_token(token: &str) -> bool {
    let mut chars = token.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch == '-' || ch == '.' || ch.is_ascii_alphanumeric())
}

// ============================================================================
// Writing Utilities
// ============================================================================

/// Helper for writing namespace declarations.
pub struct NamespaceWriter {
    buffer: String,
}

impl NamespaceWriter {
    /// Create a new namespace writer.
    pub fn new() -> Self {
        Self {
            buffer: String::with_capacity(512),
        }
    }

    /// Write a namespace declaration.
    pub fn write(&mut self, decl: &NamespaceDeclaration) {
        self.buffer.push(' ');
        self.buffer.push_str(&decl.attr_name());
        self.buffer.push_str("=\"");
        self.buffer.push_str(&decl.uri);
        self.buffer.push('"');
    }

    /// Write all namespaces from a map.
    pub fn write_all(&mut self, map: &NamespaceMap) {
        // Write default namespace first (if any)
        for decl in &map.declarations {
            if decl.prefix.is_none() {
                self.write(decl);
                break;
            }
        }

        // Then write prefixed namespaces
        for decl in &map.declarations {
            if decl.prefix.is_some() {
                self.write(decl);
            }
        }
    }

    /// Write only standard namespaces.
    pub fn write_standard(&mut self, map: &NamespaceMap) {
        for decl in map.standard() {
            self.write(decl);
        }
    }

    /// Write only custom namespaces.
    pub fn write_custom(&mut self, map: &NamespaceMap) {
        for decl in map.custom() {
            self.write(decl);
        }
    }

    /// Write specific namespaces by prefix.
    pub fn write_prefixes(&mut self, map: &NamespaceMap, prefixes: &[&str]) {
        for prefix in prefixes {
            if let Some(uri) = map.get_uri(prefix) {
                self.buffer
                    .push_str(&format!(" xmlns:{}=\"{}\"", prefix, uri));
            }
        }
    }

    /// Write default namespace if present.
    pub fn write_default(&mut self, map: &NamespaceMap) {
        if let Some(uri) = map.default_namespace() {
            self.buffer.push_str(&format!(" xmlns=\"{}\"", uri));
        }
    }

    /// Get the built string.
    pub fn finish(self) -> String {
        self.buffer
    }

    /// Clear the buffer.
    pub fn clear(&mut self) {
        self.buffer.clear();
    }
}

impl Default for NamespaceWriter {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Common Namespace Sets
// ============================================================================

/// Create standard worksheet namespaces.
pub fn worksheet_namespaces() -> NamespaceMap {
    let mut map = NamespaceMap::new();
    map.set_default(NS_SPREADSHEET_ML);
    map.add_prefixed("r", NS_RELATIONSHIPS);
    map
}

/// Create standard workbook namespaces.
pub fn workbook_namespaces() -> NamespaceMap {
    let mut map = NamespaceMap::new();
    map.set_default(NS_SPREADSHEET_ML);
    map.add_prefixed("r", NS_RELATIONSHIPS);
    map
}

/// Create standard styles namespaces.
pub fn styles_namespaces() -> NamespaceMap {
    let mut map = NamespaceMap::new();
    map.set_default(NS_SPREADSHEET_ML);
    map
}

/// Create standard relationships namespaces.
pub fn relationships_namespaces() -> NamespaceMap {
    let mut map = NamespaceMap::new();
    map.set_default(NS_RELATIONSHIPS);
    map
}

/// Create standard content types namespaces.
pub fn content_types_namespaces() -> NamespaceMap {
    let mut map = NamespaceMap::new();
    map.set_default(NS_CONTENT_TYPES);
    map
}

/// Create worksheet namespaces with extensions.
pub fn worksheet_namespaces_with_extensions() -> NamespaceMap {
    let mut map = worksheet_namespaces();
    map.add_prefixed("mc", NS_MC);
    map.add_prefixed("x14ac", NS_X14AC);
    map
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // NamespaceDeclaration tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_namespace_declaration_default() {
        let decl = NamespaceDeclaration::default_ns(NS_SPREADSHEET_ML);
        assert_eq!(decl.prefix, None);
        assert_eq!(decl.uri, NS_SPREADSHEET_ML);
        assert!(decl.is_standard);
        assert_eq!(decl.attr_name(), "xmlns");
    }

    #[test]
    fn test_namespace_declaration_prefixed() {
        let decl = NamespaceDeclaration::prefixed("r", NS_RELATIONSHIPS);
        assert_eq!(decl.prefix, Some("r".to_string()));
        assert_eq!(decl.uri, NS_RELATIONSHIPS);
        assert!(decl.is_standard);
        assert_eq!(decl.attr_name(), "xmlns:r");
    }

    #[test]
    fn test_namespace_declaration_custom() {
        let decl = NamespaceDeclaration::prefixed("custom", "http://example.com/custom");
        assert_eq!(decl.prefix, Some("custom".to_string()));
        assert!(!decl.is_standard);
    }

    // -------------------------------------------------------------------------
    // NamespaceMap tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_namespace_map_basic() {
        let mut map = NamespaceMap::new();
        map.set_default(NS_SPREADSHEET_ML);
        map.add_prefixed("r", NS_RELATIONSHIPS);

        assert_eq!(map.default_namespace(), Some(NS_SPREADSHEET_ML));
        assert_eq!(map.get_uri("r"), Some(NS_RELATIONSHIPS));
        assert_eq!(map.get_prefix(NS_RELATIONSHIPS), Some("r"));
        assert!(map.has_prefix("r"));
        assert!(map.has_uri(NS_SPREADSHEET_ML));
    }

    #[test]
    fn test_namespace_map_with_standard() {
        let map = NamespaceMap::with_standard();
        assert!(map.has_uri(NS_SPREADSHEET_ML));
        assert!(map.has_prefix("r"));
        assert!(map.has_prefix("mc"));
    }

    #[test]
    fn test_namespace_map_standard_vs_custom() {
        let mut map = NamespaceMap::new();
        map.add_prefixed("r", NS_RELATIONSHIPS);
        map.add_prefixed("custom", "http://example.com/custom");

        let standard = map.standard();
        assert_eq!(standard.len(), 1);
        assert_eq!(standard[0].prefix, Some("r".to_string()));

        let custom = map.custom();
        assert_eq!(custom.len(), 1);
        assert_eq!(custom[0].prefix, Some("custom".to_string()));
    }

    #[test]
    fn test_namespace_map_capture() {
        let mut map = NamespaceMap::new();
        let xml = br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">"#;

        map.capture_from_element(xml);

        assert_eq!(map.default_namespace(), Some(NS_SPREADSHEET_ML));
        assert!(map.has_prefix("r"));
        assert!(map.has_prefix("x14"));
        assert_eq!(map.get_uri("x14"), Some(NS_X14));
    }

    #[test]
    fn test_namespace_map_capture_single_quotes() {
        let mut map = NamespaceMap::new();
        let xml = b"<element xmlns='http://example.com' xmlns:p='http://prefix.com'>";

        map.capture_from_element(xml);

        assert_eq!(map.default_namespace(), Some("http://example.com"));
        assert_eq!(map.get_uri("p"), Some("http://prefix.com"));
    }

    #[test]
    fn test_namespace_map_merge() {
        let mut map1 = NamespaceMap::new();
        map1.add_prefixed("a", "http://a.com");

        let mut map2 = NamespaceMap::new();
        map2.add_prefixed("b", "http://b.com");
        map2.add_prefixed("a", "http://different.com"); // Should be ignored

        map1.merge(&map2);

        assert!(map1.has_prefix("a"));
        assert!(map1.has_prefix("b"));
        assert_eq!(map1.get_uri("a"), Some("http://a.com")); // Original preserved
    }

    // -------------------------------------------------------------------------
    // NamespaceWriter tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_namespace_writer_basic() {
        let mut map = NamespaceMap::new();
        map.set_default(NS_SPREADSHEET_ML);
        map.add_prefixed("r", NS_RELATIONSHIPS);

        let mut writer = NamespaceWriter::new();
        writer.write_all(&map);

        let result = writer.finish();
        assert!(result.contains(&format!("xmlns=\"{}\"", NS_SPREADSHEET_ML)));
        assert!(result.contains(&format!("xmlns:r=\"{}\"", NS_RELATIONSHIPS)));
    }

    #[test]
    fn test_namespace_writer_custom_only() {
        let mut map = NamespaceMap::new();
        map.add_prefixed("r", NS_RELATIONSHIPS);
        map.add_prefixed("custom", "http://example.com/custom");

        let mut writer = NamespaceWriter::new();
        writer.write_custom(&map);

        let result = writer.finish();
        assert!(!result.contains("xmlns:r"));
        assert!(result.contains("xmlns:custom=\"http://example.com/custom\""));
    }

    #[test]
    fn test_namespace_writer_specific_prefixes() {
        let mut map = NamespaceMap::new();
        map.add_prefixed("a", "http://a.com");
        map.add_prefixed("b", "http://b.com");
        map.add_prefixed("c", "http://c.com");

        let mut writer = NamespaceWriter::new();
        writer.write_prefixes(&map, &["a", "c"]);

        let result = writer.finish();
        assert!(result.contains("xmlns:a=\"http://a.com\""));
        assert!(result.contains("xmlns:c=\"http://c.com\""));
        assert!(!result.contains("xmlns:b"));
    }

    // -------------------------------------------------------------------------
    // Helper function tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_worksheet_namespaces() {
        let map = worksheet_namespaces();
        assert_eq!(map.default_namespace(), Some(NS_SPREADSHEET_ML));
        assert!(map.has_prefix("r"));
    }

    #[test]
    fn test_worksheet_namespaces_with_extensions() {
        let map = worksheet_namespaces_with_extensions();
        assert!(map.has_prefix("mc"));
        assert!(map.has_prefix("x14ac"));
    }

    // -------------------------------------------------------------------------
    // Integration tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_round_trip_namespaces() {
        // Simulate parsing: capture namespaces from worksheet
        let mut map = NamespaceMap::new();
        let xml = br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:customNs="http://example.com/custom">"#;

        map.capture_from_element(xml);

        // Verify all namespaces captured
        assert_eq!(map.len(), 4);
        assert_eq!(map.default_namespace(), Some(NS_SPREADSHEET_ML));
        assert!(map.has_prefix("r"));
        assert!(map.has_prefix("x14"));
        assert!(map.has_prefix("customNs"));

        // During writing: emit all namespaces
        let mut writer = NamespaceWriter::new();
        writer.write_all(&map);

        let result = writer.finish();

        // Verify all namespaces emitted
        assert!(result.contains(NS_SPREADSHEET_ML));
        assert!(result.contains(NS_RELATIONSHIPS));
        assert!(result.contains(NS_X14));
        assert!(result.contains("http://example.com/custom"));
    }

    #[test]
    fn test_preserve_custom_namespace() {
        let mut map = NamespaceMap::new();

        // Google Sheets custom namespace
        let xml = br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:gs="http://www.google.com/sheets/extensibility">"#;
        map.capture_from_element(xml);

        // Verify custom namespace preserved
        let custom = map.custom();
        assert_eq!(custom.len(), 1);
        assert_eq!(custom[0].prefix, Some("gs".to_string()));
        assert_eq!(custom[0].uri, "http://www.google.com/sheets/extensibility");
    }
}
