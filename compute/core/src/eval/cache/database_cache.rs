//! Database cache — Tier 1 placeholder.
//!
//! This module will provide a `ParsedDatabase` cache so that repeated
//! D-function calls (DSUM, DAVERAGE, DCOUNT, ...) on the same database
//! range avoid re-parsing headers, data rows, and criteria on every
//! evaluation.
//!
//! ## Planned design
//!
//! - Cache key: hash of the database array CellValue (or range coordinates
//!   when backed by a cell range).
//! - Cached value: parsed headers (Vec<String>), data rows (Vec<Vec<CellValue>>),
//!   and optionally a column index for fast field lookup.
//! - Eviction: version-validated, same pattern as sorted/frequency caches.
//!
//! ## Current status
//!
//! Placeholder only. The evaluator dispatch path for D-functions is
//! established in `eval_primitives.rs` and
//! currently delegates to the existing PureFunction implementations
//! via GLOBAL_REGISTRY. Cache integration will happen incrementally.
