/// A single page break (ECMA-376 CT_Break).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PageBreak {
    /// Row or column index where break occurs (0-based)
    pub id: u32,
    /// Minimum row/column for the break
    pub min: u32,
    /// Maximum row/column for the break
    pub max: u32,
    /// Whether this is a manual break (user-inserted)
    pub manual: bool,
    /// Whether this is a page-to-page break
    pub pt: bool,
}

// ============================================================================
// Page Breaks Container
// ============================================================================

/// Container for page breaks (ECMA-376 CT_PageBreak).
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct PageBreaks {
    /// Number of breaks (as declared in XML)
    pub count: Option<u32>,
    /// Number of manual breaks
    pub manual_break_count: Option<u32>,
    /// List of page breaks
    pub breaks: Vec<PageBreak>,
}

impl PageBreaks {
    /// Get only manual breaks.
    pub fn manual_breaks(&self) -> impl Iterator<Item = &PageBreak> {
        self.breaks.iter().filter(|b| b.manual)
    }
}
