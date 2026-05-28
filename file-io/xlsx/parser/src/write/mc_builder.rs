//! `mc:Ignorable` builder for deterministic namespace declarations.
//!
//! This module provides a shared utility for constructing the `mc:Ignorable`
//! attribute value across all XLSX writers. Instead of hardcoding ignorable
//! strings per writer, each writer collects extension prefixes it actually
//! emits (from Tier 1 domain fields + Tier 2 preserved elements) and uses
//! this builder to generate the correct `mc:Ignorable` attribute.
//!
//! # Architecture
//!
//! - Tier 1 writers add prefixes for domain fields they emit (e.g., `x14ac` for dyDescent)
//! - Tier 2 preservation merges captured namespace prefixes from the original file
//! - The builder uses a `Vec` that preserves insertion order while deduplicating
//! - `xmlns:mc` and `mc:Ignorable` are only emitted when at least one prefix is present
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::write::mc_builder::McIgnorableBuilder;
//!
//! let mut builder = McIgnorableBuilder::new();
//! builder.add("x14ac");
//! builder.add("xr");
//! assert_eq!(builder.build(), Some("x14ac xr".to_string()));
//! ```

use crate::infra::xml_namespaces::NamespaceMap;

/// Well-known namespace URIs for extension prefixes commonly found in mc:Ignorable.
/// These are the prefixes that are NOT part of the base SpreadsheetML or relationships
/// namespaces, and thus need mc:Ignorable declarations.
const MC_IGNORABLE_PREFIXES: &[&str] = &[
    "x14ac", "xr", "xr2", "xr3", "xr6", "xr9", "xr10", "x15", "x15ac", "x16r2",
];

/// Collects extension prefixes and builds `mc:Ignorable` + `xmlns:mc` declarations.
///
/// Uses a `Vec<String>` that preserves insertion order while deduplicating —
/// this ensures round-trip fidelity by maintaining the original document order.
#[derive(Debug, Clone, Default)]
pub struct McIgnorableBuilder {
    prefixes: Vec<String>,
}

impl McIgnorableBuilder {
    /// Create a new empty builder.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add an extension prefix (e.g., `"x14ac"`, `"xr"`).
    ///
    /// Duplicates are ignored. Insertion order is preserved for round-trip fidelity.
    pub fn add(&mut self, prefix: &str) {
        // Don't add core namespaces that shouldn't be in mc:Ignorable
        if is_ignorable_prefix_token(prefix) {
            let s = prefix.to_string();
            if !self.prefixes.contains(&s) {
                self.prefixes.push(s);
            }
        }
    }

    /// Add preserved `mc:Ignorable` tokens from the imported root.
    ///
    /// Preserved tokens are not filtered through the generated-prefix whitelist;
    /// they only need to remain structurally valid and, when a namespace map is
    /// available, still declared on the root being emitted.
    pub fn add_preserved_ignorable(&mut self, ignorable: &str, ns: Option<&NamespaceMap>) {
        for prefix in ignorable.split_whitespace() {
            if is_ignorable_prefix_token(prefix)
                && ns.map_or(true, |namespaces| namespaces.has_prefix(prefix))
            {
                self.add(prefix);
            }
        }
    }

    /// Add all extension prefixes from a `NamespaceMap`.
    ///
    /// Preserved `mc:Ignorable` tokens are authoritative. The well-known
    /// prefix whitelist is used only for legacy namespace-only callers that did
    /// not carry the source MCE attribute.
    pub fn add_from_namespace_map(&mut self, ns: &NamespaceMap) {
        if let Some(ref ignorable) = ns.mce_attributes().ignorable {
            self.add_preserved_ignorable(ignorable, Some(ns));
            return;
        }

        for decl in ns.all() {
            if let Some(ref prefix) = decl.prefix {
                // Add if it's a known mc:Ignorable prefix
                if MC_IGNORABLE_PREFIXES.contains(&prefix.as_str()) {
                    self.add(prefix);
                }
            }
        }
    }

    /// Check if no prefixes have been added.
    pub fn is_empty(&self) -> bool {
        self.prefixes.is_empty()
    }

    /// Get the number of prefixes.
    pub fn len(&self) -> usize {
        self.prefixes.len()
    }

    /// Build the `mc:Ignorable` attribute value.
    ///
    /// Returns `None` if no prefixes have been added, meaning no `mc:Ignorable`
    /// attribute should be emitted.
    ///
    /// Returns space-separated prefixes in insertion order (e.g., `"x14ac xr xr6"`).
    pub fn build(&self) -> Option<String> {
        if self.prefixes.is_empty() {
            return None;
        }
        let parts: Vec<&str> = self.prefixes.iter().map(|s| s.as_str()).collect();
        Some(parts.join(" "))
    }

    /// Get all prefixes in insertion order (for iteration).
    pub fn prefixes(&self) -> Vec<&str> {
        self.prefixes.iter().map(|s| s.as_str()).collect()
    }
}

fn is_ignorable_prefix_token(prefix: &str) -> bool {
    if matches!(prefix, "r" | "mc" | "" | "xmlns") {
        return false;
    }

    let mut chars = prefix.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch == '-' || ch == '.' || ch.is_ascii_alphanumeric())
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_builder() {
        let builder = McIgnorableBuilder::new();
        assert!(builder.is_empty());
        assert_eq!(builder.build(), None);
    }

    #[test]
    fn test_single_prefix() {
        let mut builder = McIgnorableBuilder::new();
        builder.add("x14ac");
        assert_eq!(builder.build(), Some("x14ac".to_string()));
    }

    #[test]
    fn test_multiple_prefixes_insertion_order() {
        let mut builder = McIgnorableBuilder::new();
        builder.add("xr");
        builder.add("x14ac");
        builder.add("xr6");
        // Preserves insertion order for round-trip fidelity
        assert_eq!(builder.build(), Some("xr x14ac xr6".to_string()));
    }

    #[test]
    fn test_deduplication() {
        let mut builder = McIgnorableBuilder::new();
        builder.add("x14ac");
        builder.add("x14ac");
        builder.add("xr");
        builder.add("xr");
        assert_eq!(builder.len(), 2);
        assert_eq!(builder.build(), Some("x14ac xr".to_string()));
    }

    #[test]
    fn test_ignores_core_namespaces() {
        let mut builder = McIgnorableBuilder::new();
        builder.add("r");
        builder.add("mc");
        builder.add("");
        builder.add("xmlns");
        assert!(builder.is_empty());
        assert_eq!(builder.build(), None);
    }

    #[test]
    fn test_add_from_namespace_map() {
        let mut ns = NamespaceMap::new();
        ns.add_prefixed(
            "x14ac",
            "http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac",
        );
        ns.add_prefixed(
            "xr",
            "http://schemas.microsoft.com/office/spreadsheetml/2014/revision",
        );
        ns.add_prefixed(
            "r",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        );

        let mut builder = McIgnorableBuilder::new();
        builder.add_from_namespace_map(&ns);

        // Only x14ac and xr should be added (r is not an mc:Ignorable prefix)
        assert_eq!(builder.build(), Some("x14ac xr".to_string()));
    }

    #[test]
    fn test_prefixes_list() {
        let mut builder = McIgnorableBuilder::new();
        builder.add("xr");
        builder.add("x14ac");
        assert_eq!(builder.prefixes(), vec!["xr", "x14ac"]);
    }
}
