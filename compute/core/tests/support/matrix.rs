//! Test-matrix scaffolding for Classes I–III.
//!
//! Stage 1 seeds the axis enums and the Cartesian combiner. Variants are
//! intentionally thin (3–5 each) — Stage 2 and beyond expand them and
//! wire them to the engine-level identity/bit-equality assertions. The
//! shape of [`TestCase`] and [`cartesian`] is the **stable** API; the
//! axis variants marked `/* stage-2+ */` are placeholders that later
//! agents will expand.
//!
//! Naming: follows the plan's convention
//! `identity__<shape>__<range>__<editpos>__<value>__<topology>__<seq>`.
//! Each axis emits a short snake_case label via its `as_slug()` method so
//! stable test names fall out of the cartesian product.

use std::fmt::Write;

// ---------------------------------------------------------------------
// Axes
// ---------------------------------------------------------------------

/// Graph topology between the edited cell and the dependent formula.
///
/// Stage 1 ships the four minimum-viable shapes named in the plan;
/// later stages will add `Deep` (26-level chain) and any topology a
/// new finding flushes out.
///
/// **Intentionally narrow.** The plan's axis 1 describes dependent
/// *formula* shapes (SUMIFS, VLOOKUP, etc.) — those live on the
/// sibling [`FormulaShape`] enum so that adding them doesn't break
/// `fixtures::workbook_with_topology`, which matches exhaustively on
/// `DependentShape`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DependentShape {
    /// Linear chain: A → B → C.
    Chain,
    /// Many inputs feed one dependent: (A, B, C) → D.
    FanIn,
    /// One input feeds many dependents: A → (B, C, D).
    FanOut,
    /// Two paths merge: A → B, A → C, (B, C) → D.
    Diamond,
    // TODO(stage-3): `Deep` (26-level A→Z chain). Plan axis 6.
}

impl DependentShape {
    #[must_use]
    pub const fn as_slug(self) -> &'static str {
        match self {
            DependentShape::Chain => "chain",
            DependentShape::FanIn => "fanin",
            DependentShape::FanOut => "fanout",
            DependentShape::Diamond => "diamond",
        }
    }

    #[must_use]
    pub const fn all() -> &'static [DependentShape] {
        &[
            DependentShape::Chain,
            DependentShape::FanIn,
            DependentShape::FanOut,
            DependentShape::Diamond,
        ]
    }
}

/// Stage-2 axis 1 — dependent *formula* shapes. ~30 variants per plan.
///
/// Kept separate from [`DependentShape`] so Stage 1's
/// `workbook_with_topology` match stays exhaustive and parallel agents
/// owning Classes II / III / V don't break when this axis grows.
///
/// Class I (`tests/iterative_recalc_identity.rs`) owns the formula-
/// template translation — no shared fixture builder yet wires these
/// up, since each shape needs a slightly different seed layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FormulaShape {
    /// `SUMIFS(sum_range, criteria_range, criteria)`.
    Sumifs,
    /// `SUMIF(range, criteria)` or `SUMIF(range, criteria, sum_range)`.
    Sumif,
    /// `COUNTIFS(criteria_range, criteria)`.
    Countifs,
    /// `COUNTIF(range, criteria)`.
    Countif,
    /// `AVERAGEIFS(avg_range, criteria_range, criteria)`.
    Averageifs,
    /// `AVERAGEIF(range, criteria)`.
    Averageif,
    /// `MINIFS(min_range, criteria_range, criteria)`.
    Minifs,
    /// `MAXIFS(max_range, criteria_range, criteria)`.
    Maxifs,
    /// `SUM(range)`.
    Sum,
    /// `SUMPRODUCT(range1, range2, ...)`.
    Sumproduct,
    /// `SUMSQ(range)`.
    Sumsq,
    /// `VLOOKUP(lookup, table, col_index, range_lookup)`.
    Vlookup,
    /// `HLOOKUP(lookup, table, row_index, range_lookup)`.
    Hlookup,
    /// `XLOOKUP(lookup, lookup_array, return_array)`.
    Xlookup,
    /// `INDEX(range, MATCH(lookup, lookup_range, 0))`.
    IndexMatch,
    /// `MATCH(lookup, lookup_range, match_type)`.
    Match,
    /// `XMATCH(lookup, lookup_range)`.
    Xmatch,
    /// `INDIRECT(address_string)`.
    Indirect,
    /// `OFFSET(anchor, rows, cols, height, width)`.
    Offset,
    /// `FILTER(range, predicate)`.
    Filter,
    /// `UNIQUE(range)`.
    Unique,
    /// `SORT(range)`.
    Sort,
    /// `SORTBY(range, by_range)`.
    Sortby,
    /// `CHOOSE(index, v1, v2, ...)`.
    Choose,
    /// `IF(condition_range, true_val, false_val)` — array-formula style.
    IfRange,
    /// `LET(name, value, body)` binding a range to a name.
    Let,
    /// `LAMBDA(param, body)(range)` applied to a range.
    Lambda,
    /// `MMULT(m1, m2)` — matrix product.
    Mmult,
    /// `TRANSPOSE(range)`.
    Transpose,
    /// Cross-sheet `SUM(Sheet1:Sheet3!range)` 3D reference.
    Sum3D,
}

