//! Merge spatial-index item types shared by construction, mutation, stores,
//! and query services.

use crate::range_manager;

/// A merge region item for the spatial index.
///
/// Wraps resolved merge bounds so the `RangeSpatialIndex` can efficiently
/// query which merges contain a cell or intersect a viewport.
#[derive(Debug, Clone)]
pub(crate) struct MergeSpatialItem {
    pub id: String,
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
    /// Single range ref stored inline for the SpatialItem trait.
    pub range_ref: MergeRangeRef,
}

/// Range reference type for merge spatial items (bounds are stored directly).
#[derive(Debug, Clone)]
pub(crate) struct MergeRangeRef {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
}

impl range_manager::SpatialItem for MergeSpatialItem {
    type RangeRef = MergeRangeRef;

    fn id(&self) -> &str {
        &self.id
    }

    fn range_refs(&self) -> &[MergeRangeRef] {
        std::slice::from_ref(&self.range_ref)
    }
}

/// Direct resolver for merge bounds (no identity resolution needed).
pub(crate) struct MergeDirectResolver;

impl range_manager::RangeBoundsResolver for MergeDirectResolver {
    type RangeRef = MergeRangeRef;

    fn resolve(&self, range_ref: &MergeRangeRef) -> Option<range_manager::ResolvedBounds> {
        Some(range_manager::ResolvedBounds {
            min_row: range_ref.start_row,
            max_row: range_ref.end_row,
            min_col: range_ref.start_col,
            max_col: range_ref.end_col,
        })
    }
}
