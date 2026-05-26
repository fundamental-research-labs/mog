//! Extension preservation container for XLSX round-trip fidelity.
//!
//! This module defines `ExtensionPreservation`, the top-level container that holds
//! all Tier 2 (uninterpreted) extension data captured during parsing. It aggregates:
//!
//! - **Namespace declarations** (`NamespaceMap`) from workbook, sheet, and styles root elements
//! - **Preserved elements** (`PreservedElements`) — unknown XML children captured for re-emission
//! - **Binary passthrough** (`BinaryPassthrough`) — opaque binary ZIP entries
//!
//! This container is stored on `FullParseResult` as `extensions: Option<ExtensionPreservation>`
//! with `#[serde(skip)]` — it is internal roundtrip data, not sent to TypeScript.
//!
//! # Architecture
//!
//! During parsing:
//! - The pipeline captures namespace declarations from root elements of workbook.xml,
//!   each worksheet, and styles.xml
//! - Unknown child elements are captured into `PreservedElements` with position hints
//! - Binary ZIP entries (OLE objects, etc.) are recorded in `BinaryPassthrough`
//!
//! During writing:
//! - Writers receive the relevant `NamespaceMap` + `PreservedElements` for their part
//! - Tier 1 namespace declarations (x14ac, xr from domain fields) are merged with
//!   Tier 2 captured namespaces
//! - `mc:Ignorable` is built from the union of all extension prefixes

use super::binary_passthrough::BinaryPassthrough;
use super::namespaces::NamespaceMap;
use super::unknown_elements::PreservedElements;

/// Top-level container for all Tier 2 extension preservation data.
///
/// This is stored on `FullParseResult` and carries captured namespace declarations,
/// unknown XML elements, and binary passthrough entries through the parse-write pipeline.
///
/// # Indexing
///
/// `sheet_namespaces` and `sheet_preserved` are indexed by sheet order (0-based),
/// matching `FullParseResult.sheets`. This is safe because the parallel parse
/// results are re-sorted by `sheets.sort_by_key(|s| s.index)`.
#[derive(Debug, Clone, Default)]
pub struct ExtensionPreservation {
    /// Namespace declarations from the `<workbook>` root element.
    pub workbook_namespaces: NamespaceMap,
    /// Preserved unknown child elements from workbook.xml.
    pub workbook_preserved: PreservedElements,
    /// Per-sheet namespace declarations from `<worksheet>` root elements.
    /// Indexed by sheet order (0-based), aligned with `FullParseResult.sheets`.
    pub sheet_namespaces: Vec<NamespaceMap>,
    /// Per-sheet preserved unknown child elements.
    /// Indexed by sheet order (0-based), aligned with `FullParseResult.sheets`.
    pub sheet_preserved: Vec<PreservedElements>,
    /// Namespace declarations from the `<styleSheet>` root element.
    pub styles_namespaces: NamespaceMap,
    /// Opaque binary ZIP entries preserved for round-trip (OLE objects, etc.).
    pub binary_passthrough: BinaryPassthrough,
}

impl ExtensionPreservation {
    /// Create a new empty container.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a container pre-sized for the given number of sheets.
    pub fn with_sheet_count(sheet_count: usize) -> Self {
        Self {
            sheet_namespaces: Vec::with_capacity(sheet_count),
            sheet_preserved: Vec::with_capacity(sheet_count),
            ..Self::default()
        }
    }

    /// Check if there is any preserved data at all.
    pub fn is_empty(&self) -> bool {
        self.workbook_namespaces.is_empty()
            && self.workbook_preserved.is_empty()
            && self.sheet_namespaces.iter().all(|ns| ns.is_empty())
            && self.sheet_preserved.iter().all(|pe| pe.is_empty())
            && self.styles_namespaces.is_empty()
            && self.binary_passthrough.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_is_empty() {
        let ext = ExtensionPreservation::new();
        assert!(ext.is_empty());
    }

    #[test]
    fn test_with_sheet_count() {
        let ext = ExtensionPreservation::with_sheet_count(5);
        assert!(ext.is_empty());
        assert_eq!(ext.sheet_namespaces.capacity(), 5);
        assert_eq!(ext.sheet_preserved.capacity(), 5);
    }

    #[test]
    fn test_not_empty_with_workbook_namespaces() {
        let mut ext = ExtensionPreservation::new();
        ext.workbook_namespaces
            .add_prefixed("xr", "http://example.com");
        assert!(!ext.is_empty());
    }
}
