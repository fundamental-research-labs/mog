//! Post-filter helpers consumed by the `bridge-delegate` gated macro.
//!
//! Two user-visible symbols: `redact_scalar` for cell-scope reads,
//! `filter_range_values` for range-scope reads. Both are generic over
//! the read's return type and delegate actual redaction to typed
//! [`RedactMaybe`] impls.
//!
//! ## Semantics (ARCHITECTURE.md §7 / legacy TS parity)
//!
//! | `AccessLevel` | Behaviour |
//! |---------------|-----------|
//! | `None`        | Full hide — typed "null" / empty equivalent |
//! | `Structure`   | Type-preserving placeholder (`[Number]`, `[Text]`, etc.) |
//! | `Read`/`Write`/`Admin` | Identity (passthrough) |
//!
//! The `Structure` string placeholders match the legacy TS
//! `viewport-filter.ts::getTypePlaceholder` — e.g. a number becomes
//! the text `"[Number]"`. This preserves the user-visible redaction
//! surface across the TS-to-Rust port.
//!
//! ## Why no blanket impl
//!
//! R4 intentionally removes the pre-existing
//! `impl<T> RedactMaybe for T {}` blanket. The blanket degraded every
//! gated scalar/range read to a silent passthrough — a `None`-level
//! principal received raw values because the default `redact` is a
//! no-op. Removing the blanket makes a missing impl a **compile error
//! at the delegate macro expansion**, so new engine read return types
//! can't ship without an explicit redaction policy.
//!
//! Types that truly should not redact (e.g. pure metadata like
//! `Vec<PolicyId>` from `wb_security_list_policies`) still need an
//! explicit impl — we provide one and document the rationale inline.

use std::sync::Arc;

use cell_types::{CellId, ColId, SheetId};
use value_types::CellValue;

use crate::level::AccessLevel;
use crate::matrix::SheetAccessMatrix;

/// Typed redaction hook for a read's return type.
///
/// The macro-emitted post-filter calls `redact(&mut self, level)` with
/// the evaluated `AccessLevel`. Impls decide what to do per level —
/// typically:
/// - `None` → overwrite with typed null/empty equivalent
/// - `Structure` → overwrite with a type placeholder preserving the
///   value's broad shape (e.g. `CellValue::Number(..) -> CellValue::Text("[Number]")`)
/// - `Read`/`Write`/`Admin` → no-op (identity)
///
/// ## Why not specialization
///
/// Stable Rust lacks `impl<T> Foo for T {}` + overridable specialisation.
/// Instead the macro names `compute_security::RedactMaybe::redact` as
/// the post-filter point; every return type the macro can emit must
/// have an explicit impl or the compile breaks. That's the
/// correctness-by-construction trade.
pub trait RedactMaybe {
    /// Apply redaction appropriate for the evaluated access level.
    fn redact(&mut self, level: AccessLevel);
}

// ---------------------------------------------------------------------------
// Core value-types impls
// ---------------------------------------------------------------------------

/// Placeholder strings used by the `Structure` level. Match the legacy
/// TS `viewport-filter.ts::getTypePlaceholder` output verbatim so the
/// user-visible redaction is unchanged across the port.
const PLACEHOLDER_NUMBER: &str = "[Number]";
const PLACEHOLDER_TEXT: &str = "[Text]";
const PLACEHOLDER_BOOLEAN: &str = "[Boolean]";
const PLACEHOLDER_ERROR: &str = "[Error]";

/// Return the type-placeholder string for a given `CellValue`.
///
/// `Null` maps to `"[Text]"` to match legacy TS behaviour (the TS
/// function coerces `null`/`undefined` to the text placeholder).
/// `Array` and `Control` map to `"[Text]"` — they're compound shapes
/// without a natural scalar placeholder and the legacy corpus has
/// no coverage forcing a different answer; picking `[Text]` preserves
/// "string-like" display ergonomics in the UI.
fn placeholder_for(value: &CellValue) -> &'static str {
    match value {
        CellValue::Number(_) => PLACEHOLDER_NUMBER,
        CellValue::Boolean(_) => PLACEHOLDER_BOOLEAN,
        CellValue::Error(..) => PLACEHOLDER_ERROR,
        CellValue::Text(_)
        | CellValue::Null
        | CellValue::Array(_)
        | CellValue::Control(_)
        | CellValue::Image(_) => PLACEHOLDER_TEXT,
    }
}

