//! # Platform Duality: Native vs WASM
//!
//! `compute-core` compiles for two targets:
//!
//! - **Native** (`features = ["native"]`): Desktop via Tauri. Evaluation runs on a rayon
//!   thread pool. Shared state uses atomics, `DashMap`, and `parking_lot` locks.
//! - **WASM** (`target_arch = "wasm32"`, no `native` feature): Browser. Evaluation is
//!   single-threaded. Shared state uses `RefCell` and `HashMap`.
//!
//! ## Convention
//!
//! When a type needs different thread-safety characteristics per target, provide two
//! variants gated by `#[cfg(feature = "native")]` / `#[cfg(not(feature = "native"))]`.
//! Use a type alias at the module boundary so callers don't branch:
//!
//! ```ignore
//! #[cfg(feature = "native")]
//! pub type ColumnTracker = ColumnCompletionTracker;    // atomic
//! #[cfg(not(feature = "native"))]
//! pub type ColumnTracker = ColumnCompletionTrackerSeq; // RefCell
//! ```
//!
//! Existing modules following this pattern:
//! - `eval/cache/range_store` — on-demand range cache (`DashMap` vs `RefCell<HashMap>`)
//! - `eval/cache/workbook_cache` — sorted/frequency/bitmask caches (native-only)
//! - `eval/lookup/index_cache` — VLOOKUP/HLOOKUP index cache (native-only)

// Staged subsystem: iterative convergence for circular references.
#[allow(dead_code)] // Staged: wire when circular reference iteration is activated
pub(crate) mod iterative_solver;
// Staged subsystem: vectorized columnar eval. Wire when activated in recalc coordinator.
#[allow(dead_code)] // Staged: wire when vectorized columnar eval is activated
pub(crate) mod vectorized;
