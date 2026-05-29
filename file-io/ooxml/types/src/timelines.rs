//! Timeline slicer OOXML types (Office 2013+ x15 extensions).
//!
//! These are shared vocabulary records. Parser/writer integration owns package
//! relationships, cache invalidation, and any raw extension replay policy.

use crate::drawings::{CellAnchor, DrawingAnchorMetadata, Extent};

pub const CONTENT_TYPE_TIMELINE: &str = "application/vnd.ms-excel.timeline+xml";
pub const CONTENT_TYPE_TIMELINE_CACHE: &str = "application/vnd.ms-excel.timelineCache+xml";
pub const REL_TIMELINE: &str = "http://schemas.microsoft.com/office/2011/relationships/timeline";
pub const REL_TIMELINE_CACHE: &str =
    "http://schemas.microsoft.com/office/2011/relationships/timelineCache";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimelineLevel {
    Years,
    Quarters,
    #[default]
    Months,
    Days,
}

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineDef {
    pub name: String,
    pub cache: String,
    pub caption: Option<String>,
    pub level: TimelineLevel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_level: Option<TimelineLevel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scroll_position: Option<String>,
    pub uid: Option<String>,
    pub ext_lst: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineCacheDef {
    pub name: String,
    pub uid: Option<String>,
    pub source_name: String,
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
    pub pivot_tables: Vec<TimelinePivotTableRef>,
    pub ext_lst: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelinePivotTableRef {
    pub tab_id: u32,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineAnchor {
    pub timeline_name: String,
    pub from: CellAnchor,
    pub to: CellAnchor,
    pub object_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extent: Option<Extent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub macro_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nv_ext_lst: Option<String>,
    /// Metadata from the owning sheet drawing anchor.
    #[serde(default, skip_serializing_if = "DrawingAnchorMetadata::is_empty")]
    pub drawing: DrawingAnchorMetadata,
}
