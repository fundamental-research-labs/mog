//! Attribute ordering preservation for XLSX round-trip fidelity.
//!
//! This module provides data structures and utilities for preserving the order
//! of XML attributes during round-trips. While XML semantically doesn't care about
//! attribute order, Excel and other applications may be sensitive to ordering in
//! some cases, and preserving order improves diff-friendliness.
//!
//! # Architecture
//!
//! During parsing, attributes are captured with their original order:
//! - Known attributes are extracted and used by the parser
//! - Unknown attributes are preserved for round-trip
//! - Original attribute order is recorded for writing
//!
//! During writing, attributes can be emitted in the preserved order.
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::attr_order::{AttributeOrder, PreservedAttribute};
//!
//! // During parsing: capture attribute order
//! let mut order = AttributeOrder::new();
//! order.capture_from_element(b"<c r=\"A1\" s=\"1\" t=\"s\" customAttr=\"value\">");
//!
//! // Get known attributes in order
//! for attr in order.get_ordered("c") {
//!     println!("{}: {}", attr.name, attr.value);
//! }
//!
//! // Get unknown attributes
//! for attr in order.get_unknown("c") {
//!     println!("Unknown: {}: {}", attr.name, attr.value);
//! }
//! ```
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file slices
//! attribute text at byte offsets produced by ASCII-only XML syntax
//! (`=`, `"`, whitespace). Char-boundary by construction. File-scope
//! allow documented here.

#![allow(clippy::string_slice)]

use std::collections::HashMap;

// ============================================================================
// Core Data Structures
// ============================================================================

/// A single XML attribute with its name, value, and optional namespace prefix.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreservedAttribute {
    /// The attribute name (local name without prefix)
    pub name: String,
    /// The attribute value
    pub value: String,
    /// Optional namespace prefix (e.g., "x14" in "x14:attr")
    pub namespace_prefix: Option<String>,
    /// Original position in the attribute list (0-based)
    pub position: usize,
}

impl PreservedAttribute {
    /// Create a new preserved attribute.
    pub fn new(name: impl Into<String>, value: impl Into<String>, position: usize) -> Self {
        let full_name = name.into();
        let (namespace_prefix, local_name) = Self::split_namespace(&full_name);

        Self {
            name: local_name,
            value: value.into(),
            namespace_prefix,
            position,
        }
    }

    /// Create a new preserved attribute with explicit namespace.
    pub fn with_namespace(
        name: impl Into<String>,
        value: impl Into<String>,
        namespace: impl Into<String>,
        position: usize,
    ) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
            namespace_prefix: Some(namespace.into()),
            position,
        }
    }

    /// Get the full attribute name including namespace prefix.
    pub fn full_name(&self) -> String {
        if let Some(ref prefix) = self.namespace_prefix {
            format!("{}:{}", prefix, self.name)
        } else {
            self.name.clone()
        }
    }

    /// Split a name into namespace prefix and local name.
    fn split_namespace(name: &str) -> (Option<String>, String) {
        if let Some(colon_pos) = name.find(':') {
            let prefix = name[..colon_pos].to_string();
            let local = name[colon_pos + 1..].to_string();
            (Some(prefix), local)
        } else {
            (None, name.to_string())
        }
    }
}

/// Collection of attributes for an element, preserving order.
#[derive(Debug, Clone, Default)]
pub struct ElementAttributes {
    /// All attributes in original order
    pub attributes: Vec<PreservedAttribute>,
    /// Set of known attribute names (for quick lookup)
    known_names: Vec<String>,
}

impl ElementAttributes {
    /// Create a new empty element attributes collection.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create with a list of known attribute names.
    ///
    /// Known attributes are those the parser explicitly handles.
    /// Unknown attributes will be preserved for round-trip.
    pub fn with_known(known: &[&str]) -> Self {
        Self {
            attributes: Vec::new(),
            known_names: known.iter().map(|s| s.to_string()).collect(),
        }
    }

    /// Add an attribute to the collection.
    pub fn add(&mut self, name: impl Into<String>, value: impl Into<String>) {
        let position = self.attributes.len();
        self.attributes
            .push(PreservedAttribute::new(name, value, position));
    }

    /// Get an attribute by name (returns first match).
    pub fn get(&self, name: &str) -> Option<&PreservedAttribute> {
        self.attributes
            .iter()
            .find(|a| a.name == name || a.full_name() == name)
    }

