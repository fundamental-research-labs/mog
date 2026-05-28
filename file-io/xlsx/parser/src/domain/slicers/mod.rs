//! Slicers domain — slicer caches and worksheet slicers parsing and writing.

pub mod read;
pub mod types;
pub mod write;

pub use types::{
    CONTENT_TYPE_SLICER, CONTENT_TYPE_SLICER_CACHE, REL_SLICER, REL_SLICER_CACHE, SlicerAnchor,
    SlicerCacheDef, SlicerCrossFilter, SlicerDef, SlicerPivotTableRef, SlicerSortOrder,
    SlicerTabularData, SlicerTabularItem, TableSlicerCache,
};
