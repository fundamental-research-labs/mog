//! Solver, goal-seek, and data-table operations.
//!
//! **NOTE**: These operations are NOT truly stateless — they require reading
//! cell values from a live engine to evaluate the objective function. They
//! are included here as stubs for API completeness, but the actual
//! implementations must be called through a [`Workbook`](crate::Workbook)
//! instance.

// Re-export the types so consumers can construct params
pub use compute_core::data_table::{DataTableParams, DataTableResult};
pub use compute_core::solver::types::{GoalSeekParams, GoalSeekResult, SolverParams, SolverResult};

// TODO: `solve`, `goal_seek`, and `data_table` require engine state (they read
// cells to evaluate the objective/formula). They cannot be exposed as pure
// free functions. Consumers should use:
//
//   workbook.solve(&params)
//   workbook.goal_seek(&params)
//   workbook.data_table(&params)
//
// Once those Workbook methods are implemented, remove this module or convert
// it to re-export the Workbook methods.
