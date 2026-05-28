//! Unknown element preservation for XLSX round-trip fidelity.
//!
//! This module provides data structures and utilities for preserving XML elements
//! that the parser doesn't explicitly handle. This enables:
//!
//! - **Future Excel features**: Elements from newer Excel versions survive round-trips
//! - **Third-party extensions**: Google Sheets, LibreOffice extensions are preserved
//! - **Custom XML parts**: Application-specific data is maintained
//! - **Full fidelity**: Files can be opened, modified, and saved without data loss
//!
//! # Architecture
//!
//! During parsing, unknown elements are captured along with:
//! - Their parent element path (for reinsertion)
//! - Their raw XML content (including attributes and children)
//! - Position hints (before/after known siblings)
//!
//! During writing, preserved elements are emitted at their original positions.
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::unknown_elements::{PreservedElements, PreservedXml, PreservedPosition};
//!
//! let mut preserved = PreservedElements::new();
//!
//! // During parsing: capture an unknown element
//! preserved.add(PreservedXml {
//!     parent_path: "worksheet/sheetData".to_string(),
//!     raw_xml: "<x14:customFeature attr=\"value\">content</x14:customFeature>".to_string(),
//!     position: PreservedPosition::AfterElement("row".to_string()),
//! });
//!
//! // During writing: retrieve elements for a parent
//! for element in preserved.get_for_parent("worksheet/sheetData") {
//!     writer.raw_str(&element.raw_xml);
//! }
//! ```
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file slices
//! verbatim-preserved XML fragments at byte offsets produced by
//! `find_lt_simd`/`find_gt_simd` — ASCII-only `<` / `>` searches.
//! Char-boundary by construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use crate::infra::scanner::{find_element_end, find_gt_simd, find_lt_simd};
use std::collections::HashMap;

// ============================================================================
// Core Data Structures
// ============================================================================

/// Position hint for where a preserved element should be re-inserted.
///
/// This helps maintain element ordering during round-trips.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreservedPosition {
    /// At the start of parent's children (before all known elements)
    First,
    /// At the end of parent's children (after all known elements)
    Last,
    /// After a specific known sibling element
    AfterElement(String),
    /// Before a specific known sibling element
    BeforeElement(String),
    /// At a specific index among siblings (0-based)
    AtIndex(usize),
}

impl Default for PreservedPosition {
    fn default() -> Self {
        PreservedPosition::Last
    }
}

/// A preserved XML fragment for round-trip fidelity.
///
/// Contains the raw XML of an unknown element along with context
/// about where it was found and should be re-inserted.
#[derive(Debug, Clone)]
pub struct PreservedXml {
    /// XPath-like path where this element was found (e.g., "worksheet/sheetData")
    pub parent_path: String,

    /// The raw XML string including the element and all its content.
    /// This is stored as a string rather than bytes for easier manipulation
    /// and because XML is typically UTF-8 encoded.
    pub raw_xml: String,

    /// Position hint for reinsertion during writing
    pub position: PreservedPosition,

    /// The tag name of the preserved element (extracted for quick lookup)
    pub tag_name: String,

    /// Optional namespace prefix (e.g., "x14" in "<x14:customFeature>")
    pub namespace_prefix: Option<String>,
}

impl PreservedXml {
    /// Create a new preserved XML fragment.
    ///
    /// # Arguments
    /// * `parent_path` - The path to the parent element (e.g., "worksheet/sheetData")
    /// * `raw_xml` - The raw XML content including the element and all children
    /// * `position` - Position hint for reinsertion
    pub fn new(
        parent_path: impl Into<String>,
        raw_xml: impl Into<String>,
        position: PreservedPosition,
    ) -> Self {
        let raw = raw_xml.into();
        let (tag_name, namespace_prefix) = Self::extract_tag_info(&raw);

        Self {
            parent_path: parent_path.into(),
            raw_xml: raw,
            position,
            tag_name,
            namespace_prefix,
        }
    }

    /// Create a preserved element with position after a sibling.
    pub fn after(
        parent_path: impl Into<String>,
        raw_xml: impl Into<String>,
        after_element: impl Into<String>,
    ) -> Self {
        Self::new(
            parent_path,
            raw_xml,
            PreservedPosition::AfterElement(after_element.into()),
        )
    }

    /// Create a preserved element at the end of parent.
    pub fn at_end(parent_path: impl Into<String>, raw_xml: impl Into<String>) -> Self {
        Self::new(parent_path, raw_xml, PreservedPosition::Last)
    }

