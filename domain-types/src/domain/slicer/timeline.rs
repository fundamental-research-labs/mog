use serde::{Deserialize, Serialize};

use super::super::floating_object::{AnchorMode, FloatingObjectAnchor};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimelineLevel {
    Years,
    Quarters,
    Months,
    Days,
}

impl Default for TimelineLevel {
    fn default() -> Self {
        Self::Months
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTimelineCache {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    pub source_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pivot_cache_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimal_refresh_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_refresh_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pivot_table_tab_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pivot_table_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTimeline {
    pub id: String,
    pub sheet_id: String,
    pub name: String,
    pub cache_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
    #[serde(default)]
    pub level: TimelineLevel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_level: Option<TimelineLevel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scroll_position: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache: Option<StoredTimelineCache>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<FloatingObjectAnchor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_object_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_macro_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_nv_ext_lst_xml: Option<String>,
    #[serde(default)]
    pub z_index: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
}

impl From<ooxml_types::timelines::TimelineLevel> for TimelineLevel {
    fn from(value: ooxml_types::timelines::TimelineLevel) -> Self {
        match value {
            ooxml_types::timelines::TimelineLevel::Years => Self::Years,
            ooxml_types::timelines::TimelineLevel::Quarters => Self::Quarters,
            ooxml_types::timelines::TimelineLevel::Months => Self::Months,
            ooxml_types::timelines::TimelineLevel::Days => Self::Days,
        }
    }
}

impl From<TimelineLevel> for ooxml_types::timelines::TimelineLevel {
    fn from(value: TimelineLevel) -> Self {
        match value {
            TimelineLevel::Years => Self::Years,
            TimelineLevel::Quarters => Self::Quarters,
            TimelineLevel::Months => Self::Months,
            TimelineLevel::Days => Self::Days,
        }
    }
}

pub fn xlsx_import_to_stored_timeline(
    timeline: &ooxml_types::timelines::TimelineDef,
    cache: Option<&ooxml_types::timelines::TimelineCacheDef>,
    anchor: Option<&ooxml_types::timelines::TimelineAnchor>,
    sheet_id: &str,
) -> StoredTimeline {
    StoredTimeline {
        id: format!("timeline-{}", timeline.name),
        sheet_id: sheet_id.to_string(),
        name: timeline.name.clone(),
        cache_name: timeline.cache.clone(),
        caption: timeline.caption.clone(),
        level: timeline.level.into(),
        selection_level: timeline.selection_level.map(Into::into),
        scroll_position: timeline.scroll_position.clone(),
        uid: timeline.uid.clone(),
        cache: cache.map(|cache| StoredTimelineCache {
            name: cache.name.clone(),
            uid: cache.uid.clone(),
            source_name: cache.source_name.clone(),
            pivot_cache_id: cache.pivot_cache_id,
            minimal_refresh_version: cache.minimal_refresh_version,
            last_refresh_version: cache.last_refresh_version,
            filter_type: cache.filter_type.clone(),
            start_date: cache.start_date.clone(),
            end_date: cache.end_date.clone(),
            pivot_table_tab_id: cache.pivot_tables.first().map(|pivot| pivot.tab_id),
            pivot_table_name: cache.pivot_tables.first().map(|pivot| pivot.name.clone()),
            ext_lst_xml: cache.ext_lst.clone(),
        }),
        position: anchor.map(|anchor| FloatingObjectAnchor {
            anchor_row: anchor.from.row,
            anchor_col: anchor.from.col,
            anchor_row_offset: anchor.from.row_off,
            anchor_col_offset: anchor.from.col_off,
            anchor_mode: AnchorMode::OneCell,
            absolute_x: None,
            absolute_y: None,
            end_row: None,
            end_col: None,
            end_row_offset: None,
            end_col_offset: None,
            extent_cx: anchor.extent.as_ref().map(|extent| extent.cx),
            extent_cy: anchor.extent.as_ref().map(|extent| extent.cy),
        }),
        anchor_object_id: anchor.and_then(|anchor| anchor.object_id),
        anchor_macro_name: anchor.and_then(|anchor| anchor.macro_name.clone()),
        anchor_nv_ext_lst_xml: anchor.and_then(|anchor| anchor.nv_ext_lst.clone()),
        z_index: anchor
            .and_then(|anchor| anchor.drawing.anchor_index)
            .and_then(|idx| i32::try_from(idx).ok())
            .unwrap_or(0),
        ext_lst_xml: timeline.ext_lst.clone(),
    }
}

pub fn stored_timeline_to_timeline_def(
    stored: &StoredTimeline,
) -> ooxml_types::timelines::TimelineDef {
    ooxml_types::timelines::TimelineDef {
        name: stored.name.clone(),
        cache: stored.cache_name.clone(),
        caption: stored.caption.clone(),
        level: stored.level.into(),
        selection_level: stored.selection_level.map(Into::into),
        scroll_position: stored.scroll_position.clone(),
        uid: stored.uid.clone(),
        ext_lst: stored.ext_lst_xml.clone(),
    }
}

pub fn stored_timeline_to_cache_def(
    stored: &StoredTimeline,
) -> Option<ooxml_types::timelines::TimelineCacheDef> {
    let cache = stored.cache.as_ref()?;
    Some(ooxml_types::timelines::TimelineCacheDef {
        name: cache.name.clone(),
        uid: cache.uid.clone(),
        source_name: cache.source_name.clone(),
        pivot_cache_id: cache.pivot_cache_id,
        minimal_refresh_version: cache.minimal_refresh_version,
        last_refresh_version: cache.last_refresh_version,
        filter_type: cache.filter_type.clone(),
        start_date: cache.start_date.clone(),
        end_date: cache.end_date.clone(),
        pivot_tables: match (cache.pivot_table_tab_id, cache.pivot_table_name.as_ref()) {
            (Some(tab_id), Some(name)) => vec![ooxml_types::timelines::TimelinePivotTableRef {
                tab_id,
                name: name.clone(),
            }],
            _ => Vec::new(),
        },
        ext_lst: cache.ext_lst_xml.clone(),
    })
}

pub fn stored_timeline_to_anchor(
    stored: &StoredTimeline,
) -> Option<ooxml_types::timelines::TimelineAnchor> {
    let pos = stored.position.as_ref()?;
    Some(ooxml_types::timelines::TimelineAnchor {
        timeline_name: stored.name.clone(),
        from: ooxml_types::drawings::CellAnchor {
            col: pos.anchor_col,
            col_off: pos.anchor_col_offset,
            row: pos.anchor_row,
            row_off: pos.anchor_row_offset,
        },
        to: ooxml_types::drawings::CellAnchor {
            col: pos.end_col.unwrap_or(pos.anchor_col),
            col_off: pos.end_col_offset.unwrap_or(0),
            row: pos.end_row.unwrap_or(pos.anchor_row),
            row_off: pos.end_row_offset.unwrap_or(0),
        },
        object_id: stored.anchor_object_id,
        extent: match (pos.extent_cx, pos.extent_cy) {
            (Some(cx), Some(cy)) => Some(ooxml_types::drawings::Extent { cx, cy }),
            _ => None,
        },
        macro_name: stored.anchor_macro_name.clone(),
        nv_ext_lst: stored.anchor_nv_ext_lst_xml.clone(),
        drawing: ooxml_types::drawings::DrawingAnchorMetadata {
            anchor_index: usize::try_from(stored.z_index).ok(),
        },
    })
}
