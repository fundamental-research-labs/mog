//! Defined Names parser for XLSX workbooks.
//!
//! This module parses the `<definedNames>` element from `xl/workbook.xml` to extract
//! Excel Defined Names (named ranges, formulas, and special built-in names).
//!
//! # XLSX Defined Names Structure
//!
//! Defined names appear in `workbook.xml` within the `<definedNames>` element:
//!
//! ```xml
//! <definedNames>
//!   <definedName name="SalesData" comment="Q1 sales figures">Sheet1!$A$1:$D$100</definedName>
//!   <definedName name="_xlnm.Print_Area" localSheetId="0">Sheet1!$A$1:$H$50</definedName>
//!   <definedName name="TaxRate" hidden="1">0.0825</definedName>
//!   <definedName name="MyFunction" function="1" xlm="1">Sheet1!$A$1</definedName>
//! </definedNames>
//! ```
//!
//! # Name Scopes
//!
//! Names can be scoped to:
//! - **Workbook scope**: No `localSheetId` attribute - name is available in all sheets
//! - **Sheet scope**: Has `localSheetId` attribute - name is only available in that sheet
//!
//! # Built-in Names
//!
//! Excel uses special prefixed names (`_xlnm.`) for built-in functionality:
//! - `_xlnm.Print_Area` - Print area for a sheet
//! - `_xlnm.Print_Titles` - Rows/columns to repeat when printing
//! - `_xlnm.Criteria` - Criteria range for advanced filter
//! - `_xlnm._FilterDatabase` - AutoFilter range
//! - `_xlnm.Extract` - Extract range for advanced filter
//! - `_xlnm.Consolidate_Area` - Consolidation source ranges
//! - `_xlnm.Database` - Database range
//! - `_xlnm.Sheet_Title` - Sheet title
//!
//! # Performance
//!
//! This parser uses zero-copy byte slice parsing with SIMD-optimized scanning
//! from the `scanner` module to achieve high throughput on large workbooks
//! with many defined names.
//!
//! UTF-8 boundary guard: the single `&s[n..]` slice in this file splits a
//! defined-name attribute at an ASCII-only delimiter. Char-boundary
//! by construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
};
use crate::infra::xml::{parse_bool_attr, parse_string_attr, parse_u32_attr};

// ============================================================================
// Built-in Name Enum
// ============================================================================

/// Excel built-in name types identified by the `_xlnm.` prefix.
///
/// These special names are used internally by Excel for various features
/// like printing, filtering, and database operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BuiltInName {
    /// Print area definition: `_xlnm.Print_Area`
    PrintArea,
    /// Print titles (rows/columns to repeat): `_xlnm.Print_Titles`
    PrintTitles,
    /// Advanced filter criteria range: `_xlnm.Criteria`
    Criteria,
    /// AutoFilter database range: `_xlnm._FilterDatabase`
    FilterDatabase,
    /// Advanced filter extract range: `_xlnm.Extract`
    Extract,
    /// Consolidation source ranges: `_xlnm.Consolidate_Area`
    ConsolidateArea,
    /// Database range: `_xlnm.Database`
    Database,
    /// Sheet title: `_xlnm.Sheet_Title`
    SheetTitle,
    /// Recorder macro: `_xlnm.Recorder`
    Recorder,
    /// Auto_Open macro: `_xlnm.Auto_Open`
    AutoOpen,
    /// Auto_Close macro: `_xlnm.Auto_Close`
    AutoClose,
    /// Unknown built-in name (has `_xlnm.` prefix but unrecognized)
    Unknown,
}

impl BuiltInName {
    /// Parse a name string to detect if it's a built-in name.
    ///
    /// Returns `Some(BuiltInName)` if the name starts with `_xlnm.`,
    /// otherwise returns `None` for user-defined names.
    ///
    /// # Arguments
    /// * `name` - The name string to check
    ///
    /// # Example
    /// ```ignore
    /// use xlsx_parser::names::BuiltInName;
    ///
    /// assert_eq!(BuiltInName::from_name("_xlnm.Print_Area"), Some(BuiltInName::PrintArea));
    /// assert_eq!(BuiltInName::from_name("MyCustomName"), None);
    /// ```
    pub fn from_name(name: &str) -> Option<Self> {
        if !name.starts_with("_xlnm.") {
            return None;
        }

        let suffix = &name[6..]; // Skip "_xlnm."
        Some(match suffix {
            "Print_Area" => BuiltInName::PrintArea,
            "Print_Titles" => BuiltInName::PrintTitles,
            "Criteria" => BuiltInName::Criteria,
            "_FilterDatabase" => BuiltInName::FilterDatabase,
            "Extract" => BuiltInName::Extract,
            "Consolidate_Area" => BuiltInName::ConsolidateArea,
            "Database" => BuiltInName::Database,
            "Sheet_Title" => BuiltInName::SheetTitle,
            "Recorder" => BuiltInName::Recorder,
            "Auto_Open" => BuiltInName::AutoOpen,
            "Auto_Close" => BuiltInName::AutoClose,
            _ => BuiltInName::Unknown,
        })
    }

    /// Check if this built-in name type is security-sensitive.
    ///
    /// Auto macros (`Auto_Open`, `Auto_Close`) can execute code automatically
    /// and should be treated with caution.
    #[inline]
    pub fn is_auto_macro(&self) -> bool {
        matches!(self, BuiltInName::AutoOpen | BuiltInName::AutoClose)
    }