    /// Get an attribute value by name.
    pub fn get_value(&self, name: &str) -> Option<&str> {
        self.get(name).map(|a| a.value.as_str())
    }

    /// Get all attributes in original order.
    pub fn ordered(&self) -> &[PreservedAttribute] {
        &self.attributes
    }

    /// Get only unknown attributes (not in the known list).
    pub fn unknown(&self) -> Vec<&PreservedAttribute> {
        self.attributes
            .iter()
            .filter(|a| !self.is_known(&a.name))
            .collect()
    }

    /// Get only known attributes.
    pub fn known(&self) -> Vec<&PreservedAttribute> {
        self.attributes
            .iter()
            .filter(|a| self.is_known(&a.name))
            .collect()
    }

    /// Check if an attribute name is in the known list.
    pub fn is_known(&self, name: &str) -> bool {
        self.known_names.iter().any(|k| k == name)
    }

    /// Check if collection is empty.
    pub fn is_empty(&self) -> bool {
        self.attributes.is_empty()
    }

    /// Get the number of attributes.
    pub fn len(&self) -> usize {
        self.attributes.len()
    }
}

// ============================================================================
// Attribute Order Tracking
// ============================================================================

/// Tracks attribute ordering for multiple elements during parsing.
///
/// This is used to preserve attribute order across a document or document part.
#[derive(Debug, Clone, Default)]
pub struct AttributeOrder {
    /// Attributes by element path (e.g., "worksheet/sheetViews/sheetView")
    elements: HashMap<String, ElementAttributes>,
    /// Known attributes by element name (not full path)
    known_by_element: HashMap<String, Vec<String>>,
}

impl AttributeOrder {
    /// Create a new attribute order tracker.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register known attributes for an element type.
    ///
    /// # Arguments
    /// * `element_name` - The element tag name (e.g., "c", "row", "sheetView")
    /// * `known_attrs` - List of known attribute names for this element
    pub fn register_known(&mut self, element_name: &str, known_attrs: &[&str]) {
        self.known_by_element.insert(
            element_name.to_string(),
            known_attrs.iter().map(|s| s.to_string()).collect(),
        );
    }

    /// Capture attributes from an XML element tag.
    ///
    /// # Arguments
    /// * `element_path` - Path to the element (e.g., "worksheet/sheetData/row")
    /// * `tag_bytes` - The opening tag bytes (e.g., `<c r="A1" s="1">`)
    pub fn capture_from_tag(&mut self, element_path: &str, tag_bytes: &[u8]) {
        let element_name = Self::extract_element_name(element_path);
        let known = self.known_by_element.get(&element_name);

        let mut elem_attrs = if let Some(known_list) = known {
            let refs: Vec<&str> = known_list.iter().map(|s| s.as_str()).collect();
            ElementAttributes::with_known(&refs)
        } else {
            ElementAttributes::new()
        };

        // Parse attributes from the tag
        for (name, value) in Self::parse_attributes(tag_bytes) {
            elem_attrs.add(name, value);
        }

        if !elem_attrs.is_empty() {
            self.elements.insert(element_path.to_string(), elem_attrs);
        }
    }

    /// Get attributes for an element path.
    pub fn get(&self, element_path: &str) -> Option<&ElementAttributes> {
        self.elements.get(element_path)
    }

    /// Get unknown attributes for an element path.
    pub fn get_unknown(&self, element_path: &str) -> Vec<&PreservedAttribute> {
        self.elements
            .get(element_path)
            .map(|e| e.unknown())
            .unwrap_or_default()
    }

    /// Get all preserved elements.
    pub fn all_elements(&self) -> &HashMap<String, ElementAttributes> {
        &self.elements
    }

    /// Check if there are any preserved attributes.
    pub fn is_empty(&self) -> bool {
        self.elements.is_empty()
    }

    /// Clear all preserved attributes.
    pub fn clear(&mut self) {
        self.elements.clear();
    }

    /// Extract the element name from a path.
    ///
    /// Handles indexed paths like "worksheet/sheetData/row[1]" -> "row"
    fn extract_element_name(path: &str) -> String {
        let segment = path.rsplit('/').next().unwrap_or(path);
        // Strip index notation like [1], [2], etc.
        if let Some(bracket_pos) = segment.find('[') {
            segment[..bracket_pos].to_string()
        } else {
            segment.to_string()
        }
    }

