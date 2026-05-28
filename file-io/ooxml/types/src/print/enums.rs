/// Page orientation (ECMA-376 ST_Orientation).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum Orientation {
    /// Default orientation (usually portrait)
    #[default]
    Default,
    /// Portrait orientation (taller than wide)
    Portrait,
    /// Landscape orientation (wider than tall)
    Landscape,
}

impl Orientation {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "default" => Self::Default,
            "portrait" => Self::Portrait,
            "landscape" => Self::Landscape,
            _ => Self::Default,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Portrait => "portrait",
            Self::Landscape => "landscape",
        }
    }
}

// ============================================================================
// Page Order Enumeration
// ============================================================================

/// Page order for printing (ECMA-376 ST_PageOrder).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum PageOrder {
    /// Print down, then over (default)
    #[default]
    DownThenOver,
    /// Print over, then down
    OverThenDown,
}

impl PageOrder {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "downThenOver" => Self::DownThenOver,
            "overThenDown" => Self::OverThenDown,
            _ => Self::DownThenOver,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::DownThenOver => "downThenOver",
            Self::OverThenDown => "overThenDown",
        }
    }
}

// ============================================================================
// Cell Comments Print Location
// ============================================================================

/// How to print cell comments (ECMA-376 ST_CellComments).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum CellComments {
    /// Don't print comments (default)
    #[default]
    None,
    /// Print comments at the end of the sheet
    AtEnd,
    /// Print comments as displayed on sheet
    AsDisplayed,
}

impl CellComments {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "none" => Self::None,
            "atEnd" => Self::AtEnd,
            "asDisplayed" => Self::AsDisplayed,
            _ => Self::None,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::AtEnd => "atEnd",
            Self::AsDisplayed => "asDisplayed",
        }
    }
}

// ============================================================================
// Print Error Display Mode
// ============================================================================

/// How to print cell errors (ECMA-376 ST_PrintError).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum PrintErrors {
    /// Print errors as displayed (default)
    #[default]
    Displayed,
    /// Print blank instead of errors
    Blank,
    /// Print dashes instead of errors
    Dash,
    /// Print "N/A" instead of errors
    NA,
}

impl PrintErrors {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "displayed" => Self::Displayed,
            "blank" => Self::Blank,
            "dash" => Self::Dash,
            "NA" => Self::NA,
            _ => Self::Displayed,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Displayed => "displayed",
            Self::Blank => "blank",
            Self::Dash => "dash",
            Self::NA => "NA",
        }
    }
}