    /// Get the canonical name string for this built-in name type.
    pub fn canonical_name(&self) -> &'static str {
        match self {
            BuiltInName::PrintArea => "_xlnm.Print_Area",
            BuiltInName::PrintTitles => "_xlnm.Print_Titles",
            BuiltInName::Criteria => "_xlnm.Criteria",
            BuiltInName::FilterDatabase => "_xlnm._FilterDatabase",
            BuiltInName::Extract => "_xlnm.Extract",
            BuiltInName::ConsolidateArea => "_xlnm.Consolidate_Area",
            BuiltInName::Database => "_xlnm.Database",
            BuiltInName::SheetTitle => "_xlnm.Sheet_Title",
            BuiltInName::Recorder => "_xlnm.Recorder",
            BuiltInName::AutoOpen => "_xlnm.Auto_Open",
            BuiltInName::AutoClose => "_xlnm.Auto_Close",
            BuiltInName::Unknown => "_xlnm.Unknown",
        }
    }
}

impl Default for BuiltInName {
    fn default() -> Self {
        BuiltInName::Unknown
    }
}

// ============================================================================
// DefinedName Struct
// ============================================================================

/// A defined name entry from the workbook.
///
/// Represents a named range, formula, or built-in name with all its attributes.
#[derive(Debug, Clone, Default)]
pub struct DefinedName {
    /// The name identifier (e.g., "SalesData", "_xlnm.Print_Area")
    pub name: String,

    /// The formula or reference string (e.g., "Sheet1!$A$1:$D$100")
    ///
    /// This is the content between `<definedName>` and `</definedName>` tags.
    /// For cell references, this uses Excel's A1 notation.
    /// Can also contain formulas, constants, or error values.
    pub refers_to: String,

    /// Comment/description for the name (optional)
    pub comment: Option<String>,

    /// Custom menu text (optional) - for XLM macros
    pub custom_menu: Option<String>,

    /// Description text (optional)
    pub description: Option<String>,

    /// Help topic text (optional)
    pub help: Option<String>,

    /// Status bar text (optional)
    pub status_bar: Option<String>,

    /// Local sheet ID if this name is sheet-scoped.
    ///
    /// - `None` = Workbook scope (available in all sheets)
    /// - `Some(id)` = Sheet scope (0-indexed sheet ID)
    pub local_sheet_id: Option<u32>,

    /// Whether this name is hidden from the UI
    pub hidden: bool,

    /// Whether this name is a function (XLM macro function)
    pub function: bool,

    /// Whether this is a VBA procedure name
    pub vb_procedure: bool,

    /// Whether this is an XLM macro
    pub xlm: bool,

    /// Whether to publish this name to the server (SharePoint)
    pub publish_to_server: bool,

    /// Whether this name is a workbook parameter (for web queries)
    pub workbook_parameter: bool,

    /// Whether xml:space="preserve" was set on this element
    pub xml_space_preserve: bool,
}

impl DefinedName {
    /// Create a new DefinedName with the given name and reference.
    ///
    /// # Arguments
    /// * `name` - The name identifier
    /// * `refers_to` - The formula or reference string
    pub fn new(name: impl Into<String>, refers_to: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            refers_to: refers_to.into(),
            ..Default::default()
        }
    }

    /// Check if this is a built-in Excel name.
    ///
    /// Returns the `BuiltInName` type if this name starts with `_xlnm.`,
    /// otherwise returns `None`.
    #[inline]
    pub fn built_in_type(&self) -> Option<BuiltInName> {
        BuiltInName::from_name(&self.name)
    }

    /// Check if this name is scoped to the workbook (global).
    #[inline]
    pub fn is_workbook_scope(&self) -> bool {
        self.local_sheet_id.is_none()
    }

    /// Check if this name is scoped to a specific sheet.
    #[inline]
    pub fn is_sheet_scope(&self) -> bool {
        self.local_sheet_id.is_some()
    }

    /// Check if this name represents a print area.
    #[inline]
    pub fn is_print_area(&self) -> bool {
        self.name == "_xlnm.Print_Area"
    }

    /// Check if this name represents print titles.
    #[inline]
    pub fn is_print_titles(&self) -> bool {
        self.name == "_xlnm.Print_Titles"
    }

    /// Check if this name represents an AutoFilter database.
    #[inline]
    pub fn is_filter_database(&self) -> bool {
        self.name == "_xlnm._FilterDatabase"
    }

    /// Check if this name is potentially dangerous (auto-executing macro).
    #[inline]
    pub fn is_potentially_dangerous(&self) -> bool {
        self.built_in_type()
            .map(|bt| bt.is_auto_macro())
            .unwrap_or(false)
            || self.xlm
    }

    /// Parse a single `<definedName>` element.
    ///
    /// # Arguments
    /// * `xml` - Byte slice containing the `<definedName>...</definedName>` element
    ///
    /// # Returns
    /// A parsed `DefinedName` or `None` if parsing fails.
    pub fn parse(xml: &[u8]) -> Option<Self> {
        // Find the opening tag
        let tag_start = find_tag_simd(xml, b"definedName", 0)?;

        // Find where the opening tag ends (the > character)
        let tag_end = find_gt_simd(xml, tag_start)?;

        // Find the closing tag
        let close_start = find_closing_tag(xml, b"definedName", tag_end)?;

        // Extract the element content (the formula/reference)
        let content_start = tag_end + 1;
        let content = if content_start < close_start {
            decode_xml_entities(&xml[content_start..close_start])
        } else {
            String::new()
        };

        // Extract attributes from the opening tag
        let tag_bytes = &xml[tag_start..=tag_end];

        let name = parse_string_attr(tag_bytes, b"name=\"")?;
        let comment = parse_optional_string_attr(tag_bytes, b"comment=\"");
        let custom_menu = parse_optional_string_attr(tag_bytes, b"customMenu=\"");
        let description = parse_optional_string_attr(tag_bytes, b"description=\"");
        let help = parse_optional_string_attr(tag_bytes, b"help=\"");
        let status_bar = parse_optional_string_attr(tag_bytes, b"statusBar=\"");

        let local_sheet_id = parse_u32_attr(tag_bytes, b"localSheetId=\"");
        let hidden = parse_bool_attr(tag_bytes, b"hidden=\"");
        let function = parse_bool_attr(tag_bytes, b"function=\"");
        let vb_procedure = parse_bool_attr(tag_bytes, b"vbProcedure=\"");
        let xlm = parse_bool_attr(tag_bytes, b"xlm=\"");
        let publish_to_server = parse_bool_attr(tag_bytes, b"publishToServer=\"");
        let workbook_parameter = parse_bool_attr(tag_bytes, b"workbookParameter=\"");

        // Check for xml:space="preserve"
        let xml_space_preserve = find_attr_simd(tag_bytes, b"xml:space=\"", 0)
            .and_then(|pos| {
                let value_start = pos + b"xml:space=\"".len();
                extract_quoted_value(tag_bytes, value_start)
            })
            .map(|(s, e)| &tag_bytes[s..e] == b"preserve")
            .unwrap_or(false);

        Some(DefinedName {
            name,
            refers_to: content,
            comment,
            custom_menu,
            description,
            help,
            status_bar,
            local_sheet_id,
            hidden,
            function,
            vb_procedure,
            xlm,
            publish_to_server,
            workbook_parameter,
            xml_space_preserve,
        })
    }
}

