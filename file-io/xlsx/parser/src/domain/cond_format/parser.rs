//! Main parsing functions for conditional formatting.
//!
//! This module contains the top-level parsing functions that extract
//! conditional formatting from worksheet XML.

use crate::infra::scanner::{XmlScanner, find_closing_tag, find_gt_simd, find_tag_simd};

use super::rules::{
    parse_conditional_formatting_element, parse_conditional_formatting_x14_element,
};
use super::types::{ConditionalFormatting, ConditionalFormattingX14};

// =============================================================================
// Main Parsing Functions
// =============================================================================

/// Parse all conditional formatting from worksheet XML
///
/// # Arguments
/// * `xml` - Raw XML bytes of the worksheet
///
/// # Returns
/// Vector of parsed ConditionalFormatting objects
pub fn parse_conditional_formatting(xml: &[u8]) -> Vec<ConditionalFormatting> {
    let mut results = Vec::new();
    let mut pos = 0;

    while let Some(cf_start) = find_tag_simd(xml, b"conditionalFormatting", pos) {
        // Check if this is a closing tag
        if cf_start > 0 && xml.get(cf_start.saturating_sub(1)) == Some(&b'/') {
            pos = cf_start + 22;
            continue;
        }

        let cf_end = find_closing_tag(xml, b"conditionalFormatting", cf_start)
            .map(|end| find_gt_simd(xml, end).unwrap_or(xml.len()) + 1)
            .unwrap_or_else(|| {
                // Self-closing element
                find_gt_simd(xml, cf_start)
                    .map(|p| p + 1)
                    .unwrap_or(xml.len())
            });

        let cf_xml = &xml[cf_start..cf_end];
        results.push(parse_conditional_formatting_element(cf_xml));
        pos = cf_end;
    }

    results
}

/// Parse x14 conditional formatting extensions from worksheet XML
///
/// # Arguments
/// * `xml` - Raw XML bytes of the worksheet (extLst section)
///
/// # Returns
/// Vector of parsed ConditionalFormattingX14 objects
pub fn parse_conditional_formatting_x14(xml: &[u8]) -> Vec<ConditionalFormattingX14> {
    let mut results = Vec::new();
    let mut pos = 0;

    // Look for x14:conditionalFormatting or conditionalFormatting in x14 namespace
    while let Some(cf_start) = find_tag_simd(xml, b"conditionalFormatting", pos) {
        // Skip closing tags
        if cf_start > 0 && xml.get(cf_start.saturating_sub(1)) == Some(&b'/') {
            pos = cf_start + 22;
            continue;
        }
        let name_start = cf_start + 1;
        let mut name_end = name_start;
        while name_end < xml.len() {
            let b = xml[name_end];
            if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
                break;
            }
            name_end += 1;
        }
        let tag_name = &xml[name_start..name_end];
        // Skip base worksheet CF and the plural x14:conditionalFormattings
        // container. Only prefixed singular x14:conditionalFormatting entries
        // are semantic x14 CF blocks on this path.
        if !tag_name.ends_with(b":conditionalFormatting") {
            pos = cf_start + 1;
            continue;
        }

        let cf_end = find_closing_tag(xml, b"conditionalFormatting", cf_start)
            .map(|end| find_gt_simd(xml, end).unwrap_or(xml.len()) + 1)
            .unwrap_or_else(|| {
                find_gt_simd(xml, cf_start)
                    .map(|p| p + 1)
                    .unwrap_or(xml.len())
            });

        let cf_xml = &xml[cf_start..cf_end];
        results.push(parse_conditional_formatting_x14_element(cf_xml));
        pos = cf_end;
    }

    results
}

/// Parse conditional formatting with XmlScanner for better integration
///
/// # Arguments
/// * `scanner` - XmlScanner positioned at the start of the worksheet
///
/// # Returns
/// Vector of parsed ConditionalFormatting objects
pub fn parse_conditional_formatting_with_scanner(
    scanner: &mut XmlScanner,
) -> Vec<ConditionalFormatting> {
    parse_conditional_formatting(scanner.bytes())
}
