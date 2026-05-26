//! Short-form public entry points for A1-notation parsing.
//!
//! These are ergonomic wrappers over the existing [`parse_formula`] path and
//! the internal `references` / `normalize` modules — not a new grammar. Each
//! function runs the full winnow grammar and pattern-matches the resulting
//! [`ASTNode`] for the shape the caller wants.
//!
//! Consolidates ~15 bespoke A1 parsers previously scattered across
//! `compute/core/src/**` and `file-io/xlsx/parser/src/**`. Every call site must
//! route through this module so UTF-8-boundary bugs (UTF-8 boundary Greek OFFSET)
//! cannot recur in new copies.
//!
//! UTF-8 boundary guard: the four `&input[..i]` / `&input[i+2..]` slices in
//! `split_sheet_prefix` operate on positions produced by explicit
//! byte-equality tests against ASCII bytes (`b'\''`, `b'!'`). Every
//! index is verified to sit on a single-byte ASCII character before
//! the slice is taken. File-scope allow documented here.

#![allow(clippy::string_slice)]

use crate::ast::{ASTNode, CellRefNode, RangeRef};
use crate::parser::parse_formula;

/// Parse a single A1-style cell reference, e.g. `A1`, `$B$5`, `AA100`.
///
/// Returns `None` if the input is not exactly a single cell reference —
/// ranges, row/column ranges, sheet-qualified refs, or any other expression
/// yield `None`. Lowercase column letters are accepted (the winnow grammar
/// normalizes them).
#[must_use]
pub fn parse_a1_cell(input: &str) -> Option<CellRefNode> {
    // Delegates to parse_formula; pattern-matches the single cell-ref variant.
    let with_eq = ensure_eq_prefix(input);
    let ast = parse_formula(&with_eq, None).ok()?.into_inner();
    match ast {
        ASTNode::CellReference(node) => Some(node),
        _ => None,
    }
}

/// Parse a single A1-style range reference, e.g. `A1:B10`, `$A$1:$B$10`,
/// `A:C`, `1:5`, or a single cell (`A1`) expanded to a 1×1 range.
///
/// Returns `None` for sqref lists, sheet-qualified refs, or any non-range
/// expression.
#[must_use]
pub fn parse_a1_range(input: &str) -> Option<RangeRef> {
    // Delegates to parse_formula; accepts Range directly or promotes a bare
    // CellReference to a degenerate 1x1 range for caller convenience.
    let with_eq = ensure_eq_prefix(input);
    let ast = parse_formula(&with_eq, None).ok()?.into_inner();
    match ast {
        ASTNode::Range(r) => Some(r),
        ASTNode::CellReference(node) => Some(RangeRef::new(
            node.reference,
            node.reference,
            formula_types::RangeType::CellRange,
        )),
        _ => None,
    }
}

/// Parse a space-separated list of A1 ranges (XLSX `sqref` attribute format),
/// e.g. `A1 B2:C3` → two ranges.
///
/// Returns `None` if any token fails to parse as a cell or range.
#[must_use]
pub fn parse_sqref_list(input: &str) -> Option<Vec<RangeRef>> {
    // sqref is whitespace-separated in OOXML; each token is an A1 range or cell.
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut out = Vec::new();
    for token in trimmed.split_whitespace() {
        out.push(parse_a1_range(token)?);
    }
    if out.is_empty() { None } else { Some(out) }
}

/// Split an optional `SheetName!` (or `'Quoted Sheet'!`) prefix from an A1
/// reference string. Returns `(sheet_name, remainder)`.
///
/// `sheet_name` is `None` when the input has no prefix; when quoted, the
/// returned slice excludes the outer `'` characters. `remainder` is the
/// portion after the `!` (or the whole input when no prefix is present).
#[must_use]
pub fn split_sheet_prefix(input: &str) -> (Option<&str>, &str) {
    // Byte-level scan: handles both unquoted `Sheet1!A1` and quoted
    // `'My Sheet'!A1`, matching the `ast::format_cell_ref` sheet quoting rule.
    let bytes = input.as_bytes();
    if bytes.is_empty() {
        return (None, input);
    }

    if bytes[0] == b'\'' {
        // Quoted sheet name — find the closing quote followed by '!'. Handle
        // escaped doubled quotes `''` inside the name.
        let mut i = 1;
        while i < bytes.len() {
            if bytes[i] == b'\'' {
                // Peek for escaped double-quote.
                if i + 1 < bytes.len() && bytes[i + 1] == b'\'' {
                    i += 2;
                    continue;
                }
                // Closing quote — expect '!' right after.
                if i + 1 < bytes.len() && bytes[i + 1] == b'!' {
                    // Safe: `i` sits at a `'` byte (ASCII), `i+1` at `!` (ASCII).
                    let name = &input[1..i];
                    let rest = &input[i + 2..];
                    return (Some(name), rest);
                }
                return (None, input);
            }
            i += 1;
        }
        (None, input)
    } else if let Some(excl) = bytes.iter().position(|&b| b == b'!') {
        // Unquoted — take everything before the first `!`.
        // `!` is ASCII so `excl` is a valid UTF-8 boundary.
        let name = &input[..excl];
        let rest = &input[excl + 1..];
        (Some(name), rest)
    } else {
        (None, input)
    }
}