// ============================================================================
// DefinedNames Collection
// ============================================================================

/// Collection of all defined names from a workbook.
///
/// Provides efficient lookup by name and filtering by scope.
#[derive(Debug, Clone, Default)]
pub struct DefinedNames {
    /// All defined names in document order
    names: Vec<DefinedName>,
}

impl DefinedNames {
    /// Create an empty DefinedNames collection.
    pub fn new() -> Self {
        Self { names: Vec::new() }
    }

    /// Parse the `<definedNames>` section from workbook.xml.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the workbook.xml file
    ///
    /// # Returns
    /// Parsed collection of defined names
    ///
    /// # Example
    /// ```ignore
    /// use xlsx_parser::names::DefinedNames;
    ///
    /// let xml = br#"<workbook>
    ///   <definedNames>
    ///     <definedName name="MyRange">Sheet1!$A$1:$B$10</definedName>
    ///   </definedNames>
    /// </workbook>"#;
    ///
    /// let names = DefinedNames::parse(xml);
    /// assert_eq!(names.len(), 1);
    /// assert_eq!(names.get("MyRange").unwrap().refers_to, "Sheet1!$A$1:$B$10");
    /// ```
    pub fn parse(xml: &[u8]) -> Self {
        let mut names = DefinedNames::new();

        // Find <definedNames> section
        let section_start = match find_tag_simd(xml, b"definedNames", 0) {
            Some(pos) => pos,
            None => return names,
        };

        // Find </definedNames> to bound our search
        let section_end =
            find_closing_tag(xml, b"definedNames", section_start).unwrap_or(xml.len());

        // Parse each <definedName> element
        let mut pos = section_start;

        while pos < section_end {
            // Find next <definedName element
            let name_start = match find_tag_simd(xml, b"definedName", pos) {
                Some(p) if p < section_end => p,
                _ => break,
            };

            // Make sure this is <definedName not <definedNames
            let after_tag = name_start + 12; // len("<definedName")
            if after_tag < xml.len() && xml[after_tag] == b's' {
                pos = name_start + 13;
                continue;
            }

            // Find the closing tag to get the full element
            let name_end = match find_closing_tag(xml, b"definedName", name_start) {
                Some(close_pos) => {
                    // Find the > of </definedName>
                    find_gt_simd(xml, close_pos)
                        .map(|p| p + 1)
                        .unwrap_or(xml.len())
                }
                None => {
                    // Self-closing tag - find the >
                    find_gt_simd(xml, name_start)
                        .map(|p| p + 1)
                        .unwrap_or(xml.len())
                }
            };

            // Parse this element
            let element_bytes = &xml[name_start..name_end.min(xml.len())];
            if let Some(defined_name) = DefinedName::parse(element_bytes) {
                names.names.push(defined_name);
            }

            pos = name_end;
        }

        names
    }

    /// Get the number of defined names.
    #[inline]
    pub fn len(&self) -> usize {
        self.names.len()
    }

    /// Check if there are no defined names.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }

    /// Get all defined names as a slice.
    #[inline]
    pub fn all(&self) -> &[DefinedName] {
        &self.names
    }

    /// Get a defined name by its name (case-sensitive).
    ///
    /// For workbook-scoped names, pass `None` for `sheet_id`.
    /// For sheet-scoped names, pass `Some(sheet_id)`.
    ///
    /// If multiple names match (workbook and sheet scope), sheet scope takes precedence.
    pub fn get(&self, name: &str) -> Option<&DefinedName> {
        self.names.iter().find(|n| n.name == name)
    }