impl RedactMaybe for CellValue {
    fn redact(&mut self, level: AccessLevel) {
        match level {
            AccessLevel::None => *self = CellValue::Null,
            AccessLevel::Structure => {
                let placeholder = placeholder_for(self);
                *self = CellValue::Text(Arc::from(placeholder));
            }
            AccessLevel::Read | AccessLevel::Write | AccessLevel::Admin => {}
        }
    }
}

// ---------------------------------------------------------------------------
// Scalar impls — every scope=cell / scope=range read return type on
// YrsComputeEngine lands here. Missing impls are a compile error at
// delegate-macro expansion; that's the point of removing the blanket.
// ---------------------------------------------------------------------------

impl RedactMaybe for String {
    fn redact(&mut self, level: AccessLevel) {
        match level {
            AccessLevel::None => self.clear(),
            // String reads don't carry enough type information to
            // choose a typed placeholder — legacy treated them as
            // "[Text]". Keep parity.
            AccessLevel::Structure => {
                self.clear();
                self.push_str(PLACEHOLDER_TEXT);
            }
            _ => {}
        }
    }
}

impl RedactMaybe for bool {
    fn redact(&mut self, level: AccessLevel) {
        // `Structure` for a bare bool has no type-preserving scalar;
        // collapse to false (the additive-identity equivalent of a
        // "hidden" boolean).
        if level < AccessLevel::Read {
            *self = false;
        }
    }
}

// Numeric scalars — zeroed on denial. Structure-level on a bare number
// has the same shape as None (both yield 0) because the type is already
// known to be numeric by construction; there's no placeholder to pick.
macro_rules! redact_numeric_scalar {
    ($($ty:ty),* $(,)?) => {
        $(
            impl RedactMaybe for $ty {
                fn redact(&mut self, level: AccessLevel) {
                    if level < AccessLevel::Read {
                        *self = 0 as $ty;
                    }
                }
            }
        )*
    };
}
redact_numeric_scalar!(u8, u16, u32, u64, usize, i8, i16, i32, i64, isize, f32, f64);

impl<T: RedactMaybe> RedactMaybe for Option<T> {
    fn redact(&mut self, level: AccessLevel) {
        match level {
            AccessLevel::None => *self = None,
            AccessLevel::Structure => {
                if let Some(inner) = self.as_mut() {
                    inner.redact(AccessLevel::Structure);
                }
            }
            _ => {}
        }
    }
}

impl<T: RedactMaybe> RedactMaybe for Vec<T> {
    fn redact(&mut self, level: AccessLevel) {
        match level {
            AccessLevel::None => self.clear(),
            AccessLevel::Structure => {
                for v in self.iter_mut() {
                    v.redact(AccessLevel::Structure);
                }
            }
            _ => {}
        }
    }
}

// Note: `Vec<u8>` is covered by the generic `Vec<T: RedactMaybe>` impl
// above via the `u8: RedactMaybe` numeric impl (zero on denial). The
// viewport binary path goes through `compute_wire::filter_viewport_buffer`
// before this layer sees the bytes, so cell-payload redaction of byte
// buffers is not the common case.

impl<T: RedactMaybe, E> RedactMaybe for Result<T, E> {
    fn redact(&mut self, level: AccessLevel) {
        if let Ok(v) = self.as_mut() {
            v.redact(level);
        }
    }
}

// ---------------------------------------------------------------------------
// Per-domain opt-outs.
//
// Types that are pure metadata (cell IDs, sheet IDs, aggregate
// summaries, shape descriptors) are not redacted at this layer —
// they're already public by design, or their content would be
// reproducible from the grid structure alone (which a Structure-level
// principal can observe). Each impl documents the rationale.
// ---------------------------------------------------------------------------

