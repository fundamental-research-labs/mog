//! Sheet-view / SheetPane lowering — boundary 1.15.
//!
//! **W4.d migration.** The XLSX `<pane topLeftCell="…">` attribute carries a
//! single cell reference — the top-left cell of the unfrozen / split pane.
//! It flows from the parser as [`SheetPane.topLeftCell: Option<String>`] (at
//! `file-io/xlsx/parser/src/output/results.rs:1499`, and downstream through
//! [`domain_types::FrozenPane.top_left_cell`]) and is ultimately written to
//! Yrs in [`crate::storage::infra::hydration::view::hydrate_frozen_pane`].
//!
//! This module owns the typed classification step. The hydrator calls
//! [`classify_top_left_cell`] before writing to Yrs so that malformed or
//! non-cell-shaped inputs are rejected uniformly; the raw bytes continue to
//! be stored verbatim on the valid path to preserve writer round-trip
//! fidelity (per the typed formula boundary rule: ref-shaped fields do not carry
//! `original: String`, but container-level byte preservation at an external-
//! format edge — Yrs here — is explicitly legitimate).
//!
//! # Type choice — narrow `CellRefNode`
//!
//! `topLeftCell` is defined by OOXML (ECMA-376 CT_Pane, 18.3.1.66) as a
//! single cell reference. It is never a range, a formula, a constant, or a
//! sqref list. Classification therefore targets the narrow
//! [`CellRefNode`] rather than the wider `ParsedExpr` umbrella — the
//! narrow type makes invalid states unrepresentable at the consumer edge.
//!
//! The underlying dispatch still goes through [`ParsedExpr::classify`] so
//! every boundary shares the same grammar table; we only project to the
//! narrow variant.

use compute_parser::{CellRefNode, ParsedExpr};

/// Classify the `topLeftCell` attribute of an XLSX `<pane>` element into a
/// typed [`CellRefNode`].
///
/// Accepts bare (`A1`) and absolute (`$A$1`) forms. Sheet-qualified forms
/// are not expected at this boundary — the pane's cell reference is
/// implicitly bound to the sheet containing the pane element. If a
/// producer emits one anyway the classifier goes through
/// `parse_sheet_qualified_cell` inside `compute-parser` and the sheet
/// prefix is dropped; the returned node carries only the row/col position,
/// which is the semantically relevant part for a pane.
///
/// Returns [`None`] when the input is empty, a range, a named range, or
/// otherwise not a single-cell reference.
#[must_use]
pub fn classify_top_left_cell(raw: &str) -> Option<CellRefNode> {
    if raw.is_empty() {
        return None;
    }
    match ParsedExpr::classify(raw) {
        ParsedExpr::Cell(node) => Some(node),
        _ => None,
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use formula_types::CellRef;

    fn pos(node: &CellRefNode) -> (u32, u32) {
        match node.reference {
            CellRef::Positional { row, col, .. } => (row, col),
            CellRef::Resolved(_) => panic!("expected Positional ref"),
        }
    }

    #[test]
    fn bare_cell() {
        let node = classify_top_left_cell("B3").expect("B3 is a valid TLC");
        assert_eq!(pos(&node), (2, 1));
    }

    #[test]
    fn absolute_cell() {
        let node = classify_top_left_cell("$D$4").expect("$D$4 is a valid TLC");
        assert!(node.abs_row);
        assert!(node.abs_col);
        assert_eq!(pos(&node), (3, 3));
    }

    #[test]
    fn large_cell() {
        // The pane TLC must survive cells past A-Z — pane state on wide
        // sheets scrolls right of AA.
        let node = classify_top_left_cell("AB100").expect("AB100 valid");
        assert_eq!(pos(&node), (99, 27));
    }

    #[test]
    fn empty_rejected() {
        assert!(classify_top_left_cell("").is_none());
    }

    #[test]
    fn range_rejected() {
        // A range is not a valid TLC. The hydrator must drop this rather
        // than writing malformed data to Yrs.
        assert!(classify_top_left_cell("A1:B2").is_none());
    }

    #[test]
    fn malformed_rejected() {
        assert!(classify_top_left_cell("not a cell").is_none());
        assert!(classify_top_left_cell("#REF!").is_none());
        assert!(classify_top_left_cell("1A").is_none());
    }

    #[test]
    fn sheet_qualified_utf8_does_not_panic() {
        // Non-ASCII sheet qualifier with a cell remainder. The XLSX spec
        // does not require sheet qualification on `topLeftCell`, but any
        // producer that emits one must not crash the importer. The typed
        // classifier delegates to UTF-8-safe parsers; bytes in the middle
        // of a multi-byte char were the UTF-8 boundary incident class.
        let node = classify_top_left_cell("'Πίνακας'!B3");
        match node {
            Some(n) => assert_eq!(pos(&n), (2, 1)),
            // If a future `ParsedExpr` tightening rejects sheet-qualified
            // panes, returning None is also acceptable — the only hard
            // requirement is no panic.
            None => {}
        }
    }

    #[test]
    fn classify_never_panics_on_utf8_samples() {
        // Totality spot-check. Proptest coverage lives on
        // `ParsedExpr::classify` itself.
        let samples = ["", "A1", "$B$2", "Πλήρης", "μμμμμμ", "\u{1F4A5}", "=A1"];
        for s in samples {
            let _ = classify_top_left_cell(s);
        }
    }
}
