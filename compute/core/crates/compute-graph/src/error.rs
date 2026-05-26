use cell_types::CellId;
use thiserror::Error;

/// Errors produced by dependency graph operations.
///
/// The enum is `#[non_exhaustive]` to allow adding new error variants
/// without breaking downstream callers.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum GraphError {
    /// One or more dependency cycles were detected in the graph.
    ///
    /// `cycle_cores` contains cells in true circular reference SCCs.
    /// `downstream` contains cells that depend on cycle members but are
    /// not themselves part of any cycle — they can be evaluated once
    /// cycle cores resolve to `#CIRC_REF`.
    #[error("cycle detected involving {} core cells", cycle_cores.len())]
    CycleDetected {
        /// Cells in true circular reference SCCs.
        cycle_cores: Vec<CellId>,
        /// Cells downstream of cycles — evaluable after cores resolve.
        downstream: Vec<CellId>,
    },
}