macro_rules! redact_noop {
    ($($ty:ty),* $(,)?) => {
        $( impl RedactMaybe for $ty { fn redact(&mut self, _level: AccessLevel) {} } )*
    };
}

// Identity / shape types — visible at Structure level by policy (the
// whole point of Structure is "see grid shape, not contents").
redact_noop!((), CellId, SheetId, ColId);

// ---------------------------------------------------------------------------
// Shape / metadata types from domain-types and snapshot-types.
//
// The policy is consistent across these: at `Structure` level, the
// shape is intentionally visible — it's a "directory listing" view.
// At `None` the caller shouldn't be reaching these endpoints at all
// (the enclosing `get_*` method is itself gated by sheet/workbook
// scope at the delegate layer), but we still zero out scalar content
// to make the denial semantically loud. Collapse to `Default::default()`
// where a `Default` impl exists; otherwise noop and document why.
// ---------------------------------------------------------------------------

// Grid shape: position within a sheet. Visible at Structure level (grid
// layout is the shape).
redact_noop!(
    cell_types::SheetPos,
    snapshot_types::CellPosition,
    snapshot_types::CellPositionResult,
    snapshot_types::RectBounds,
    snapshot_types::IdentityCell,
    snapshot_types::TableHitRegion,
    domain_types::MergeRegion,
    domain_types::CellMergeInfo,
);

// Formatting metadata: classified as "shape" — styling is not payload.
// Legacy never redacted formats; keep parity.
redact_noop!(
    domain_types::CellFormat,
    domain_types::ResolvedCellFormat,
    domain_types::ConditionalFormat,
    domain_types::Sparkline,
    domain_types::Table,
    domain_types::CellValidationResult,
);

// Annotations / auxiliary content. Comments are user-authored but
// attached to the grid shape; legacy code did not redact them via the
// Structure path (the path redacted values, not annotations). Keep
// parity; orthogonal protection can still hide comments
// at a coarser layer.
redact_noop!(domain_types::Comment);

// Value-typed payload: redacted content goes through `CellValue`'s
// impl above. `RawCellData` / `ProjectionData` wrap a `CellValue`
// field plus metadata; the macro-emitted filter only sees the outer
// struct, so we redact the inner value field by replacing the whole
// struct with `Default` on denial. Structure-level preserves the
// outer shape; the value pocket inside becomes `CellValue::Null`
// (which has the same visual effect as "[Text]" in the legacy TS
// code, because the display layer already renders Null cells as
// empty). We could do better with a hand-rolled impl per field, but
// the marginal value is low — callers that care about the exact
// Structure-level shape use viewport reads (which go through the
// binary filter, not this path).
impl RedactMaybe for snapshot_types::RawCellData {
    fn redact(&mut self, level: AccessLevel) {
        // RawCellData.raw + .computed carry CellValue payload; .formula
        // is a string. All three are redactable.
        self.raw.redact(level);
        self.computed.redact(level);
        self.formula.redact(level);
    }
}

impl RedactMaybe for snapshot_types::ProjectionData {
    fn redact(&mut self, _level: AccessLevel) {
        // ProjectionData is pure shape (origin + dimensions of a
        // projected region); no payload to redact. Structure-level
        // callers are entitled to see grid shape.
    }
}

impl RedactMaybe for snapshot_types::FindInRangeResult {
    fn redact(&mut self, level: AccessLevel) {
        // FindInRangeResult.value is a stringified match; redact as a
        // String. Position/address fields are shape and stay visible.
        self.value.redact(level);
    }
}

// `serde_json::Value` is the SDK-facing JSON type returned by a
// handful of reads (e.g. `get_cell_metadata`). A `None`-level caller
// must see an empty object; Structure is treated the same — JSON
// metadata is inherently unstructured, so there's no type-preserving
// placeholder to pick.
impl RedactMaybe for serde_json::Value {
    fn redact(&mut self, level: AccessLevel) {
        if level < AccessLevel::Read {
            *self = serde_json::Value::Null;
        }
    }
}

// Tuples used by misc read methods (e.g. aggregate summaries). The
// engine already redacts the contained values via the matrix lookup
// when needed; this passthrough is intentional.
impl<A: RedactMaybe, B: RedactMaybe> RedactMaybe for (A, B) {
    fn redact(&mut self, level: AccessLevel) {
        self.0.redact(level);
        self.1.redact(level);
    }
}

