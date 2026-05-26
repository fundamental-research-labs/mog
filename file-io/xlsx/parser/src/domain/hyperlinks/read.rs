//! Hyperlink parser for XLSX worksheets.
//!
//! This module parses `<hyperlinks>` and `<hyperlink>` elements from worksheet XML files
//! according to ECMA-376 CT_Hyperlinks specification, as well as hyperlink relationships
//! from the worksheet's `.rels` file.
//!
//! # Excel Hyperlink Types
//!
//! Excel supports several types of hyperlinks:
//!
//! - **URL**: External web links (http://, https://, ftp://)
//! - **Email**: Email addresses (mailto:)
//! - **File**: Local or network file paths
//! - **Internal**: References to locations within the same workbook (#Sheet1!A1)
//!
//! # XLSX Hyperlink Structure
//!
//! Hyperlinks in XLSX are split between the worksheet XML and relationships file:
//!
//! ## Worksheet XML (xl/worksheets/sheet1.xml)
//! ```xml
//! <hyperlinks>
//!   <hyperlink ref="A1" r:id="rId1" display="Click here" tooltip="Visit website"/>
//!   <hyperlink ref="B1" location="Sheet2!A1" display="Go to Sheet2"/>
//! </hyperlinks>
//! ```
//!
//! ## Relationships File (xl/worksheets/_rels/sheet1.xml.rels)
//! ```xml
//! <Relationships>
//!   <Relationship Id="rId1" Type=".../hyperlink" Target="https://example.com" TargetMode="External"/>
//! </Relationships>
//! ```
//!
//! # Performance
//! - Uses SIMD-optimized scanning functions from the scanner module
//! - Zero allocations in the hot path where possible
//! - Graceful handling of malformed input
//!
//! UTF-8 boundary guard: the two `&s[n..]` / `&s[..n]` slices in this file
//! split hyperlink anchor strings at byte offsets produced by
//! ASCII-only `#` or `!` searches. Char-boundary by construction.
//! File-scope allow documented here.

#![allow(clippy::string_slice)]

use crate::infra::scanner::{find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::parse_string_attr;

// ============================================================================
// Type Definitions
// ============================================================================

/// Type of hyperlink target
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum HyperlinkType {
    /// External URL (http://, https://, ftp://)
    #[default]
    Url,
    /// Local or network file path
    File,
    /// Email address (mailto:)
    Email,
    /// Internal reference within the workbook (#Sheet1!A1)
    Internal,
}

impl HyperlinkType {
    /// Detect hyperlink type from target string
    ///
    /// # Arguments
    /// * `target` - The hyperlink target URL/path
    ///
    /// # Returns
    /// The detected HyperlinkType
    pub fn from_target(target: &str) -> Self {
        let target_lower = target.to_lowercase();

        if target_lower.starts_with("mailto:") {
            Self::Email
        } else if target_lower.starts_with("http://")
            || target_lower.starts_with("https://")
            || target_lower.starts_with("ftp://")
        {
            Self::Url
        } else if target.starts_with('#') {
            Self::Internal
        } else if target_lower.contains("://") {
            // Other protocol URLs (e.g., file://)
            Self::Url
        } else {
            // Local file path or network path
            Self::File
        }
    }

    /// Convert to string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Url => "url",
            Self::File => "file",
            Self::Email => "email",
            Self::Internal => "internal",
        }
    }
}

/// Target mode for external relationships
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TargetMode {
    /// Internal target (within the package)
    #[default]
    Internal,
    /// External target (outside the package)
    External,
}

impl TargetMode {
    /// Parse from XML attribute value
    pub fn from_bytes(bytes: &[u8]) -> Self {
        match bytes {
            b"External" => Self::External,
            b"external" => Self::External,
            _ => Self::Internal,
        }
    }

    /// Convert to string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Internal => "Internal",
            Self::External => "External",
        }
    }
}

// ============================================================================
// Hyperlink Relationship Struct
// ============================================================================

/// Hyperlink relationship from the .rels file
///
/// Maps a relationship ID to an external target URL/path.
#[derive(Debug, Clone, Default)]
pub struct HyperlinkRelationship {
    /// Relationship ID (e.g., "rId1")
    pub id: String,

    /// Target URL or file path
    pub target: String,

    /// Target mode (Internal or External)
    pub target_mode: TargetMode,
}

impl HyperlinkRelationship {
    /// Create a new HyperlinkRelationship
    pub fn new(id: String, target: String, target_mode: TargetMode) -> Self {
        Self {
            id,
            target,
            target_mode,
        }
    }

    /// Parse hyperlink relationships from a worksheet's .rels file
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the .rels XML file
    ///
    /// # Returns
    /// Vector of hyperlink relationships
    pub fn parse_all(xml: &[u8]) -> Vec<Self> {
        let mut relationships = Vec::new();
        let mut pos = 0;

        while pos < xml.len() {
            // Find next <Relationship element
            let rel_pos = match find_tag_simd(xml, b"Relationship", pos) {
                Some(p) => p,
                None => break,
            };

            // Find the end of this element
            let element_end = find_element_end_simple(xml, rel_pos).unwrap_or(xml.len());

            let element = &xml[rel_pos..element_end.min(xml.len())];

            // Check if this is a hyperlink relationship
            let type_value = parse_bytes_attr(element, b"Type=\"");
            let is_hyperlink = type_value
                .map(|t| memchr::memmem::find(t, b"hyperlink").is_some())
                .unwrap_or(false);

            if is_hyperlink {
                // Extract Id attribute
                let id = parse_string_attr(element, b"Id=\"").unwrap_or_default();

                // Extract Target attribute
                let target = parse_string_attr(element, b"Target=\"").unwrap_or_default();

                // Extract TargetMode attribute
                let target_mode = parse_bytes_attr(element, b"TargetMode=\"")
                    .map(TargetMode::from_bytes)
                    .unwrap_or_default();

                if !id.is_empty() {
                    relationships.push(HyperlinkRelationship {
                        id,
                        target,
                        target_mode,
                    });
                }
            }

            pos = element_end + 1;
        }

        relationships
    }
}

