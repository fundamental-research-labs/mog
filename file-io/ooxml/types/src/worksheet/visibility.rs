//! SheetVisibility (ST_SheetState).

/// Visibility state of a worksheet (ECMA-376 ST_SheetState).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum SheetVisibility {
    /// Sheet is visible (default state).
    #[default]
    Visible,
    /// Sheet is hidden but can be unhidden via the UI.
    Hidden,
    /// Sheet is hidden and cannot be unhidden via the normal UI.
    VeryHidden,
}

impl SheetVisibility {
    /// Parse from an OOXML `state` attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "visible" => Self::Visible,
            "hidden" => Self::Hidden,
            "veryHidden" => Self::VeryHidden,
            _ => Self::Visible,
        }
    }

    /// Serialize to the OOXML `state` attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Visible => "visible",
            Self::Hidden => "hidden",
            Self::VeryHidden => "veryHidden",
        }
    }
}
