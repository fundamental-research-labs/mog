//! Hyperlink lowering — boundaries 1.13–1.14.
//!
//! **W4.d migration.** XLSX hyperlink anchors (`Hyperlink.cell_ref`) and
//! internal-link targets (`Hyperlink.location`) flow in from the parser as raw
//! `String`s. Downstream, `storage/infra/hydration/features::hydrate_hyperlinks`
//! shadow-parses those strings via `parse_a1_ref` to locate the cell. That
//! `String → shadow-parse → pos` hop is the stringly-typed boundary this
//! module replaces: classify once at the import edge into a typed anchor, then
//! hand the typed shape to the consumer.
//!
//! # Anchor type — `HyperlinkAnchor` (narrower than `ParsedExpr`)
//!
//! The XLSX spec admits exactly two shapes for the `ref` attribute of a
//! `<hyperlink>` element (CT_Hyperlink, sml.xsd §18.3.1.47): a single cell
//! (`A1`) or a range (`A1:B5`). It never holds a formula, a constant, a
//! sqref list, or a `#REF!` token. A narrower enum
//! [`HyperlinkAnchor`] captures that invariant at the type level — a wider
//! `ParsedExpr` would add four variants the consumer would then have to
//! reject. Classification still delegates to [`ParsedExpr::classify`] so the
//! shared grammar table stays in one place; the narrow enum is just the
//! projection the hyperlink consumer needs.
//!
//! # Location type — `CellRefNode`
//!
//! `Hyperlink.location` (for internal links like `'Sheet Name'!A1`) is
//! always a sheet-qualified single cell per the spec. [`ParsedExpr::Cell`]
//! already accepts sheet-qualified cells (see `parse_sheet_qualified_cell`
//! inside `compute-parser`); this module exposes a narrow helper that
//! returns the underlying [`CellRefNode`] for consumers that need the sheet
//! prefix preserved structurally.
//!
//! # Typed-boundary rule carried forward
//!
//! `Hyperlink.target` stays `Option<String>`. It is a URL (external grammar,
//! not a spreadsheet grammar) and is explicitly excluded from this round's
//! scope.

use compute_parser::{CellRefNode, ParsedExpr, RangeRef};

/// Classified anchor (`ref=`) for an XLSX hyperlink.
///
/// Produced by [`classify_hyperlink_anchor`] from a raw parser-side string.
/// Narrower than [`ParsedExpr`] — hyperlink anchors can only be a single cell
/// or a range, never a formula / constant / sqref / broken ref.
#[derive(Debug, Clone, PartialEq)]
pub enum HyperlinkAnchor {
    /// Single-cell anchor (`ref="A1"`).
    Cell(CellRefNode),
    /// Range anchor (`ref="A1:B5"`) — typically from a merged-cell hyperlink
    /// or a multi-cell annotation.
    Range(RangeRef),
}

impl HyperlinkAnchor {
    /// Whether this anchor is a multi-cell range.
    #[must_use]
    pub fn is_range(&self) -> bool {
        matches!(self, Self::Range(_))
    }
}

/// Classify a hyperlink's `cell_ref` into a typed [`HyperlinkAnchor`].
///
/// Returns [`None`] when the input is not a well-formed single cell or range
/// reference — for hyperlinks this indicates malformed XLSX input; the caller
/// should skip the link rather than try to shadow-parse.
#[must_use]
pub fn classify_hyperlink_anchor(raw: &str) -> Option<HyperlinkAnchor> {
    match ParsedExpr::classify(raw) {
        ParsedExpr::Cell(node) => Some(HyperlinkAnchor::Cell(node)),
        ParsedExpr::Range(range) => Some(HyperlinkAnchor::Range(range)),
        // A hyperlink anchor is never a formula / constant / sqref / broken
        // ref / empty — reject and let the caller skip.
        _ => None,
    }
}