// ============================================================================
// Hyperlink Struct
// ============================================================================

/// A single hyperlink in a worksheet (CT_Hyperlink)
///
/// Represents a hyperlink that can be applied to one or more cells.
/// The actual target URL may come from either:
/// - The `location` attribute (for internal links)
/// - A relationship referenced by `r_id` (for external links)
#[derive(Debug, Clone, Default)]
pub struct Hyperlink {
    /// Cell reference or range this hyperlink applies to (e.g., "A1" or "A1:B5")
    pub cell_ref: String,

    /// Relationship ID linking to worksheet's .rels file (for external links)
    pub r_id: Option<String>,

    /// Internal location/anchor within the workbook (e.g., "Sheet2!A1" or "#Sheet2!A1")
    pub location: Option<String>,

    /// Display text (shown instead of the URL)
    pub display: Option<String>,

    /// Tooltip text (shown on hover)
    pub tooltip: Option<String>,

    /// Target URL/path (resolved from relationship or internal location)
    /// This is populated after combining with relationship data
    pub target: Option<String>,

    /// Detected hyperlink type based on target
    pub link_type: HyperlinkType,

    /// History tracking - unique ID for this hyperlink
    pub id: Option<String>,

    /// Extension UID for revision tracking (xr:uid)
    pub uid: Option<String>,
}

impl Hyperlink {
    /// Create a new Hyperlink with just a cell reference
    pub fn new(cell_ref: String) -> Self {
        Self {
            cell_ref,
            ..Default::default()
        }
    }

    /// Parse a single <hyperlink> element
    ///
    /// # Arguments
    /// * `xml` - Bytes of the hyperlink element
    ///
    /// # Returns
    /// Parsed Hyperlink, or None if required attributes are missing
    pub fn parse(xml: &[u8]) -> Option<Self> {
        let mut hyperlink = Hyperlink::default();

        // Find the opening tag end
        let tag_end = find_gt_simd(xml, 0)?;
        let tag = &xml[..tag_end];

        // Parse ref attribute (required)
        hyperlink.cell_ref = parse_string_attr(tag, b"ref=\"")?;
        if hyperlink.cell_ref.is_empty() {
            return None;
        }

        // Parse r:id attribute (for external links via relationships)
        hyperlink.r_id =
            parse_string_attr(tag, b"r:id=\"").or_else(|| parse_string_attr(tag, b":id=\""));

        // Parse location attribute (for internal links)
        hyperlink.location = parse_string_attr(tag, b"location=\"");

        // Parse display attribute
        hyperlink.display = parse_string_attr(tag, b"display=\"");

        // Parse tooltip attribute
        hyperlink.tooltip = parse_string_attr(tag, b"tooltip=\"");

        // Parse id attribute (history tracking)
        // Note: This is different from r:id - it's a unique identifier for the hyperlink
        // Note: find_attr_simd already validates whitespace prefix, so no leading space needed
        hyperlink.id = parse_string_attr(tag, b"id=\"");

        // Parse xr:uid attribute (revision tracking extension)
        hyperlink.uid =
            parse_string_attr(tag, b"xr:uid=\"").or_else(|| parse_string_attr(tag, b":uid=\""));

        // Determine link type based on location if present
        if let Some(ref loc) = hyperlink.location {
            hyperlink.target = Some(loc.clone());
            hyperlink.link_type = HyperlinkType::Internal;
        }

        Some(hyperlink)
    }

    /// Resolve the hyperlink target using relationship data
    ///
    /// # Arguments
    /// * `relationships` - Map of relationship ID to HyperlinkRelationship
    pub fn resolve_target(&mut self, relationships: &[HyperlinkRelationship]) {
        if let Some(ref r_id) = self.r_id {
            if let Some(rel) = relationships.iter().find(|r| r.id == *r_id) {
                // Combine target with location fragment if present
                let mut full_target = rel.target.clone();

                if let Some(ref location) = self.location {
                    // Append location as fragment if it doesn't start with #
                    if !location.is_empty() {
                        if location.starts_with('#') {
                            full_target.push_str(location);
                        } else {
                            full_target.push('#');
                            full_target.push_str(location);
                        }
                    }
                }

                self.target = Some(full_target.clone());
                self.link_type = HyperlinkType::from_target(&full_target);
            }
        } else if self.target.is_none() {
            // No r:id and no target yet - check if we have just a location
            if let Some(ref location) = self.location {
                self.target = Some(location.clone());
                self.link_type = HyperlinkType::Internal;
            }
        }
    }

    /// Get the final resolved URL/target
    ///
    /// Returns the target URL, falling back to location if no external target
    pub fn get_target(&self) -> Option<&str> {
        self.target.as_deref().or(self.location.as_deref())
    }