impl FormulaShape {
    #[must_use]
    pub const fn as_slug(self) -> &'static str {
        match self {
            FormulaShape::Sumifs => "sumifs",
            FormulaShape::Sumif => "sumif",
            FormulaShape::Countifs => "countifs",
            FormulaShape::Countif => "countif",
            FormulaShape::Averageifs => "averageifs",
            FormulaShape::Averageif => "averageif",
            FormulaShape::Minifs => "minifs",
            FormulaShape::Maxifs => "maxifs",
            FormulaShape::Sum => "sum",
            FormulaShape::Sumproduct => "sumproduct",
            FormulaShape::Sumsq => "sumsq",
            FormulaShape::Vlookup => "vlookup",
            FormulaShape::Hlookup => "hlookup",
            FormulaShape::Xlookup => "xlookup",
            FormulaShape::IndexMatch => "indexmatch",
            FormulaShape::Match => "match",
            FormulaShape::Xmatch => "xmatch",
            FormulaShape::Indirect => "indirect",
            FormulaShape::Offset => "offset",
            FormulaShape::Filter => "filter",
            FormulaShape::Unique => "unique",
            FormulaShape::Sort => "sort",
            FormulaShape::Sortby => "sortby",
            FormulaShape::Choose => "choose",
            FormulaShape::IfRange => "ifrange",
            FormulaShape::Let => "let",
            FormulaShape::Lambda => "lambda",
            FormulaShape::Mmult => "mmult",
            FormulaShape::Transpose => "transpose",
            FormulaShape::Sum3D => "sum3d",
        }
    }

    /// Full Stage-2 formula-shape axis. 30 variants.
    #[must_use]
    pub const fn all() -> &'static [FormulaShape] {
        &[
            FormulaShape::Sumifs,
            FormulaShape::Sumif,
            FormulaShape::Countifs,
            FormulaShape::Countif,
            FormulaShape::Averageifs,
            FormulaShape::Averageif,
            FormulaShape::Minifs,
            FormulaShape::Maxifs,
            FormulaShape::Sum,
            FormulaShape::Sumproduct,
            FormulaShape::Sumsq,
            FormulaShape::Vlookup,
            FormulaShape::Hlookup,
            FormulaShape::Xlookup,
            FormulaShape::IndexMatch,
            FormulaShape::Match,
            FormulaShape::Xmatch,
            FormulaShape::Indirect,
            FormulaShape::Offset,
            FormulaShape::Filter,
            FormulaShape::Unique,
            FormulaShape::Sort,
            FormulaShape::Sortby,
            FormulaShape::Choose,
            FormulaShape::IfRange,
            FormulaShape::Let,
            FormulaShape::Lambda,
            FormulaShape::Mmult,
            FormulaShape::Transpose,
            FormulaShape::Sum3D,
        ]
    }
}

