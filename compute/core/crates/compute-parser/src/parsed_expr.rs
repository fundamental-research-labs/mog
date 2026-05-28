//! Typed umbrella for any `refers_to`-shaped field plus narrow helper types.
//!
//! # Design
//!
//! [`ParsedExpr`] is the umbrella classifier for every "this XLSX field holds
//! some expression-like string" boundary in the inventory. [`FormulaSource`] is
//! the narrow type for fields that unconditionally hold a formula; [`SqrefList`]
//! is the narrow type for XLSX `sqref` attributes.
//!
//! # Why this lives in `compute-parser`
//!
//! Placing these types in `formula-types` is infeasible: [`ParsedExpr::classify`]
//! and [`FormulaSource::parse`] must dispatch to [`parse_formula`], which lives
//! in `compute-parser`. Since `compute-parser` already depends on
//! `formula-types`, placing these types in `formula-types` would require
//! `formula-types` to depend on `compute-parser` — a Cargo cycle.
//! Rust's orphan rule also forbids inherent `impl` blocks on a foreign type, so
//! `ParsedExpr::classify` cannot be defined downstream of the type itself.
//!
//! `compute-parser` is the next-best fit: it is one layer above `formula-types`
//! in the dep DAG, already exports `ASTNode` and every A1 entry point this
//! module uses, and is already a dependency of every consumer that needs these
//! types (Yrs construction, wire queries, scheduler, and import via
//! `compute-core`). No consumer needs to gain a new dep to reach these types.
//!
//! # Totality
//!
//! [`ParsedExpr::classify`] is **total** over UTF-8: every well-formed UTF-8
//! string maps to exactly one variant. The match order is:
//!
//! 1. empty / whitespace-only → [`ParsedExpr::Empty`]
//! 2. `#REF!` only, possibly sheet-qualified → [`ParsedExpr::BrokenRef`]
//! 3. A1 cell ref → [`ParsedExpr::Cell`]
//! 4. A1 range ref → [`ParsedExpr::Range`]
//! 5. sqref list → [`ParsedExpr::SqrefList`]
//! 6. literal value (number / bool / quoted string / error token) →
//!    [`ParsedExpr::Constant`]
//! 7. anything else → [`ParsedExpr::Formula`] (via
//!    [`FormulaSource::parse`], which tolerates parser error recovery)
//!
//! There is **no `Unparseable` escape variant**. Malformed formula input lands
//! in [`ParsedExpr::Formula`] with [`FormulaSource::ast`] carrying the parser's
//! error-recovery node; [`FormulaSource::original`] preserves the raw bytes
//! verbatim for writer fidelity.

use std::borrow::Cow;

use cell_types::col_to_letter;
use formula_types::{CellRef, IdentityFormula, RangeRef as TypedRangeRef, RangeType};
use value_types::{CellError, CellValue, FiniteF64};

use crate::a1_entry::{parse_a1_cell, parse_a1_range, parse_sqref_list, split_sheet_prefix};
use crate::ast::{ASTNode, CellRefNode, RangeRef};
use crate::parser::parse_formula;

// ─────────────────────────────────────────────────────────────────────────────
// SheetName — lightweight newtype for the sheet qualifier carried on
// `ParsedExpr::BrokenRef`.
// ─────────────────────────────────────────────────────────────────────────────

/// Sheet qualifier parsed from an A1 expression — the textual sheet name, not a
/// resolved [`cell_types::SheetId`].
///
/// `ParsedExpr::BrokenRef { sheet: Some(SheetName(..)) }` records the author's
/// original sheet prefix when an XLSX field like `'Deleted Sheet'!#REF!`
/// survives sheet deletion. The name is **not** resolved — we intentionally do
/// not require a workbook-level sheet table to classify.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SheetName(pub String);