    /// Check if this is an external link
    pub fn is_external(&self) -> bool {
        self.r_id.is_some()
            || matches!(
                self.link_type,
                HyperlinkType::Url | HyperlinkType::File | HyperlinkType::Email
            )
    }

    /// Check if this is an internal link
    pub fn is_internal(&self) -> bool {
        matches!(self.link_type, HyperlinkType::Internal)
    }

    /// Parse the location fragment to extract sheet name and cell reference
    ///
    /// # Returns
    /// Tuple of (sheet_name, cell_reference) if parseable
    pub fn parse_location(&self) -> Option<(String, String)> {
        let location = self.location.as_ref()?;
        let loc = location.trim_start_matches('#');

        // Look for ! separator between sheet name and cell reference
        if let Some(sep_pos) = loc.find('!') {
            let sheet_name = &loc[..sep_pos];
            let cell_ref = &loc[sep_pos + 1..];

            // Remove quotes from sheet name if present
            let sheet_name = sheet_name.trim_matches('\'');

            Some((sheet_name.to_string(), cell_ref.to_string()))
        } else {
            // No sheet name, just a cell reference or named range
            Some((String::new(), loc.to_string()))
        }
    }
}

// ============================================================================
// Hyperlinks Container Struct
// ============================================================================

/// Container for all hyperlinks in a worksheet (CT_Hyperlinks)
#[derive(Debug, Clone, Default)]
pub struct Hyperlinks {
    /// List of hyperlinks
    pub hyperlinks: Vec<Hyperlink>,
}

impl Hyperlinks {
    /// Parse hyperlinks from worksheet XML
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the worksheet XML
    ///
    /// # Returns
    /// Parsed Hyperlinks container, or None if no hyperlinks found
    pub fn parse(xml: &[u8]) -> Option<Self> {
        // Find <hyperlinks> section
        let hl_start = find_tag_simd(xml, b"hyperlinks", 0)?;
        let hl_end = find_closing_tag(xml, b"hyperlinks", hl_start).unwrap_or(xml.len());

        let section = &xml[hl_start..hl_end];
        let mut container = Hyperlinks::default();

        // Parse individual <hyperlink> elements
        // Note: find_tag_simd correctly handles "hyperlink" vs "hyperlinks" because
        // the tag must be followed by whitespace, >, or /
        let mut pos = 0;
        while let Some(hl_pos) = find_tag_simd(section, b"hyperlink", pos) {
            // Find the end of this hyperlink element
            let element_end = find_element_end_simple(section, hl_pos).unwrap_or(section.len());

            // +1 to include the closing '>' character
            if let Some(hl) = Hyperlink::parse(&section[hl_pos..element_end + 1]) {
                container.hyperlinks.push(hl);
            }

            pos = element_end;
        }

        if container.hyperlinks.is_empty() {
            None
        } else {
            Some(container)
        }
    }

    /// Parse hyperlinks and resolve targets using relationship data
    ///
    /// # Arguments
    /// * `worksheet_xml` - Raw bytes of the worksheet XML
    /// * `rels_xml` - Raw bytes of the worksheet's .rels file
    ///
    /// # Returns
    /// Parsed Hyperlinks with resolved targets
    pub fn parse_with_rels(worksheet_xml: &[u8], rels_xml: &[u8]) -> Option<Self> {
        let mut container = Self::parse(worksheet_xml)?;
        let relationships = HyperlinkRelationship::parse_all(rels_xml);

        for hyperlink in &mut container.hyperlinks {
            hyperlink.resolve_target(&relationships);
        }

        Some(container)
    }

    /// Get hyperlink for a specific cell
    ///
    /// # Arguments
    /// * `cell_ref` - Cell reference (e.g., "A1")
    ///
    /// # Returns
    /// Reference to the hyperlink if found
    pub fn get(&self, cell_ref: &str) -> Option<&Hyperlink> {
        self.hyperlinks.iter().find(|h| h.cell_ref == cell_ref)
    }

    /// Get all hyperlinks for cells in a range
    ///
    /// # Arguments
    /// * `range` - Cell range (e.g., "A1:B5")
    ///
    /// # Returns
    /// Vector of references to matching hyperlinks
    pub fn get_in_range(&self, range: &str) -> Vec<&Hyperlink> {
        // Parse the range to get start and end coordinates
        if let Some((start_ref, end_ref)) = parse_cell_range(range) {
            self.hyperlinks
                .iter()
                .filter(|h| {
                    if let Some((col, row)) = parse_cell_ref(&h.cell_ref) {
                        let (start_col, start_row) = start_ref;
                        let (end_col, end_row) = end_ref;
                        col >= start_col && col <= end_col && row >= start_row && row <= end_row
                    } else {
                        false
                    }
                })
                .collect()
        } else {
            // Single cell reference
            self.hyperlinks
                .iter()
                .filter(|h| h.cell_ref == range)
                .collect()
        }
    }

    /// Get the number of hyperlinks
    pub fn len(&self) -> usize {
        self.hyperlinks.len()
    }

    /// Check if there are no hyperlinks
    pub fn is_empty(&self) -> bool {
        self.hyperlinks.is_empty()
    }

    /// Iterate over hyperlinks
    pub fn iter(&self) -> impl Iterator<Item = &Hyperlink> {
        self.hyperlinks.iter()
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Parse raw bytes from an attribute (no decoding)
fn parse_bytes_attr<'a>(xml: &'a [u8], attr: &[u8]) -> Option<&'a [u8]> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();