/// Shape of the range referenced by the dependent formula.
///
/// Stage 1 seeds the five most-implicated variants (closed, multi-col
/// closed, full-col, full-row, single-cell). The full named-range /
/// structured / 3D / indirect / offset axis values are placeholders
/// for Stage 2 — each expects engine-side fixture support that isn't
/// yet plumbed through `workbook_with_topology`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RangeType {
    /// `A1:A10` — closed single-column range.
    Closed,
    /// `A1:C10` — closed multi-column range.
    ClosedMultiCol,
    /// `A:A` — full-column range (one column).
    FullCol,
    /// `1:1` — full-row range (one row).
    FullRow,
    /// `A1` — single-cell "range".
    SingleCell,

    // -- Stage 2 additions (append-only) --------------------------------
    /// `A:C` — full-column range spanning multiple columns.
    FullColMulti,
    /// A workbook-scoped defined name. Resolution happens in the
    /// workbook's named-range table; fixture support is still pending,
    /// so the Class I runner skips these as `IncompatibleCombo`.
    NamedRange,
    /// `Table1[Col]` — structured table reference. Fixture support
    /// pending; skipped by the Class I runner for now.
    StructuredTable,
    /// `Sheet1:Sheet3!A1` — 3D reference across multiple sheets.
    /// Skipped by Class I runner — only meaningful paired with `Sum3D`
    /// or similar; otherwise the range type is incompatible.
    ThreeD,
    /// `INDIRECT("A:A")` — string that evaluates to a range.
    IndirectString,
}

impl RangeType {
    #[must_use]
    pub const fn as_slug(self) -> &'static str {
        match self {
            RangeType::Closed => "closed",
            RangeType::ClosedMultiCol => "closedmc",
            RangeType::FullCol => "fullcol",
            RangeType::FullRow => "fullrow",
            RangeType::SingleCell => "single",
            RangeType::FullColMulti => "fullcolmc",
            RangeType::NamedRange => "named",
            RangeType::StructuredTable => "structured",
            RangeType::ThreeD => "threed",
            RangeType::IndirectString => "indirectstr",
        }
    }

    /// Stage-1 subset preserved verbatim for existing callers.
    #[must_use]
    pub const fn all() -> &'static [RangeType] {
        &[
            RangeType::Closed,
            RangeType::ClosedMultiCol,
            RangeType::FullCol,
            RangeType::FullRow,
            RangeType::SingleCell,
        ]
    }

    /// Full Stage-2 range-type axis (plan axis 2). 10 variants.
    #[must_use]
    pub const fn all_stage2() -> &'static [RangeType] {
        &[
            RangeType::Closed,
            RangeType::ClosedMultiCol,
            RangeType::FullCol,
            RangeType::FullColMulti,
            RangeType::FullRow,
            RangeType::SingleCell,
            RangeType::NamedRange,
            RangeType::StructuredTable,
            RangeType::ThreeD,
            RangeType::IndirectString,
        ]
    }
}

/// Position of the edited cell relative to the referenced range.
///
/// Plan axis 3. The `FarOutside` variant stresses dynamic-extent invalidation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EditPosition {
    /// Inside the populated extent (row < last populated row).
    Inside,
    /// Outside the populated extent but within a small gap (e.g. +10 rows).
    OutsideNearby,
    /// Far outside the populated extent (row ≥ 50_000).
    FarOutside,
    /// At a range boundary (first or last cell).
    Boundary,
    /// In a different sheet.
    OtherSheet,
}

impl EditPosition {
    #[must_use]
    pub const fn as_slug(self) -> &'static str {
        match self {
            EditPosition::Inside => "inside",
            EditPosition::OutsideNearby => "outnear",
            EditPosition::FarOutside => "faroutside",
            EditPosition::Boundary => "boundary",
            EditPosition::OtherSheet => "othersheet",
        }
    }

    #[must_use]
    pub const fn all() -> &'static [EditPosition] {
        &[
            EditPosition::Inside,
            EditPosition::OutsideNearby,
            EditPosition::FarOutside,
            EditPosition::Boundary,
            EditPosition::OtherSheet,
        ]
    }
}