    /// Get a defined name with scope consideration.
    ///
    /// # Arguments
    /// * `name` - The name to look up
    /// * `sheet_id` - The current sheet ID for scope resolution
    ///
    /// # Returns
    /// The most specific matching name (sheet-scoped preferred over workbook-scoped)
    pub fn get_in_scope(&self, name: &str, sheet_id: Option<u32>) -> Option<&DefinedName> {
        // First try to find a sheet-scoped name
        if let Some(sid) = sheet_id {
            if let Some(n) = self
                .names
                .iter()
                .find(|n| n.name == name && n.local_sheet_id == Some(sid))
            {
                return Some(n);
            }
        }

        // Fall back to workbook-scoped name
        self.names
            .iter()
            .find(|n| n.name == name && n.local_sheet_id.is_none())
    }

    /// Get all names with workbook scope.
    pub fn workbook_scoped(&self) -> impl Iterator<Item = &DefinedName> {
        self.names.iter().filter(|n| n.is_workbook_scope())
    }

    /// Get all names scoped to a specific sheet.
    pub fn sheet_scoped(&self, sheet_id: u32) -> impl Iterator<Item = &DefinedName> {
        self.names
            .iter()
            .filter(move |n| n.local_sheet_id == Some(sheet_id))
    }

    /// Get all hidden names.
    pub fn hidden(&self) -> impl Iterator<Item = &DefinedName> {
        self.names.iter().filter(|n| n.hidden)
    }

    /// Get all visible (non-hidden) names.
    pub fn visible(&self) -> impl Iterator<Item = &DefinedName> {
        self.names.iter().filter(|n| !n.hidden)
    }

    /// Get the print area for a specific sheet.
    ///
    /// # Arguments
    /// * `sheet_id` - The 0-indexed sheet ID
    ///
    /// # Returns
    /// The print area reference if defined for this sheet
    pub fn print_area(&self, sheet_id: u32) -> Option<&str> {
        self.names
            .iter()
            .find(|n| n.is_print_area() && n.local_sheet_id == Some(sheet_id))
            .map(|n| n.refers_to.as_str())
    }

    /// Get the print titles for a specific sheet.
    ///
    /// # Arguments
    /// * `sheet_id` - The 0-indexed sheet ID
    ///
    /// # Returns
    /// The print titles reference if defined for this sheet
    pub fn print_titles(&self, sheet_id: u32) -> Option<&str> {
        self.names
            .iter()
            .find(|n| n.is_print_titles() && n.local_sheet_id == Some(sheet_id))
            .map(|n| n.refers_to.as_str())
    }

    /// Get the AutoFilter database range for a specific sheet.
    ///
    /// # Arguments
    /// * `sheet_id` - The 0-indexed sheet ID
    ///
    /// # Returns
    /// The filter database reference if defined for this sheet
    pub fn filter_database(&self, sheet_id: u32) -> Option<&str> {
        self.names
            .iter()
            .find(|n| n.is_filter_database() && n.local_sheet_id == Some(sheet_id))
            .map(|n| n.refers_to.as_str())
    }

    /// Get all user-defined names (excluding built-in `_xlnm.` names).
    pub fn user_defined(&self) -> impl Iterator<Item = &DefinedName> {
        self.names.iter().filter(|n| n.built_in_type().is_none())
    }

    /// Get all built-in names (`_xlnm.` prefix).
    pub fn built_in(&self) -> impl Iterator<Item = &DefinedName> {
        self.names.iter().filter(|n| n.built_in_type().is_some())
    }

    /// Check if there are any potentially dangerous names (auto-macros, XLM).
    pub fn has_dangerous_names(&self) -> bool {
        self.names.iter().any(|n| n.is_potentially_dangerous())
    }

    /// Get all potentially dangerous names.
    pub fn dangerous_names(&self) -> impl Iterator<Item = &DefinedName> {
        self.names.iter().filter(|n| n.is_potentially_dangerous())
    }

    /// Iterate over all defined names.
    pub fn iter(&self) -> impl Iterator<Item = &DefinedName> {
        self.names.iter()
    }
}

impl IntoIterator for DefinedNames {
    type Item = DefinedName;
    type IntoIter = std::vec::IntoIter<DefinedName>;

    fn into_iter(self) -> Self::IntoIter {
        self.names.into_iter()
    }
}

impl<'a> IntoIterator for &'a DefinedNames {
    type Item = &'a DefinedName;
    type IntoIter = std::slice::Iter<'a, DefinedName>;

    fn into_iter(self) -> Self::IntoIter {
        self.names.iter()
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Parse an optional string attribute from XML bytes.
fn parse_optional_string_attr(xml: &[u8], attr: &[u8]) -> Option<String> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();
    let (start, end) = extract_quoted_value(xml, value_start)?;
    let value = decode_xml_entities(&xml[start..end]);
    if value.is_empty() { None } else { Some(value) }
}

/// Decode XML entities in a byte slice.
///
/// Handles: `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`
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
                if let Some((ch, len)) = parse_char_reference_names(&bytes[i..]) {
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
            // Copy byte as UTF-8
            if bytes[i] < 0x80 {
                result.push(bytes[i] as char);
                i += 1;
            } else {
                // Multi-byte UTF-8 character
                let remaining = &bytes[i..];
                if let Ok(s) = std::str::from_utf8(remaining) {
                    if let Some(c) = s.chars().next() {
                        result.push(c);
                        i += c.len_utf8();
                    } else {
                        i += 1;
                    }
                } else {
                    // Invalid UTF-8, use replacement character
                    result.push('\u{FFFD}');
                    i += 1;
                }
            }
        }
    }

    result
}