    if value_start >= xml.len() {
        return None;
    }

    // Find closing quote
    let mut pos = value_start;
    while pos < xml.len() && xml[pos] != b'"' {
        pos += 1;
    }

    Some(&xml[value_start..pos])
}

/// Find the end of an XML element (the closing > character)
/// Handles quoted attribute values
fn find_element_end_simple(bytes: &[u8], start: usize) -> Option<usize> {
    let mut pos = start;
    let mut in_quotes = false;

    while pos < bytes.len() {
        let b = bytes[pos];

        if b == b'"' {
            in_quotes = !in_quotes;
        } else if b == b'>' && !in_quotes {
            return Some(pos);
        }

        pos += 1;
    }

    None
}

/// Decode XML entities in attribute/content values
#[cfg(test)]
fn decode_xml_entities(bytes: &[u8]) -> String {
    let mut result = String::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'&' {
            // Check for common XML entities
            if i + 4 <= bytes.len() && &bytes[i..i + 4] == b"&lt;" {
                result.push('<');
                i += 4;
            } else if i + 4 <= bytes.len() && &bytes[i..i + 4] == b"&gt;" {
                result.push('>');
                i += 4;
            } else if i + 5 <= bytes.len() && &bytes[i..i + 5] == b"&amp;" {
                result.push('&');
                i += 5;
            } else if i + 6 <= bytes.len() && &bytes[i..i + 6] == b"&quot;" {
                result.push('"');
                i += 6;
            } else if i + 6 <= bytes.len() && &bytes[i..i + 6] == b"&apos;" {
                result.push('\'');
                i += 6;
            } else if i + 2 < bytes.len() && bytes[i + 1] == b'#' {
                // Numeric character reference
                if let Some((ch, len)) = parse_char_reference(&bytes[i..]) {
                    result.push(ch);
                    i += len;
                } else {
                    result.push('&');
                    i += 1;
                }
            } else {
                // Unknown entity, just copy the &
                result.push('&');
                i += 1;
            }
        } else {
            // Handle UTF-8 multi-byte sequences properly
            // Check UTF-8 leading byte to determine sequence length
            let byte = bytes[i];
            let seq_len = if byte & 0x80 == 0 {
                1 // ASCII
            } else if byte & 0xE0 == 0xC0 {
                2 // 2-byte sequence
            } else if byte & 0xF0 == 0xE0 {
                3 // 3-byte sequence
            } else if byte & 0xF8 == 0xF0 {
                4 // 4-byte sequence
            } else {
                1 // Invalid, treat as single byte
            };

            let end = (i + seq_len).min(bytes.len());
            if let Ok(s) = std::str::from_utf8(&bytes[i..end]) {
                result.push_str(s);
            } else {
                // Fallback for invalid UTF-8: use replacement char
                result.push(char::REPLACEMENT_CHARACTER);
            }
            i = end;
        }
    }

    result
}

/// Parse a numeric character reference (&#NNN; or &#xHHH;)
#[cfg(test)]
fn parse_char_reference(bytes: &[u8]) -> Option<(char, usize)> {
    if bytes.len() < 4 || bytes[0] != b'&' || bytes[1] != b'#' {
        return None;
    }

    let is_hex = bytes[2] == b'x' || bytes[2] == b'X';
    let num_start = if is_hex { 3 } else { 2 };

    let mut end = num_start;
    while end < bytes.len() && bytes[end] != b';' {
        end += 1;
    }

    if end >= bytes.len() || bytes[end] != b';' {
        return None;
    }

    let num_bytes = &bytes[num_start..end];
    let code_point = if is_hex {
        u32::from_str_radix(std::str::from_utf8(num_bytes).ok()?, 16).ok()?
    } else {
        std::str::from_utf8(num_bytes).ok()?.parse::<u32>().ok()?
    };

    char::from_u32(code_point).map(|ch| (ch, end + 1))
}

/// Parse a cell reference (e.g., "A1") into column and row indices
fn parse_cell_ref(cell_ref: &str) -> Option<(u32, u32)> {
    let bytes = cell_ref.as_bytes();
    let mut col: u32 = 0;
    let mut row: u32 = 0;
    let mut i = 0;

    // Parse column letters (A-Z, case insensitive)
    while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
        let c = bytes[i].to_ascii_uppercase();
        col = col * 26 + (c - b'A' + 1) as u32;
        i += 1;
    }

    if col == 0 {
        return None;
    }

    // Parse row number
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        row = row * 10 + (bytes[i] - b'0') as u32;
        i += 1;
    }

    if row == 0 {
        return None;
    }

    Some((col, row))
}