/// Typed value used as the op's "before" and "after" seeds.
///
/// Plan axis 4. Stage-2 Track-4b expands the axis from the stage-1
/// four-variant placeholder (Int / FloatCascade / Text / Error) to the
/// full 13-variant fanout.
///
/// The original four variants are preserved as-is (`Int`, `FloatCascade`,
/// `Error`, and a legacy `Text` alias kept append-only for existing
/// callers). The nine additions are:
///
/// - `LargeInt` — `1_000_000_000` (big-magnitude int seed).
/// - `FloatClean` — exact binary-representable float (`0.5`).
/// - `Bool` — Excel `TRUE` / `FALSE`.
/// - `TextShort` — short 3-char text (`"abc"`).
/// - `TextLong` — 256-char string.
/// - `LeadingApostrophe` — `CellValue::Text` whose payload begins with
///   `'` (Excel's literal-escape; engine should keep as text).
/// - `WhitespaceOnly` — `"   "` (3 spaces).
/// - `NullEmpty` — `CellValue::Null`.
/// - `DateSerial` — a number cell semantically a date (`45000.0`).
/// - `TimeSerial` — a number cell semantically a time of day (`0.5`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ValueType {
    /// Plain integer as f64 (e.g. `1`, `42`, `85`).
    Int,
    /// Float-cascade seed (`0.1`, `0.2`, `0.3`, `0.4`, `0.7`).
    FloatCascade,
    /// Short text. Stage-1 legacy alias; `TextShort` is the preferred
    /// Stage-2 variant but we keep this entry so the 4-ary `smoke_check`
    /// self-test stays valid (append-only rule).
    Text,
    /// Error (e.g. `#N/A`).
    Error,
    /// Large integer (`1_000_000_000`).
    LargeInt,
    /// Exact binary-representable float (`0.5`).
    FloatClean,
    /// Boolean (`TRUE` / `FALSE`). Defaults to `TRUE` in the fixture
    /// builder; the forward op pair flips to `FALSE`.
    Bool,
    /// Short 3-character text (`"abc"`).
    TextShort,
    /// 256-character text string.
    TextLong,
    /// Text whose payload begins with a literal apostrophe (`"'quoted"`).
    LeadingApostrophe,
    /// Whitespace-only text (`"   "`).
    WhitespaceOnly,
    /// `CellValue::Null`.
    NullEmpty,
    /// A number cell that would be formatted as a date (`45000.0`).
    DateSerial,
    /// A number cell that would be formatted as a time-of-day (`0.5`).
    TimeSerial,
}

impl ValueType {
    #[must_use]
    pub const fn as_slug(self) -> &'static str {
        match self {
            ValueType::Int => "int",
            ValueType::FloatCascade => "floatcascade",
            ValueType::Text => "text",
            ValueType::Error => "error",
            ValueType::LargeInt => "largeint",
            ValueType::FloatClean => "floatclean",
            ValueType::Bool => "bool",
            ValueType::TextShort => "textshort",
            ValueType::TextLong => "textlong",
            ValueType::LeadingApostrophe => "leadingapos",
            ValueType::WhitespaceOnly => "whitespace",
            ValueType::NullEmpty => "nullempty",
            ValueType::DateSerial => "dateserial",
            ValueType::TimeSerial => "timeserial",
        }
    }

    /// Stage-1 subset preserved verbatim for existing callers
    /// (`smoke_check`, Stage-1 references to `ValueType::all()`).
    #[must_use]
    pub const fn all() -> &'static [ValueType] {
        &[
            ValueType::Int,
            ValueType::FloatCascade,
            ValueType::Text,
            ValueType::Error,
        ]
    }

    /// Full Stage-2 (Track-4b) value-type axis. 13 variants.
    ///
    /// Keeps `Text` from the Stage-1 subset as a legacy-compatible
    /// alias and adds `TextShort` / `TextLong` / `LeadingApostrophe` /
    /// `WhitespaceOnly` / `NullEmpty` / `LargeInt` / `FloatClean` /
    /// `Bool` / `DateSerial` / `TimeSerial`.
    ///
    /// Stage-2 runners (Track-4b Class I, Track-4c Class II) iterate
    /// this slice. Older callers continue to iterate [`ValueType::all`].
    #[must_use]
    pub const fn all_stage2() -> &'static [ValueType] {
        &[
            ValueType::Int,
            ValueType::LargeInt,
            ValueType::FloatClean,
            ValueType::FloatCascade,
            ValueType::Bool,
            ValueType::TextShort,
            ValueType::TextLong,
            ValueType::LeadingApostrophe,
            ValueType::WhitespaceOnly,
            ValueType::NullEmpty,
            ValueType::Error,
            ValueType::DateSerial,
            ValueType::TimeSerial,
        ]
    }
}

