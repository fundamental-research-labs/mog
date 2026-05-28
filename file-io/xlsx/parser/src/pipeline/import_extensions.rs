//! Extension metadata container for XLSX import.
//!
//! This module defines `ImportExtensionParts`, the top-level container that holds
//! explicit extension data captured during parsing. It aggregates:
//!
//! - **Namespace declarations** (`NamespaceMap`) from workbook and sheet root elements
//! - **Binary passthrough** (`ImportedPackageParts`) — opaque binary ZIP entries
//!
//! This container is stored on `FullParseResult` as `extensions: Option<ImportExtensionParts>`
//! with `#[serde(skip)]` — it is parser import metadata, not sent to TypeScript.
//!
//! # Architecture
//!
//! During parsing, the pipeline captures namespace declarations from root
//! elements of workbook.xml and each worksheet. Binary ZIP entries
//! used by explicit modeled owners are recorded in `ImportedPackageParts`.

use crate::infra::imported_parts::ImportedPackageParts;
use crate::infra::xml_namespaces::NamespaceMap;

/// Top-level container for all Tier 2 extension preservation data.
///
/// This is stored on `FullParseResult` and carries captured namespace declarations
/// and binary passthrough entries through import conversion.
///
/// # Indexing
///
/// `sheet_namespaces` is indexed by sheet order (0-based), matching
/// `FullParseResult.sheets`. This is safe because the parallel parse results
/// are re-sorted by `sheets.sort_by_key(|s| s.index)`.
#[derive(Debug, Clone, Default)]
pub struct ImportExtensionParts {
    /// Namespace declarations from the `<workbook>` root element.
    pub workbook_namespaces: NamespaceMap,
    /// Namespace declarations from the `<styleSheet>` root element.
    pub styles_namespaces: NamespaceMap,
    /// Per-sheet namespace declarations from `<worksheet>` root elements.
    /// Indexed by sheet order (0-based), aligned with `FullParseResult.sheets`.
    pub sheet_namespaces: Vec<NamespaceMap>,
    /// Opaque binary ZIP entries used by explicit import conversion paths.
    pub imported_parts: ImportedPackageParts,
}

impl ImportExtensionParts {
    /// Create a new empty container.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a container pre-sized for the given number of sheets.
    pub fn with_sheet_count(sheet_count: usize) -> Self {
        Self {
            sheet_namespaces: Vec::with_capacity(sheet_count),
            ..Self::default()
        }
    }

    /// Check if there is any preserved data at all.
    pub fn is_empty(&self) -> bool {
        self.workbook_namespaces.is_empty()
            && self.styles_namespaces.is_empty()
            && self.sheet_namespaces.iter().all(|ns| ns.is_empty())
            && self.imported_parts.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_is_empty() {
        let ext = ImportExtensionParts::new();
        assert!(ext.is_empty());
    }

    #[test]
    fn test_with_sheet_count() {
        let ext = ImportExtensionParts::with_sheet_count(5);
        assert!(ext.is_empty());
        assert_eq!(ext.sheet_namespaces.capacity(), 5);
    }

    #[test]
    fn test_not_empty_with_workbook_namespaces() {
        let mut ext = ImportExtensionParts::new();
        ext.workbook_namespaces
            .add_prefixed("xr", "http://example.com");
        assert!(!ext.is_empty());
    }
}
