use serde::{Deserialize, Serialize};

use super::super::floating_object::FloatingObjectAnchor;

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
    pub uid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache: Option<StoredTimelineCache>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<FloatingObjectAnchor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_object_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
}