// ---------------------------------------------------------------------
// TestCase
// ---------------------------------------------------------------------

/// One generated test scenario. The `inputs` tuple is intentionally
/// open-ended (any subset of axes). Stage 2+ assertion helpers read
/// only the axes they care about — callers slot in axes they need.
///
/// `name` is derived from the axis slugs so it remains stable across
/// runs and diffs cleanly when a new axis slot is added.
#[derive(Debug, Clone)]
pub struct TestCase<Inputs, Expected = ()> {
    pub name: String,
    pub inputs: Inputs,
    pub expected: Expected,
}

// ---------------------------------------------------------------------
// Cartesian combiner
// ---------------------------------------------------------------------

/// Enumerate all `(a, b, c, d)` tuples from four axis slices and emit a
/// `TestCase` per tuple. Stable name is `identity__a__b__c__d` where
/// each component is the axis slug.
///
/// The combiner is 4-ary because that covers the initial "Class I 1×2
/// exhaustive" tile exactly, and extends to "orthogonal overlay over
/// axes 3–9" cleanly with repeated application (later stages can wrap
/// this in higher-arity combinators).
///
/// The `expected` parameter is a closure so callers can compute the
/// expected assertion payload from the axis tuple (e.g. for Class I
/// that's "op value + inverse value" derived from `ValueType`). When
/// no expected payload is needed, pass `|_, _, _, _| ()`.
pub fn cartesian<A, B, C, D, Exp>(
    prefix: &str,
    axis_a: &[A],
    axis_b: &[B],
    axis_c: &[C],
    axis_d: &[D],
    mut expected: impl FnMut(&A, &B, &C, &D) -> Exp,
) -> Vec<TestCase<(A, B, C, D), Exp>>
where
    A: AxisSlug + Copy,
    B: AxisSlug + Copy,
    C: AxisSlug + Copy,
    D: AxisSlug + Copy,
{
    let mut out = Vec::with_capacity(axis_a.len() * axis_b.len() * axis_c.len() * axis_d.len());
    for a in axis_a {
        for b in axis_b {
            for c in axis_c {
                for d in axis_d {
                    let mut name = String::with_capacity(64);
                    let _ = write!(
                        name,
                        "{prefix}__{}__{}__{}__{}",
                        a.as_slug(),
                        b.as_slug(),
                        c.as_slug(),
                        d.as_slug(),
                    );
                    out.push(TestCase {
                        name,
                        inputs: (*a, *b, *c, *d),
                        expected: expected(a, b, c, d),
                    });
                }
            }
        }
    }
    out
}

/// Enumerate all `(a, b, c, d, e)` tuples from five axis slices and emit
/// a `TestCase` per tuple. Stable name is `identity__a__b__c__d__e`
/// where each component is the axis slug.
///
/// Stage-1 Track-4a addition. Shape mirrors [`cartesian`] exactly — just
/// one extra axis. Used by Class I Stage 3 to layer `EditPosition` and
/// `ValueType` over the `FormulaShape × RangeType × EditPosition`
/// baseline (or any other 5-axis fanout). Append-only; the 4-ary
/// combiner is preserved verbatim for existing callers.
pub fn cartesian5<A, B, C, D, E, Exp>(
    prefix: &str,
    axis_a: &[A],
    axis_b: &[B],
    axis_c: &[C],
    axis_d: &[D],
    axis_e: &[E],
    mut expected: impl FnMut(&A, &B, &C, &D, &E) -> Exp,
) -> Vec<TestCase<(A, B, C, D, E), Exp>>
where
    A: AxisSlug + Copy,
    B: AxisSlug + Copy,
    C: AxisSlug + Copy,
    D: AxisSlug + Copy,
    E: AxisSlug + Copy,
{
    let mut out = Vec::with_capacity(
        axis_a.len() * axis_b.len() * axis_c.len() * axis_d.len() * axis_e.len(),
    );
    for a in axis_a {
        for b in axis_b {
            for c in axis_c {
                for d in axis_d {
                    for e in axis_e {
                        let mut name = String::with_capacity(80);
                        let _ = write!(
                            name,
                            "{prefix}__{}__{}__{}__{}__{}",
                            a.as_slug(),
                            b.as_slug(),
                            c.as_slug(),
                            d.as_slug(),
                            e.as_slug(),
                        );
                        out.push(TestCase {
                            name,
                            inputs: (*a, *b, *c, *d, *e),
                            expected: expected(a, b, c, d, e),
                        });
                    }
                }
            }
        }
    }
    out
}