impl SheetName {
    /// Borrow the underlying name.
    #[must_use]
    #[inline]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<String> for SheetName {
    #[inline]
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for SheetName {
    #[inline]
    fn from(s: &str) -> Self {
        Self(s.to_owned())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SqrefList — newtype over Vec<RangeRef> for XLSX `sqref` attributes.
// ─────────────────────────────────────────────────────────────────────────────

/// Space-separated list of A1 range references — the XLSX `sqref` attribute
/// shape.
///
/// Replaces the ad-hoc `Vec<String>` that many XLSX-facing structs previously
/// used for multi-range selections.
///
/// # Default
///
/// `Default::default()` yields an empty list (zero ranges). This is the right
/// shape for "field present but malformed" recovery: parser-side structs that
/// `Default` an `SqrefList` get a no-range list rather than a panic, and
/// downstream serialization through [`Self::to_a1_string`] emits an empty
/// string, matching the OOXML "no sqref attribute" semantics.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SqrefList(pub Vec<RangeRef>);

impl SqrefList {
    /// Parse a whitespace-separated list of A1 ranges.
    ///
    /// Returns `None` if the input is empty, whitespace-only, or contains any
    /// token that fails to parse as a range (or single cell, which is promoted
    /// to a 1×1 range per [`parse_a1_range`]).
    #[must_use]
    pub fn parse(input: &str) -> Option<Self> {
        parse_sqref_list(input).map(Self)
    }

    /// Canonical A1 re-emission: space-separated ranges each serialized via
    /// [`RangeRef::to_a1_string`], with one sqref-specific fidelity rule —
    /// **1×1 ranges elide the `:A1` tail** and emit the bare cell form.
    ///
    /// This matches Excel's sqref convention (`sqref="A1"`, not
    /// `sqref="A1:A1"`) and preserves writer byte-fidelity on the CF / data-
    /// validation round-trip path. Semantic round-trip is unaffected:
    /// `SqrefList::parse("A1")` and `SqrefList::parse("A1:A1")` produce the
    /// same typed structure, so reparse-after-emission always reconstructs
    /// the same `SqrefList`.
    #[must_use]
    pub fn to_a1_string(&self) -> String {
        let mut out = String::new();
        for (i, r) in self.0.iter().enumerate() {
            if i > 0 {
                out.push(' ');
            }
            out.push_str(&range_ref_to_sqref_token(r));
        }
        out
    }

    /// Number of ranges in the list.
    #[must_use]
    #[inline]
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Is the list empty?
    #[must_use]
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// sqref-token emitter: defers to [`RangeRef::to_a1_string`] for every shape
/// except `CellRange` 1×1s, which emit as the degenerate cell form (`A1`
/// rather than `A1:A1`) to match Excel's sqref-attribute convention.
fn range_ref_to_sqref_token(r: &RangeRef) -> String {
    if r.range_type == formula_types::RangeType::CellRange
        && let (
            CellRef::Positional {
                row: sr,
                col: sc,
                sheet: ss,
            },
            CellRef::Positional {
                row: er,
                col: ec,
                sheet: es,
            },
        ) = (&r.start, &r.end)
        && sr == er
        && sc == ec
        && ss == es
        && r.abs_start == r.abs_end
    {
        return format_positional_cell(*sr, *sc, r.abs_start.row, r.abs_start.col);
    }
    r.to_a1_string()
}

// ─────────────────────────────────────────────────────────────────────────────
// FormulaSource — AST + original bytes for round-trip writer fidelity.
// ─────────────────────────────────────────────────────────────────────────────

/// A parsed formula paired with its original source bytes.
///
/// Both fields are load-bearing:
///
/// - `ast`: the parsed [`ASTNode`] — may be an error-recovery node when the
///   input is malformed; callers never inspect error state, they just forward
///   the AST to the evaluator, which handles error nodes uniformly.
/// - `original`: the raw input bytes, preserved verbatim. XLSX writers emit
///   this string directly for round-trip fidelity — the AST alone is lossy for
///   cosmetic variants (whitespace, casing, redundant parentheses) that Excel
///   preserves but the parser normalizes away.
///
/// # Equality
///
/// [`PartialEq`] compares only `original`. Two `FormulaSource` values with the
/// same source bytes are functionally equivalent; the AST is a deterministic
/// function of the source, so including it in equality would be redundant and
/// would also force the AST to implement `PartialEq` (it does) but more
/// importantly would slow common-case comparison unnecessarily.
#[derive(Debug, Clone)]
pub struct FormulaSource {
    /// Parsed AST — may be an error-recovery node for malformed input.
    pub ast: ASTNode,
    /// Original source bytes, preserved verbatim.
    pub original: String,
}

impl FormulaSource {
    /// Parse an arbitrary formula string.
    ///
    /// Totality: never returns an error. When [`parse_formula`] fails, the
    /// returned `ast` is an [`ASTNode::Error`] sentinel carrying `#N/A`; the
    /// original bytes are preserved verbatim in `original` so the writer path
    /// can still emit the author's text untouched.
    #[must_use]
    pub fn parse(input: &str) -> Self {
        let ast = match parse_formula(input, None) {
            Ok(spanned) => spanned.into_inner(),
            Err(_) => ASTNode::Error(CellError::Na),
        };
        Self {
            ast,
            original: input.to_string(),
        }
    }
}

impl PartialEq for FormulaSource {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.original == other.original
    }
}

impl Eq for FormulaSource {}

// ─────────────────────────────────────────────────────────────────────────────
// ParsedExpr — umbrella classifier.
// ─────────────────────────────────────────────────────────────────────────────

/// Typed umbrella for any "`refers_to`-shaped" XLSX field.
///
/// Every variant is reachable from [`ParsedExpr::classify`]; classification is
/// total over UTF-8. See the module-level docs for the totality contract and
/// match order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedExpr {
    /// Empty or whitespace-only input.
    Empty,
    /// `#REF!` token, optionally with a surviving sheet qualifier
    /// (e.g. `'Deleted Sheet'!#REF!`).
    BrokenRef {
        /// Original sheet qualifier, if the `#REF!` was sheet-prefixed.
        sheet: Option<SheetName>,
    },
    /// Single-cell A1 reference.
    Cell(CellRefNode),
    /// Single A1 range reference (including column / row ranges and 1×1 cell
    /// ranges).
    Range(RangeRef),
    /// `sqref`-style space-separated range list with at least two entries.
    /// (Single-token inputs classify as [`ParsedExpr::Cell`] or
    /// [`ParsedExpr::Range`] by precedence.)
    SqrefList(SqrefList),
    /// Literal scalar value: number, boolean, quoted text, or error token.
    Constant(CellValue),
    /// Anything else — a formula or any input the ref-shaped classifiers
    /// rejected. Preserves original bytes via [`FormulaSource`] for writer
    /// fidelity.
    Formula(FormulaSource),
}

impl ParsedExpr {
    /// Total classification of an arbitrary UTF-8 string.
    ///
    /// See the module-level docs for the precedence order.
    #[must_use]
    pub fn classify(input: &str) -> Self {
        // 1. Empty / whitespace-only.
        if input.trim().is_empty() {
            return Self::Empty;
        }

        // 2. `#REF!` with optional sheet qualifier.
        if let Some(expr) = classify_broken_ref(input) {
            return expr;
        }

        // 3. A1 cell reference (bare or sheet-qualified).
        //    Sheet-qualified shapes like `Sheet1!$F$10` or `'My Sheet'!$A$1`
        //    peel the sheet prefix and re-run parse_a1_cell on the remainder.
        //    This keeps the `Cell` variant a single-grammar discriminator for
        //    the `xxx_input_ref` style fields that the OOXML spec defines as
        //    single-cell references regardless of sheet qualification.
        if let Some(node) = parse_a1_cell(input) {
            return Self::Cell(node);
        }
        if let Some(node) = parse_sheet_qualified_cell(input) {
            return Self::Cell(node);
        }

        // 4. A1 range reference.
        if let Some(r) = parse_a1_range(input) {
            return Self::Range(r);
        }

        // 5. sqref list (multi-token; a single token was already handled above).
        if input.split_whitespace().count() >= 2
            && let Some(list) = SqrefList::parse(input)
        {
            return Self::SqrefList(list);
        }

        // 6. Literal scalar.
        if let Some(v) = try_parse_constant_literal(input) {
            return Self::Constant(v);
        }

        // 7. Fall through to formula source — tolerates parser error recovery.
        Self::Formula(FormulaSource::parse(input))
    }

    /// Materialize an empty [`IdentityFormula`] shell suitable for writing a
    /// `NamedRangeDef` that does not carry concrete identity refs.
    ///
    /// Helper for the `NamedRangeDef.refers_to` to `ParsedExpr` path. The
    /// current implementation stores `ParsedExpr` as a classifier of the source
    /// string (driving the in-engine [`Self::classify`] dispatch at the
    /// `resolve_named_range_def` fallback sites) rather than as the on-disk
    /// identity-formula shape, so the returned shell is purely the "empty
    /// template with no refs" placeholder that existing writers produce for
    /// constants / formulas / broken refs. Identity-ref shapes
    /// (`ParsedExpr::Cell`, `Range`, `SqrefList`) are positional — they
    /// carry no `CellId`s at parse time — so materializing a `CellId`-bearing
    /// `IdentityFormula` from them requires the live mirror and cannot
    /// happen here.
    ///
    /// Volatility / dynamic-array flags are not inferred: this helper is a
    /// container builder, not a semantic analyzer. Callers that need those
    /// flags should route through [`crate::to_identity_formula`] (the string-
    /// entry resolver) or compute them alongside the identity-ref resolve
    /// step.
    ///
    /// Provided as a public API; not currently load-bearing inside
    /// `compute-core`.
    #[must_use]
    pub fn to_identity_formula(&self) -> IdentityFormula {
        IdentityFormula {
            template: String::new(),
            refs: Vec::new(),
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        }
    }

    /// Canonical A1 re-emission.
    ///
    /// - `Empty`: `""`
    /// - `BrokenRef` without sheet: `#REF!`
    /// - `BrokenRef` with sheet: `<sheet>!#REF!` (sheet quoted when needed)
    /// - `Cell` / `Range` / `SqrefList`: delegated to each type's
    ///   `to_a1_string` method.
    /// - `Constant`: textual form of the literal scalar.
    /// - `Formula`: [`FormulaSource::original`] (verbatim).
    #[must_use]
    pub fn to_a1_string(&self) -> Cow<'_, str> {
        match self {
            Self::Empty => Cow::Borrowed(""),
            Self::BrokenRef { sheet: None } => Cow::Borrowed("#REF!"),
            Self::BrokenRef { sheet: Some(name) } => {
                Cow::Owned(format!("{}!#REF!", quote_sheet_if_needed(name.as_str())))
            }
            Self::Cell(node) => Cow::Owned(node.to_a1_string()),
            Self::Range(r) => Cow::Owned(r.to_a1_string()),
            Self::SqrefList(list) => Cow::Owned(list.to_a1_string()),
            Self::Constant(v) => Cow::Owned(constant_to_a1(v)),
            Self::Formula(fs) => Cow::Borrowed(fs.original.as_str()),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical serializers on CellRefNode / RangeRef.
//
// (Rust orphan rule: inherent methods must live in the defining crate; both
// types are defined here in `compute-parser`, so the impls are co-located
// with the types they serialize.)
// ─────────────────────────────────────────────────────────────────────────────

impl CellRefNode {
    /// Canonical A1 form — upper-case column letters, `$` markers per the
    /// carried `abs_row`/`abs_col` flags.
    ///
    /// For [`CellRef::Positional`], emits the full A1 notation. For
    /// [`CellRef::Resolved`] (where row/col aren't carried), emits `#REF!` —
    /// this path is not reachable from [`ParsedExpr::classify`] (which parses
    /// without a resolver, so every ref is positional) but is provided for
    /// completeness.
    #[must_use]
    pub fn to_a1_string(&self) -> String {
        match &self.reference {
            CellRef::Positional { row, col, .. } => {
                format_positional_cell(*row, *col, self.abs_row, self.abs_col)
            }
            CellRef::Resolved(_) => "#REF!".to_string(),
        }
    }
}

impl RangeRef {
    /// Canonical A1 form. Dispatches by [`RangeType`]:
    ///
    /// - `CellRange`: `A1:B10` (or `$A$1:$B$10` etc per abs flags). When the
    ///   range is a degenerate 1×1 (start == end with matching abs flags), the
    ///   abbreviated single-cell form `A1` is emitted — this matches the XLSX
    ///   sqref convention where `A1` and `A1:A1` are equivalent and the
    ///   short form is canonical. Round-trip is preserved because
    ///   [`crate::a1_entry::parse_a1_range`] promotes a bare cell ref back to
    ///   a 1×1 `CellRange`.
    /// - `ColumnRange`: `A:C`
    /// - `RowRange`: `1:5`
    #[must_use]
    pub fn to_a1_string(&self) -> String {
        match self.range_type {
            RangeType::CellRange => match (&self.start, &self.end) {
                (
                    CellRef::Positional {
                        row: sr, col: sc, ..
                    },
                    CellRef::Positional {
                        row: er, col: ec, ..
                    },
                ) => {
                    let start =
                        format_positional_cell(*sr, *sc, self.abs_start.row, self.abs_start.col);
                    if sr == er
                        && sc == ec
                        && self.abs_start.row == self.abs_end.row
                        && self.abs_start.col == self.abs_end.col
                    {
                        // Degenerate 1×1 — emit the abbreviated single-cell form.
                        return start;
                    }
                    let end = format_positional_cell(*er, *ec, self.abs_end.row, self.abs_end.col);
                    format!("{start}:{end}")
                }
                _ => "#REF!:#REF!".to_string(),
            },
            RangeType::ColumnRange => match (&self.start, &self.end) {
                (CellRef::Positional { col: sc, .. }, CellRef::Positional { col: ec, .. }) => {
                    let mut out = String::new();
                    if self.abs_start.col {
                        out.push('$');
                    }
                    out.push_str(&col_to_letter(*sc));
                    out.push(':');
                    if self.abs_end.col {
                        out.push('$');
                    }
                    out.push_str(&col_to_letter(*ec));
                    out
                }
                _ => "#REF!:#REF!".to_string(),
            },
            RangeType::RowRange => match (&self.start, &self.end) {
                (CellRef::Positional { row: sr, .. }, CellRef::Positional { row: er, .. }) => {
                    let mut out = String::new();
                    if self.abs_start.row {
                        out.push('$');
                    }
                    out.push_str(&(sr + 1).to_string());
                    out.push(':');
                    if self.abs_end.row {
                        out.push('$');
                    }
                    out.push_str(&(er + 1).to_string());
                    out
                }
                _ => "#REF!:#REF!".to_string(),
            },
            _ => "#REF!".to_string(),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers.
// ─────────────────────────────────────────────────────────────────────────────

fn format_positional_cell(row: u32, col: u32, abs_row: bool, abs_col: bool) -> String {
    let mut out = String::new();
    if abs_col {
        out.push('$');
    }
    out.push_str(&col_to_letter(col));
    if abs_row {
        out.push('$');
    }
    out.push_str(&(row + 1).to_string());
    out
}

/// Sheet-name quoting consistent with [`crate::ast::needs_quoting`].
fn quote_sheet_if_needed(name: &str) -> Cow<'_, str> {
    if crate::ast::needs_quoting(name) {
        Cow::Owned(format!("'{}'", name.replace('\'', "''")))
    } else {
        Cow::Borrowed(name)
    }
}

/// Peel a `Sheet!` or `'Quoted Sheet'!` prefix, then re-classify the remainder
/// as a bare A1 cell. Returns `None` when the input has no sheet prefix or
/// when the post-prefix remainder is not a single cell reference.
///
/// Used only by [`ParsedExpr::classify`] to keep `ParsedExpr::Cell` a
/// single-grammar discriminator that includes sheet-qualified single-cell
/// refs. Typed formula boundary: needs this for `DataTableEntry::row_input_ref` /
/// `col_input_ref` which are stored as `Sheet1!$A$1`-shaped strings.
fn parse_sheet_qualified_cell(input: &str) -> Option<CellRefNode> {
    let trimmed = input.trim();
    let stripped = trimmed.strip_prefix('=').unwrap_or(trimmed);
    let (sheet, rest) = split_sheet_prefix(stripped);
    sheet?; // require a non-None sheet prefix
    parse_a1_cell(rest)
}

/// Classify inputs of the shape `#REF!`, `=#REF!`, or (optional `=`)
/// `Sheet!#REF!`.
///
/// Returns `None` if the input is not one of those shapes — the caller falls
/// through to later classification steps.
///
/// The leading `=` is optional: XLSX `DefinedName.refers_to` is stored without
/// it per the OOXML spec, but some producers emit it defensively. Treating
/// `=#REF!` and `#REF!` as the same `BrokenRef` matches Excel's semantics and
/// the contract of the (now-deleted) `is_ref_error_only` predicate this
/// function replaced in typed formula boundary
fn classify_broken_ref(input: &str) -> Option<ParsedExpr> {
    let trimmed = input.trim();
    // Strip optional leading `=` so `=#REF!` and `#REF!` classify identically.
    let stripped = trimmed.strip_prefix('=').unwrap_or(trimmed);
    if stripped.eq_ignore_ascii_case("#REF!") {
        return Some(ParsedExpr::BrokenRef { sheet: None });
    }
    // Sheet-qualified: split on first `!` respecting '-quoted sheet names.
    let (sheet, rest) = split_sheet_prefix(stripped);
    let sheet_name = sheet?;
    if !rest.eq_ignore_ascii_case("#REF!") {
        return None;
    }
    Some(ParsedExpr::BrokenRef {
        sheet: Some(SheetName::from(sheet_name)),
    })
}

/// Try to interpret `input` as a literal scalar — number, bool, quoted text,
/// or error token. Returns `None` if the shape isn't literal-like.
fn try_parse_constant_literal(input: &str) -> Option<CellValue> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Error token.
    if let Some(err) = CellError::parse_error_str(trimmed) {
        return Some(CellValue::from(err));
    }

    // Boolean.
    if trimmed.eq_ignore_ascii_case("TRUE") {
        return Some(CellValue::Boolean(true));
    }
    if trimmed.eq_ignore_ascii_case("FALSE") {
        return Some(CellValue::Boolean(false));
    }

    // Quoted text: `"..."` with `""` as escape for interior quote.
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        // starts_with('"') + ends_with('"') guarantee both edges are
        // single-byte ASCII '"'; `[1..len-1]` is at char boundaries.
        #[allow(clippy::string_slice)]
        let inner = &trimmed[1..trimmed.len() - 1];
        // Ensure no unescaped interior `"` — a bare `"` in the middle means
        // it's not a well-formed literal.
        let unescaped = inner.replace("\"\"", "\"");
        // Round-trip check: the unescaped form must contain no raw `"` that
        // wasn't paired in the original. `replace` is idempotent for balanced
        // pairs — a simpler check is to count `"` in `inner` and require it
        // to be even.
        if inner.bytes().filter(|&b| b == b'"').count() % 2 == 0 {
            return Some(CellValue::from(unescaped));
        }
        return None;
    }

    // Number (finite).
    if let Ok(n) = trimmed.parse::<f64>()
        && n.is_finite()
    {
        return Some(CellValue::Number(FiniteF64::must(n)));
    }

    None
}

/// Emit a [`CellValue`] as a formula-style literal. Used by
/// [`ParsedExpr::to_a1_string`] for the `Constant` variant.
fn constant_to_a1(v: &CellValue) -> String {
    match v {
        CellValue::Boolean(true) => "TRUE".to_string(),
        CellValue::Boolean(false) => "FALSE".to_string(),
        CellValue::Number(n) => {
            let f = **n;
            #[allow(clippy::float_cmp)]
            // Exact integer display check is intentional for parsed constants.
            if f == f.trunc() && f.abs() < 1e15 {
                #[allow(clippy::cast_possible_truncation)]
                {
                    (f as i64).to_string()
                }
            } else {
                format!("{f}")
            }
        }
        CellValue::Text(s) => format!("\"{}\"", s.replace('"', "\"\"")),
        CellValue::Error(e, _) => e.as_str().to_string(),
        // Not produced by `try_parse_constant_literal`; defensive fallback.
        CellValue::Null | CellValue::Array(_) | CellValue::Control(_) | CellValue::Image(_) => {
            String::new()
        }
    }
}

// Suppress dead-code for the re-exported `TypedRangeRef`; for now we use
// `crate::ast::RangeRef` which carries absoluteness flags (not stored on the
// identity `RangeRef`).
#[allow(dead_code)]
fn _typed_range_ref_marker() -> Option<TypedRangeRef> {
    None
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests (unit — proptests live in `parsed_expr_proptests.rs`).
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::SheetId;

    #[test]
    fn classify_empty() {
        assert_eq!(ParsedExpr::classify(""), ParsedExpr::Empty);
        assert_eq!(ParsedExpr::classify("   "), ParsedExpr::Empty);
        assert_eq!(ParsedExpr::classify("\t\n"), ParsedExpr::Empty);
    }

    #[test]
    fn classify_broken_ref_bare() {
        assert_eq!(
            ParsedExpr::classify("#REF!"),
            ParsedExpr::BrokenRef { sheet: None }
        );
        assert_eq!(
            ParsedExpr::classify("#ref!"),
            ParsedExpr::BrokenRef { sheet: None }
        );
    }

    #[test]
    fn classify_broken_ref_sheet_qualified() {
        match ParsedExpr::classify("Sheet1!#REF!") {
            ParsedExpr::BrokenRef { sheet: Some(name) } => assert_eq!(name.as_str(), "Sheet1"),
            other => panic!("expected BrokenRef with sheet, got {other:?}"),
        }
        match ParsedExpr::classify("'Deleted Sheet'!#REF!") {
            ParsedExpr::BrokenRef { sheet: Some(name) } => {
                assert_eq!(name.as_str(), "Deleted Sheet");
            }
            other => panic!("expected BrokenRef with quoted sheet, got {other:?}"),
        }
    }

    #[test]
    fn classify_cell() {
        match ParsedExpr::classify("A1") {
            ParsedExpr::Cell(node) => {
                assert!(!node.abs_row);
                assert!(!node.abs_col);
            }
            other => panic!("expected Cell, got {other:?}"),
        }
        match ParsedExpr::classify("$B$5") {
            ParsedExpr::Cell(node) => {
                assert!(node.abs_row);
                assert!(node.abs_col);
            }
            other => panic!("expected Cell, got {other:?}"),
        }
    }

    #[test]
    fn classify_range() {
        match ParsedExpr::classify("A1:C5") {
            ParsedExpr::Range(r) => assert_eq!(r.range_type, RangeType::CellRange),
            other => panic!("expected Range, got {other:?}"),
        }
        match ParsedExpr::classify("A:C") {
            ParsedExpr::Range(r) => assert_eq!(r.range_type, RangeType::ColumnRange),
            other => panic!("expected Range column, got {other:?}"),
        }
    }

    #[test]
    fn classify_sqref_list() {
        match ParsedExpr::classify("A1 B2:C3 D4") {
            ParsedExpr::SqrefList(list) => assert_eq!(list.len(), 3),
            other => panic!("expected SqrefList, got {other:?}"),
        }
    }

    #[test]
    fn classify_constant_number() {
        match ParsedExpr::classify("42") {
            ParsedExpr::Constant(CellValue::Number(n)) => assert!((*n - 42.0).abs() < f64::EPSILON),
            other => panic!("expected Constant(Number), got {other:?}"),
        }
    }

    #[test]
    fn classify_constant_boolean() {
        assert_eq!(
            ParsedExpr::classify("TRUE"),
            ParsedExpr::Constant(CellValue::Boolean(true))
        );
        assert_eq!(
            ParsedExpr::classify("false"),
            ParsedExpr::Constant(CellValue::Boolean(false))
        );
    }

    #[test]
    fn classify_constant_text() {
        match ParsedExpr::classify("\"hello\"") {
            ParsedExpr::Constant(v) => assert_eq!(v.as_text(), Some("hello")),
            other => panic!("expected Constant(Text), got {other:?}"),
        }
    }

    /// W4.a discovery test: confirm that an XLSX `type="list"` `formula1`
    /// payload (a comma-separated quoted literal) tokenizes as a single
    /// [`ParsedExpr::Constant`] with the comma-list preserved verbatim
    /// inside the [`CellValue::Text`] payload.
    ///
    /// Outcome: NO new `ParsedExpr::ValueList` variant is needed — the
    /// existing `Constant(Text)` variant is sufficient. The comma-split
    /// happens at the domain layer (the consumer knows the validation is
    /// `type="list"`), not at the classifier.
    #[test]
    fn classify_data_validation_list_formula() {
        match ParsedExpr::classify("\"Yes,No,Maybe\"") {
            ParsedExpr::Constant(v) => assert_eq!(v.as_text(), Some("Yes,No,Maybe")),
            other => panic!("expected Constant(Text) for list formula, got {other:?}"),
        }
        match ParsedExpr::classify("\"Option1,Option2,Option3\"") {
            ParsedExpr::Constant(v) => assert_eq!(v.as_text(), Some("Option1,Option2,Option3")),
            other => panic!("expected Constant(Text) for list formula, got {other:?}"),
        }
        // Single-item list is also a Constant(Text).
        match ParsedExpr::classify("\"Yes\"") {
            ParsedExpr::Constant(v) => assert_eq!(v.as_text(), Some("Yes")),
            other => panic!("expected Constant(Text) for single-item list, got {other:?}"),
        }
        // Range-shaped list source (`type="list"` can also point at a range)
        // classifies as Range — the writer just emits whatever is held.
        match ParsedExpr::classify("$J$1:$J$5") {
            ParsedExpr::Range(_) => {}
            other => panic!("expected Range for range-shaped list source, got {other:?}"),
        }
    }

    #[test]
    fn classify_constant_error() {
        match ParsedExpr::classify("#DIV/0!") {
            ParsedExpr::Constant(v) => assert_eq!(v.as_error(), Some(CellError::Div0)),
            other => panic!("expected Constant(Error), got {other:?}"),
        }
    }

    #[test]
    fn classify_formula() {
        match ParsedExpr::classify("=A1+B1") {
            ParsedExpr::Formula(fs) => assert_eq!(fs.original, "=A1+B1"),
            other => panic!("expected Formula, got {other:?}"),
        }
    }

    #[test]
    fn classify_unparseable_goes_to_formula_with_error_ast() {
        // Malformed → FormulaSource with error-recovery AST. Bytes preserved.
        let fs = match ParsedExpr::classify("=((()") {
            ParsedExpr::Formula(fs) => fs,
            other => panic!("expected Formula, got {other:?}"),
        };
        assert_eq!(fs.original, "=((()");
    }

    #[test]
    fn formula_source_parse_preserves_bytes() {
        let fs = FormulaSource::parse("=SUM(A1:B2)");
        assert_eq!(fs.original, "=SUM(A1:B2)");

        let fs = FormulaSource::parse("arbitrary  whitespace  ");
        assert_eq!(fs.original, "arbitrary  whitespace  ");
    }

    #[test]
    fn formula_source_parse_on_malformed_is_error_ast() {
        let fs = FormulaSource::parse("=((");
        assert_eq!(fs.original, "=((");
        assert!(matches!(fs.ast, ASTNode::Error(_)));
    }

    #[test]
    fn sqref_list_parse_and_back() {
        let list = SqrefList::parse("A1 B2:C3").unwrap();
        assert_eq!(list.len(), 2);
        let s = list.to_a1_string();
        let list2 = SqrefList::parse(&s).unwrap();
        assert_eq!(list, list2);
    }

    #[test]
    fn sqref_list_emits_single_cell_without_redundant_tail() {
        // typed sqref boundary: sqref-specific fidelity rule. A 1×1 range must emit
        // as the degenerate cell form (`A1`, not `A1:A1`) to match Excel's
        // sqref-attribute convention and preserve writer byte-identity for
        // CF / data-validation round-trip.
        let list = SqrefList::parse("A1").unwrap();
        assert_eq!(list.to_a1_string(), "A1");

        // Both inputs parse to the same typed structure — semantic round-trip
        // is unaffected by the emitter elision.
        let list_expanded = SqrefList::parse("A1:A1").unwrap();
        assert_eq!(list, list_expanded);
        assert_eq!(list_expanded.to_a1_string(), "A1");

        // Mixed list with one 1×1 and one genuine range.
        let list = SqrefList::parse("A1 B2:C3").unwrap();
        assert_eq!(list.to_a1_string(), "A1 B2:C3");

        // `parse_a1_range` promotes a bare cell reference by dropping its
        // absoluteness bits (`RangeRef::new` zeroes `abs_start`/`abs_end`).
        // For sqref emission that means `$B$5` → `B5` on round-trip. The
        // `$` drop is a pre-existing limitation of the cell-to-range
        // promotion, not introduced by W4.e. XLSX sqref attributes don't
        // customarily carry `$` (the container element provides the range
        // semantics), so this is benign on the CF / data-validation paths.
        let list = SqrefList::parse("$B$5").unwrap();
        assert_eq!(list.to_a1_string(), "B5");
    }

    #[test]
    fn sqref_list_parse_rejects_empty() {
        assert!(SqrefList::parse("").is_none());
        assert!(SqrefList::parse("   ").is_none());
    }

    #[test]
    fn cell_ref_node_to_a1_string_positional() {
        let node = parse_a1_cell("$B$5").unwrap();
        assert_eq!(node.to_a1_string(), "$B$5");
    }

    #[test]
    fn cell_ref_node_to_a1_string_canonical_upper() {
        let node = parse_a1_cell("ab100").unwrap();
        // Canonical form uppercases the column letters.
        assert_eq!(node.to_a1_string(), "AB100");
    }

    #[test]
    fn range_ref_to_a1_string_cell_range() {
        let r = parse_a1_range("$A$1:$C$5").unwrap();
        assert_eq!(r.to_a1_string(), "$A$1:$C$5");
    }

    #[test]
    fn range_ref_to_a1_string_column_range() {
        let r = parse_a1_range("A:C").unwrap();
        assert_eq!(r.to_a1_string(), "A:C");
    }

    #[test]
    fn range_ref_to_a1_string_row_range() {
        let r = parse_a1_range("2:7").unwrap();
        assert_eq!(r.to_a1_string(), "2:7");
    }

    #[test]
    fn range_ref_to_a1_string_resolved_fallback_is_ref_error() {
        use crate::ast::AbsFlags;
        use cell_types::CellId;
        let r = RangeRef {
            start: CellRef::Resolved(CellId::from_raw(1)),
            end: CellRef::Resolved(CellId::from_raw(2)),
            abs_start: AbsFlags::default(),
            abs_end: AbsFlags::default(),
            range_type: RangeType::CellRange,
        };
        // Canonical form for Resolved-without-position is defensive — we
        // never produce this from classify(), but the fallback is explicit.
        assert_eq!(r.to_a1_string(), "#REF!:#REF!");
    }

    #[test]
    fn parsed_expr_to_a1_string_empty() {
        assert_eq!(ParsedExpr::Empty.to_a1_string(), "");
    }

    #[test]
    fn parsed_expr_to_a1_string_broken_ref() {
        assert_eq!(
            ParsedExpr::BrokenRef { sheet: None }.to_a1_string(),
            "#REF!"
        );
        assert_eq!(
            ParsedExpr::BrokenRef {
                sheet: Some(SheetName::from("Sheet1"))
            }
            .to_a1_string(),
            "Sheet1!#REF!"
        );
        assert_eq!(
            ParsedExpr::BrokenRef {
                sheet: Some(SheetName::from("My Sheet"))
            }
            .to_a1_string(),
            "'My Sheet'!#REF!"
        );
    }

    #[test]
    fn parsed_expr_to_a1_string_constant() {
        assert_eq!(
            ParsedExpr::Constant(CellValue::from(42.0)).to_a1_string(),
            "42"
        );
        assert_eq!(
            ParsedExpr::Constant(CellValue::Boolean(true)).to_a1_string(),
            "TRUE"
        );
        assert_eq!(
            ParsedExpr::Constant(CellValue::from("hi")).to_a1_string(),
            "\"hi\""
        );
    }

    #[test]
    fn parsed_expr_to_a1_string_formula_returns_original() {
        let expr = ParsedExpr::classify("=SUM(A1:B2)");
        match &expr {
            ParsedExpr::Formula(_) => {}
            _ => panic!("expected formula variant"),
        }
        assert_eq!(&*expr.to_a1_string(), "=SUM(A1:B2)");
    }

    #[test]
    fn classify_round_trip_cell_semantic() {
        let a = ParsedExpr::classify("$A$1");
        let s = a.to_a1_string();
        let b = ParsedExpr::classify(&s);
        assert_eq!(a, b);
    }

    #[test]
    fn classify_round_trip_range_semantic() {
        let a = ParsedExpr::classify("A1:B10");
        let s = a.to_a1_string();
        let b = ParsedExpr::classify(&s);
        assert_eq!(a, b);
    }

    #[test]
    fn classify_round_trip_sqref_semantic() {
        let a = ParsedExpr::classify("A1 B2:C3 D4");
        let s = a.to_a1_string();
        let b = ParsedExpr::classify(&s);
        assert_eq!(a, b);
    }

    #[test]
    fn classify_round_trip_broken_ref_semantic() {
        let a = ParsedExpr::classify("'My Sheet'!#REF!");
        let s = a.to_a1_string();
        let b = ParsedExpr::classify(&s);
        assert_eq!(a, b);
    }

    #[test]
    fn sheet_name_basic() {
        let n = SheetName::from("Sheet1");
        assert_eq!(n.as_str(), "Sheet1");
        let n2 = SheetName::from(String::from("Sheet2"));
        assert_eq!(n2.as_str(), "Sheet2");
    }

    // ── Typed formula boundary: sanitize-module regression tests ───────────────
    //
    // Ported verbatim from `compute/core/src/import/sanitize.rs` (deleted in
    // W3). Each assertion maps the previous boolean `is_ref_error_only`
    // semantics onto the stronger `ParsedExpr::classify` umbrella: an input
    // previously classified as "ref-error-only" now lands in
    // `ParsedExpr::BrokenRef { .. }` or `ParsedExpr::Empty`.

    /// Matches the previous `is_ref_error_only` contract: `#REF!`-only and
    /// empty inputs are orphaned refs.
    fn is_orphan_ref(s: &str) -> bool {
        matches!(
            ParsedExpr::classify(s),
            ParsedExpr::BrokenRef { .. } | ParsedExpr::Empty
        )
    }

    #[test]
    fn sanitize_regression_ref_error_only_pure_ref() {
        // Pure #REF! (bare)
        assert!(is_orphan_ref("#REF!"));
        assert!(is_orphan_ref("=#REF!"));
        assert!(is_orphan_ref(" #REF! "));
        assert!(is_orphan_ref(" =#REF! "));
    }

    #[test]
    fn sanitize_regression_ref_error_only_sheet_qualified() {
        // Sheet-qualified #REF! (broken cell ref on a specific sheet)
        assert!(is_orphan_ref("Sheet1!#REF!"));
        assert!(is_orphan_ref("=Sheet1!#REF!"));
        assert!(is_orphan_ref("'Bond-Refinancing'!#REF!"));
        assert!(is_orphan_ref("='Bond-Refinancing'!#REF!"));
    }

    #[test]
    fn sanitize_regression_ref_error_only_expressions_with_refs() {
        // Expressions with #REF! have partial semantic value — NOT orphan.
        // (These classify as `ParsedExpr::Formula`, not `BrokenRef`.)
        assert!(!is_orphan_ref("=#REF!+1"));
        assert!(!is_orphan_ref("=Sheet1!#REF!+A1"));
    }

    #[test]
    fn sanitize_regression_ref_error_only_valid_refs_and_constants() {
        // Valid references and constants are not orphans.
        assert!(!is_orphan_ref("=42"));
        assert!(!is_orphan_ref("='Sheet1'!$A$1"));
    }

    #[test]
    fn sanitize_regression_ref_error_only_empty_is_orphan() {
        // Empty classifies as `ParsedExpr::Empty`, which the orphan filter
        // catches. (The old `is_ref_error_only` returned `false` for empty;
        // callers treated empty as "skip" anyway because the name had no
        // target. The typed replacement unifies both cases.)
        assert!(is_orphan_ref(""));
    }

    #[test]
    fn sanitize_regression_utf8_boundary_no_panic() {
        // Regression: inputs whose last six bytes straddle a multi-byte
        // UTF-8 char must not panic (UTF-8 boundary Greek OFFSET class).
        assert!(!is_orphan_ref(
            "OFFSET(Πλήρης_Εκτύπωση,0,0,'Input -1'!Τελευταία_γραμμή)"
        ));
        assert!(!is_orphan_ref("=Sheet1!γραμμή"));
        assert!(!is_orphan_ref("μμμμμμ"));
    }

    #[test]
    fn sanitize_regression_non_ascii_sheet_name_broken_ref() {
        // Non-ASCII sheet name with a valid #REF! suffix still detected.
        assert!(is_orphan_ref("'Πίνακας'!#REF!"));
        assert!(is_orphan_ref("='Πίνακας'!#REF!"));
    }

    #[test]
    fn sanitize_regression_is_ref_error_only_never_panics_samples() {
        // The UTF-8 boundary production panic was on a narrow UTF-8 byte-boundary
        // slice — byte length N where N straddled a multi-byte char. This
        // sweep asserts totality on the same inputs the old function's
        // `never_panics_on_arbitrary_input` test used.
        let samples = [
            "",
            "!",
            "#",
            "!#",
            "!#R",
            "!#RE",
            "!#REF",
            "!#REF!",
            "μ",
            "μμ",
            "μμμ",
            "μμμμ",
            "μμμμμ",
            "μμμμμμ",
            "μμμμμμμ",
            "=μ",
            "=μμμμμμ",
            "a!μμμμμ",
            "a!#μREF",
            "a!#RμF!",
            "a!#REFμ",
            "💥",
            "💥!#REF!",
            "'a'!#REF!💥",
            "A!#REF!",
        ];
        for s in samples {
            let _ = ParsedExpr::classify(s);
        }
    }

    #[test]
    fn sanitize_regression_broken_cell_ref_semantics() {
        // Ported from `test_is_broken_cell_ref` in the deleted sanitize.rs.
        // The typed replacement in `data_table_lowering` matches on
        // `ParsedExpr::Cell(_)` (inclusive: only valid cell refs pass);
        // everything else (including `#REF!` shapes) is rejected.
        assert!(matches!(ParsedExpr::classify("$A$1"), ParsedExpr::Cell(_)));
        assert!(matches!(
            ParsedExpr::classify("Sheet1!$F$10"),
            ParsedExpr::Cell(_)
        ));
        assert!(matches!(
            ParsedExpr::classify("#REF!"),
            ParsedExpr::BrokenRef { .. }
        ));
        assert!(matches!(
            ParsedExpr::classify("Sheet1!#REF!"),
            ParsedExpr::BrokenRef { .. }
        ));
    }

    #[test]
    fn classify_is_total_on_sample_inputs() {
        // Totality: representative samples never panic. (Proptest lives
        // separately for broader UTF-8 coverage.)
        for s in [
            "",
            " ",
            "A1",
            "A1:B10",
            "#REF!",
            "Sheet1!#REF!",
            "=1+1",
            "hello world",
            "\"quoted\"",
            "TRUE",
            "3.14",
            "",                    // double empty for good measure
            "Πλήρης_Εκτύπωση",     // Greek
            "μμμμμμ",              // Greek repeated
            "=OFFSET(Πλήρης,0,0)", // Greek in formula
        ] {
            let _ = ParsedExpr::classify(s);
        }
        // Suppress unused import if SheetId isn't touched.
        let _ = SheetId::from_raw(0);
    }

    // ── Proptests ──────────────────────────────────────────────────────
    //
    // Typed umbrella ship criteria:
    //   - classify never panics on arbitrary UTF-8
    //   - SqrefList::parse never panics on arbitrary UTF-8
    //   - semantic round-trip: classify(to_a1_string(classify(s))) == classify(s)
    //     for ref-shaped inputs (Cell / Range / SqrefList / BrokenRef / Empty)
    //   - byte round-trip for formulas: FormulaSource::parse(s).original == s

    use proptest::prelude::*;

    proptest! {
        /// Totality: `ParsedExpr::classify` never panics on any UTF-8 string.
        #[test]
        fn proptest_classify_never_panics(s in any::<String>()) {
            let _ = ParsedExpr::classify(&s);
        }

        /// Totality: `SqrefList::parse` never panics on any UTF-8 string.
        #[test]
        fn proptest_sqref_list_parse_never_panics(s in any::<String>()) {
            let _ = SqrefList::parse(&s);
        }

        /// Semantic round-trip: classify→serialize→classify is idempotent for
        /// ref-shaped inputs (Cell / Range / SqrefList / BrokenRef / Empty).
        ///
        /// `Constant` and `Formula` are intentionally skipped — their
        /// round-trip properties are tested separately (byte-preservation
        /// for `Formula`, unit tests for `Constant` canonicalization).
        #[test]
        fn proptest_classify_round_trip_ref_shaped(s in any::<String>()) {
            let a = ParsedExpr::classify(&s);
            let skip = matches!(a, ParsedExpr::Constant(_) | ParsedExpr::Formula(_));
            if !skip {
                let serialized = a.to_a1_string();
                let b = ParsedExpr::classify(&serialized);
                prop_assert_eq!(a, b);
            }
        }

        /// Byte round-trip: `FormulaSource::parse(s).original == s` for any
        /// UTF-8 `s`. Load-bearing for writer fidelity — XLSX serializers
        /// emit `original` verbatim, so the classifier must never lose bytes.
        #[test]
        fn proptest_formula_source_byte_round_trip(s in any::<String>()) {
            let fs = FormulaSource::parse(&s);
            prop_assert_eq!(fs.original, s);
        }
    }
}
