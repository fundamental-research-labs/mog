//! Web extension (Office Add-in) detection and metadata extraction.
//!
//! Office Add-ins are stored in `xl/webextensions/` as XML parts.
//! This module parses basic metadata so the API can report which add-ins exist.

use serde::Serialize;

use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_tag_simd};
use crate::zip::XlsxArchive;

/// Content type for web extension taskpanes
pub const CT_WEB_EXTENSION_TASKPANES: &str = "application/vnd.ms-office.webextensiontaskpanes+xml";

/// Content type for individual web extensions
pub const CT_WEB_EXTENSION: &str = "application/vnd.ms-office.webextension+xml";

/// Relationship type for web extension taskpanes (root-level)
pub const REL_WEB_EXTENSION_TASKPANES: &str =
    "http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes";

/// Relationship type for individual web extensions
pub const REL_WEB_EXTENSION: &str =
    "http://schemas.microsoft.com/office/2011/relationships/webextension";

/// Parsed web extension metadata for a workbook.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebExtensions {
    /// Individual add-ins found in the workbook
    pub extensions: Vec<WebExtensionInfo>,
}

/// Metadata about a single web extension (Office Add-in).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebExtensionInfo {
    /// Add-in ID from the Office Store or catalog
    pub id: String,
    /// Add-in version
    pub version: String,
    /// Store type (e.g., "OMEX" for Office Marketplace, "Registry", "FileSystem")
    pub store: String,
    /// Store type identifier
    pub store_type: String,
}

/// Stored web extension parts for round-trip fidelity.
/// All files under `xl/webextensions/` are preserved as raw bytes.
#[derive(Debug, Clone, Default)]
pub struct WebExtensionParts {
    /// ZIP path -> raw bytes for all webextension-related files
    pub parts: Vec<(String, Vec<u8>)>,
}

/// Detect and parse web extensions from an XLSX archive.
///
/// Returns parsed metadata (for API) and raw parts (for round-trip).
pub fn parse_web_extensions(archive: &XlsxArchive) -> Option<(WebExtensions, WebExtensionParts)> {
    // Find all webextension-related entries
    let mut raw_parts = Vec::new();
    let mut has_webextensions = false;

    for entry in archive.entries() {
        let name = &entry.name;
        if name.starts_with("xl/webextensions/") || name.starts_with("xl/webextensions\\") {
            has_webextensions = true;
            if let Ok(data) = archive.read_file(name) {
                raw_parts.push((name.to_string(), data));
            }
        }
    }

    if !has_webextensions {
        return None;
    }

    // Parse metadata from webextension*.xml files
    let mut extensions = Vec::new();
    for (path, data) in raw_parts.iter() {
        let path: &String = path;
        if path.contains("webextension")
            && path.ends_with(".xml")
            && !path.contains("_rels")
            && !path.contains("taskpanes")
        {
            if let Ok(xml_str) = std::str::from_utf8(data) {
                if let Some(info) = parse_webextension_xml(xml_str) {
                    extensions.push(info);
                }
            }
        }
    }

    Some((
        WebExtensions { extensions },
        WebExtensionParts { parts: raw_parts },
    ))
}

/// Parse a single webextension*.xml to extract add-in identity.
fn parse_webextension_xml(xml: &str) -> Option<WebExtensionInfo> {
    // Look for <we:reference id="..." version="..." store="..." storeType="..."/>
    // The we: prefix may vary, so search for the tag by local name
    let xml_bytes = xml.as_bytes();

    // Find the reference element (could be <we:reference or just <reference)
    let pos = find_tag_simd(xml_bytes, b"reference", 0)?;

    let id = find_attr_simd(xml_bytes, b"id", pos)
        .and_then(|p| extract_quoted_value(xml_bytes, p))
        .map(|(s, e)| String::from_utf8_lossy(&xml_bytes[s..e]).into_owned())
        .unwrap_or_default();
    let version = find_attr_simd(xml_bytes, b"version", pos)
        .and_then(|p| extract_quoted_value(xml_bytes, p))
        .map(|(s, e)| String::from_utf8_lossy(&xml_bytes[s..e]).into_owned())
        .unwrap_or_default();
    let store = find_attr_simd(xml_bytes, b"store", pos)
        .and_then(|p| extract_quoted_value(xml_bytes, p))
        .map(|(s, e)| String::from_utf8_lossy(&xml_bytes[s..e]).into_owned())
        .unwrap_or_default();
    let store_type = find_attr_simd(xml_bytes, b"storeType", pos)
        .and_then(|p| extract_quoted_value(xml_bytes, p))
        .map(|(s, e)| String::from_utf8_lossy(&xml_bytes[s..e]).into_owned())
        .unwrap_or_default();

    Some(WebExtensionInfo {
        id,
        version,
        store,
        store_type,
    })
}
