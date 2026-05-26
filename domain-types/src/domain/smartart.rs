//! SmartArt diagram types.

use serde::{Deserialize, Serialize};

/// SmartArt diagram definition — typed OOXML round-trip data.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartArtDefinition {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dm_rel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lo_rel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qs_rel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cs_rel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_xml: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout_xml: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colors_xml: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style_xml: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drawing_xml: Option<String>,
}

/// SmartArt diagram category.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SmartArtCategory {
    List,
    Process,
    Cycle,
    Hierarchy,
    Relationship,
    Matrix,
    Pyramid,
    Picture,
}
