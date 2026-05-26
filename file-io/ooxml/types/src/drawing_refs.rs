//! Drawing reference types (ECMA-376 Part 1, Section 18.3).
//!
//! Types modelling relationship references from worksheets to drawing parts
//! and header/footer drawing images.

// ============================================================================
// DrawingRef — CT_Drawing
// ============================================================================

/// Drawing part reference (CT_Drawing, sml.xsd:2486).
///
/// A simple relationship reference from a worksheet to its drawing part.
/// This is the SML `CT_Drawing` which contains only `r:id`.
///
/// **Audit note**: The audit tool flags missing `twoCellAnchor`, `oneCellAnchor`,
/// and `absoluteAnchor` elements — those belong to the *SpreadsheetDrawing* `CT_Drawing`
/// in `dml-spreadsheetDrawing.xsd` (modeled by `SpreadsheetDrawing` in
/// `drawings/spreadsheet.rs`), not this SML reference type.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct DrawingRef {
    /// Relationship ID to the drawing part (required).
    pub r_id: String,
}

// ============================================================================
// DrawingHF — CT_DrawingHF
// ============================================================================

/// Header/footer drawing reference (CT_DrawingHF).
///
/// References images used in sheet headers and footers. Each optional field
/// maps to a specific position (left/center/right) and page type
/// (odd/even/first) in the header or footer.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct DrawingHF {
    /// Relationship ID to the drawing part (required).
    pub r_id: String,
    /// Left header, odd page image ID.
    pub lho: Option<u32>,
    /// Left header, even page image ID.
    pub lhe: Option<u32>,
    /// Left header, first page image ID.
    pub lhf: Option<u32>,
    /// Center header, odd page image ID.
    pub cho: Option<u32>,
    /// Center header, even page image ID.
    pub che: Option<u32>,
    /// Center header, first page image ID.
    pub chf: Option<u32>,
    /// Right header, odd page image ID.
    pub rho: Option<u32>,
    /// Right header, even page image ID.
    pub rhe: Option<u32>,
    /// Right header, first page image ID.
    pub rhf: Option<u32>,
    /// Left footer, odd page image ID.
    pub lfo: Option<u32>,
    /// Left footer, even page image ID.
    pub lfe: Option<u32>,
    /// Left footer, first page image ID.
    pub lff: Option<u32>,
    /// Center footer, odd page image ID.
    pub cfo: Option<u32>,
    /// Center footer, even page image ID.
    pub cfe: Option<u32>,
    /// Center footer, first page image ID.
    pub cff: Option<u32>,
    /// Right footer, odd page image ID.
    pub rfo: Option<u32>,
    /// Right footer, even page image ID.
    pub rfe: Option<u32>,
    /// Right footer, first page image ID.
    pub rff: Option<u32>,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drawing_ref_default() {
        let d = DrawingRef::default();
        assert!(d.r_id.is_empty());
    }

    #[test]
    fn drawing_hf_defaults() {
        let hf = DrawingHF::default();
        assert!(hf.r_id.is_empty());
        assert!(hf.lho.is_none());
        assert!(hf.lhe.is_none());
        assert!(hf.lhf.is_none());
        assert!(hf.cho.is_none());
        assert!(hf.che.is_none());
        assert!(hf.chf.is_none());
        assert!(hf.rho.is_none());
        assert!(hf.rhe.is_none());
        assert!(hf.rhf.is_none());
        assert!(hf.lfo.is_none());
        assert!(hf.lfe.is_none());
        assert!(hf.lff.is_none());
        assert!(hf.cfo.is_none());
        assert!(hf.cfe.is_none());
        assert!(hf.cff.is_none());
        assert!(hf.rfo.is_none());
        assert!(hf.rfe.is_none());
        assert!(hf.rff.is_none());
    }
}
