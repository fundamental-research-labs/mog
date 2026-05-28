//! Integration tests for circular reference detection and iterative convergence
//! through the full `ComputeCore` pipeline.
//!
//! These tests exercise the demand-driven recalculation engine's cycle detection
//! and iterative resolution paths. Cycle cells are seeded from cached values
//! (XLSX loads) or 0.0 (new cells) and always go through the convergence loop;
//! `iterative_calc` is a UI/diagnostic concern, not a computation gate.
//! Circular reference diagnostics are always emitted in `result.errors`.
//!
//! Run:
//!   cargo test -p compute-core --test recalc_circular_refs -- --nocapture

#[path = "support/mod.rs"]
mod support;

#[path = "recalc_circular_refs/basic_cycles.rs"]
mod basic_cycles;
#[path = "recalc_circular_refs/benign_self_refs.rs"]
mod benign_self_refs;
#[path = "recalc_circular_refs/cached_equilibria.rs"]
mod cached_equilibria;
#[path = "recalc_circular_refs/convergence.rs"]
mod convergence;
#[path = "recalc_circular_refs/selective_ranges.rs"]
mod selective_ranges;
