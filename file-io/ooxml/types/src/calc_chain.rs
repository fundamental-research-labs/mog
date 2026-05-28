//! Calculation chain types (ECMA-376 Part 1, Section 18.6 — SpreadsheetML Calculation Chain).
//!
//! Types modelling the contents of `xl/calcChain.xml`: the calculation chain
//! root element and individual cell entries that define formula dependency order.

// ============================================================================
// CalcChain -- CT_CalcChain
// ============================================================================

/// Calculation chain root element (CT_CalcChain).
///
/// The `<calcChain>` element is the root of `xl/calcChain.xml`. It contains
/// an ordered list of cell references that defines the formula calculation
/// dependency order.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct CalcChain {
    /// Ordered list of calc chain cell entries (`<c>` elements).
    pub cells: Vec<CalcCell>,
}

// ============================================================================
// CalcCell -- CT_CalcCell
// ============================================================================

/// Individual calc chain entry (CT_CalcCell).
///
/// Represents a single cell in the calculation chain with its dependency
/// metadata.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct CalcCell {
    /// Cell reference in A1 notation (e.g. "A1", "B12"). Required.
    pub r: String,
    /// Transitional compatibility cell reference (`ref`).
    ///
    /// Strict packages use `r`; import adapters should prefer `r` when both are
    /// present and use this only as a fallback.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// Sheet index (1-based). When omitted, same sheet as previous entry.
    /// XSD type: `xsd:int` (signed), default: 0.
    pub i: Option<i32>,
    /// Whether this is a new dependency level. Default: false.
    pub s: bool,
    /// Whether new thread dependency level. Default: false.
    pub l: bool,
    /// Whether the cell is an array formula. Default: false.
    pub t: bool,
    /// Whether the cell is part of an "always calculate" chain. Default: false.
    pub a: bool,
}

impl CalcCell {
    /// Returns the effective sheet index, using the XSD default of `0` when absent.
    #[must_use]
    pub fn effective_i(&self) -> i32 {
        self.i.unwrap_or(0)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calc_chain_default() {
        let cc = CalcChain::default();
        assert!(cc.cells.is_empty());
    }

    #[test]
    fn calc_cell_defaults() {
        let c = CalcCell::default();
        assert!(c.r.is_empty());
        assert!(c.reference.is_none());
        assert!(c.i.is_none());
        assert!(!c.s);
        assert!(!c.l);
        assert!(!c.t);
        assert!(!c.a);
    }

    #[test]
    fn calc_cell_with_values() {
        let c = CalcCell {
            r: "B2".to_string(),
            reference: None,
            i: Some(1),
            s: true,
            l: false,
            t: true,
            a: false,
        };
        assert_eq!(c.r, "B2");
        assert_eq!(c.i, Some(1));
        assert_eq!(c.effective_i(), 1);
        assert!(c.s);
        assert!(!c.l);
        assert!(c.t);
        assert!(!c.a);
    }

    #[test]
    fn calc_cell_effective_i_default() {
        let c = CalcCell::default();
        assert_eq!(c.effective_i(), 0);
    }
}
