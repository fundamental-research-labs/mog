//! Resolved cell write, produced at the scheduler edge.
//!
//! [`CellWrite`] is what the storage write path actually commits to yrs: a
//! coerced value, a parsed formula, or nothing. It is produced by the
//! classifier [`CellWrite::from_user_string`] — the **only** place where a
//! raw user string is sniffed for formula-vs-value. Every downstream consumer
//! pattern-matches on the variants; nobody re-sniffs the bytes.
//!
//! Pipeline position: boundary-side `CellInput` (intent) dispatches here via
//! `storage::cells::values::set_cell_value` → `CellWrite` (what gets written)
//! → leaf write helpers (`store_as_text` / `store_formula` / `store_typed`).
//!
//! Scheduler-scoped by design (one consumer). Kept crate-private to prevent
//! other subsystems from re-growing their own input classifiers.

use compute_formats::FormatType;
use compute_parser::FormulaSource;
use value_types::{CellError, CellValue};

use crate::storage::cells::values::{ParsedValue, parse_input_value};

/// Resolved write for a single cell.
///
/// `Value` wraps the coerced [`CellValue`] for non-formula inputs (numbers,
/// booleans, dates, text). `Formula` wraps the parsed AST plus original bytes
/// for round-trip fidelity. `Empty` is the whitespace-only / zero-length case,
/// which removes the cell.
///
/// Constructed via [`CellWrite::from_user_string`] — the **only** place where
/// a raw user string is classified into this typed form. Downstream consumers
/// (`storage::cells::values::set_cell_value` etc.) pattern-match on the
/// variants; they never re-sniff the string.
#[derive(Debug, Clone)]
pub(crate) enum CellWrite {
    /// Non-formula scalar value, coerced by [`parse_input_value`].
    Value(CellValue),
    /// Formula (input began with `=`) with preserved source bytes.
    Formula(FormulaSource),
    /// Empty or whitespace-only input.
    Empty,
}

