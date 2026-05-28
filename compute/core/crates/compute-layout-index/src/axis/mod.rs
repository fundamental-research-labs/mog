//! Per-axis spatial index using a sparse Fenwick tree over dimension deltas.
//!
//! Decomposes cumulative position as:
//!   `get_position(i) = i * default_size + fenwick.prefix_sum(i - 1)`
//! where the Fenwick tree stores `delta[i] = actual_size[i] - default_size`
//! (only non-zero for rows/cols with custom dimensions or hidden state).
//!
//! With k custom entries out of n total:
//! - `get_position(i)`:      O(log n)
//! - `get_index_at(px)`:     O(log n) via Fenwick descent
//! - `set_dimension(i, v)`:  O(log n)
//! - `build_position_array`: O(v * log n) for v entries
//! - Memory:                 O(n) for the Fenwick tree (but sparse BTreeMap for k entries)

use std::collections::{BTreeMap, BTreeSet};

use domain_types::units::Pixels;

use crate::fenwick::FenwickTree;

mod dimensions;
mod lookup;
mod ranges;

#[cfg(test)]
mod tests;

/// Spatial index for one axis (rows or columns).
#[derive(Debug, Clone)]
pub struct AxisIndex {
    /// Default dimension size (e.g., 20.0 for row height, 64.0 for col width).
    pub(super) default_size: Pixels,
    /// Total number of entries on this axis.
    pub(super) count: usize,
    /// Sparse map of custom dimensions: index -> actual size.
    /// Only entries that differ from `default_size` are stored.
    pub(super) custom: BTreeMap<usize, f64>,
    /// Set of hidden indices (these have effective size 0).
    pub(super) hidden: BTreeSet<usize>,
    /// Fenwick tree storing deltas: `delta[i] = effective_size[i] - default_size`.
    /// `effective_size[i]` = 0 if hidden, `custom[i]` if custom, else `default_size`.
    pub(super) fenwick: FenwickTree,
}

impl AxisIndex {
    /// Create an empty axis index with all entries at default size.
    pub fn new(count: usize, default_size: Pixels) -> Self {
        Self {
            default_size,
            count,
            custom: BTreeMap::new(),
            hidden: BTreeSet::new(),
            fenwick: FenwickTree::new(count),
        }
    }

    /// Total number of entries on this axis.
    pub fn count(&self) -> usize {
        self.count
    }

    /// Default dimension size.
    pub fn default_size(&self) -> Pixels {
        self.default_size
    }
}