    /// Parse attributes from a tag's bytes.
    ///
    /// Returns (name, value) pairs in order.
    fn parse_attributes(tag_bytes: &[u8]) -> Vec<(String, String)> {
        let mut attrs = Vec::new();
        let tag_str = match std::str::from_utf8(tag_bytes) {
            Ok(s) => s,
            Err(_) => return attrs,
        };

        // Skip the tag name
        let content = tag_str
            .trim_start_matches('<')
            .trim_end_matches('>')
            .trim_end_matches('/');

        // Find end of tag name
        let tag_name_end = content
            .find(|c: char| c.is_whitespace())
            .unwrap_or(content.len());

        let attr_part = &content[tag_name_end..];

        // Simple attribute parser
        let mut pos = 0;
        let bytes = attr_part.as_bytes();

        while pos < bytes.len() {
            // Skip whitespace
            while pos < bytes.len() && bytes[pos].is_ascii_whitespace() {
                pos += 1;
            }

            if pos >= bytes.len() {
                break;
            }

            // Find attribute name
            let name_start = pos;
            while pos < bytes.len() && bytes[pos] != b'=' && !bytes[pos].is_ascii_whitespace() {
                pos += 1;
            }

            if pos == name_start || pos >= bytes.len() {
                break;
            }

            let name = &attr_part[name_start..pos];

            // Skip whitespace and '='
            while pos < bytes.len() && (bytes[pos].is_ascii_whitespace() || bytes[pos] == b'=') {
                pos += 1;
            }

            if pos >= bytes.len() {
                break;
            }

            // Parse quoted value
            let quote = bytes[pos];
            if quote != b'"' && quote != b'\'' {
                break;
            }
            pos += 1;

            let value_start = pos;
            while pos < bytes.len() && bytes[pos] != quote {
                pos += 1;
            }

            if pos >= bytes.len() {
                break;
            }

            let value = &attr_part[value_start..pos];
            pos += 1; // Skip closing quote

            attrs.push((name.to_string(), Self::decode_xml_entities(value)));
        }

        attrs
    }

    /// Decode XML entities in attribute values.
    fn decode_xml_entities(s: &str) -> String {
        s.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
    }
}

// ============================================================================
// Writing Utilities
// ============================================================================

/// Helper for writing attributes in a specific order.
pub struct AttributeWriter {
    /// Buffer for building attribute strings
    buffer: String,
}

impl AttributeWriter {
    /// Create a new attribute writer.
    pub fn new() -> Self {
        Self {
            buffer: String::with_capacity(256),
        }
    }

    /// Write an attribute to the buffer.
    pub fn write(&mut self, name: &str, value: &str) {
        self.buffer.push(' ');
        self.buffer.push_str(name);
        self.buffer.push_str("=\"");
        self.buffer.push_str(&Self::encode_xml_entities(value));
        self.buffer.push('"');
    }

    /// Write a preserved attribute to the buffer.
    pub fn write_preserved(&mut self, attr: &PreservedAttribute) {
        self.write(&attr.full_name(), &attr.value);
    }

    /// Write all preserved attributes to the buffer.
    pub fn write_all_preserved(&mut self, attrs: &[&PreservedAttribute]) {
        for attr in attrs {
            self.write_preserved(attr);
        }
    }

    /// Write known attributes first, then unknown attributes.
    ///
    /// This maintains semantic ordering (known first) while preserving
    /// unknown attributes at the end.
    pub fn write_with_unknown(&mut self, known: &[(&str, &str)], unknown: &[&PreservedAttribute]) {
        for (name, value) in known {
            self.write(name, value);
        }
        self.write_all_preserved(unknown);
    }

    /// Get the built attribute string.
    pub fn finish(self) -> String {
        self.buffer
    }

    /// Clear the buffer for reuse.
    pub fn clear(&mut self) {
        self.buffer.clear();
    }

    /// Encode special XML characters in attribute values.
    fn encode_xml_entities(s: &str) -> String {
        let mut result = String::with_capacity(s.len());
        for c in s.chars() {
            match c {
                '&' => result.push_str("&amp;"),
                '<' => result.push_str("&lt;"),
                '>' => result.push_str("&gt;"),
                '"' => result.push_str("&quot;"),
                '\'' => result.push_str("&apos;"),
                _ => result.push(c),
            }
        }
        result
    }
}