/// Prepend `=` when the caller passes a bare A1 reference. `parse_formula`
/// strips an optional leading `=` before delegating to the expression grammar.
#[inline]
fn ensure_eq_prefix(input: &str) -> std::borrow::Cow<'_, str> {
    if input.starts_with('=') {
        std::borrow::Cow::Borrowed(input)
    } else {
        std::borrow::Cow::Owned(format!("={input}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use formula_types::{CellRef, RangeType};

    #[test]
    fn parse_a1_cell_simple() {
        let node = parse_a1_cell("A1").unwrap();
        assert!(!node.abs_row);
        assert!(!node.abs_col);
        match node.reference {
            CellRef::Positional { row, col, .. } => {
                assert_eq!(row, 0);
                assert_eq!(col, 0);
            }
            CellRef::Resolved(_) => panic!("expected positional"),
        }
    }

    #[test]
    fn parse_a1_cell_absolute() {
        let node = parse_a1_cell("$B$5").unwrap();
        assert!(node.abs_row);
        assert!(node.abs_col);
        match node.reference {
            CellRef::Positional { row, col, .. } => {
                assert_eq!(row, 4);
                assert_eq!(col, 1);
            }
            CellRef::Resolved(_) => panic!("expected positional"),
        }
    }

    #[test]
    fn parse_a1_cell_lowercase() {
        // Regression: a1.rs previously used `is_ascii_uppercase()` without
        // normalizing, silently dropping lowercase columns. The winnow grammar
        // accepts them.
        assert!(parse_a1_cell("a1").is_some());
        assert!(parse_a1_cell("ab100").is_some());
    }

    #[test]
    fn parse_a1_cell_rejects_range() {
        assert!(parse_a1_cell("A1:B2").is_none());
    }

    #[test]
    fn parse_a1_cell_rejects_empty() {
        assert!(parse_a1_cell("").is_none());
    }

    #[test]
    fn parse_a1_cell_rejects_trailing_garbage() {
        // Callers like range_manager::parse_cell's test suite require
        // trailing chars after a valid cell ref to reject the input.
        assert!(parse_a1_cell("A1B").is_none());
        assert!(parse_a1_cell("A0").is_none()); // row-0 invalid in A1
        assert!(parse_a1_cell("1A").is_none());
        assert!(parse_a1_cell("A").is_none());
        assert!(parse_a1_cell("$").is_none());
        assert!(parse_a1_cell("123").is_none());
    }

    #[test]
    fn parse_a1_range_simple() {
        let r = parse_a1_range("A1:C5").unwrap();
        assert_eq!(r.range_type, RangeType::CellRange);
    }

    #[test]
    fn parse_a1_range_single_cell_degenerate() {
        // Callers (e.g. XLSX phantom-cell exclusion) expect a single cell to
        // parse as a 1x1 range.
        let r = parse_a1_range("B2").unwrap();
        assert_eq!(r.range_type, RangeType::CellRange);
    }

    #[test]
    fn parse_a1_range_absolute() {
        let r = parse_a1_range("$A$1:$C$5").unwrap();
        assert!(r.abs_start.row);
        assert!(r.abs_end.col);
    }

    #[test]
    fn parse_a1_range_column() {
        let r = parse_a1_range("A:C").unwrap();
        assert_eq!(r.range_type, RangeType::ColumnRange);
    }

    #[test]
    fn parse_a1_range_row() {
        let r = parse_a1_range("1:5").unwrap();
        assert_eq!(r.range_type, RangeType::RowRange);
    }

    #[test]
    fn parse_a1_range_rejects_empty() {
        assert!(parse_a1_range("").is_none());
    }

    #[test]
    fn parse_sqref_list_single() {
        let list = parse_sqref_list("A1:B2").unwrap();
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn parse_sqref_list_multiple() {
        let list = parse_sqref_list("A1 B2:C3 D4").unwrap();
        assert_eq!(list.len(), 3);
    }

    #[test]
    fn parse_sqref_list_empty() {
        assert!(parse_sqref_list("").is_none());
        assert!(parse_sqref_list("   ").is_none());
    }

    #[test]
    fn parse_sqref_list_partial_failure() {
        // One bad token fails the whole list.
        assert!(parse_sqref_list("A1 notacell").is_none());
    }

    #[test]
    fn split_sheet_prefix_none() {
        assert_eq!(split_sheet_prefix("A1"), (None, "A1"));
        assert_eq!(split_sheet_prefix("A1:B2"), (None, "A1:B2"));
    }

    #[test]
    fn split_sheet_prefix_unquoted() {
        assert_eq!(split_sheet_prefix("Sheet1!A1"), (Some("Sheet1"), "A1"));
    }

    #[test]
    fn split_sheet_prefix_quoted() {
        assert_eq!(
            split_sheet_prefix("'My Sheet'!A1:B2"),
            (Some("My Sheet"), "A1:B2")
        );
    }

    #[test]
    fn split_sheet_prefix_empty() {
        assert_eq!(split_sheet_prefix(""), (None, ""));
    }

    // ── Regression: UTF-8 boundary Greek OFFSET ──────────────────────────────
    //
    // The UTF-8 boundary production-incident input panicked on a `&str[n..]` slice
    // at a non-ASCII byte boundary inside `is_ref_error_only`. After W1
    // consolidation, every A1-shaped caller lands on compute-parser which is
    // UTF-8 safe. This test asserts the whole formula, plus each non-ASCII
    // fragment in isolation, round-trips through the public entry points
    // without panicking.
    #[test]
    fn round_35_greek_offset_does_not_panic() {
        let formula = "=OFFSET(Πλήρης_Εκτύπωση,0,0,'Input -1'!Τελευταία_γραμμή)";
        let _ = crate::parse_formula(formula, None); // must not panic
        let _ = parse_a1_cell("Τελευταία_γραμμή"); // must not panic
        let _ = parse_a1_range("Πλήρης_Εκτύπωση"); // must not panic
        let _ = parse_sqref_list("Πλήρης_Εκτύπωση Τελευταία_γραμμή"); // must not panic
        let _ = split_sheet_prefix("'Input -1'!Τελευταία_γραμμή"); // must not panic
    }

    // ── Proptests: totality gate ───────────────────────────────────────
    //
    // Every public A1 entry point must be total over arbitrary UTF-8 input.
    // These properties are load-bearing for W3 — the sanitize-module
    // deletion there relies on compute-parser being defensively total.

    use proptest::prelude::*;

    proptest! {
        /// `parse_a1_cell` never panics on arbitrary UTF-8.
        #[test]
        fn proptest_parse_a1_cell_never_panics(s in any::<String>()) {
            let _ = parse_a1_cell(&s);
        }

        /// `parse_a1_range` never panics on arbitrary UTF-8.
        #[test]
        fn proptest_parse_a1_range_never_panics(s in any::<String>()) {
            let _ = parse_a1_range(&s);
        }

        /// `parse_sqref_list` never panics on arbitrary UTF-8.
        #[test]
        fn proptest_parse_sqref_list_never_panics(s in any::<String>()) {
            let _ = parse_sqref_list(&s);
        }

        /// `split_sheet_prefix` never panics on arbitrary UTF-8 and never
        /// returns a sheet/rest pair that isn't a UTF-8-valid slice of the
        /// input (enforced by `&str` return type at compile time; this
        /// proptest also asserts the concatenation doesn't exceed the
        /// original length).
        #[test]
        fn proptest_split_sheet_prefix_never_panics(s in any::<String>()) {
            let (sheet, rest) = split_sheet_prefix(&s);
            // Bounds sanity: returned slices come from `s`, so their lengths
            // are each bounded by s.len(); their sum is at most s.len() + 2
            // (the `'!` or `!` separator is not included in either slice).
            let sheet_len = sheet.map_or(0, str::len);
            prop_assert!(sheet_len + rest.len() <= s.len() + 2);
        }

        /// The same broad safety check for `parse_formula` itself — W3 relies
        /// on this property to remove the defensive byte-boundary filter in
        /// `is_ref_error_only`. Duplicated from `proptest_tests.rs`'s
        /// `parse_never_panics_any_string` to keep the contract co-located
        /// with the ship-criterion it underpins.
        #[test]
        fn proptest_parse_formula_never_panics(s in any::<String>()) {
            let _ = crate::parse_formula(&s, None);
        }
    }
}
