//! Core types for the compute engine.
//!
//! # Why this crate exists
//!
//! `compute-types` is the foundation layer: every other compute crate depends on these types,
//! and this crate depends on **nothing internal**. This zero-dependency invariant means types
//! defined here can be shared freely between the parser, evaluator, snapshot serialization,
//! and IPC boundary without creating circular dependencies.
//!
//! # u128 identity strategy
//!
//! [`CellId`], [`SheetId`], [`RowId`], and [`ColId`] are `#[repr(transparent)]` newtypes
//! over `u128` — the raw bytes of a UUID. This gives us `Copy`, single-instruction equality,
//! and zero-cost hashing via `FxHashMap` (the entire 128-bit value IS the hash bucket key).
//! UUID string parsing (`uuid::Uuid::parse_str(s).as_u128()`) happens only at the IPC boundary
//! (Tauri commands, snapshot deserialization) — internal code never touches strings.
//!
//! # `CellRef`: Resolved vs Positional
//!
//! In the Cell Identity Model, `CellId`s are created lazily — empty cells don't have them.
//! A formula `=A1+B1` where B1 is empty would fail if we required `CellId`s at parse time.
//! [`CellRef::Resolved`] holds a known `CellId` for O(1) lookup; [`CellRef::Positional`]
//! stores `(sheet, row, col)` for empty cells and resolves via the position index at eval
//! time. When a user types into the empty cell, the positional ref gets promoted to resolved.
//!
//! # Lambda trait-object pattern
//!
//! [`EvalValue::Lambda`] needs to hold a formula body, but the concrete `ASTNode` type lives
//! in the parser (a higher-level crate). The [`LambdaNode`] trait breaks this dependency:
//! `EvalValue` holds a type-erased `Box<dyn LambdaNode>`, and only the evaluator downcasts
//! it back to `ASTNode` via `as_any()` (exactly 2 call sites).
//!
//! # `FiniteF64` / NaN enforcement
//!
//! The [`CellValue::Number`] variant stores a [`FiniteF64`], guaranteeing NaN and
//! Infinity are structurally impossible. The [`CellValue::number()`] constructor maps
//! non-finite `f64` to `CellError::Num`, matching Excel behavior. `FiniteF64` implements
//! `Deref<Target=f64>` for ergonomic read access and `Eq`/`Ord`/`Hash` (sound because
//! NaN is excluded by construction).
//!
//! # Performance characteristics
//!
//! - **Identity hashing**: u128 identity types hash in a single instruction with `FxHashMap`.
//!   No heap allocation, no string comparison — `cells.get(&cell_id)` is ~3-5ns.
//! - **Coercion hot paths**: `coerce_to_number`, `coerce_to_string`, `coerce_to_bool` are
//!   allocation-free for the common cases (Number, Null, Boolean). Text coercion uses
//!   `fast_float::parse` for number conversion and `Cow::Borrowed` to avoid copies.
//! - **Snapshot formats**: JSON path (string UUIDs) for Tauri command default; bincode path
//!   (raw u128) for large workbooks — skips UUID string parsing entirely.

#![forbid(unsafe_code)]
#![deny(missing_docs)]
#![warn(clippy::all, clippy::pedantic)]

// Re-export sub-crate modules that consumers access as `formula_types::date_serial::*`
pub use value_types::date_serial;

mod error;
mod identity_formula;
mod refs;
mod structured_ref;

pub use error::*;

pub use identity_formula::{
    DepEdge, DepEdges, FormulaDeps, IdentityCellRef, IdentityColRangeRef, IdentityFormula,
    IdentityFormulaRef, IdentityFullColRef, IdentityFullRowRef, IdentityRangeRef,
    IdentityRectRangeRef, IdentityRowRangeRef, NameDef, RefStyle, ReferenceTarget, TableDefLookup,
    WorkbookLookup,
};
pub use refs::{
    CellRef, NamedRangeDef, RangeRef, RangeType, ResolvedName, Scope, StructureChange, TableDef,
};
pub use structured_ref::{SpecialItem, StructuredRef, StructuredRefSpecifier};
pub use workbook_types::{
    ExternalA1Cell, ExternalA1Range, ExternalAbsFlags, ExternalAddressKey, ExternalCellRef,
    ExternalDepTarget, ExternalNameRef, ExternalRangeAbsFlags, ExternalRangeRef, ExternalRefKey,
    ExternalSheetIdHint, ExternalSheetKey, ExternalWorkbookToken, LinkId, LinkStatus,
    LinkStatusReason, LinkStatusView, WorkbookId, WorkbookSessionId,
};

// Compile-time assertion: ensures formula types are Send+Sync for parallel eval
const _: () = {
    use cell_types::CellId;
    use value_types::{CellError, CellValue, Color, ComputeError, FiniteF64};

    #[allow(dead_code)]
    fn assert_send_sync<T: Send + Sync>() {}
    fn _assertions() {
        assert_send_sync::<CellId>();
        assert_send_sync::<CellValue>();
        assert_send_sync::<CellRef>();
        assert_send_sync::<CellError>();
        assert_send_sync::<Color>();
        assert_send_sync::<ComputeError>();
        assert_send_sync::<FiniteF64>();
        assert_send_sync::<IdentityFormula>();
    }
};