/// Parse a numeric character reference (&#NNN; or &#xHHH;)
fn parse_char_reference_names(bytes: &[u8]) -> Option<(char, usize)> {
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

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // BuiltInName tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_builtin_name_from_name() {
        assert_eq!(
            BuiltInName::from_name("_xlnm.Print_Area"),
            Some(BuiltInName::PrintArea)
        );
        assert_eq!(
            BuiltInName::from_name("_xlnm.Print_Titles"),
            Some(BuiltInName::PrintTitles)
        );
        assert_eq!(
            BuiltInName::from_name("_xlnm.Criteria"),
            Some(BuiltInName::Criteria)
        );
        assert_eq!(
            BuiltInName::from_name("_xlnm._FilterDatabase"),
            Some(BuiltInName::FilterDatabase)
        );
        assert_eq!(
            BuiltInName::from_name("_xlnm.Extract"),
            Some(BuiltInName::Extract)
        );
        assert_eq!(
            BuiltInName::from_name("_xlnm.Consolidate_Area"),
            Some(BuiltInName::ConsolidateArea)
        );
        assert_eq!(
            BuiltInName::from_name("_xlnm.Database"),
            Some(BuiltInName::Database)
        );
        assert_eq!(
            BuiltInName::from_name("_xlnm.Sheet_Title"),
            Some(BuiltInName::SheetTitle)
        );
        assert_eq!(
            BuiltInName::from_name("_xlnm.Auto_Open"),
            Some(BuiltInName::AutoOpen)
        );
        assert_eq!(
            BuiltInName::from_name("_xlnm.Auto_Close"),
            Some(BuiltInName::AutoClose)
        );
        assert_eq!(
            BuiltInName::from_name("_xlnm.SomethingNew"),
            Some(BuiltInName::Unknown)
        );
        assert_eq!(BuiltInName::from_name("MyCustomName"), None);
        assert_eq!(BuiltInName::from_name("_xlnm"), None); // No dot
    }

    #[test]
    fn test_builtin_name_is_auto_macro() {
        assert!(BuiltInName::AutoOpen.is_auto_macro());
        assert!(BuiltInName::AutoClose.is_auto_macro());
        assert!(!BuiltInName::PrintArea.is_auto_macro());
        assert!(!BuiltInName::FilterDatabase.is_auto_macro());
    }

    #[test]
    fn test_builtin_name_canonical_name() {
        assert_eq!(BuiltInName::PrintArea.canonical_name(), "_xlnm.Print_Area");
        assert_eq!(
            BuiltInName::FilterDatabase.canonical_name(),
            "_xlnm._FilterDatabase"
        );
    }

    // -------------------------------------------------------------------------
    // DefinedName parsing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_simple_defined_name() {
        let xml = br#"<definedName name="MyRange">Sheet1!$A$1:$B$10</definedName>"#;
        let name = DefinedName::parse(xml).unwrap();

        assert_eq!(name.name, "MyRange");
        assert_eq!(name.refers_to, "Sheet1!$A$1:$B$10");
        assert!(name.local_sheet_id.is_none());
        assert!(!name.hidden);
        assert!(!name.function);
    }

    #[test]
    fn test_parse_defined_name_with_local_sheet_id() {
        let xml = br#"<definedName name="_xlnm.Print_Area" localSheetId="0">Sheet1!$A$1:$H$50</definedName>"#;
        let name = DefinedName::parse(xml).unwrap();

        assert_eq!(name.name, "_xlnm.Print_Area");
        assert_eq!(name.refers_to, "Sheet1!$A$1:$H$50");
        assert_eq!(name.local_sheet_id, Some(0));
        assert!(name.is_print_area());
    }

    #[test]
    fn test_parse_hidden_defined_name() {
        let xml = br#"<definedName name="TaxRate" hidden="1">0.0825</definedName>"#;
        let name = DefinedName::parse(xml).unwrap();

        assert_eq!(name.name, "TaxRate");
        assert_eq!(name.refers_to, "0.0825");
        assert!(name.hidden);
    }

    #[test]
    fn test_parse_function_defined_name() {
        let xml = br#"<definedName name="MyFunc" function="1" xlm="1">Sheet1!$A$1</definedName>"#;
        let name = DefinedName::parse(xml).unwrap();

        assert_eq!(name.name, "MyFunc");
        assert!(name.function);
        assert!(name.xlm);
    }

    #[test]
    fn test_parse_defined_name_with_comment() {
        let xml = br#"<definedName name="SalesData" comment="Q1 sales figures">Sheet1!$A$1:$D$100</definedName>"#;
        let name = DefinedName::parse(xml).unwrap();

        assert_eq!(name.name, "SalesData");
        assert_eq!(name.comment.as_deref(), Some("Q1 sales figures"));
    }

    #[test]
    fn test_parse_defined_name_with_all_attributes() {
        let xml = br#"<definedName name="TestName" comment="Test comment" description="Description text" help="Help text" statusBar="Status text" localSheetId="2" hidden="1" function="1" vbProcedure="1" xlm="1" publishToServer="1" workbookParameter="1">Sheet1!$A$1</definedName>"#;
        let name = DefinedName::parse(xml).unwrap();

        assert_eq!(name.name, "TestName");
        assert_eq!(name.comment.as_deref(), Some("Test comment"));
        assert_eq!(name.description.as_deref(), Some("Description text"));
        assert_eq!(name.help.as_deref(), Some("Help text"));
        assert_eq!(name.status_bar.as_deref(), Some("Status text"));
        assert_eq!(name.local_sheet_id, Some(2));
        assert!(name.hidden);
        assert!(name.function);
        assert!(name.vb_procedure);
        assert!(name.xlm);
        assert!(name.publish_to_server);
        assert!(name.workbook_parameter);
    }

    #[test]
    fn test_parse_defined_name_with_xml_entities() {
        let xml = br#"<definedName name="Data &amp; Info">Sheet1!$A$1:$B$10</definedName>"#;
        let name = DefinedName::parse(xml).unwrap();

        assert_eq!(name.name, "Data & Info");
    }

    #[test]
    fn test_parse_defined_name_formula_with_entities() {
        let xml = br#"<definedName name="Comparison">IF(A1&gt;B1,&quot;Yes&quot;,&quot;No&quot;)</definedName>"#;
        let name = DefinedName::parse(xml).unwrap();

        assert_eq!(name.refers_to, "IF(A1>B1,\"Yes\",\"No\")");
    }

    #[test]
    fn test_parse_defined_name_empty_content() {
        let xml = br#"<definedName name="EmptyName"></definedName>"#;
        let name = DefinedName::parse(xml).unwrap();

        assert_eq!(name.name, "EmptyName");
        assert_eq!(name.refers_to, "");
    }

    #[test]
    fn test_defined_name_scope_methods() {
        let workbook_scoped = DefinedName::new("Global", "Sheet1!$A$1");
        assert!(workbook_scoped.is_workbook_scope());
        assert!(!workbook_scoped.is_sheet_scope());

        let mut sheet_scoped = DefinedName::new("Local", "Sheet1!$A$1");
        sheet_scoped.local_sheet_id = Some(0);
        assert!(!sheet_scoped.is_workbook_scope());
        assert!(sheet_scoped.is_sheet_scope());
    }

    #[test]
    fn test_defined_name_built_in_detection() {
        let print_area = DefinedName::new("_xlnm.Print_Area", "Sheet1!$A$1:$H$50");
        assert_eq!(print_area.built_in_type(), Some(BuiltInName::PrintArea));
        assert!(print_area.is_print_area());

        let user_name = DefinedName::new("MyRange", "Sheet1!$A$1");
        assert_eq!(user_name.built_in_type(), None);
        assert!(!user_name.is_print_area());
    }

    #[test]
    fn test_defined_name_dangerous_detection() {
        let auto_open = DefinedName::new("_xlnm.Auto_Open", "Sheet1!$A$1");
        assert!(auto_open.is_potentially_dangerous());

        let mut xlm_macro = DefinedName::new("MyMacro", "Sheet1!$A$1");
        xlm_macro.xlm = true;
        assert!(xlm_macro.is_potentially_dangerous());

        let normal_name = DefinedName::new("SalesData", "Sheet1!$A$1:$D$100");
        assert!(!normal_name.is_potentially_dangerous());
    }

    // -------------------------------------------------------------------------
    // DefinedNames collection parsing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_defined_names_section() {
        let xml = br#"<?xml version="1.0"?>