impl CellWrite {
    /// Classify a raw user-supplied string at the scheduler boundary.
    ///
    /// # Precedence
    ///
    /// 1. Empty / whitespace-only → [`CellWrite::Empty`]
    /// 2. `target == Some(Text)` (G2) → [`CellWrite::Value`] with `Text(s)` —
    ///    beats formula and every value-classification branch. Excel/Sheets
    ///    both treat `=A1+B1` typed into a `@`-formatted cell as the literal
    ///    string.
    /// 3. Leading `=` → [`CellWrite::Formula`] (AST parsed via
    ///    [`FormulaSource::parse`], original bytes preserved)
    /// 4. Otherwise → [`CellWrite::Value`] via [`parse_input_value`] —
    ///    matches the existing engine-services parse (numbers, booleans,
    ///    dates, formatted numbers, fallback text). The target hint is
    ///    forwarded to the parser for G1 (percent ÷100) and G3 (fraction)
    ///    handling.
    #[must_use]
    pub(crate) fn from_user_string(s: &str, target: Option<FormatType>) -> Self {
        if s.trim().is_empty() {
            return Self::Empty;
        }
        // G2: a Text-formatted cell is the user's explicit "store anything I
        // type as a string" contract — including formulas. Excel and Sheets
        // both treat `=A1+B1` typed into an `@`-formatted cell as the literal
        // string. Must precede the `=` short-circuit.
        if matches!(target, Some(FormatType::Text)) {
            return Self::Value(CellValue::Text(s.to_string().into()));
        }
        // Formula short-circuit (only reached when target != Text).
        if s.starts_with('=') {
            return Self::Formula(FormulaSource::parse(s));
        }
        if let Some(error) = CellError::parse_error_str(s.trim()) {
            return Self::Value(CellValue::Error(error, None));
        }
        // No apostrophe handling here: `from_user_string` does not strip
        // leading `'` today and continues not to. The force-text editor path
        // strips at the service layer (`set_cell_value_as_text`) and routes
        // through `CellInput::Literal`, which never reaches this classifier.
        let value = match parse_input_value(s, target) {
            ParsedValue::Empty => CellValue::Null,
            ParsedValue::Number(n) => CellValue::number(n),
            ParsedValue::Boolean(b) => CellValue::Boolean(b),
            ParsedValue::Error(e) => CellValue::Error(e, None),
            // Preserve the original (non-trimmed) input for text — matches
            // the existing `parse_plain_value` contract for trailing whitespace
            // round-trip.
            ParsedValue::Text(_) => CellValue::Text(s.to_string().into()),
        };
        Self::Value(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_user_string_empty() {
        assert!(matches!(
            CellWrite::from_user_string("", None),
            CellWrite::Empty
        ));
        assert!(matches!(
            CellWrite::from_user_string("   ", None),
            CellWrite::Empty
        ));
        assert!(matches!(
            CellWrite::from_user_string("\t\n", None),
            CellWrite::Empty
        ));
    }

    #[test]
    fn from_user_string_formula() {
        match CellWrite::from_user_string("=A1+B1", None) {
            CellWrite::Formula(fs) => assert_eq!(fs.original, "=A1+B1"),
            other => panic!("expected Formula, got {other:?}"),
        }
    }

    #[test]
    fn from_user_string_formula_preserves_bytes_on_malformed() {
        // Totality: malformed formula still classifies as Formula with bytes preserved.
        match CellWrite::from_user_string("=((", None) {
            CellWrite::Formula(fs) => assert_eq!(fs.original, "=(("),
            other => panic!("expected Formula, got {other:?}"),
        }
    }

    #[test]
    fn from_user_string_number() {
        match CellWrite::from_user_string("42", None) {
            CellWrite::Value(CellValue::Number(n)) => {
                assert!((*n - 42.0).abs() < f64::EPSILON);
            }
            other => panic!("expected Value(Number), got {other:?}"),
        }
    }

    #[test]
    fn from_user_string_boolean() {
        match CellWrite::from_user_string("TRUE", None) {
            CellWrite::Value(CellValue::Boolean(true)) => {}
            other => panic!("expected Value(Boolean(true)), got {other:?}"),
        }
        match CellWrite::from_user_string("false", None) {
            CellWrite::Value(CellValue::Boolean(false)) => {}
            other => panic!("expected Value(Boolean(false)), got {other:?}"),
        }
    }

    #[test]
    fn from_user_string_text() {
        match CellWrite::from_user_string("hello", None) {
            CellWrite::Value(v) => assert_eq!(v.as_text(), Some("hello")),
            other => panic!("expected Value(Text), got {other:?}"),
        }
    }

    #[test]
    fn from_user_string_text_preserves_trailing_whitespace() {
        // The text branch preserves trailing whitespace — the scheduler
        // `parse_plain_value` relies on this to round-trip user input verbatim.
        match CellWrite::from_user_string("hello  ", None) {
            CellWrite::Value(v) => assert_eq!(v.as_text(), Some("hello  ")),
            other => panic!("expected Value(Text), got {other:?}"),
        }
    }

    #[test]
    fn from_user_string_is_total_on_sample_inputs() {
        // Typed formula boundary: non-ASCII coverage: Greek, CJK, emoji, RTL-mark,
        // and an accented-Latin input are included alongside the
        // original ASCII sample set. All must return without panic (the
        // parser's totality proptest above covers arbitrary UTF-8; the
        // curated list locks the UTF-8 boundary production-incident class
        // specifically).
        for s in [
            "",
            " ",
            "=",
            "=1+1",
            "=INVALID(",
            "42",
            "3.14",
            "TRUE",
            "hello",
            "$1,234.56",
            "50%",
            "2024-01-01",
            "Πλήρης",                       // Greek
            "日本語",                       // CJK
            "🚀 rocket",                    // emoji + Latin
            "café",                         // accented Latin
            "\u{202E}abc",                  // RTL override marker
            "=OFFSET(A1,0,0)",              // ASCII formula
            "=OFFSET(Πλήρης_Εκτύπωση,0,0)", // UTF-8 boundary Greek OFFSET
        ] {
            let _ = CellWrite::from_user_string(s, None);
        }
    }

    // ── Format-aware classifier ────────────────────────────────────────
    //
    // G2 (Text format): a Text-formatted cell stores any classifier-non-text
    // shape — including formulas — as the literal string. The text-format
    // hint must beat the formula short-circuit (`=` prefix) since Excel and
    // Sheets both treat `=A1+B1` typed into an `@`-formatted cell as the
    // literal string, never as a formula. Other classifier branches (number,
    // boolean, date) are also overridden when target == Some(Text).
    //
    #[test]
    fn from_user_string_text_format_beats_formula() {
        match CellWrite::from_user_string("=A1+B1", Some(FormatType::Text)) {
            CellWrite::Value(v) => assert_eq!(v.as_text(), Some("=A1+B1")),
            other => panic!("expected Value(Text(\"=A1+B1\")), got {other:?}"),
        }
    }

    #[test]
    fn from_user_string_percent_format_does_not_beat_formula() {
        // Percent-format hint must NOT short-circuit the formula prefix.
        match CellWrite::from_user_string("=A1+B1", Some(FormatType::Percentage)) {
            CellWrite::Formula(fs) => assert_eq!(fs.original, "=A1+B1"),
            other => panic!("expected Formula, got {other:?}"),
        }
    }

    #[test]
    fn from_user_string_no_hint_keeps_formula() {
        // Regression guard: format-blind path unchanged.
        match CellWrite::from_user_string("=A1+B1", None) {
            CellWrite::Formula(fs) => assert_eq!(fs.original, "=A1+B1"),
            other => panic!("expected Formula, got {other:?}"),
        }
    }

    #[test]
    fn from_user_string_text_format_number() {
        // G2: bare number into text-formatted cell stays text.
        match CellWrite::from_user_string("11", Some(FormatType::Text)) {
            CellWrite::Value(v) => assert_eq!(v.as_text(), Some("11")),
            other => panic!("expected Value(Text(\"11\")), got {other:?}"),
        }
    }

    #[test]
    fn from_user_string_text_format_boolean() {
        // G2: boolean into text-formatted cell stays text.
        match CellWrite::from_user_string("TRUE", Some(FormatType::Text)) {
            CellWrite::Value(v) => assert_eq!(v.as_text(), Some("TRUE")),
            other => panic!("expected Value(Text(\"TRUE\")), got {other:?}"),
        }
    }

    #[test]
    fn from_user_string_text_format_date() {
        // G2: date string into text-formatted cell stays text.
        match CellWrite::from_user_string("3/14/2024", Some(FormatType::Text)) {
            CellWrite::Value(v) => assert_eq!(v.as_text(), Some("3/14/2024")),
            other => panic!("expected Value(Text(\"3/14/2024\")), got {other:?}"),
        }
    }

    // ── Proptest ───────────────────────────────────────────────────────

    use proptest::prelude::*;

    proptest! {
        /// Totality: `CellWrite::from_user_string` never panics on arbitrary UTF-8.
        ///
        /// Load-bearing for W6 — once `set_cell_value` starts calling this at
        /// the scheduler edge, any panic on user input would take down the
        /// entire recalc scheduler. The parser is already total (W1 proptests);
        /// this covers the `=`-split + scalar-parse composition.
        #[test]
        fn proptest_from_user_string_never_panics(s in any::<String>()) {
            let _ = CellWrite::from_user_string(&s, None);
        }

        /// Totality with format hint also never panics.
        #[test]
        fn proptest_from_user_string_with_text_hint_never_panics(s in any::<String>()) {
            let _ = CellWrite::from_user_string(&s, Some(FormatType::Text));
        }
    }
}
