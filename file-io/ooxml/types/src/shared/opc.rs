// ============================================================================
// OpcRelationship — OPC Relationship entry
// ============================================================================

/// A single OPC (Open Packaging Conventions) relationship entry from a `.rels` file.
///
/// OOXML packages use `.rels` files to define relationships between parts.
/// Each relationship maps an ID (e.g., `rId1`) to a target path and type URI.
/// Preserving the original relationships during round-trip avoids renumbering
/// IDs and reordering entries, which can break external references.
///
/// Reference: ECMA-376 Part 2, §9 (Relationships).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct OpcRelationship {
    /// Relationship ID (e.g., "rId1", "rId3").
    pub id: String,
    /// Relationship type URI (e.g., "http://schemas.openxmlformats.org/.../worksheet").
    pub rel_type: String,
    /// Target path or URL (e.g., "worksheets/sheet1.xml", "https://example.com").
    pub target: String,
    /// Target mode — `Some("External")` for external resources (hyperlinks, etc.),
    /// `None` for internal package parts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_mode: Option<String>,
}
