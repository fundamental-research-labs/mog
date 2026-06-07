//! Integration tests for circular reference detection and iterative convergence
//! through the full `ComputeCore` pipeline.
//!
//! These tests exercise the demand-driven recalculation engine's cycle detection
//! and iterative resolution paths. With `iterative_calc` disabled, numeric
//! cached cycle values are preserved and non-numeric cycle values materialize as
//! #CIRC. With `iterative_calc` enabled, cycle cells go through the convergence
//! loop. Circular reference diagnostics are always emitted in `result.errors`.
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