/// Enumerate all `(a, b, c, d, e, f)` tuples from six axis slices and
/// emit a `TestCase` per tuple. Stable name is
/// `identity__a__b__c__d__e__f` where each component is the axis slug.
///
/// Stage-1 Track-4a addition. Shape mirrors [`cartesian`] and
/// [`cartesian5`] exactly — just one additional axis. Used by Class II
/// Stage 3 to layer `EditPosition` and `ValueType` over the `Extent ×
/// AggregatorShape × RangeType` baseline (six axes total when the
/// fixture carries an extra discriminator). Append-only; lower-arity
/// combiners are preserved verbatim for existing callers.
pub fn cartesian6<A, B, C, D, E, F, Exp>(
    prefix: &str,
    axis_a: &[A],
    axis_b: &[B],
    axis_c: &[C],
    axis_d: &[D],
    axis_e: &[E],
    axis_f: &[F],
    mut expected: impl FnMut(&A, &B, &C, &D, &E, &F) -> Exp,
) -> Vec<TestCase<(A, B, C, D, E, F), Exp>>
where
    A: AxisSlug + Copy,
    B: AxisSlug + Copy,
    C: AxisSlug + Copy,
    D: AxisSlug + Copy,
    E: AxisSlug + Copy,
    F: AxisSlug + Copy,
{
    let mut out = Vec::with_capacity(
        axis_a.len() * axis_b.len() * axis_c.len() * axis_d.len() * axis_e.len() * axis_f.len(),
    );
    for a in axis_a {
        for b in axis_b {
            for c in axis_c {
                for d in axis_d {
                    for e in axis_e {
                        for f in axis_f {
                            let mut name = String::with_capacity(96);
                            let _ = write!(
                                name,
                                "{prefix}__{}__{}__{}__{}__{}__{}",
                                a.as_slug(),
                                b.as_slug(),
                                c.as_slug(),
                                d.as_slug(),
                                e.as_slug(),
                                f.as_slug(),
                            );
                            out.push(TestCase {
                                name,
                                inputs: (*a, *b, *c, *d, *e, *f),
                                expected: expected(a, b, c, d, e, f),
                            });
                        }
                    }
                }
            }
        }
    }
    out
}

/// Axis trait — any axis enum that wants to participate in [`cartesian`]
/// must implement it. All Stage 1 axes do.
pub trait AxisSlug {
    fn as_slug(&self) -> &'static str;
}

impl AxisSlug for DependentShape {
    fn as_slug(&self) -> &'static str {
        DependentShape::as_slug(*self)
    }
}

impl AxisSlug for FormulaShape {
    fn as_slug(&self) -> &'static str {
        FormulaShape::as_slug(*self)
    }
}

impl AxisSlug for RangeType {
    fn as_slug(&self) -> &'static str {
        RangeType::as_slug(*self)
    }
}

impl AxisSlug for EditPosition {
    fn as_slug(&self) -> &'static str {
        EditPosition::as_slug(*self)
    }
}

impl AxisSlug for ValueType {
    fn as_slug(&self) -> &'static str {
        ValueType::as_slug(*self)
    }
}

// ---------------------------------------------------------------------
// Class II extensions — appended by Class II agent (stage 4).
// ---------------------------------------------------------------------
//
// These axes capture "state of the populated extent" when the
// op+inverse pair runs. The dynamic-extent hypothesis lives in the
// interaction between `Extent::*` and a full-column / INDIRECT /
// OFFSET-driven dependent range.

