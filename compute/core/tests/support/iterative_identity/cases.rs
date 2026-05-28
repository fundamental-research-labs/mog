//! Case descriptors, value seeds, and identity comparison contracts.

use value_types::{CellError, CellValue, FiniteF64};

use crate::support::matrix::{EditPosition, FormulaShape, RangeType, ValueType};

// ---------------------------------------------------------------------------
// Class I case descriptor
// ---------------------------------------------------------------------------

/// Why a case was skipped rather than run.
#[derive(Debug, Clone)]
pub(crate) enum CoverageReason {
    /// The shape × range pair is semantically incompatible (e.g.
    /// MATCH doesn't accept multi-column ranges) — skip cleanly
    /// rather than hiding a failure.
    IncompatibleCombo(&'static str),
    /// Fixture support for this range type isn't wired up yet
    /// (named ranges, structured refs, 3D). Stage 2+ follow-up.
    FixturePending(&'static str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Class1Axis3 {
    Inside,
    FarOutside,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Class1Axis4 {
    Int,
    FloatCascade,
}

#[derive(Debug, Clone)]
#[allow(dead_code)] // `name`, `range`, `edit_pos`, `value_kind` are read only
// during eprintln! summaries at runtime, not statically.
pub(crate) struct Class1Case {
    pub(crate) name: String,
    pub(crate) shape: FormulaShape,
    pub(crate) range: RangeType,
    pub(crate) edit_pos: Class1Axis3,
    pub(crate) value_kind: Class1Axis4,
    /// Pre-op seed value on the edited cell.
    pub(crate) prior: CellValue,
    /// Post-op value on the edited cell (the "forward op").
    pub(crate) new_value: CellValue,
}

#[derive(Debug)]
pub(crate) enum TestOutcome {
    Passed,
    Failed(String),
    Skipped(CoverageReason),
}

// ---------------------------------------------------------------------------
// Bit-identity comparator for CellValue
// ---------------------------------------------------------------------------

/// CellValue's `PartialEq` for numbers uses `==` on f64 (so
/// `-0.0 == 0.0`, etc). Class I demands bitwise identity for numbers;
/// everything else falls back to CellValue's existing equality (but with
/// case-sensitive text comparison since text identity should be strict).
pub(super) fn cell_values_bit_equal(a: &CellValue, b: &CellValue) -> bool {
    match (a, b) {
        (CellValue::Number(x), CellValue::Number(y)) => x.get().to_bits() == y.get().to_bits(),
        (CellValue::Text(x), CellValue::Text(y)) => x.as_ref() == y.as_ref(),
        (CellValue::Boolean(x), CellValue::Boolean(y)) => x == y,
        (CellValue::Error(ea, _), CellValue::Error(eb, _)) => ea == eb,
        (CellValue::Null, CellValue::Null) => true,
        (CellValue::Array(_), CellValue::Array(_)) => a == b,
        (CellValue::Control(_), CellValue::Control(_)) => a == b,
        (CellValue::Image(_), CellValue::Image(_)) => a == b,
        _ => false,
    }
}

pub(super) fn describe_cell_value(v: &CellValue) -> String {
    match v {
        CellValue::Number(n) => format!("Number({} bits=0x{:016x})", n.get(), n.get().to_bits()),
        CellValue::Text(t) => format!("Text({:?})", t.as_ref()),
        CellValue::Boolean(b) => format!("Boolean({})", b),
        CellValue::Error(e, _) => format!("Error({:?})", e),
        CellValue::Null => "Null".to_string(),
        CellValue::Array(_) => "Array(..)".to_string(),
        CellValue::Control(_) => "Control(..)".to_string(),
        CellValue::Image(_) => "Image(..)".to_string(),
    }
}

/// Render a CellValue as an input string suitable for `set_cell` — the
/// forward-op path. For numbers we just stringify. Text loses its
/// fidelity through the parser (that's the Class-A story), but Class I
/// only uses Int / FloatCascade seeds, so this is fine.
pub(super) fn render_input(v: &CellValue) -> String {
    match v {
        CellValue::Number(n) => {
            let f = n.get();
            if f.fract() == 0.0 && f.abs() < 1e16 {
                // Integer-ish — drop the trailing .0.
                format!("{}", f as i64)
            } else {
                format!("{}", f)
            }
        }
        CellValue::Text(t) => t.as_ref().to_string(),
        CellValue::Boolean(true) => "TRUE".to_string(),
        CellValue::Boolean(false) => "FALSE".to_string(),
        CellValue::Error(e, _) => e.as_str().to_string(),
        CellValue::Null => String::new(),
        CellValue::Array(_) | CellValue::Control(_) | CellValue::Image(_) => String::new(),
    }
}

#[allow(dead_code)] // Fields present for diagnostic ergonomics in future
// stages; Stage 2 itself only reads from eprintln!.
pub(crate) struct FamilySummary {
    pub(crate) family: &'static str,
    pub(crate) total: usize,
    pub(crate) passed: usize,
    pub(crate) failed: usize,
    pub(crate) skipped_incompat: usize,
    pub(crate) skipped_pending: usize,
    pub(crate) failures: Vec<String>,
    pub(crate) elapsed_ms: u128,
}

// ===========================================================================
// Axes 3 x 4 expansion (FormulaShape x RangeType x EditPosition x ValueType).
//
// All types below parallel the matrix above but iterate the full EditPosition
// and ValueType axes from `support::matrix`. Five `#[test]` functions, one per
// EditPosition, give cargo-test's thread pool per-axis parallelism. Nominal
// case count per test = 300 (FormulaShape::all() x RangeType::all_stage2()) x 13
// (ValueType::all_stage2()) = 3_900, of which most are IncompatibleCombo or
// FixturePending skips (the `NamedRange` row drops from Pending to active
// once its fixture builder lands; `StructuredTable` stays pending until
// structured-reference parsing is verified in engine).
// ===========================================================================

/// One matrix case. Axis 3 (EditPosition) and axis 4 (ValueType) are the
/// orthogonal additions to the axis-1/2 matrix.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(crate) struct Class1CaseV2 {
    pub(crate) name: String,
    pub(crate) shape: FormulaShape,
    pub(crate) range: RangeType,
    pub(crate) edit_pos: EditPosition,
    pub(crate) value_kind: ValueType,
    pub(crate) prior: CellValue,
    pub(crate) new_value: CellValue,
}

/// Map a `ValueType` to a `(prior, new_value)` pair for the op.
///
/// - Number-shaped variants pick two different numbers so the dependent
///   has something to flip on.
/// - Text variants pick two different strings.
/// - `Bool` flips TRUE ↔ FALSE.
/// - `NullEmpty` uses Null both as prior and new; the op degenerates to
///   a no-op write and still exercises the invalidation path.
/// - `Error` picks two different error kinds so round-trip is visible.
pub(super) fn value_type_seeds(v: ValueType) -> (CellValue, CellValue) {
    use std::sync::Arc;
    match v {
        ValueType::Int => (
            CellValue::Number(FiniteF64::must(5.0)),
            CellValue::Number(FiniteF64::must(7.0)),
        ),
        ValueType::LargeInt => (
            CellValue::Number(FiniteF64::must(1_000_000_000.0)),
            CellValue::Number(FiniteF64::must(1_000_000_007.0)),
        ),
        ValueType::FloatClean => (
            CellValue::Number(FiniteF64::must(0.5)),
            CellValue::Number(FiniteF64::must(0.25)),
        ),
        ValueType::FloatCascade => (
            CellValue::Number(FiniteF64::must(0.1)),
            CellValue::Number(FiniteF64::must(0.2)),
        ),
        ValueType::Bool => (CellValue::Boolean(true), CellValue::Boolean(false)),
        ValueType::Text => (
            CellValue::Text(Arc::from("alpha")),
            CellValue::Text(Arc::from("beta")),
        ),
        ValueType::TextShort => (
            CellValue::Text(Arc::from("abc")),
            CellValue::Text(Arc::from("xyz")),
        ),
        ValueType::TextLong => {
            let p = "x".repeat(256);
            let n = "y".repeat(256);
            (CellValue::Text(Arc::from(p)), CellValue::Text(Arc::from(n)))
        }
        ValueType::LeadingApostrophe => (
            CellValue::Text(Arc::from("'quoted")),
            CellValue::Text(Arc::from("'flipped")),
        ),
        ValueType::WhitespaceOnly => (
            CellValue::Text(Arc::from("   ")),
            CellValue::Text(Arc::from("     ")),
        ),
        ValueType::NullEmpty => (CellValue::Null, CellValue::Null),
        ValueType::Error => (
            CellValue::Error(CellError::Na, None),
            CellValue::Error(CellError::Div0, None),
        ),
        ValueType::DateSerial => (
            CellValue::Number(FiniteF64::must(45_000.0)),
            CellValue::Number(FiniteF64::must(45_001.0)),
        ),
        ValueType::TimeSerial => (
            CellValue::Number(FiniteF64::must(0.5)),
            CellValue::Number(FiniteF64::must(0.25)),
        ),
    }
}
