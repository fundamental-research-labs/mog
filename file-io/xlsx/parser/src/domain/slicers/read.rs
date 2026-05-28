//! Slicer readers for XLSX files.
//!
//! This facade preserves the historic `domain::slicers::read::*` entrypoints
//! while the parser implementation lives in focused child modules.

mod anchors;
mod archive;
mod cache;
mod part;
mod rels;
mod support;

pub use super::types::{
    CONTENT_TYPE_SLICER, CONTENT_TYPE_SLICER_CACHE, REL_SLICER, REL_SLICER_CACHE, SlicerAnchor,
    SlicerCacheDef, SlicerCrossFilter, SlicerDef, SlicerPivotTableRef, SlicerSortOrder,
    SlicerTabularData, SlicerTabularItem, TableSlicerCache,
};
pub use anchors::parse_slicer_anchors_from_drawing;
pub use archive::{parse_all_slicer_caches, parse_slicers_for_sheet};
pub use cache::parse_slicer_cache;
pub use part::parse_slicer_part;
pub use rels::build_rel_id_map;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn facade_keeps_read_exports_available() {
        let _: Vec<SlicerDef> = parse_slicer_part(b"");
        let _: Option<SlicerCacheDef> = parse_slicer_cache(b"");
        let _: Vec<SlicerAnchor> = parse_slicer_anchors_from_drawing(b"");
        let _: std::collections::HashMap<String, String> = build_rel_id_map(b"");
    }
}