    /// Create a preserved element at the start of parent.
    pub fn at_start(parent_path: impl Into<String>, raw_xml: impl Into<String>) -> Self {
        Self::new(parent_path, raw_xml, PreservedPosition::First)
    }

    /// Extract tag name and optional namespace prefix from raw XML.
    fn extract_tag_info(raw_xml: &str) -> (String, Option<String>) {
        let bytes = raw_xml.as_bytes();

        // Find the opening '<'
        let start = match bytes.iter().position(|&b| b == b'<') {
            Some(pos) => pos + 1,
            None => return (String::new(), None),
        };

        // Find the end of the tag name (space, >, /)
        let mut end = start;
        while end < bytes.len() {
            let b = bytes[end];
            if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
                break;
            }
            end += 1;
        }

        let full_tag = String::from_utf8_lossy(&bytes[start..end]).to_string();

        // Check for namespace prefix
        if let Some(colon_pos) = full_tag.find(':') {
            let prefix = full_tag[..colon_pos].to_string();
            let local_name = full_tag[colon_pos + 1..].to_string();
            (local_name, Some(prefix))
        } else {
            (full_tag, None)
        }
    }

    /// Get the full tag name including namespace prefix if present.
    pub fn full_tag_name(&self) -> String {
        if let Some(ref prefix) = self.namespace_prefix {
            format!("{}:{}", prefix, self.tag_name)
        } else {
            self.tag_name.clone()
        }
    }
}

// ============================================================================
// Collection of Preserved Elements
// ============================================================================

/// Collection of preserved elements for a sheet or workbook part.
///
/// Elements are organized by parent path for efficient lookup during writing.
#[derive(Debug, Default, Clone)]
pub struct PreservedElements {
    /// Elements indexed by parent path
    elements_by_parent: HashMap<String, Vec<PreservedXml>>,

    /// Preserved attributes for known elements (element_path -> attr_name -> attr_value)
    preserved_attributes: HashMap<String, HashMap<String, String>>,
}

impl PreservedElements {
    /// Create a new empty collection.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a preserved element to the collection.
    pub fn add(&mut self, element: PreservedXml) {
        self.elements_by_parent
            .entry(element.parent_path.clone())
            .or_default()
            .push(element);
    }

    /// Add a preserved attribute for a known element.
    ///
    /// # Arguments
    /// * `element_path` - Path to the element (e.g., "worksheet/sheetViews/sheetView")
    /// * `attr_name` - The attribute name
    /// * `attr_value` - The attribute value
    pub fn add_attribute(
        &mut self,
        element_path: impl Into<String>,
        attr_name: impl Into<String>,
        attr_value: impl Into<String>,
    ) {
        self.preserved_attributes
            .entry(element_path.into())
            .or_default()
            .insert(attr_name.into(), attr_value.into());
    }

