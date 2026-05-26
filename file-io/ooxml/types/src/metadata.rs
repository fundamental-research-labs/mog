//! Metadata types (ECMA-376 Part 1, Section 18.9).
//!
//! Types modelling future metadata blocks used for rich data types,
//! dynamic arrays, and other extensible cell metadata.

// ============================================================================
// FutureMetadataBlock — CT_FutureMetadataBlock
// ============================================================================

/// A single future metadata block (CT_FutureMetadataBlock).
///
/// Contains extension-based metadata for a cell or range. The actual content
/// is carried via the extension list.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct FutureMetadataBlock {
    /// Extension list carrying the block content.
    pub ext_lst: Option<crate::ExtensionList>,
}

// ============================================================================
// FutureMetadata — CT_FutureMetadata
// ============================================================================

/// Future metadata collection (CT_FutureMetadata).
///
/// Groups metadata blocks under a named metadata type (e.g. "XLDAPR" for
/// dynamic arrays, "XLRICHVALUE" for rich value types).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct FutureMetadata {
    /// Metadata type name (required).
    pub name: String,
    /// Number of metadata blocks (informational).
    pub count: Option<u32>,
    /// Metadata blocks.
    pub blocks: Vec<FutureMetadataBlock>,
    /// Extension list for vendor-specific data.
    pub ext_lst: Option<crate::ExtensionList>,
}

impl FutureMetadata {
    /// Returns the effective count, using the XSD default of `0` when absent.
    #[must_use]
    pub fn effective_count(&self) -> u32 {
        self.count.unwrap_or(0)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn future_metadata_block_default() {
        let b = FutureMetadataBlock::default();
        assert!(b.ext_lst.is_none());
    }

    #[test]
    fn future_metadata_defaults() {
        let m = FutureMetadata::default();
        assert!(m.name.is_empty());
        assert!(m.count.is_none());
        assert_eq!(m.effective_count(), 0);
        assert!(m.blocks.is_empty());
        assert!(m.ext_lst.is_none());
    }
}