/// Populated-extent shape of the sheet under test at the moment the
/// forward op is applied.
///
/// Plan §"Class II — Range dependency tracking under dynamic extent":
/// we need to probe the full-column invalidation path with the bbox
/// cache in five distinct states. `GrewThenShrank` and `ExpandedMidPath`
/// require multi-step seeding (additional ops prior to the forward op
/// that's under test).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Extent {
    /// No populated data on the sheet at all. The formula evaluates
    /// against an empty range.
    Empty,
    /// Exactly one populated cell near the top of the sheet (`A1`).
    A1Only,
    /// Exactly one populated cell far down the sheet (row 50_000).
    A50k,
    /// Extent grew with a seed write, then shrank back (the shrink is
    /// the *initial state* — the grow-then-shrink happens before the
    /// op-under-test lands).
    GrewThenShrank,
    /// Between the forward op and the inverse, an additional (unrelated)
    /// write pushes the extent further out. The inverse must still
    /// reach back to the originally edited cell.
    ExpandedMidPath,
}

impl Extent {
    #[must_use]
    pub const fn as_slug(self) -> &'static str {
        match self {
            Extent::Empty => "extent_empty",
            Extent::A1Only => "extent_a1",
            Extent::A50k => "extent_a50k",
            Extent::GrewThenShrank => "extent_grewshrank",
            Extent::ExpandedMidPath => "extent_expanded_mid",
        }
    }

    #[must_use]
    pub const fn all() -> &'static [Extent] {
        &[
            Extent::Empty,
            Extent::A1Only,
            Extent::A50k,
            Extent::GrewThenShrank,
            Extent::ExpandedMidPath,
        ]
    }
}

impl AxisSlug for Extent {
    fn as_slug(&self) -> &'static str {
        Extent::as_slug(*self)
    }
}

/// Dependent-formula shape used by Class II. The Class II invariant is
/// orthogonal to the graph topology in [`DependentShape`]; we need to
/// vary the **aggregator** because the full-column invalidation path is sensitive
/// to which dependency-extractor path the engine takes (SUMIFS / COUNTIFS
/// route through criteria range, SUM is a single range sum, VLOOKUP hits
/// the lookup-column specialisation).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AggregatorShape {
    Sumifs,
    Countifs,
    Sum,
    Vlookup,
}

impl AggregatorShape {
    #[must_use]
    pub const fn as_slug(self) -> &'static str {
        match self {
            AggregatorShape::Sumifs => "sumifs",
            AggregatorShape::Countifs => "countifs",
            AggregatorShape::Sum => "sum",
            AggregatorShape::Vlookup => "vlookup",
        }
    }

    #[must_use]
    pub const fn all() -> &'static [AggregatorShape] {
        &[
            AggregatorShape::Sumifs,
            AggregatorShape::Countifs,
            AggregatorShape::Sum,
            AggregatorShape::Vlookup,
        ]
    }
}

impl AxisSlug for AggregatorShape {
    fn as_slug(&self) -> &'static str {
        AggregatorShape::as_slug(*self)
    }
}

/// Coverage reason — used when a test case is declared but deferred
/// (e.g. to structural-op) rather than run. Keeps the "gap is visible" so
/// readers of the test report see what *isn't* exercised yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CoverageReason {
    /// Feature requires structural ops that are structural-op scope. Class II
    /// only exercises cell-edit invariants; the structural-mutation
    /// invariants are the same shape but needed a separate round.
    Round2Scope,
}

impl CoverageReason {
    #[must_use]
    pub const fn as_slug(self) -> &'static str {
        match self {
            CoverageReason::Round2Scope => "round2_scope",
        }
    }
}

// ---------------------------------------------------------------------
// Self-test — keeps the scaffolding honest across edits.
// ---------------------------------------------------------------------

// Not gated on cfg(test) because each integration test file is already
// its own binary; but this function runs as a normal helper, exercising
// name stability. Stage 2 can promote it to a real `#[test]`.
#[must_use]
pub fn smoke_check() -> usize {
    let all = cartesian(
        "smoke",
        DependentShape::all(),
        RangeType::all(),
        EditPosition::all(),
        ValueType::all(),
        |_, _, _, _| (),
    );
    all.len()
}