    /// Get all preserved elements for a parent path.
    pub fn get_for_parent(&self, parent_path: &str) -> &[PreservedXml] {
        self.elements_by_parent
            .get(parent_path)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// Get elements that should appear first (before known elements).
    pub fn get_first(&self, parent_path: &str) -> Vec<&PreservedXml> {
        self.get_for_parent(parent_path)
            .iter()
            .filter(|e| matches!(e.position, PreservedPosition::First))
            .collect()
    }

    /// Get elements that should appear last (after known elements).
    pub fn get_last(&self, parent_path: &str) -> Vec<&PreservedXml> {
        self.get_for_parent(parent_path)
            .iter()
            .filter(|e| matches!(e.position, PreservedPosition::Last))
            .collect()
    }

    /// Get elements that should appear after a specific sibling.
    pub fn get_after(&self, parent_path: &str, after_element: &str) -> Vec<&PreservedXml> {
        self.get_for_parent(parent_path)
            .iter()
            .filter(
                |e| matches!(&e.position, PreservedPosition::AfterElement(s) if s == after_element),
            )
            .collect()
    }

    /// Get all elements with `AfterElement` position that aren't matched by a
    /// specific `get_after` call. Used as a catch-all to avoid dropping elements
    /// whose `AfterElement` sibling isn't explicitly emitted by the writer.
    pub fn get_after_any(&self, parent_path: &str, already_handled: &[&str]) -> Vec<&PreservedXml> {
        self.get_for_parent(parent_path)
            .iter()
            .filter(|e| {
                if let PreservedPosition::AfterElement(ref s) = e.position {
                    !already_handled.contains(&s.as_str())
                } else {
                    false
                }
            })
            .collect()
    }

    /// Get elements that should appear before a specific sibling.
    pub fn get_before(&self, parent_path: &str, before_element: &str) -> Vec<&PreservedXml> {
        self.get_for_parent(parent_path)
            .iter()
            .filter(|e| matches!(&e.position, PreservedPosition::BeforeElement(s) if s == before_element))
            .collect()
    }

    /// Get preserved attributes for an element.
    pub fn get_attributes(&self, element_path: &str) -> Option<&HashMap<String, String>> {
        self.preserved_attributes.get(element_path)
    }

    /// Check if there are any preserved elements.
    pub fn is_empty(&self) -> bool {
        self.elements_by_parent.is_empty() && self.preserved_attributes.is_empty()
    }

    /// Get total count of preserved elements.
    pub fn element_count(&self) -> usize {
        self.elements_by_parent.values().map(|v| v.len()).sum()
    }

    /// Get total count of preserved attributes.
    pub fn attribute_count(&self) -> usize {
        self.preserved_attributes.values().map(|v| v.len()).sum()
    }

    /// Merge another PreservedElements collection into this one.
    pub fn merge(&mut self, other: PreservedElements) {
        for (parent_path, elements) in other.elements_by_parent {
            self.elements_by_parent
                .entry(parent_path)
                .or_default()
                .extend(elements);
        }

        for (element_path, attrs) in other.preserved_attributes {
            self.preserved_attributes
                .entry(element_path)
                .or_default()
                .extend(attrs);
        }
    }

    /// Clear all preserved elements.
    pub fn clear(&mut self) {
        self.elements_by_parent.clear();
        self.preserved_attributes.clear();
    }

    /// Serialize preserved elements to (position_key, raw_xml) pairs for storage
    /// in parse diagnostics. The position_key encodes the parent path and position
    /// as a string that can be deserialized back into a `PreservedXml`.
    ///
    /// Format: "parent_path\0position_type\0position_arg\0tag_name"
    pub fn to_position_pairs(&self) -> Vec<(String, String)> {
        let mut pairs = Vec::new();
        for elements in self.elements_by_parent.values() {
            for elem in elements {
                let pos_key = match &elem.position {
                    PreservedPosition::First => {
                        format!("{}\0first\0\0{}", elem.parent_path, elem.tag_name)
                    }
                    PreservedPosition::Last => {
                        format!("{}\0last\0\0{}", elem.parent_path, elem.tag_name)
                    }
                    PreservedPosition::AfterElement(s) => {
                        format!("{}\0after\0{}\0{}", elem.parent_path, s, elem.tag_name)
                    }
                    PreservedPosition::BeforeElement(s) => {
                        format!("{}\0before\0{}\0{}", elem.parent_path, s, elem.tag_name)
                    }
                    PreservedPosition::AtIndex(i) => {
                        format!("{}\0index\0{}\0{}", elem.parent_path, i, elem.tag_name)
                    }
                };
                pairs.push((pos_key, elem.raw_xml.clone()));
            }
        }
        pairs
    }

    /// Deserialize from (position_key, raw_xml) pairs.
    pub fn from_position_pairs(pairs: &[(String, String)]) -> Self {
        let mut result = Self::new();
        for (pos_key, raw_xml) in pairs {
            let parts: Vec<&str> = pos_key.splitn(4, '\0').collect();
            if parts.len() < 4 {
                continue;
            }
            let parent_path = parts[0].to_string();
            let position = match parts[1] {
                "first" => PreservedPosition::First,
                "last" => PreservedPosition::Last,
                "after" => PreservedPosition::AfterElement(parts[2].to_string()),
                "before" => PreservedPosition::BeforeElement(parts[2].to_string()),
                "index" => PreservedPosition::AtIndex(parts[2].parse().unwrap_or(0)),
                _ => PreservedPosition::Last,
            };
            let tag_name = parts[3].to_string();
            // Extract namespace prefix from tag_name (e.g., "x14:customFeature" → Some("x14"))
            let namespace_prefix = tag_name
                .find(':')
                .map(|colon_pos| tag_name[..colon_pos].to_string());
            result.add(PreservedXml {
                parent_path,
                raw_xml: raw_xml.clone(),
                position,
                tag_name,
                namespace_prefix,
            });
        }
        result
    }
}

// ============================================================================
// XML Extraction Utilities
// ============================================================================

/// Extract a complete XML element (including all content and nested elements).
///
/// This function handles:
/// - Self-closing elements (`<tag/>`)
/// - Elements with content (`<tag>...</tag>`)
/// - Nested elements with same tag name
/// - Namespaced elements
///
/// # Arguments
/// * `xml` - The XML bytes to extract from
/// * `start` - Position of the opening `<`
///
/// # Returns
/// The end position (exclusive) of the element, or None if malformed
pub fn extract_element_bounds(xml: &[u8], start: usize) -> Option<(usize, usize)> {
    if start >= xml.len() || xml[start] != b'<' {
        return None;
    }

    // Find the tag name
    let tag_start = start + 1;
    let mut tag_end = tag_start;
    while tag_end < xml.len() {
        let b = xml[tag_end];
        if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
            break;
        }
        tag_end += 1;
    }