<workbook>
    <definedNames>
        <definedName name="SalesData">Sheet1!$A$1:$D$100</definedName>
        <definedName name="_xlnm.Print_Area" localSheetId="0">Sheet1!$A$1:$H$50</definedName>
        <definedName name="TaxRate" hidden="1">0.0825</definedName>
    </definedNames>
</workbook>"#;

        let names = DefinedNames::parse(xml);

        assert_eq!(names.len(), 3);
        assert!(!names.is_empty());

        // Check first name
        let sales = names.get("SalesData").unwrap();
        assert_eq!(sales.refers_to, "Sheet1!$A$1:$D$100");
        assert!(sales.is_workbook_scope());

        // Check print area
        let print_area = names.get("_xlnm.Print_Area").unwrap();
        assert!(print_area.is_print_area());
        assert_eq!(print_area.local_sheet_id, Some(0));

        // Check hidden name
        let tax_rate = names.get("TaxRate").unwrap();
        assert!(tax_rate.hidden);
    }

    #[test]
    fn test_parse_defined_names_empty() {
        let xml = br#"<workbook><definedNames></definedNames></workbook>"#;
        let names = DefinedNames::parse(xml);

        assert_eq!(names.len(), 0);
        assert!(names.is_empty());
    }

    #[test]
    fn test_parse_defined_names_missing_section() {
        let xml = br#"<workbook><sheets><sheet name="Sheet1"/></sheets></workbook>"#;
        let names = DefinedNames::parse(xml);

        assert_eq!(names.len(), 0);
    }

    #[test]
    fn test_defined_names_scope_filtering() {
        let xml = br#"<workbook>
    <definedNames>
        <definedName name="Global1">Sheet1!$A$1</definedName>
        <definedName name="Local1" localSheetId="0">Sheet1!$A$1</definedName>
        <definedName name="Local2" localSheetId="0">Sheet1!$B$1</definedName>
        <definedName name="Local3" localSheetId="1">Sheet2!$A$1</definedName>
        <definedName name="Global2">Sheet2!$A$1</definedName>
    </definedNames>
</workbook>"#;

        let names = DefinedNames::parse(xml);

        // Workbook scoped
        let workbook_names: Vec<_> = names.workbook_scoped().collect();
        assert_eq!(workbook_names.len(), 2);

        // Sheet 0 scoped
        let sheet0_names: Vec<_> = names.sheet_scoped(0).collect();
        assert_eq!(sheet0_names.len(), 2);

        // Sheet 1 scoped
        let sheet1_names: Vec<_> = names.sheet_scoped(1).collect();
        assert_eq!(sheet1_names.len(), 1);
    }

    #[test]
    fn test_defined_names_get_in_scope() {
        let xml = br#"<workbook>
    <definedNames>
        <definedName name="MyName">Global!$A$1</definedName>
        <definedName name="MyName" localSheetId="0">Sheet1!$A$1</definedName>
    </definedNames>
</workbook>"#;

        let names = DefinedNames::parse(xml);

        // With sheet scope, should get sheet-scoped name
        let in_sheet = names.get_in_scope("MyName", Some(0)).unwrap();
        assert_eq!(in_sheet.refers_to, "Sheet1!$A$1");

        // Without sheet scope or different sheet, should get workbook-scoped
        let global = names.get_in_scope("MyName", Some(1)).unwrap();
        assert_eq!(global.refers_to, "Global!$A$1");

        let global2 = names.get_in_scope("MyName", None).unwrap();
        assert_eq!(global2.refers_to, "Global!$A$1");
    }

    #[test]
    fn test_defined_names_hidden_filtering() {
        let xml = br#"<workbook>
    <definedNames>
        <definedName name="Visible1">Sheet1!$A$1</definedName>
        <definedName name="Hidden1" hidden="1">Sheet1!$B$1</definedName>
        <definedName name="Visible2">Sheet1!$C$1</definedName>
    </definedNames>
</workbook>"#;

        let names = DefinedNames::parse(xml);

        let hidden: Vec<_> = names.hidden().collect();
        assert_eq!(hidden.len(), 1);
        assert_eq!(hidden[0].name, "Hidden1");

        let visible: Vec<_> = names.visible().collect();
        assert_eq!(visible.len(), 2);
    }

    #[test]
    fn test_defined_names_print_area_lookup() {
        let xml = br#"<workbook>
    <definedNames>
        <definedName name="_xlnm.Print_Area" localSheetId="0">Sheet1!$A$1:$H$50</definedName>
        <definedName name="_xlnm.Print_Area" localSheetId="1">Sheet2!$A$1:$J$100</definedName>
    </definedNames>
</workbook>"#;

        let names = DefinedNames::parse(xml);

        assert_eq!(names.print_area(0), Some("Sheet1!$A$1:$H$50"));
        assert_eq!(names.print_area(1), Some("Sheet2!$A$1:$J$100"));
        assert_eq!(names.print_area(2), None);
    }

    #[test]
    fn test_defined_names_print_titles_lookup() {
        let xml = br#"<workbook>
    <definedNames>
        <definedName name="_xlnm.Print_Titles" localSheetId="0">Sheet1!$1:$2</definedName>
    </definedNames>
</workbook>"#;

        let names = DefinedNames::parse(xml);

        assert_eq!(names.print_titles(0), Some("Sheet1!$1:$2"));
        assert_eq!(names.print_titles(1), None);
    }

    #[test]
    fn test_defined_names_filter_database_lookup() {
        let xml = br#"<workbook>
    <definedNames>
        <definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Sheet1!$A$1:$D$100</definedName>
    </definedNames>
</workbook>"#;

        let names = DefinedNames::parse(xml);

        assert_eq!(names.filter_database(0), Some("Sheet1!$A$1:$D$100"));
    }

    #[test]
    fn test_defined_names_user_and_builtin_filtering() {
        let xml = br#"<workbook>
    <definedNames>
        <definedName name="UserRange">Sheet1!$A$1</definedName>
        <definedName name="_xlnm.Print_Area" localSheetId="0">Sheet1!$A$1:$H$50</definedName>
        <definedName name="AnotherUser">Sheet1!$B$1</definedName>
        <definedName name="_xlnm._FilterDatabase" localSheetId="0">Sheet1!$A$1:$D$100</definedName>
    </definedNames>
</workbook>"#;

        let names = DefinedNames::parse(xml);

        let user: Vec<_> = names.user_defined().collect();
        assert_eq!(user.len(), 2);

        let builtin: Vec<_> = names.built_in().collect();
        assert_eq!(builtin.len(), 2);
    }

    #[test]
    fn test_defined_names_dangerous_detection() {
        let xml = br#"<workbook>
    <definedNames>
        <definedName name="SafeName">Sheet1!$A$1</definedName>
        <definedName name="_xlnm.Auto_Open">Sheet1!Macro</definedName>
        <definedName name="XLMMacro" xlm="1">Sheet1!$A$1</definedName>
    </definedNames>
</workbook>"#;

        let names = DefinedNames::parse(xml);

        assert!(names.has_dangerous_names());

        let dangerous: Vec<_> = names.dangerous_names().collect();
        assert_eq!(dangerous.len(), 2);
    }

    #[test]
    fn test_defined_names_iteration() {
        let xml = br#"<workbook>
    <definedNames>
        <definedName name="Name1">Sheet1!$A$1</definedName>
        <definedName name="Name2">Sheet1!$B$1</definedName>
    </definedNames>
</workbook>"#;

        let names = DefinedNames::parse(xml);

        // Test iter()
        let collected: Vec<_> = names.iter().collect();
        assert_eq!(collected.len(), 2);

        // Test IntoIterator for &DefinedNames
        let mut count = 0;
        for _ in &names {
            count += 1;
        }
        assert_eq!(count, 2);

        // Test IntoIterator for DefinedNames (consumes)
        let mut owned_count = 0;
        for _ in names {
            owned_count += 1;
        }
        assert_eq!(owned_count, 2);
    }

    // -------------------------------------------------------------------------
    // Helper function tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_decode_xml_entities() {
        assert_eq!(decode_xml_entities(b"hello"), "hello");
        assert_eq!(decode_xml_entities(b"&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_xml_entities(b"&amp;"), "&");
        assert_eq!(decode_xml_entities(b"&quot;text&quot;"), "\"text\"");
        assert_eq!(decode_xml_entities(b"&apos;"), "'");
        assert_eq!(
            decode_xml_entities(b"A &lt; B &amp;&amp; C &gt; D"),
            "A < B && C > D"
        );
        assert_eq!(decode_xml_entities(b""), "");
    }

    #[test]
    fn test_parse_u32_attr() {
        let xml = b"<element id=\"123\" other=\"456\"/>";
        assert_eq!(parse_u32_attr(xml, b"id=\""), Some(123));
        assert_eq!(parse_u32_attr(xml, b"other=\""), Some(456));
        assert_eq!(parse_u32_attr(xml, b"missing=\""), None);
    }

    #[test]
    fn test_parse_bool_attr() {
        let xml = b"<element a=\"1\" b=\"0\" c=\"true\" d=\"false\"/>";
        assert!(parse_bool_attr(xml, b"a=\""));
        assert!(!parse_bool_attr(xml, b"b=\""));
        assert!(parse_bool_attr(xml, b"c=\""));
        assert!(!parse_bool_attr(xml, b"d=\""));
        assert!(!parse_bool_attr(xml, b"missing=\""));
    }

    // -------------------------------------------------------------------------
    // Integration / realistic tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_realistic_workbook_with_defined_names() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="27231"/>
    <workbookPr defaultThemeVersion="166925"/>
    <sheets>
        <sheet name="Sales" sheetId="1" r:id="rId1"/>
        <sheet name="Summary" sheetId="2" r:id="rId2"/>
    </sheets>
    <definedNames>
        <definedName name="SalesData" comment="Q1-Q4 sales data">Sales!$A$1:$E$100</definedName>
        <definedName name="SummaryRange">Summary!$A$1:$C$20</definedName>
        <definedName name="_xlnm.Print_Area" localSheetId="0">Sales!$A$1:$E$50</definedName>
        <definedName name="_xlnm.Print_Area" localSheetId="1">Summary!$A$1:$C$20</definedName>
        <definedName name="_xlnm.Print_Titles" localSheetId="0">Sales!$1:$1</definedName>
        <definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Sales!$A$1:$E$100</definedName>
        <definedName name="TaxRate" hidden="1">0.0825</definedName>
        <definedName name="Categories">{"Electronics","Furniture","Clothing","Food"}</definedName>
    </definedNames>
    <calcPr calcId="191029"/>
</workbook>"#;

        let names = DefinedNames::parse(xml);

        assert_eq!(names.len(), 8);

        // User-defined names
        assert_eq!(names.user_defined().count(), 4);

        // Built-in names
        assert_eq!(names.built_in().count(), 4);

        // Hidden names
        assert_eq!(names.hidden().count(), 2);

        // Print areas
        assert_eq!(names.print_area(0), Some("Sales!$A$1:$E$50"));
        assert_eq!(names.print_area(1), Some("Summary!$A$1:$C$20"));

        // Print titles
        assert_eq!(names.print_titles(0), Some("Sales!$1:$1"));
        assert_eq!(names.print_titles(1), None);

        // Filter database
        assert_eq!(names.filter_database(0), Some("Sales!$A$1:$E$100"));

        // Specific name lookup
        let sales_data = names.get("SalesData").unwrap();
        assert_eq!(sales_data.comment.as_deref(), Some("Q1-Q4 sales data"));

        // Array constant
        let categories = names.get("Categories").unwrap();
        assert!(categories.refers_to.starts_with("{"));

        // No dangerous names in this file
        assert!(!names.has_dangerous_names());
    }

    #[test]
    fn test_workbook_with_dangerous_names() {
        let xml = br#"<workbook>
    <definedNames>
        <definedName name="_xlnm.Auto_Open">Sheet1!RunMacro</definedName>
        <definedName name="LegacyMacro" xlm="1" function="1">EXEC("notepad.exe")</definedName>
    </definedNames>
</workbook>"#;

        let names = DefinedNames::parse(xml);

        assert!(names.has_dangerous_names());

        let dangerous: Vec<_> = names.dangerous_names().collect();
        assert_eq!(dangerous.len(), 2);

        // First is auto-open
        assert_eq!(dangerous[0].built_in_type(), Some(BuiltInName::AutoOpen));

        // Second is XLM macro
        assert!(dangerous[1].xlm);
    }

    #[test]
    fn test_unicode_in_defined_names() {
        let xml = "<workbook>
    <definedNames>
        <definedName name=\"\u{65E5}\u{672C}\u{8A9E}\">\u{30B7}\u{30FC}\u{30C8}1!$A$1</definedName>
    </definedNames>
</workbook>"
            .as_bytes();

        let names = DefinedNames::parse(xml);

        assert_eq!(names.len(), 1);
        let name = names.all().first().unwrap();
        assert_eq!(name.name, "\u{65E5}\u{672C}\u{8A9E}"); // Japanese
    }

    #[test]
    fn test_defined_name_with_formula() {
        let xml = br#"<workbook>
    <definedNames>
        <definedName name="TotalSales">SUM(Sales!$B$2:$B$100)</definedName>
        <definedName name="Average">AVERAGE(Data!$A:$A)</definedName>
        <definedName name="Complex">IF(AND(A1&gt;0,B1&lt;100),C1*2,0)</definedName>
    </definedNames>
</workbook>"#;

        let names = DefinedNames::parse(xml);

        let total = names.get("TotalSales").unwrap();
        assert_eq!(total.refers_to, "SUM(Sales!$B$2:$B$100)");

        let complex = names.get("Complex").unwrap();
        assert_eq!(complex.refers_to, "IF(AND(A1>0,B1<100),C1*2,0)");
    }
}