/// Classify a hyperlink's `location` (the `#<target>` fragment for internal
/// links) into a typed sheet-qualified cell reference.
///
/// Accepts both bare (`A1`) and sheet-qualified (`'Other Sheet'!B5`) forms;
/// the returned [`CellRefNode`] carries the parsed cell position. The sheet
/// prefix itself is consumed by classification and not re-attached — callers
/// that need to round-trip the sheet name work from the original raw bytes
/// (per the W2 rule that ref-shaped types do not carry per-field
/// `source_bytes`). Consumers which care about cross-sheet navigation
/// resolve the sheet name separately; this helper's job is validating the
/// cell-reference shape.
///
/// Returns [`None`] when the input is empty, a named range (no `!`
/// separator), or anything other than a single cell.
///
/// Currently exposed as the public classifier for boundary 1.14. The Yrs
/// hydrator preserves `link.location` verbatim (bytes are the authoritative
/// form for round-trip fidelity; named-range and defined-name targets are
/// legal here and must not be lost). Downstream consumers that need the
/// structured cell position — writer round-trip validation, future
/// semantic navigation — call this helper rather than shadow-parsing.
#[must_use]
#[allow(dead_code)] // Boundary 1.14 helper — consumed by tests; ready for
// semantic-navigation consumers landing in a follow-up.
pub fn classify_hyperlink_location(raw: &str) -> Option<CellRefNode> {
    if raw.is_empty() {
        return None;
    }
    // Some XLSX producers prefix internal locations with `#`; strip it before
    // classifying.
    let stripped = raw.strip_prefix('#').unwrap_or(raw);
    match ParsedExpr::classify(stripped) {
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

    fn expect_cell(raw: &str) -> CellRefNode {
        match classify_hyperlink_anchor(raw) {
            Some(HyperlinkAnchor::Cell(node)) => node,
            other => panic!("expected Cell anchor for {raw:?}, got {other:?}"),
        }
    }

    fn expect_range(raw: &str) -> RangeRef {
        match classify_hyperlink_anchor(raw) {
            Some(HyperlinkAnchor::Range(range)) => range,
            other => panic!("expected Range anchor for {raw:?}, got {other:?}"),
        }
    }

    fn cell_pos(node: &CellRefNode) -> (u32, u32) {
        match node.reference {
            CellRef::Positional { row, col, .. } => (row, col),
            CellRef::Resolved(_) => panic!("expected Positional ref"),
        }
    }

    // ── HyperlinkAnchor.cell_ref (Boundary 1.13) ──────────────────────────

    #[test]
    fn cell_anchor_bare_a1() {
        let node = expect_cell("A1");
        assert_eq!(cell_pos(&node), (0, 0));
    }

    #[test]
    fn cell_anchor_absolute() {
        let node = expect_cell("$B$5");
        assert!(node.abs_row);
        assert!(node.abs_col);
        assert_eq!(cell_pos(&node), (4, 1));
    }

    #[test]
    fn range_anchor_cell_range() {
        let range = expect_range("A1:B5");
        match (range.start, range.end) {
            (
                CellRef::Positional {
                    row: sr, col: sc, ..
                },
                CellRef::Positional {
                    row: er, col: ec, ..
                },
            ) => {
                assert_eq!((sr, sc), (0, 0));
                assert_eq!((er, ec), (4, 1));
            }
            _ => panic!("expected positional range"),
        }
    }

    #[test]
    fn merged_cell_anchor_single_row_single_col_range() {
        // Anchors used by merged-cell hyperlinks classify as Range even when
        // square — the boundary preserves the author's literal shape.
        let range = expect_range("C3:C3");
        assert!(matches!(
            range.start,
            CellRef::Positional { row: 2, col: 2, .. }
        ));
        assert!(matches!(
            range.end,
            CellRef::Positional { row: 2, col: 2, .. }
        ));
    }

    #[test]
    fn malformed_anchor_rejected() {
        assert!(classify_hyperlink_anchor("").is_none());
        assert!(classify_hyperlink_anchor("   ").is_none());
        assert!(classify_hyperlink_anchor("#REF!").is_none());
        assert!(classify_hyperlink_anchor("not an anchor").is_none());
        assert!(classify_hyperlink_anchor("=A1+1").is_none());
    }

    #[test]
    fn anchor_is_range_discriminator() {
        assert!(!classify_hyperlink_anchor("A1").unwrap().is_range());
        assert!(classify_hyperlink_anchor("A1:B5").unwrap().is_range());
    }

    // ── Hyperlink.location (Boundary 1.14) ────────────────────────────────

    #[test]
    fn location_bare_cell() {
        let node = classify_hyperlink_location("B5").expect("bare cell location");
        assert_eq!(cell_pos(&node), (4, 1));
    }

    #[test]
    fn location_sheet_qualified() {
        let node = classify_hyperlink_location("Sheet2!A1").expect("sheet-qualified location");
        assert_eq!(cell_pos(&node), (0, 0));
    }

    #[test]
    fn location_quoted_sheet_name_with_spaces() {
        // Core W4.d regression: quoted sheet names with spaces must classify
        // cleanly. A shadow parser that splits on the first `!` without
        // respecting `'`-quoting mis-attributes the sheet on names like
        // `'Sheet!Name'!A1`. `ParsedExpr::classify` delegates to
        // `split_sheet_prefix` which handles quoted names correctly.
        let node = classify_hyperlink_location("'Other Sheet'!B5").expect("quoted sheet");
        assert_eq!(cell_pos(&node), (4, 1));
    }

    #[test]
    fn location_quoted_sheet_with_embedded_bang() {
        // Sheet names may (in rare producers) contain `!` inside quotes.
        // The typed classifier respects the quote grouping.
        let node = classify_hyperlink_location("'Sheet!With!Bangs'!C3").expect("embedded bangs");
        assert_eq!(cell_pos(&node), (2, 2));
    }

    #[test]
    fn location_non_ascii_sheet_name() {
        // Non-ASCII sheet names — Greek, CJK, emoji. The shadow-parse
        // implementations that used byte indexing panic on multi-byte chars
        // crossing their slice boundaries (UTF-8 boundary incident class). The
        // typed path goes through `compute-parser`, which is UTF-8 safe.
        let node = classify_hyperlink_location("'Πίνακας'!A1").expect("Greek sheet");
        assert_eq!(cell_pos(&node), (0, 0));
        let node = classify_hyperlink_location("'\u{4E2D}\u{6587}'!B2").expect("CJK sheet");
        assert_eq!(cell_pos(&node), (1, 1));
    }

    #[test]
    fn location_with_hash_prefix_stripped() {
        // Some XLSX producers prefix internal locations with `#`.
        let node = classify_hyperlink_location("#Sheet1!A1").expect("hash-prefixed");
        assert_eq!(cell_pos(&node), (0, 0));
    }

    #[test]
    fn location_named_range_rejected() {
        // A bare named-range target (no `!`, not a cell) is not a sheet-
        // qualified cell. Returning None lets the consumer keep the raw
        // string for named-range navigation.
        assert!(classify_hyperlink_location("MyNamedRange").is_none());
    }

    #[test]
    fn location_range_rejected() {
        // A range location is not a single-cell reference. Callers that
        // need range locations would go through the anchor path instead.
        assert!(classify_hyperlink_location("Sheet1!A1:B2").is_none());
    }

    #[test]
    fn location_empty_rejected() {
        assert!(classify_hyperlink_location("").is_none());
    }

    // ── Totality (Boundary 1.14 interacts with UTF-8 boundary class) ────────────

    #[test]
    fn classify_never_panics_on_utf8_samples() {
        // Totality spot-check on the UTF-8 boundary sample set. Proptest coverage
        // lives on `ParsedExpr::classify` itself; this is a belt-and-braces
        // check that the narrow projections inherit totality.
        let samples = [
            "",
            "A1",
            "Sheet1!A1",
            "'Πίνακας'!A1",
            "μμμμμμ",
            "\u{1F4A5}",
            "'a'!#REF!\u{1F4A5}",
            "=OFFSET(Πλήρης,0,0)",
        ];
        for s in samples {
            let _ = classify_hyperlink_anchor(s);
            let _ = classify_hyperlink_location(s);
        }
    }
}