    if tag_end <= tag_start {
        return None;
    }

    let tag_name = &xml[tag_start..tag_end];

    // Find the end of the opening tag
    let element_end_pos = find_element_end(xml, tag_end)?;

    // Check if self-closing
    if element_end_pos > 0 && xml[element_end_pos - 1] == b'/' {
        return Some((start, element_end_pos + 1));
    }

    // Find the matching closing tag, handling nested elements
    let mut pos = element_end_pos + 1;
    let mut depth = 1;

    while pos < xml.len() && depth > 0 {
        if let Some(lt_pos) = find_lt_simd(xml, pos) {
            let after_lt = lt_pos + 1;

            if after_lt >= xml.len() {
                break;
            }

            // Check for closing tag
            if xml[after_lt] == b'/' {
                let close_tag_start = after_lt + 1;

                // Extract closing tag name
                let mut close_tag_end = close_tag_start;
                while close_tag_end < xml.len() {
                    let b = xml[close_tag_end];
                    if matches!(b, b'>' | b' ' | b'\t' | b'\n' | b'\r') {
                        break;
                    }
                    close_tag_end += 1;
                }

                let close_tag_name = &xml[close_tag_start..close_tag_end];

                // Check if it matches (considering namespace)
                if tags_match(tag_name, close_tag_name) {
                    depth -= 1;
                    if depth == 0 {
                        // Find the > of the closing tag
                        if let Some(gt_pos) = find_gt_simd(xml, close_tag_end) {
                            return Some((start, gt_pos + 1));
                        }
                    }
                }
            } else {
                // Check for opening tag of same element
                let mut open_tag_end = after_lt;
                while open_tag_end < xml.len() {
                    let b = xml[open_tag_end];
                    if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
                        break;
                    }
                    open_tag_end += 1;
                }

                let open_tag_name = &xml[after_lt..open_tag_end];

                if tags_match(tag_name, open_tag_name) {
                    // Check if self-closing
                    if let Some(gt_pos) = find_element_end(xml, open_tag_end) {
                        if gt_pos > 0 && xml[gt_pos - 1] != b'/' {
                            depth += 1;
                        }
                    }
                }
            }

            pos = after_lt;
        } else {
            break;
        }
    }

    None
}

/// Check if two tag names match (considering namespaces).
///
/// Matches if:
/// - Both are identical
/// - One has a namespace prefix and the local names match
fn tags_match(tag1: &[u8], tag2: &[u8]) -> bool {
    if tag1 == tag2 {
        return true;
    }

    // Extract local names (after : if present)
    let local1 = tag1
        .iter()
        .position(|&b| b == b':')
        .map(|p| &tag1[p + 1..])
        .unwrap_or(tag1);
    let local2 = tag2
        .iter()
        .position(|&b| b == b':')
        .map(|p| &tag2[p + 1..])
        .unwrap_or(tag2);

    local1 == local2
}

/// Extract raw XML for an element from bytes.
///
/// # Arguments
/// * `xml` - The XML bytes
/// * `start` - Position of the opening `<`
///
/// # Returns
/// The raw XML as a String, or None if extraction fails
pub fn extract_element_xml(xml: &[u8], start: usize) -> Option<String> {
    let (_, end) = extract_element_bounds(xml, start)?;
    String::from_utf8(xml[start..end].to_vec()).ok()
}

// ============================================================================
// Parsing Utilities
// ============================================================================

/// Context for capturing unknown elements during parsing.
///
/// This is used by parsers to track their position and capture elements
/// they don't recognize.
#[derive(Debug, Default)]
pub struct UnknownElementCapture {
    /// Current parent path being parsed
    current_path: Vec<String>,

    /// Set of known element names at each level
    known_elements: HashMap<String, Vec<String>>,

    /// Captured elements
    pub captured: PreservedElements,
}

impl UnknownElementCapture {
    /// Create a new capture context.
    pub fn new() -> Self {
        Self::default()
    }

    /// Push a new parent element onto the path.
    pub fn push_element(&mut self, name: &str) {
        self.current_path.push(name.to_string());
    }

