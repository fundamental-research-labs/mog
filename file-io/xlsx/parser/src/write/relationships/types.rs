/// Represents a single relationship entry in a .rels file
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relationship {
    /// Relationship ID (rId1, rId2, etc.)
    pub id: String,
    /// Relationship type URI (one of the REL_* constants)
    pub rel_type: String,
    /// Target path or URL
    pub target: String,
    /// Target mode - "External" for external resources like hyperlinks, None for internal
    pub target_mode: Option<String>,
}

impl Relationship {
    /// Create a new internal relationship
    pub fn new(
        id: impl Into<String>,
        rel_type: impl Into<String>,
        target: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            rel_type: rel_type.into(),
            target: target.into(),
            target_mode: None,
        }
    }

    /// Create a new external relationship (e.g., for hyperlinks)
    pub fn external(
        id: impl Into<String>,
        rel_type: impl Into<String>,
        target: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            rel_type: rel_type.into(),
            target: target.into(),
            target_mode: Some("External".to_string()),
        }
    }

    /// Check if this is an external relationship
    pub fn is_external(&self) -> bool {
        self.target_mode.as_deref() == Some("External")
    }
}