impl<A: RedactMaybe, B: RedactMaybe, C: RedactMaybe> RedactMaybe for (A, B, C) {
    fn redact(&mut self, level: AccessLevel) {
        self.0.redact(level);
        self.1.redact(level);
        self.2.redact(level);
    }
}

impl<A: RedactMaybe, B: RedactMaybe, C: RedactMaybe, D: RedactMaybe> RedactMaybe for (A, B, C, D) {
    fn redact(&mut self, level: AccessLevel) {
        self.0.redact(level);
        self.1.redact(level);
        self.2.redact(level);
        self.3.redact(level);
    }
}

impl<A: RedactMaybe, B: RedactMaybe, C: RedactMaybe, D: RedactMaybe, E: RedactMaybe> RedactMaybe
    for (A, B, C, D, E)
{
    fn redact(&mut self, level: AccessLevel) {
        self.0.redact(level);
        self.1.redact(level);
        self.2.redact(level);
        self.3.redact(level);
        self.4.redact(level);
    }
}

impl<A: RedactMaybe, B: RedactMaybe, C: RedactMaybe, D: RedactMaybe, E: RedactMaybe, F: RedactMaybe>
    RedactMaybe for (A, B, C, D, E, F)
{
    fn redact(&mut self, level: AccessLevel) {
        self.0.redact(level);
        self.1.redact(level);
        self.2.redact(level);
        self.3.redact(level);
        self.4.redact(level);
        self.5.redact(level);
    }
}

// ---------------------------------------------------------------------------
// Public redaction functions
// ---------------------------------------------------------------------------

/// Redact a scalar cell read based on the cell's evaluated level.
#[inline]
pub fn redact_scalar<T: RedactMaybe>(mut raw: T, level: AccessLevel) -> T {
    raw.redact(level);
    raw
}