    /// Pop the current element from the path.
    pub fn pop_element(&mut self) {
        self.current_path.pop();
    }

    /// Get the current parent path as a string.
    pub fn current_path(&self) -> String {
        self.current_path.join("/")
    }

    /// Register known element names for the current path.
    ///
    /// Elements not in this list will be captured as unknown.
    pub fn register_known_elements(&mut self, elements: &[&str]) {
        let path = self.current_path();
        self.known_elements
            .insert(path, elements.iter().map(|s| s.to_string()).collect());
    }

    /// Check if an element name is known at the current path.
    pub fn is_known_element(&self, name: &str) -> bool {
        let path = self.current_path();

        // Extract local name if namespaced
        let local_name = name.find(':').map(|p| &name[p + 1..]).unwrap_or(name);

        self.known_elements
            .get(&path)
            .map(|known| known.iter().any(|k| k == local_name))
            .unwrap_or(false)
    }

    /// Capture an unknown element.
    ///
    /// # Arguments
    /// * `raw_xml` - The raw XML of the element
    /// * `position` - Where the element should be reinserted
    pub fn capture(&mut self, raw_xml: String, position: PreservedPosition) {
        let element = PreservedXml::new(self.current_path(), raw_xml, position);
        self.captured.add(element);
    }

    /// Capture an unknown element after a sibling.
    pub fn capture_after(&mut self, raw_xml: String, after_element: &str) {
        self.capture(
            raw_xml,
            PreservedPosition::AfterElement(after_element.to_string()),
        );
    }

    /// Extract and capture an element from XML bytes.
    ///
    /// # Arguments
    /// * `xml` - The XML bytes
    /// * `start` - Position of the opening `<`
    /// * `position` - Where the element should be reinserted
    ///
    /// # Returns
    /// The end position of the element, or None if extraction fails
    pub fn extract_and_capture(
        &mut self,
        xml: &[u8],
        start: usize,
        position: PreservedPosition,
    ) -> Option<usize> {
        let (_, end) = extract_element_bounds(xml, start)?;
        let raw_xml = String::from_utf8(xml[start..end].to_vec()).ok()?;
        self.capture(raw_xml, position);
        Some(end)
    }

    /// Take the captured elements, leaving an empty collection.
    pub fn take(&mut self) -> PreservedElements {
        std::mem::take(&mut self.captured)
    }
}

// ============================================================================
// Writing Utilities
// ============================================================================

/// Helper trait for writing preserved elements.
///
/// This can be implemented by writer types to gain utility methods
/// for emitting preserved content.
pub trait PreservedWriter {
    /// Write raw XML content.
    fn write_preserved_raw(&mut self, content: &str);

    /// Write all preserved elements that should appear first.
    fn write_preserved_first(&mut self, preserved: &PreservedElements, parent_path: &str) {
        for element in preserved.get_first(parent_path) {
            self.write_preserved_raw(&element.raw_xml);
        }
    }

    /// Write all preserved elements that should appear last.
    fn write_preserved_last(&mut self, preserved: &PreservedElements, parent_path: &str) {
        for element in preserved.get_last(parent_path) {
            self.write_preserved_raw(&element.raw_xml);
        }
    }

    /// Write preserved elements that appear after a specific sibling.
    fn write_preserved_after(
        &mut self,
        preserved: &PreservedElements,
        parent_path: &str,
        after_element: &str,
    ) {
        for element in preserved.get_after(parent_path, after_element) {
            self.write_preserved_raw(&element.raw_xml);
        }
    }

    /// Write preserved elements that appear before a specific sibling.
    fn write_preserved_before(
        &mut self,
        preserved: &PreservedElements,
        parent_path: &str,
        before_element: &str,
    ) {
        for element in preserved.get_before(parent_path, before_element) {
            self.write_preserved_raw(&element.raw_xml);
        }
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::scanner::find_tag_simd;

    // -------------------------------------------------------------------------
    // PreservedXml tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_preserved_xml_new() {
        let element = PreservedXml::new(
            "worksheet/sheetData",
            "<unknown attr=\"value\">content</unknown>",
            PreservedPosition::Last,
        );

        assert_eq!(element.parent_path, "worksheet/sheetData");
        assert_eq!(element.tag_name, "unknown");
        assert_eq!(element.namespace_prefix, None);
    }

    #[test]
    fn test_preserved_xml_with_namespace() {
        let element = PreservedXml::new(
            "worksheet",
            "<x14:customFeature>test</x14:customFeature>",
            PreservedPosition::First,
        );

        assert_eq!(element.tag_name, "customFeature");
        assert_eq!(element.namespace_prefix, Some("x14".to_string()));
        assert_eq!(element.full_tag_name(), "x14:customFeature");
    }