/// Parse a cell range (e.g., "A1:B5") into start and end coordinates
fn parse_cell_range(range: &str) -> Option<((u32, u32), (u32, u32))> {
    let parts: Vec<&str> = range.split(':').collect();
    if parts.len() != 2 {
        return None;
    }

    let start = parse_cell_ref(parts[0])?;
    let end = parse_cell_ref(parts[1])?;
    Some((start, end))
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // HyperlinkType tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_hyperlink_type_from_target_url() {
        assert_eq!(
            HyperlinkType::from_target("http://example.com"),
            HyperlinkType::Url
        );
        assert_eq!(
            HyperlinkType::from_target("https://example.com"),
            HyperlinkType::Url
        );
        assert_eq!(
            HyperlinkType::from_target("HTTP://EXAMPLE.COM"),
            HyperlinkType::Url
        );
        assert_eq!(
            HyperlinkType::from_target("ftp://files.example.com"),
            HyperlinkType::Url
        );
    }

    #[test]
    fn test_hyperlink_type_from_target_email() {
        assert_eq!(
            HyperlinkType::from_target("mailto:test@example.com"),
            HyperlinkType::Email
        );
        assert_eq!(
            HyperlinkType::from_target("MAILTO:TEST@EXAMPLE.COM"),
            HyperlinkType::Email
        );
        assert_eq!(
            HyperlinkType::from_target("mailto:user@domain.org?subject=Hello"),
            HyperlinkType::Email
        );
    }

    #[test]
    fn test_hyperlink_type_from_target_internal() {
        assert_eq!(
            HyperlinkType::from_target("#Sheet1!A1"),
            HyperlinkType::Internal
        );
        assert_eq!(
            HyperlinkType::from_target("#'Sheet Name'!B5"),
            HyperlinkType::Internal
        );
        assert_eq!(
            HyperlinkType::from_target("#NamedRange"),
            HyperlinkType::Internal
        );
    }

    #[test]
    fn test_hyperlink_type_from_target_file() {
        assert_eq!(HyperlinkType::from_target("file.xlsx"), HyperlinkType::File);
        assert_eq!(
            HyperlinkType::from_target("../other/file.xlsx"),
            HyperlinkType::File
        );
        assert_eq!(
            HyperlinkType::from_target("C:\\Documents\\file.xlsx"),
            HyperlinkType::File
        );
        assert_eq!(
            HyperlinkType::from_target("\\\\server\\share\\file.xlsx"),
            HyperlinkType::File
        );
    }

    #[test]
    fn test_hyperlink_type_as_str() {
        assert_eq!(HyperlinkType::Url.as_str(), "url");
        assert_eq!(HyperlinkType::File.as_str(), "file");
        assert_eq!(HyperlinkType::Email.as_str(), "email");
        assert_eq!(HyperlinkType::Internal.as_str(), "internal");
    }

    // -------------------------------------------------------------------------
    // TargetMode tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_target_mode_from_bytes() {
        assert_eq!(TargetMode::from_bytes(b"External"), TargetMode::External);
        assert_eq!(TargetMode::from_bytes(b"external"), TargetMode::External);
        assert_eq!(TargetMode::from_bytes(b"Internal"), TargetMode::Internal);
        assert_eq!(TargetMode::from_bytes(b""), TargetMode::Internal);
        assert_eq!(TargetMode::from_bytes(b"unknown"), TargetMode::Internal);
    }

    #[test]
    fn test_target_mode_as_str() {
        assert_eq!(TargetMode::Internal.as_str(), "Internal");
        assert_eq!(TargetMode::External.as_str(), "External");
    }

    // -------------------------------------------------------------------------
    // HyperlinkRelationship tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_hyperlink_relationships() {
        let xml = br#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:test@example.com" TargetMode="External"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"#;

        let rels = HyperlinkRelationship::parse_all(xml);
        assert_eq!(rels.len(), 2);

        assert_eq!(rels[0].id, "rId1");
        assert_eq!(rels[0].target, "https://example.com");
        assert_eq!(rels[0].target_mode, TargetMode::External);

        assert_eq!(rels[1].id, "rId2");
        assert_eq!(rels[1].target, "mailto:test@example.com");
        assert_eq!(rels[1].target_mode, TargetMode::External);
    }

    #[test]
    fn test_parse_hyperlink_relationships_empty() {
        let xml = br#"<Relationships></Relationships>"#;
        let rels = HyperlinkRelationship::parse_all(xml);
        assert_eq!(rels.len(), 0);
    }

    #[test]
    fn test_parse_hyperlink_relationships_different_order() {
        let xml = br#"<Relationships>
  <Relationship Target="https://example.com" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Id="rId1"/>
</Relationships>"#;

        let rels = HyperlinkRelationship::parse_all(xml);
        assert_eq!(rels.len(), 1);
        assert_eq!(rels[0].id, "rId1");
        assert_eq!(rels[0].target, "https://example.com");
    }

    // -------------------------------------------------------------------------
    // Hyperlink parsing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_external_hyperlink() {
        let xml =
            br#"<hyperlink ref="A1" r:id="rId1" display="Click here" tooltip="Visit website"/>"#;

        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.cell_ref, "A1");
        assert_eq!(hl.r_id, Some("rId1".to_string()));
        assert_eq!(hl.display, Some("Click here".to_string()));
        assert_eq!(hl.tooltip, Some("Visit website".to_string()));
        assert!(hl.location.is_none());
    }

    #[test]
    fn test_parse_internal_hyperlink() {
        let xml = br#"<hyperlink ref="B5" location="Sheet2!A1" display="Go to Sheet2"/>"#;

        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.cell_ref, "B5");
        assert_eq!(hl.location, Some("Sheet2!A1".to_string()));
        assert_eq!(hl.display, Some("Go to Sheet2".to_string()));
        assert!(hl.r_id.is_none());
        assert_eq!(hl.link_type, HyperlinkType::Internal);
    }

    #[test]
    fn test_parse_hyperlink_with_fragment() {
        let xml = br#"<hyperlink ref="C1" r:id="rId1" location="Section1"/>"#;

        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.cell_ref, "C1");
        assert_eq!(hl.r_id, Some("rId1".to_string()));
        assert_eq!(hl.location, Some("Section1".to_string()));
    }

    #[test]
    fn test_parse_hyperlink_minimal() {
        let xml = br#"<hyperlink ref="D1"/>"#;

        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.cell_ref, "D1");
        assert!(hl.r_id.is_none());
        assert!(hl.location.is_none());
        assert!(hl.display.is_none());
        assert!(hl.tooltip.is_none());
    }

    #[test]
    fn test_parse_hyperlink_missing_ref() {
        let xml = br#"<hyperlink r:id="rId1" display="No ref"/>"#;
        assert!(Hyperlink::parse(xml).is_none());
    }

    #[test]
    fn test_parse_hyperlink_with_xml_entities() {
        let xml = br#"<hyperlink ref="E1" display="A &amp; B &lt;test&gt;" tooltip="&quot;quoted&quot;"/>"#;

        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.display, Some("A & B <test>".to_string()));
        assert_eq!(hl.tooltip, Some("\"quoted\"".to_string()));
    }

    #[test]
    fn test_parse_hyperlink_with_id() {
        let xml = br#"<hyperlink ref="F1" id="12345" r:id="rId1"/>"#;

        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.cell_ref, "F1");
        assert_eq!(hl.id, Some("12345".to_string()));
    }

    // -------------------------------------------------------------------------
    // Hyperlink resolution tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_resolve_external_target() {
        let mut hl = Hyperlink {
            cell_ref: "A1".to_string(),
            r_id: Some("rId1".to_string()),
            ..Default::default()
        };

        let rels = vec![HyperlinkRelationship::new(
            "rId1".to_string(),
            "https://example.com".to_string(),
            TargetMode::External,
        )];

        hl.resolve_target(&rels);
        assert_eq!(hl.target, Some("https://example.com".to_string()));
        assert_eq!(hl.link_type, HyperlinkType::Url);
    }

    #[test]
    fn test_resolve_target_with_fragment() {
        let mut hl = Hyperlink {
            cell_ref: "A1".to_string(),
            r_id: Some("rId1".to_string()),
            location: Some("Section1".to_string()),
            ..Default::default()
        };

        let rels = vec![HyperlinkRelationship::new(
            "rId1".to_string(),
            "https://example.com/page".to_string(),
            TargetMode::External,
        )];

        hl.resolve_target(&rels);
        assert_eq!(
            hl.target,
            Some("https://example.com/page#Section1".to_string())
        );
    }

    #[test]
    fn test_resolve_target_with_hash_fragment() {
        let mut hl = Hyperlink {
            cell_ref: "A1".to_string(),
            r_id: Some("rId1".to_string()),
            location: Some("#Section1".to_string()),
            ..Default::default()
        };

        let rels = vec![HyperlinkRelationship::new(
            "rId1".to_string(),
            "https://example.com/page".to_string(),
            TargetMode::External,
        )];

        hl.resolve_target(&rels);
        assert_eq!(
            hl.target,
            Some("https://example.com/page#Section1".to_string())
        );
    }

    #[test]
    fn test_resolve_internal_only() {
        let mut hl = Hyperlink {
            cell_ref: "A1".to_string(),
            location: Some("Sheet2!A1".to_string()),
            ..Default::default()
        };

        hl.resolve_target(&[]);
        assert_eq!(hl.target, Some("Sheet2!A1".to_string()));
        assert_eq!(hl.link_type, HyperlinkType::Internal);
    }

    // -------------------------------------------------------------------------
    // Hyperlink helper method tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_hyperlink_is_external() {
        let mut hl = Hyperlink {
            cell_ref: "A1".to_string(),
            r_id: Some("rId1".to_string()),
            ..Default::default()
        };
        assert!(hl.is_external());

        hl.r_id = None;
        hl.link_type = HyperlinkType::Url;
        assert!(hl.is_external());

        hl.link_type = HyperlinkType::Internal;
        assert!(!hl.is_external());
    }

    #[test]
    fn test_hyperlink_is_internal() {
        let hl = Hyperlink {
            cell_ref: "A1".to_string(),
            link_type: HyperlinkType::Internal,
            ..Default::default()
        };
        assert!(hl.is_internal());

        let hl2 = Hyperlink {
            cell_ref: "A1".to_string(),
            link_type: HyperlinkType::Url,
            ..Default::default()
        };
        assert!(!hl2.is_internal());
    }

    #[test]
    fn test_parse_location() {
        let hl = Hyperlink {
            cell_ref: "A1".to_string(),
            location: Some("Sheet2!B5".to_string()),
            ..Default::default()
        };
        let (sheet, cell) = hl.parse_location().unwrap();
        assert_eq!(sheet, "Sheet2");
        assert_eq!(cell, "B5");
    }

    #[test]
    fn test_parse_location_with_hash() {
        let hl = Hyperlink {
            cell_ref: "A1".to_string(),
            location: Some("#Sheet2!B5".to_string()),
            ..Default::default()
        };
        let (sheet, cell) = hl.parse_location().unwrap();
        assert_eq!(sheet, "Sheet2");
        assert_eq!(cell, "B5");
    }

    #[test]
    fn test_parse_location_quoted_sheet() {
        let hl = Hyperlink {
            cell_ref: "A1".to_string(),
            location: Some("'Sheet With Spaces'!A1".to_string()),
            ..Default::default()
        };
        let (sheet, cell) = hl.parse_location().unwrap();
        assert_eq!(sheet, "Sheet With Spaces");
        assert_eq!(cell, "A1");
    }

    #[test]
    fn test_parse_location_named_range() {
        let hl = Hyperlink {
            cell_ref: "A1".to_string(),
            location: Some("MyNamedRange".to_string()),
            ..Default::default()
        };
        let (sheet, cell) = hl.parse_location().unwrap();
        assert_eq!(sheet, "");
        assert_eq!(cell, "MyNamedRange");
    }

    // -------------------------------------------------------------------------
    // Hyperlinks container tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_hyperlinks_container() {
        let xml = br#"<worksheet>
            <sheetData/>
            <hyperlinks>
                <hyperlink ref="A1" r:id="rId1" display="Link 1"/>
                <hyperlink ref="B2" location="Sheet2!A1" display="Internal"/>
                <hyperlink ref="C3" r:id="rId2" tooltip="Email"/>
            </hyperlinks>
        </worksheet>"#;

        let hls = Hyperlinks::parse(xml).unwrap();
        assert_eq!(hls.len(), 3);
        assert!(!hls.is_empty());

        assert_eq!(hls.hyperlinks[0].cell_ref, "A1");
        assert_eq!(hls.hyperlinks[1].cell_ref, "B2");
        assert_eq!(hls.hyperlinks[2].cell_ref, "C3");
    }

    #[test]
    fn test_parse_hyperlinks_empty() {
        let xml = b"<worksheet><sheetData/></worksheet>";
        assert!(Hyperlinks::parse(xml).is_none());
    }

    #[test]
    fn test_parse_hyperlinks_with_rels() {
        let worksheet_xml = br#"<worksheet>
            <hyperlinks>
                <hyperlink ref="A1" r:id="rId1" display="Google"/>
                <hyperlink ref="B1" location="Sheet2!A1"/>
            </hyperlinks>
        </worksheet>"#;

        let rels_xml = br#"<Relationships>
            <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://google.com" TargetMode="External"/>
        </Relationships>"#;

        let hls = Hyperlinks::parse_with_rels(worksheet_xml, rels_xml).unwrap();
        assert_eq!(hls.len(), 2);

        assert_eq!(
            hls.hyperlinks[0].target,
            Some("https://google.com".to_string())
        );
        assert_eq!(hls.hyperlinks[0].link_type, HyperlinkType::Url);

        assert_eq!(hls.hyperlinks[1].target, Some("Sheet2!A1".to_string()));
        assert_eq!(hls.hyperlinks[1].link_type, HyperlinkType::Internal);
    }

    #[test]
    fn test_hyperlinks_get() {
        let xml = br#"<worksheet>
            <hyperlinks>
                <hyperlink ref="A1" display="First"/>
                <hyperlink ref="B2" display="Second"/>
            </hyperlinks>
        </worksheet>"#;

        let hls = Hyperlinks::parse(xml).unwrap();

        let hl = hls.get("A1").unwrap();
        assert_eq!(hl.display, Some("First".to_string()));

        let hl = hls.get("B2").unwrap();
        assert_eq!(hl.display, Some("Second".to_string()));

        assert!(hls.get("C3").is_none());
    }

    #[test]
    fn test_hyperlinks_get_in_range() {
        let xml = br#"<worksheet>
            <hyperlinks>
                <hyperlink ref="A1" display="A1"/>
                <hyperlink ref="B2" display="B2"/>
                <hyperlink ref="C3" display="C3"/>
                <hyperlink ref="D4" display="D4"/>
            </hyperlinks>
        </worksheet>"#;

        let hls = Hyperlinks::parse(xml).unwrap();

        let in_range = hls.get_in_range("A1:B2");
        assert_eq!(in_range.len(), 2);

        let in_range = hls.get_in_range("A1:D4");
        assert_eq!(in_range.len(), 4);

        let in_range = hls.get_in_range("E5:F6");
        assert_eq!(in_range.len(), 0);
    }

    #[test]
    fn test_hyperlinks_iter() {
        let xml = br#"<worksheet>
            <hyperlinks>
                <hyperlink ref="A1"/>
                <hyperlink ref="B2"/>
            </hyperlinks>
        </worksheet>"#;

        let hls = Hyperlinks::parse(xml).unwrap();
        let refs: Vec<&str> = hls.iter().map(|h| h.cell_ref.as_str()).collect();
        assert_eq!(refs, vec!["A1", "B2"]);
    }

    // -------------------------------------------------------------------------
    // Helper function tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_cell_ref() {
        assert_eq!(parse_cell_ref("A1"), Some((1, 1)));
        assert_eq!(parse_cell_ref("B5"), Some((2, 5)));
        assert_eq!(parse_cell_ref("Z26"), Some((26, 26)));
        assert_eq!(parse_cell_ref("AA1"), Some((27, 1)));
        assert_eq!(parse_cell_ref("AB100"), Some((28, 100)));
        assert_eq!(parse_cell_ref("XFD1048576"), Some((16384, 1048576)));
    }

    #[test]
    fn test_parse_cell_ref_invalid() {
        assert_eq!(parse_cell_ref(""), None);
        assert_eq!(parse_cell_ref("1A"), None);
        assert_eq!(parse_cell_ref("A"), None);
        assert_eq!(parse_cell_ref("1"), None);
    }

    #[test]
    fn test_parse_cell_range() {
        let range = parse_cell_range("A1:B5").unwrap();
        assert_eq!(range, ((1, 1), (2, 5)));

        let range = parse_cell_range("AA10:ZZ100").unwrap();
        assert_eq!(range, ((27, 10), (702, 100)));
    }

    #[test]
    fn test_parse_cell_range_invalid() {
        assert!(parse_cell_range("A1").is_none());
        assert!(parse_cell_range("A1:").is_none());
        assert!(parse_cell_range(":B5").is_none());
        assert!(parse_cell_range("A1:B5:C6").is_none());
    }

    #[test]
    fn test_decode_xml_entities() {
        assert_eq!(decode_xml_entities(b"hello"), "hello");
        assert_eq!(decode_xml_entities(b"&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_xml_entities(b"&amp;"), "&");
        assert_eq!(decode_xml_entities(b"&quot;text&quot;"), "\"text\"");
        assert_eq!(decode_xml_entities(b"&apos;"), "'");
        assert_eq!(decode_xml_entities(b"&#65;"), "A");
        assert_eq!(decode_xml_entities(b"&#x41;"), "A");
    }

    // -------------------------------------------------------------------------
    // Integration tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_realistic_worksheet_with_hyperlinks() {
        let worksheet_xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <sheetData>
        <row r="1">
            <c r="A1"><v>Company</v></c>
            <c r="B1"><v>Website</v></c>
            <c r="C1"><v>Contact</v></c>
        </row>
    </sheetData>
    <hyperlinks>
        <hyperlink ref="B2" r:id="rId1" display="Visit Website" tooltip="Go to company website"/>
        <hyperlink ref="C2" r:id="rId2" display="Email Us"/>
        <hyperlink ref="D2" location="'Contact Sheet'!A1" display="See Details"/>
        <hyperlink ref="E2" r:id="rId3" location="pricing" display="View Pricing"/>
    </hyperlinks>
</worksheet>"#;

        let rels_xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.example.com" TargetMode="External"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:contact@example.com" TargetMode="External"/>
    <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.example.com/products" TargetMode="External"/>
</Relationships>"#;

        let hls = Hyperlinks::parse_with_rels(worksheet_xml, rels_xml).unwrap();
        assert_eq!(hls.len(), 4);

        // Check external URL
        let web_link = hls.get("B2").unwrap();
        assert_eq!(web_link.target, Some("https://www.example.com".to_string()));
        assert_eq!(web_link.link_type, HyperlinkType::Url);
        assert!(web_link.is_external());

        // Check email
        let email_link = hls.get("C2").unwrap();
        assert_eq!(
            email_link.target,
            Some("mailto:contact@example.com".to_string())
        );
        assert_eq!(email_link.link_type, HyperlinkType::Email);

        // Check internal link
        let internal_link = hls.get("D2").unwrap();
        assert_eq!(internal_link.target, Some("'Contact Sheet'!A1".to_string()));
        assert_eq!(internal_link.link_type, HyperlinkType::Internal);
        assert!(internal_link.is_internal());
        let (sheet, cell) = internal_link.parse_location().unwrap();
        assert_eq!(sheet, "Contact Sheet");
        assert_eq!(cell, "A1");

        // Check URL with fragment
        let pricing_link = hls.get("E2").unwrap();
        assert_eq!(
            pricing_link.target,
            Some("https://www.example.com/products#pricing".to_string())
        );
    }

    #[test]
    fn test_malformed_xml_handling() {
        // Missing closing tags
        let xml = b"<hyperlinks><hyperlink ref=\"A1\" r:id=\"rId1\">";
        let result = Hyperlinks::parse(xml);
        // Should handle gracefully, may return partial results
        if let Some(hls) = result {
            assert!(hls.len() <= 1);
        }
    }

    #[test]
    fn test_empty_attributes() {
        let xml = br#"<hyperlink ref="A1" display="" tooltip=""/>"#;
        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.cell_ref, "A1");
        assert_eq!(hl.display, Some("".to_string()));
        assert_eq!(hl.tooltip, Some("".to_string()));
    }

    #[test]
    fn test_unicode_in_hyperlinks() {
        let xml = "<hyperlink ref=\"A1\" display=\"\u{65E5}\u{672C}\u{8A9E}\" tooltip=\"\u{4E2D}\u{6587}\"/>".as_bytes();
        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.display, Some("\u{65E5}\u{672C}\u{8A9E}".to_string())); // Japanese
        assert_eq!(hl.tooltip, Some("\u{4E2D}\u{6587}".to_string())); // Chinese
    }

    #[test]
    fn test_hyperlink_new() {
        let hl = Hyperlink::new("A1".to_string());
        assert_eq!(hl.cell_ref, "A1");
        assert!(hl.r_id.is_none());
        assert!(hl.location.is_none());
        assert!(hl.display.is_none());
        assert!(hl.tooltip.is_none());
        assert!(hl.target.is_none());
        assert_eq!(hl.link_type, HyperlinkType::Url);
    }

    #[test]
    fn test_hyperlink_relationship_new() {
        let rel = HyperlinkRelationship::new(
            "rId1".to_string(),
            "https://example.com".to_string(),
            TargetMode::External,
        );
        assert_eq!(rel.id, "rId1");
        assert_eq!(rel.target, "https://example.com");
        assert_eq!(rel.target_mode, TargetMode::External);
    }
}
