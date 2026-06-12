//! Slicer, timeline, and OOXML conversion domain contracts.
//!
//! This facade preserves the public `domain::slicer::*` surface while the
//! implementation is split by storage, UI payload, event, style, source,
//! timeline, and OOXML conversion concerns.

mod events;
mod items;
mod ooxml;
mod source;
mod stored;
mod style;
mod timeline;

pub use events::{
    CacheInvalidationEventReason, DisconnectionEventReason, SlicerDisconnectionReason,
    SlicerInvalidationReason,
};
pub use items::{SlicerItem, SlicerItemState, SlicerSelectionChangeType};
pub use ooxml::{
    XlsxSlicerImportContext, stored_slicer_to_anchor, stored_slicer_to_cache_def,
    stored_slicer_to_slicer_def, table_filter_selected_values_for_slicer,
    xlsx_import_to_stored_slicer,
};
pub use source::{PivotFieldArea, SlicerSource};
pub use stored::{StoredSlicer, StoredSlicerUpdate};
pub use style::{
    CrossFilterMode, NamedSlicerStyle, SlicerCustomStyle, SlicerSortOrder, SlicerStyle,
    SlicerStylePreset,
};
pub use timeline::{
    StoredTimeline, StoredTimelineCache, TimelineLevel, stored_timeline_to_anchor,
    stored_timeline_to_cache_def, stored_timeline_to_timeline_def, xlsx_import_to_stored_timeline,
};

#[cfg(test)]
mod tests;