    #[test]
    fn test_preserved_xml_self_closing() {
        let element = PreservedXml::new(
            "styles",
            "<ext:feature enabled=\"true\"/>",
            PreservedPosition::Last,
        );

        assert_eq!(element.tag_name, "feature");
        assert_eq!(element.namespace_prefix, Some("ext".to_string()));
    }

    #[test]
    fn test_preserved_xml_convenience_constructors() {
        let after = PreservedXml::after("parent", "<elem/>", "sibling");
        assert!(matches!(after.position, PreservedPosition::AfterElement(s) if s == "sibling"));

        let at_end = PreservedXml::at_end("parent", "<elem/>");
        assert!(matches!(at_end.position, PreservedPosition::Last));

        let at_start = PreservedXml::at_start("parent", "<elem/>");
        assert!(matches!(at_start.position, PreservedPosition::First));
    }

    // -------------------------------------------------------------------------
    // PreservedElements collection tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_preserved_elements_add_and_get() {
        let mut preserved = PreservedElements::new();

        preserved.add(PreservedXml::new(
            "worksheet",
            "<x14:custom/>",
            PreservedPosition::Last,
        ));
        preserved.add(PreservedXml::new(
            "worksheet",
            "<x14:another/>",
            PreservedPosition::First,
        ));
        preserved.add(PreservedXml::new(
            "worksheet/sheetData",
            "<x14:data/>",
            PreservedPosition::Last,
        ));

