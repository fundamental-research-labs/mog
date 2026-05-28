/// Page margin settings (ECMA-376 CT_PageMargins).
///
/// All margin values are in inches.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PageMargins {
    /// Left margin in inches
    pub left: f64,
    /// Right margin in inches
    pub right: f64,
    /// Top margin in inches
    pub top: f64,
    /// Bottom margin in inches
    pub bottom: f64,
    /// Header margin in inches (from top edge to header)
    pub header: f64,
    /// Footer margin in inches (from bottom edge to footer)
    pub footer: f64,
}

impl Default for PageMargins {
    /// Default Excel margins (0.7" left/right, 0.75" top/bottom, 0.3" header/footer).
    fn default() -> Self {
        Self {
            left: 0.7,
            right: 0.7,
            top: 0.75,
            bottom: 0.75,
            header: 0.3,
            footer: 0.3,
        }
    }
}

impl PageMargins {
    /// Create new page margins with explicit values.
    pub fn new(left: f64, right: f64, top: f64, bottom: f64, header: f64, footer: f64) -> Self {
        Self {
            left,
            right,
            top,
            bottom,
            header,
            footer,
        }
    }

    /// Default Excel margins (alias for `Default::default()`).
    pub fn excel_default() -> Self {
        Self::default()
    }

    /// Create margins with all values set to the same amount.
    pub fn uniform(inches: f64) -> Self {
        Self {
            left: inches,
            right: inches,
            top: inches,
            bottom: inches,
            header: inches,
            footer: inches,
        }
    }

    /// Create narrow margins (0.25" left/right, 0.75" top/bottom, 0.3" header/footer).
    pub fn narrow() -> Self {
        Self {
            left: 0.25,
            right: 0.25,
            top: 0.75,
            bottom: 0.75,
            header: 0.3,
            footer: 0.3,
        }
    }

    /// Create wide margins (1" left/right/top/bottom, 0.5" header/footer).
    pub fn wide() -> Self {
        Self {
            left: 1.0,
            right: 1.0,
            top: 1.0,
            bottom: 1.0,
            header: 0.5,
            footer: 0.5,
        }
    }
}
