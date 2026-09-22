//! Evaluation coordination.
//!
//! Recalculation runs on a rayon thread pool. Shared state uses atomics,
//! `DashMap`, and `parking_lot` locks.

// Staged subsystem: iterative convergence for circular references.
#[allow(dead_code)] // Staged: wire when circular reference iteration is activated
pub(crate) mod iterative_solver;
// Staged subsystem: vectorized columnar eval. Wire when activated in recalc coordinator.
#[allow(dead_code)] // Staged: wire when vectorized columnar eval is activated
pub(crate) mod vectorized;
