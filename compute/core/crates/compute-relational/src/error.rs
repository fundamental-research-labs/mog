//! Error types for the relational compute engine.

/// Errors that can occur during relational query execution.
#[derive(Debug, thiserror::Error)]
pub enum RelationalError {
    /// Group hierarchy exceeds the maximum allowed number of nodes.
    #[error("Group hierarchy exceeds maximum of {max} nodes")]
    GroupExplosion {
        /// The maximum allowed node count.
        max: usize,
    },

    /// An invalid field was referenced in the query.
    #[error("Invalid field: {field}: {message}")]
    InvalidField {
        /// The field identifier.
        field: String,
        /// Description of the problem.
        message: String,
    },

    /// Relational window functions are intentionally unsupported in this
    /// engine. Pivot Show Values As semantics are owned by compute-pivot's
    /// whole-result post-processing path.
    #[error("Unsupported window function on measure: {measure_id}")]
    UnsupportedWindowFunction {
        /// The measure whose `window` field was set.
        measure_id: String,
    },
}
