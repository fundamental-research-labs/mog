//! # Compute Core
//!
//! Native Rust compute engine for spreadsheet formula evaluation.
//!
//! ## Architecture
//!
//! ```text
//! TypeScript (owns storage + UI)              Rust (owns compute)
//! ┌──────────────────────────────┐           ┌──────────────────────────────┐
//! │ Yjs Document (source of truth)│           │ compute-core crate           │
//! │ Cell Identity Model           │  ──IPC──▶│ Cell Mirror (identity-keyed) │
//! │ UndoManager, EventBus        │           │ Formula Parser (winnow)      │
//! │ Structural ops, Canvas       │◀─results──│ AST Evaluator                │
//! │ React UI, Selection          │           │ Function Library (508)        │
//! │ Formatting, Number display   │           │ Dependency Graph (CellId)     │
//! └──────────────────────────────┘           │ Recalc Scheduler (rayon)     │
//!                                            └──────────────────────────────┘
//! ```
//!
//! Communication via Tauri IPC commands. All data structures keyed by CellId (u128).

// Typed-boundary authorship guardrail (W10): any remaining `&str[n..]` slice must be
// accompanied by an explicit `#[allow(clippy::string_slice)]` with a one-line
// ASCII-boundary justification. See `AGENTS.md` at repo root.
#![warn(clippy::string_slice)]

// Cross-platform time utilities (std::time::Instant panics on WASM)
#[doc(hidden)]
pub mod time_compat;

pub(crate) mod xlsx_profile;

// Cell Mirror — internal, but exposed for integration tests and dev tools (formula-eval)
#[doc(hidden)]
pub mod mirror;

// Formula Parser (extracted to compute-parser crate)

// AST Evaluator
#[doc(hidden)]
pub mod eval;

// Eval bridge — concrete trait impls wiring eval traits to CellMirror
#[doc(hidden)]
pub mod eval_bridge;

// Function Library (extracted to compute-functions crate)
pub use compute_functions as functions;

pub(crate) mod formula_text;

// Dependency Graph (used by formula-eval dev tool)
#[cfg(feature = "__internal")]
pub use compute_graph as graph;
#[cfg(not(feature = "__internal"))]
pub(crate) use compute_graph as graph;

// Recalc Scheduler — internal, but exposed for integration tests and dev tools (formula-eval)
#[doc(hidden)]
pub mod scheduler;

// Cell Identity Model (per-sheet identity↔position tracker)
#[doc(hidden)]
pub mod identity;

// Number Format Engine (extracted to compute-formats crate)
pub use compute_formats as formats;

// Chart data transforms (extracted to compute-charts crate)
pub use compute_charts as charts;

// Conditional Formatting evaluation (extracted to compute-cf crate)
pub use compute_cf as cf;

// Collab sync protocol — zero external usage
#[cfg(feature = "__internal")]
pub use compute_collab as collab;

// Document layer — zero external usage
#[cfg(feature = "__internal")]
pub use compute_document as document;

// Dynamic array projection registry (spatial index for array projections)
#[doc(hidden)]
pub mod projection;

// Pivot Table Engine (extracted to compute-pivot crate)
pub use compute_pivot as pivot;

// Yrs-backed CRDT storage (hybrid: yrs::Doc + CellMirror)
pub mod storage;

// Range manager (A1-style range parsing utilities, no Yrs dependency)
pub(crate) mod range_manager;

// Snapshot types (IPC initialization and incremental updates, extracted to snapshot-types crate)
pub use snapshot_types as snapshot;

// Engine-specific types (pure serializable contracts for the IPC boundary)
pub mod engine_types;

// What-If Analysis (Scenarios only — Goal Seek moved to solver, Data Tables to data_table)
#[doc(hidden)]
pub mod what_if;

// Solver — numerical optimization (root finding local, multi-variable via Python)
pub mod solver;

// Data Table — parametric formula evaluation
pub mod data_table;

pub mod diagnostics;

pub mod versioning;

// Table Engine (extracted to compute-table crate)
pub use compute_table as table;

// Autofill Engine — zero external usage
#[cfg(feature = "__internal")]
pub use compute_fill as fill;

// Schema Engine (extracted to compute-schema crate)
pub use compute_schema as schema;

// Re-export key types for convenience
pub use cell_types::{CellId, ColId, RangePos, RowId, SheetId};
pub use formula_types::{CellRef, RangeRef};
pub use value_types::{CellError, CellValue, ComputeError};

// Re-export commonly used snapshot types at crate root
pub use snapshot::{RecalcMetrics, RecalcResult, WorkbookSnapshot};

// Re-export compute-core-specific engine types at crate root
pub use engine_types::{CellIdRange, PositionRange, SerializedFloatingObjectGroup, ZOrderEntry};

// Re-export export result type for external crates (unified writer)
pub use storage::engine::ExportParseResult;

// Re-export cell semantics types
pub use storage::engine::CellInfo;

// Execution Journal — structured runtime path tracing (feature-gated)
#[cfg(feature = "journal")]
pub mod journal;

// XLSX import pipeline (used by formula-eval dev tool)
#[cfg(feature = "__internal")]
pub mod import;
#[cfg(not(feature = "__internal"))]
pub(crate) mod import;

// Bridge Mode 1 service wrappers (stateless pure function groups)
pub mod bridge_pure;
pub mod bridge_types;

// Test-support surface — used by inline `#[cfg(test)]` blocks AND by
// integration tests under `compute/core/tests/` that need engine-internal
// helpers (e.g. `cell_value_to_input_string`, the Class IV case table).
// Exposed as `pub` (so integration tests can reach it) but `#[doc(hidden)]`
// because it is not part of the stable public API.
#[doc(hidden)]
pub mod test_support;
