// =============================================================================
// PageOrientation -- page setup orientation
// =============================================================================

/// Page orientation for chart print settings (ST_PageSetupOrientation).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum PageOrientation {
    /// Default orientation (let application decide)
    #[default]
    Default,
    /// Portrait orientation
    Portrait,
    /// Landscape orientation
    Landscape,
}

impl PageOrientation {
    /// Parse from OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "default" => Self::Default,
            "portrait" => Self::Portrait,
            "landscape" => Self::Landscape,
            _ => Self::Default,
        }
    }

    /// Serialize to OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Portrait => "portrait",
            Self::Landscape => "landscape",
        }
    }
}
