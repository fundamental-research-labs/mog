//! Sparse axis dimensions with lazily rebuilt delta prefixes.
//! Position queries cost O(log k), inverse queries O(log n * log k), and
//! storage O(k) for k custom/hidden entries on an axis of n positions.

use std::collections::{BTreeMap, BTreeSet};

use domain_types::units::Pixels;

use std::sync::OnceLock;

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
    /// Sorted (axis index, cumulative delta) pairs; allocated only for overrides.
    pub(super) prefixes: OnceLock<Vec<(usize, f64)>>,
}

impl AxisIndex {
    /// Create an empty axis index with all entries at default size.
    pub fn new(count: usize, default_size: Pixels) -> Self {
        Self {
            default_size,
            count,
            custom: BTreeMap::new(),
            hidden: BTreeSet::new(),
            prefixes: OnceLock::new(),
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