// Stage-1 Track-4a — additive smoke for the higher-arity combiners. Kept
// as separate fns so the 4-ary `smoke_check` above is untouched (per the
// structural-op append-only coordination rule).

/// Exercise [`cartesian5`] on a small fixed axis set and verify:
/// - the total case count equals `|a| × |b| × |c| × |d| × |e|`,
/// - every generated `TestCase.name` is unique,
/// - every name carries the `<prefix>__a__b__c__d__e` slug pattern.
///
/// Returns the generated case count so callers can assert on it.
#[must_use]
pub fn smoke_check5() -> usize {
    // Small fixed axis set: 4 × 5 × 5 × 4 × 4 = 1600 cases. Same enums
    // `smoke_check()` uses, plus one extra axis of `ValueType` doubled
    // into `FormulaShape::all()` — we pick a tiny subset of `FormulaShape`
    // to keep the total case count modest.
    let formula_axis = &[
        FormulaShape::Sumifs,
        FormulaShape::Sum,
        FormulaShape::Vlookup,
        FormulaShape::Countif,
    ];
    let all = cartesian5(
        "smoke5",
        DependentShape::all(),
        RangeType::all(),
        EditPosition::all(),
        ValueType::all(),
        formula_axis,
        |_, _, _, _, _| (),
    );
    let expected = DependentShape::all().len()
        * RangeType::all().len()
        * EditPosition::all().len()
        * ValueType::all().len()
        * formula_axis.len();
    assert_eq!(
        all.len(),
        expected,
        "cartesian5 produced {} cases, expected {}",
        all.len(),
        expected,
    );
    let mut names: Vec<&str> = all.iter().map(|c| c.name.as_str()).collect();
    names.sort_unstable();
    let before = names.len();
    names.dedup();
    assert_eq!(
        before,
        names.len(),
        "cartesian5 produced duplicate case names",
    );
    // Spot-check slug shape: prefix plus five slug segments separated by `__`.
    for case in &all {
        let segments: Vec<&str> = case.name.split("__").collect();
        assert_eq!(
            segments.len(),
            6,
            "cartesian5 name `{}` has {} segments, expected 6 (prefix + 5 axes)",
            case.name,
            segments.len(),
        );
    }
    all.len()
}

/// Exercise [`cartesian6`] on a small fixed axis set and verify:
/// - the total case count equals `|a| × |b| × |c| × |d| × |e| × |f|`,
/// - every generated `TestCase.name` is unique,
/// - every name carries the `<prefix>__a__b__c__d__e__f` slug pattern.
///
/// Returns the generated case count so callers can assert on it.
#[must_use]
pub fn smoke_check6() -> usize {
    // Tiny axis picks to keep total count small:
    // 4 × 3 × 5 × 4 × 4 × 4 = 3840 cases.
    let formula_axis = &[
        FormulaShape::Sumifs,
        FormulaShape::Sum,
        FormulaShape::Vlookup,
        FormulaShape::Countif,
    ];
    let range_axis = &[RangeType::Closed, RangeType::FullCol, RangeType::SingleCell];
    let all = cartesian6(
        "smoke6",
        DependentShape::all(),
        range_axis,
        EditPosition::all(),
        ValueType::all(),
        formula_axis,
        AggregatorShape::all(),
        |_, _, _, _, _, _| (),
    );
    let expected = DependentShape::all().len()
        * range_axis.len()
        * EditPosition::all().len()
        * ValueType::all().len()
        * formula_axis.len()
        * AggregatorShape::all().len();
    assert_eq!(
        all.len(),
        expected,
        "cartesian6 produced {} cases, expected {}",
        all.len(),
        expected,
    );
    let mut names: Vec<&str> = all.iter().map(|c| c.name.as_str()).collect();
    names.sort_unstable();
    let before = names.len();
    names.dedup();
    assert_eq!(
        before,
        names.len(),
        "cartesian6 produced duplicate case names",
    );
    for case in &all {
        let segments: Vec<&str> = case.name.split("__").collect();
        assert_eq!(
            segments.len(),
            7,
            "cartesian6 name `{}` has {} segments, expected 7 (prefix + 6 axes)",
            case.name,
            segments.len(),
        );
    }
    all.len()
}