impl Default for AttributeWriter {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // PreservedAttribute tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_preserved_attribute_new() {
        let attr = PreservedAttribute::new("r", "A1", 0);
        assert_eq!(attr.name, "r");
        assert_eq!(attr.value, "A1");
        assert_eq!(attr.namespace_prefix, None);
        assert_eq!(attr.position, 0);
        assert_eq!(attr.full_name(), "r");
    }

    #[test]
    fn test_preserved_attribute_with_namespace() {
        let attr = PreservedAttribute::new("x14:customAttr", "value", 0);
        assert_eq!(attr.name, "customAttr");
        assert_eq!(attr.namespace_prefix, Some("x14".to_string()));
        assert_eq!(attr.full_name(), "x14:customAttr");
    }

    #[test]
    fn test_preserved_attribute_explicit_namespace() {
        let attr = PreservedAttribute::with_namespace("attr", "val", "ns", 0);
        assert_eq!(attr.name, "attr");
        assert_eq!(attr.namespace_prefix, Some("ns".to_string()));
        assert_eq!(attr.full_name(), "ns:attr");
    }

    // -------------------------------------------------------------------------
    // ElementAttributes tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_element_attributes_basic() {
        let mut attrs = ElementAttributes::new();
        attrs.add("r", "A1");
        attrs.add("s", "1");
        attrs.add("t", "s");

        assert_eq!(attrs.len(), 3);
        assert_eq!(attrs.get_value("r"), Some("A1"));
        assert_eq!(attrs.get_value("s"), Some("1"));
        assert_eq!(attrs.get_value("t"), Some("s"));
        assert_eq!(attrs.get_value("nonexistent"), None);
    }

    #[test]
    fn test_element_attributes_with_known() {
        let mut attrs = ElementAttributes::with_known(&["r", "s", "t"]);
        attrs.add("r", "A1");
        attrs.add("s", "1");
        attrs.add("customAttr", "custom");

        assert!(attrs.is_known("r"));
        assert!(attrs.is_known("s"));
        assert!(!attrs.is_known("customAttr"));

        let known = attrs.known();
        assert_eq!(known.len(), 2);

        let unknown = attrs.unknown();
        assert_eq!(unknown.len(), 1);
        assert_eq!(unknown[0].name, "customAttr");
    }

    #[test]
    fn test_element_attributes_order_preserved() {
        let mut attrs = ElementAttributes::new();
        attrs.add("c", "3");
        attrs.add("a", "1");
        attrs.add("b", "2");

        let ordered = attrs.ordered();
        assert_eq!(ordered[0].name, "c");
        assert_eq!(ordered[1].name, "a");
        assert_eq!(ordered[2].name, "b");
    }

    // -------------------------------------------------------------------------
    // AttributeOrder tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_attribute_order_capture() {
        let mut order = AttributeOrder::new();
        order.register_known("c", &["r", "s", "t"]);

        let tag = b"<c r=\"A1\" s=\"1\" t=\"s\">";
        order.capture_from_tag("worksheet/sheetData/row/c", tag);

        let attrs = order.get("worksheet/sheetData/row/c").unwrap();
        assert_eq!(attrs.len(), 3);
        assert_eq!(attrs.get_value("r"), Some("A1"));
    }

    #[test]
    fn test_attribute_order_unknown_attrs() {
        let mut order = AttributeOrder::new();
        order.register_known("c", &["r", "s", "t"]);

        let tag = b"<c r=\"A1\" customAttr=\"value\" s=\"1\">";
        order.capture_from_tag("worksheet/sheetData/row/c", tag);

        let unknown = order.get_unknown("worksheet/sheetData/row/c");
        assert_eq!(unknown.len(), 1);
        assert_eq!(unknown[0].name, "customAttr");
        assert_eq!(unknown[0].value, "value");
    }

    #[test]
    fn test_attribute_order_self_closing() {
        let mut order = AttributeOrder::new();
        let tag = b"<element attr1=\"val1\" attr2=\"val2\"/>";
        order.capture_from_tag("root/element", tag);

        let attrs = order.get("root/element").unwrap();
        assert_eq!(attrs.len(), 2);
    }

    #[test]
    fn test_attribute_order_entity_decoding() {
        let mut order = AttributeOrder::new();
        let tag = b"<element value=\"&lt;test&gt;&amp;more&quot;quote&apos;\">";
        order.capture_from_tag("root/element", tag);

        let attrs = order.get("root/element").unwrap();
        assert_eq!(attrs.get_value("value"), Some("<test>&more\"quote'"));
    }

    #[test]
    fn test_attribute_order_namespaced() {
        let mut order = AttributeOrder::new();
        let tag = b"<element x14:custom=\"value\" normal=\"val\">";
        order.capture_from_tag("root/element", tag);

        let attrs = order.get("root/element").unwrap();
        assert_eq!(attrs.len(), 2);

        let custom = attrs.get("custom").unwrap();
        assert_eq!(custom.namespace_prefix, Some("x14".to_string()));
    }

    // -------------------------------------------------------------------------
    // AttributeWriter tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_attribute_writer_basic() {
        let mut writer = AttributeWriter::new();
        writer.write("r", "A1");
        writer.write("s", "1");

        let result = writer.finish();
        assert_eq!(result, " r=\"A1\" s=\"1\"");
    }

    #[test]
    fn test_attribute_writer_entity_encoding() {
        let mut writer = AttributeWriter::new();
        writer.write("value", "<test>&\"'");

        let result = writer.finish();
        assert_eq!(result, " value=\"&lt;test&gt;&amp;&quot;&apos;\"");
    }

    #[test]
    fn test_attribute_writer_preserved() {
        let attr = PreservedAttribute::new("custom", "val", 0);
        let mut writer = AttributeWriter::new();
        writer.write_preserved(&attr);

        let result = writer.finish();
        assert_eq!(result, " custom=\"val\"");
    }

    #[test]
    fn test_attribute_writer_with_unknown() {
        let unknown = PreservedAttribute::new("custom", "val", 0);
        let mut writer = AttributeWriter::new();
        writer.write_with_unknown(&[("r", "A1"), ("s", "1")], &[&unknown]);

        let result = writer.finish();
        assert_eq!(result, " r=\"A1\" s=\"1\" custom=\"val\"");
    }

    #[test]
    fn test_attribute_writer_clear_reuse() {
        let mut writer = AttributeWriter::new();
        writer.write("first", "1");
        writer.clear();
        writer.write("second", "2");

        let result = writer.finish();
        assert_eq!(result, " second=\"2\"");
    }

    // -------------------------------------------------------------------------
    // Integration tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_round_trip_attribute_order() {
        // Simulate parsing: capture attributes from cell element
        let mut order = AttributeOrder::new();
        order.register_known("c", &["r", "s", "t"]);

        // Original order: r, x14:custom, s, t
        let tag = b"<c r=\"B2\" x14:custom=\"ext\" s=\"5\" t=\"n\">";
        order.capture_from_tag("worksheet/sheetData/row/c", tag);

        // During writing: emit in order with known first, unknown appended
        let attrs = order.get("worksheet/sheetData/row/c").unwrap();
        let unknown = attrs.unknown();

        let mut writer = AttributeWriter::new();
        writer.write_with_unknown(
            &[("r", "B2"), ("s", "5"), ("t", "n")],
            &unknown.iter().map(|a| *a).collect::<Vec<_>>(),
        );

        let result = writer.finish();
        // Known attributes first, then unknown
        assert!(result.contains("r=\"B2\""));
        assert!(result.contains("s=\"5\""));
        assert!(result.contains("t=\"n\""));
        assert!(result.contains("x14:custom=\"ext\""));
    }

    #[test]
    fn test_multiple_elements_same_type() {
        let mut order = AttributeOrder::new();
        order.register_known("row", &["r", "spans"]);

        order.capture_from_tag(
            "worksheet/sheetData/row[1]",
            b"<row r=\"1\" spans=\"1:10\">",
        );
        order.capture_from_tag(
            "worksheet/sheetData/row[2]",
            b"<row r=\"2\" customSort=\"true\">",
        );

        let row1 = order.get("worksheet/sheetData/row[1]").unwrap();
        assert_eq!(row1.unknown().len(), 0);

        let row2 = order.get("worksheet/sheetData/row[2]").unwrap();
        assert_eq!(row2.unknown().len(), 1);
        assert_eq!(row2.unknown()[0].name, "customSort");
    }
}