        assert_eq!(preserved.get_for_parent("worksheet").len(), 2);
        assert_eq!(preserved.get_for_parent("worksheet/sheetData").len(), 1);
        assert_eq!(preserved.get_for_parent("nonexistent").len(), 0);
    }

    #[test]
    fn test_preserved_elements_get_by_position() {
        let mut preserved = PreservedElements::new();

        preserved.add(PreservedXml::new(
            "parent",
            "<first/>",
            PreservedPosition::First,
        ));
        preserved.add(PreservedXml::new(
            "parent",
            "<last/>",
            PreservedPosition::Last,
        ));
        preserved.add(PreservedXml::new(
            "parent",
            "<after_row/>",
            PreservedPosition::AfterElement("row".to_string()),
        ));
        preserved.add(PreservedXml::new(
            "parent",
            "<before_col/>",
            PreservedPosition::BeforeElement("col".to_string()),
        ));

        assert_eq!(preserved.get_first("parent").len(), 1);
        assert_eq!(preserved.get_last("parent").len(), 1);
        assert_eq!(preserved.get_after("parent", "row").len(), 1);
        assert_eq!(preserved.get_before("parent", "col").len(), 1);
        assert_eq!(preserved.get_after("parent", "nonexistent").len(), 0);
    }

    #[test]
    fn test_preserved_elements_attributes() {
        let mut preserved = PreservedElements::new();

        preserved.add_attribute("worksheet/sheetView", "unknownAttr", "value1");
        preserved.add_attribute("worksheet/sheetView", "anotherAttr", "value2");
        preserved.add_attribute("worksheet/dimension", "customAttr", "value3");

        let attrs = preserved.get_attributes("worksheet/sheetView").unwrap();
        assert_eq!(attrs.len(), 2);
        assert_eq!(attrs.get("unknownAttr"), Some(&"value1".to_string()));
        assert_eq!(attrs.get("anotherAttr"), Some(&"value2".to_string()));

        assert!(preserved.get_attributes("nonexistent").is_none());
    }

    #[test]
    fn test_preserved_elements_counts() {
        let mut preserved = PreservedElements::new();

        assert!(preserved.is_empty());
        assert_eq!(preserved.element_count(), 0);
        assert_eq!(preserved.attribute_count(), 0);

        preserved.add(PreservedXml::at_end("parent1", "<elem1/>"));
        preserved.add(PreservedXml::at_end("parent2", "<elem2/>"));
        preserved.add_attribute("path", "attr1", "val1");
        preserved.add_attribute("path", "attr2", "val2");

        assert!(!preserved.is_empty());
        assert_eq!(preserved.element_count(), 2);
        assert_eq!(preserved.attribute_count(), 2);
    }

    #[test]
    fn test_preserved_elements_merge() {
        let mut preserved1 = PreservedElements::new();
        preserved1.add(PreservedXml::at_end("parent", "<elem1/>"));
        preserved1.add_attribute("path", "attr1", "val1");

        let mut preserved2 = PreservedElements::new();
        preserved2.add(PreservedXml::at_end("parent", "<elem2/>"));
        preserved2.add_attribute("path", "attr2", "val2");
        preserved2.add_attribute("path2", "attr3", "val3");

        preserved1.merge(preserved2);

        assert_eq!(preserved1.get_for_parent("parent").len(), 2);
        assert_eq!(preserved1.get_attributes("path").unwrap().len(), 2);
        assert_eq!(preserved1.get_attributes("path2").unwrap().len(), 1);
    }

    #[test]
    fn test_preserved_elements_clear() {
        let mut preserved = PreservedElements::new();
        preserved.add(PreservedXml::at_end("parent", "<elem/>"));
        preserved.add_attribute("path", "attr", "val");

        preserved.clear();

        assert!(preserved.is_empty());
        assert_eq!(preserved.element_count(), 0);
        assert_eq!(preserved.attribute_count(), 0);
    }

    // -------------------------------------------------------------------------
    // Element extraction tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_extract_element_bounds_self_closing() {
        let xml = b"<elem attr=\"value\"/>";
        let bounds = extract_element_bounds(xml, 0);
        assert_eq!(bounds, Some((0, 20)));
    }

    #[test]
    fn test_extract_element_bounds_with_content() {
        let xml = b"<elem>content</elem>";
        let bounds = extract_element_bounds(xml, 0);
        assert_eq!(bounds, Some((0, 20)));
    }

    #[test]
    fn test_extract_element_bounds_nested() {
        let xml = b"<outer><inner>text</inner></outer>";
        let bounds = extract_element_bounds(xml, 0);
        assert_eq!(bounds, Some((0, 34)));
    }

    #[test]
    fn test_extract_element_bounds_nested_same_name() {
        // Handle nested elements with same tag name
        let xml = b"<div><div>inner</div></div>";
        let bounds = extract_element_bounds(xml, 0);
        assert_eq!(bounds, Some((0, 27)));
    }

    #[test]
    fn test_extract_element_bounds_namespaced() {
        let xml = b"<x14:custom attr=\"val\">content</x14:custom>";
        let bounds = extract_element_bounds(xml, 0);
        assert_eq!(bounds, Some((0, 43)));
    }

    #[test]
    fn test_extract_element_bounds_with_offset() {
        let xml = b"prefix<elem>content</elem>suffix";
        let bounds = extract_element_bounds(xml, 6);
        assert_eq!(bounds, Some((6, 26)));
    }

    #[test]
    fn test_extract_element_bounds_malformed() {
        // No closing tag
        let xml = b"<elem>content";
        assert_eq!(extract_element_bounds(xml, 0), None);

        // Not starting with <
        let xml = b"elem>content</elem>";
        assert_eq!(extract_element_bounds(xml, 0), None);
    }

    #[test]
    fn test_extract_element_xml() {
        let xml = b"<root><child attr=\"val\">text</child></root>";
        let child_xml = extract_element_xml(xml, 6);
        assert_eq!(
            child_xml,
            Some("<child attr=\"val\">text</child>".to_string())
        );
    }

    #[test]
    fn test_tags_match_identical() {
        assert!(tags_match(b"elem", b"elem"));
        assert!(tags_match(b"ns:elem", b"ns:elem"));
    }

    #[test]
    fn test_tags_match_with_namespace() {
        assert!(tags_match(b"elem", b"ns:elem"));
        assert!(tags_match(b"ns:elem", b"elem"));
        assert!(tags_match(b"ns1:elem", b"ns2:elem"));
    }

    #[test]
    fn test_tags_match_different() {
        assert!(!tags_match(b"elem1", b"elem2"));
        assert!(!tags_match(b"ns:elem1", b"elem2"));
    }

    // -------------------------------------------------------------------------
    // UnknownElementCapture tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_capture_path_tracking() {
        let mut capture = UnknownElementCapture::new();

        assert_eq!(capture.current_path(), "");

        capture.push_element("worksheet");
        assert_eq!(capture.current_path(), "worksheet");

        capture.push_element("sheetData");
        assert_eq!(capture.current_path(), "worksheet/sheetData");

        capture.pop_element();
        assert_eq!(capture.current_path(), "worksheet");

        capture.pop_element();
        assert_eq!(capture.current_path(), "");
    }

    #[test]
    fn test_capture_known_elements() {
        let mut capture = UnknownElementCapture::new();
        capture.push_element("worksheet");

        capture.register_known_elements(&["sheetViews", "sheetData", "mergeCells"]);

        assert!(capture.is_known_element("sheetViews"));
        assert!(capture.is_known_element("sheetData"));
        assert!(capture.is_known_element("x14:sheetData")); // Namespace should be stripped
        assert!(!capture.is_known_element("unknownElement"));
    }

    #[test]
    fn test_capture_element() {
        let mut capture = UnknownElementCapture::new();
        capture.push_element("worksheet");

        capture.capture("<unknown/>".to_string(), PreservedPosition::Last);
        capture.capture_after("<afterRow/>".to_string(), "row");

        let preserved = capture.take();
        assert_eq!(preserved.element_count(), 2);
        assert_eq!(preserved.get_for_parent("worksheet").len(), 2);

        // After take, capture should be empty
        assert_eq!(capture.captured.element_count(), 0);
    }

    #[test]
    fn test_capture_extract_and_capture() {
        let mut capture = UnknownElementCapture::new();
        capture.push_element("worksheet");

        let xml = b"<unknown attr=\"val\">content</unknown>";
        let end = capture.extract_and_capture(xml, 0, PreservedPosition::Last);

        assert_eq!(end, Some(37));
        assert_eq!(capture.captured.element_count(), 1);

        let elements = capture.captured.get_for_parent("worksheet");
        assert_eq!(
            elements[0].raw_xml,
            "<unknown attr=\"val\">content</unknown>"
        );
    }

    // -------------------------------------------------------------------------
    // Round-trip integration tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_round_trip_unknown_element_in_worksheet() {
        // Simulate parsing: capture unknown element
        let xml = br#"<worksheet>
            <sheetData/>
            <x14:customFeature enabled="true">data</x14:customFeature>
        </worksheet>"#;

        let mut capture = UnknownElementCapture::new();
        capture.push_element("worksheet");
        capture.register_known_elements(&["sheetData", "sheetViews", "mergeCells"]);

        // Find and capture the unknown element (x14:customFeature)
        if let Some(pos) = find_tag_simd(xml, b"customFeature", 0) {
            capture.extract_and_capture(
                xml,
                pos,
                PreservedPosition::AfterElement("sheetData".to_string()),
            );
        }

        let preserved = capture.take();

        // Verify captured
        assert_eq!(preserved.element_count(), 1);
        let elements = preserved.get_after("worksheet", "sheetData");
        assert_eq!(elements.len(), 1);
        assert!(elements[0].raw_xml.contains("x14:customFeature"));
        assert!(elements[0].raw_xml.contains("enabled=\"true\""));
    }

    #[test]
    fn test_round_trip_nested_unknown_elements() {
        let xml = br#"<parent>
            <child>
                <grandchild>value</grandchild>
            </child>
        </parent>"#;

        // Extract the full parent element
        let (start, end) = extract_element_bounds(xml, 0).unwrap();
        let raw = String::from_utf8(xml[start..end].to_vec()).unwrap();

        // Verify all content is captured
        assert!(raw.contains("<parent>"));
        assert!(raw.contains("</parent>"));
        assert!(raw.contains("<child>"));
        assert!(raw.contains("<grandchild>value</grandchild>"));
    }

    #[test]
    fn test_round_trip_multiple_unknown_elements() {
        let mut preserved = PreservedElements::new();

        // Add multiple unknown elements at different positions
        preserved.add(PreservedXml::new(
            "worksheet",
            "<x14:feature1/>",
            PreservedPosition::First,
        ));
        preserved.add(PreservedXml::new(
            "worksheet",
            "<x14:feature2/>",
            PreservedPosition::AfterElement("sheetViews".to_string()),
        ));
        preserved.add(PreservedXml::new(
            "worksheet",
            "<x14:feature3/>",
            PreservedPosition::Last,
        ));

        // Verify they can be retrieved in correct order
        assert_eq!(preserved.get_first("worksheet").len(), 1);
        assert_eq!(preserved.get_after("worksheet", "sheetViews").len(), 1);
        assert_eq!(preserved.get_last("worksheet").len(), 1);
    }

    #[test]
    fn test_round_trip_styles_unknown_elements() {
        // Simulate preserving unknown elements in styles.xml
        let mut preserved = PreservedElements::new();

        // Unknown style extension
        preserved.add(PreservedXml::new(
            "styleSheet",
            "<x14:slicerStyles defaultSlicerStyle=\"SlicerStyleLight1\"/>",
            PreservedPosition::Last,
        ));

        // Verify preservation
        assert_eq!(preserved.element_count(), 1);
        let elements = preserved.get_last("styleSheet");
        assert_eq!(elements.len(), 1);
        assert!(elements[0].raw_xml.contains("slicerStyles"));
    }
}
