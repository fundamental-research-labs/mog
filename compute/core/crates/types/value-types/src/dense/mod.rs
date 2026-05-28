//! Dense columnar value types for SIMD-accelerated aggregation.
//!
//! Pure data types with zero internal dependencies. The materialization
//! logic and cache management live in `mirror/dense.rs`.

mod bool_mask;
mod column;

pub use bool_mask::DenseBoolMask;
pub use column::DenseColumn;

/// Minimum number of cells in a range before the dense path is used.
/// Below this threshold, direct `FxHashMap` iteration is fast enough.
pub const DENSE_THRESHOLD: usize = 1000;