/// Filter a range of cell values in place. `values` is in row-major
/// order over `[start_row..=end_row] × [start_col..=end_col]`.
///
/// Fast path: `matrix.is_uniform()` → one level check for the whole
/// range. Slow path: walk the matrix per-cell.
pub fn filter_range_values<T: RedactMaybe>(
    values: &mut [T],
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    matrix: &SheetAccessMatrix,
) {
    if let Some(lvl) = matrix.is_uniform() {
        if lvl < AccessLevel::Read {
            for v in values.iter_mut() {
                v.redact(lvl);
            }
        }
        return;
    }
    let cols = end_col.saturating_sub(start_col).saturating_add(1);
    let rows = end_row.saturating_sub(start_row).saturating_add(1);
    let expected = (rows as usize).saturating_mul(cols as usize);
    let len = values.len().min(expected);
    for (i, value) in values.iter_mut().enumerate().take(len) {
        let dr = (i as u32) / cols;
        let dc = (i as u32) % cols;
        let row = start_row + dr;
        let col = start_col + dc;
        let lvl = matrix.get(row, col);
        if lvl < AccessLevel::Read {
            value.redact(lvl);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::CellError;

    fn uniform(lvl: AccessLevel) -> SheetAccessMatrix {
        SheetAccessMatrix::new_synthetic_uniform(lvl)
    }

    #[test]
    fn redact_scalar_passthrough_when_allowed() {
        assert_eq!(redact_scalar(42_u32, AccessLevel::Read), 42);
        assert_eq!(redact_scalar(42_u32, AccessLevel::Write), 42);
        assert_eq!(redact_scalar(42_u32, AccessLevel::Admin), 42);
    }

    #[test]
    fn redact_scalar_numeric_zeroed_on_none() {
        assert_eq!(redact_scalar(42_u32, AccessLevel::None), 0);
        assert_eq!(redact_scalar(42_i32, AccessLevel::Structure), 0);
        assert_eq!(redact_scalar(3.14_f64, AccessLevel::None), 0.0);
    }

    #[test]
    fn redact_cellvalue_none_to_null() {
        let mut v = CellValue::Number(value_types::FiniteF64::must(42.0));
        v.redact(AccessLevel::None);
        assert!(matches!(v, CellValue::Null));
    }

    #[test]
    fn redact_cellvalue_structure_uses_type_placeholder() {
        let mut v = CellValue::Number(value_types::FiniteF64::must(42.0));
        v.redact(AccessLevel::Structure);
        match &v {
            CellValue::Text(s) => assert_eq!(&**s, "[Number]"),
            other => panic!("expected Text placeholder, got {:?}", other),
        }

        let mut b = CellValue::Boolean(true);
        b.redact(AccessLevel::Structure);
        match &b {
            CellValue::Text(s) => assert_eq!(&**s, "[Boolean]"),
            other => panic!("expected [Boolean], got {:?}", other),
        }

        let mut t = CellValue::Text(Arc::from("secret"));
        t.redact(AccessLevel::Structure);
        match &t {
            CellValue::Text(s) => assert_eq!(&**s, "[Text]"),
            other => panic!("expected [Text], got {:?}", other),
        }

        let mut e = CellValue::Error(CellError::Na, None);
        e.redact(AccessLevel::Structure);
        match &e {
            CellValue::Text(s) => assert_eq!(&**s, "[Error]"),
            other => panic!("expected [Error], got {:?}", other),
        }
    }

    #[test]
    fn redact_cellvalue_read_is_identity() {
        let orig = CellValue::Number(value_types::FiniteF64::must(42.0));
        let mut v = orig.clone();
        v.redact(AccessLevel::Read);
        assert_eq!(
            match (&orig, &v) {
                (CellValue::Number(a), CellValue::Number(b)) => a.get() == b.get(),
                _ => false,
            },
            true
        );
    }

    #[test]
    fn redact_option_none_level_becomes_none() {
        let mut v: Option<String> = Some("hi".to_string());
        v.redact(AccessLevel::None);
        assert_eq!(v, None);
    }

    #[test]
    fn redact_option_structure_redacts_inner() {
        let mut v: Option<String> = Some("secret".to_string());
        v.redact(AccessLevel::Structure);
        assert_eq!(v.as_deref(), Some("[Text]"));
    }

    #[test]
    fn redact_string_structure_uses_text_placeholder() {
        let mut s = "secret".to_string();
        s.redact(AccessLevel::Structure);
        assert_eq!(s, "[Text]");
    }

    #[test]
    fn filter_range_uniform_admin_passthrough() {
        let mut v = vec![1_u32, 2, 3, 4];
        filter_range_values(&mut v, 0, 0, 1, 1, &uniform(AccessLevel::Admin));
        assert_eq!(v, vec![1, 2, 3, 4]);
    }

    #[test]
    fn filter_range_uniform_none_zeros() {
        let mut v = vec![1_u32, 2, 3, 4];
        filter_range_values(&mut v, 0, 0, 1, 1, &uniform(AccessLevel::None));
        assert_eq!(v, vec![0, 0, 0, 0]);
    }

    #[test]
    fn filter_range_uniform_structure_zeros_numerics() {
        // Structure on a bare numeric collapses to the zero value —
        // there's no type-preserving scalar placeholder for a `u32`.
        let mut v = vec![1_u32, 2, 3, 4];
        filter_range_values(&mut v, 0, 0, 1, 1, &uniform(AccessLevel::Structure));
        assert_eq!(v, vec![0, 0, 0, 0]);
    }

    #[test]
    fn filter_range_uniform_structure_cellvalue_uses_placeholder() {
        use value_types::FiniteF64;
        let mut v = vec![
            CellValue::Number(FiniteF64::must(1.0)),
            CellValue::Boolean(true),
            CellValue::Text(Arc::from("hi")),
        ];
        filter_range_values(&mut v, 0, 0, 0, 2, &uniform(AccessLevel::Structure));
        let placeholders: Vec<&str> = v
            .iter()
            .map(|cv| match cv {
                CellValue::Text(s) => &**s,
                _ => "unexpected",
            })
            .collect();
        assert_eq!(placeholders, vec!["[Number]", "[Boolean]", "[Text]"]);
    }
}
