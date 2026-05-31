use serde::{Deserialize, Serialize};

use super::{ChartFormatData, ChartFormatStringData};

fn color_scheme_index_name(index: ooxml_types::themes::ColorSchemeIndex) -> &'static str {
    match index {
        ooxml_types::themes::ColorSchemeIndex::Dk1 => "Dk1",
        ooxml_types::themes::ColorSchemeIndex::Lt1 => "Lt1",
        ooxml_types::themes::ColorSchemeIndex::Dk2 => "Dk2",
        ooxml_types::themes::ColorSchemeIndex::Lt2 => "Lt2",
        ooxml_types::themes::ColorSchemeIndex::Accent1 => "Accent1",
        ooxml_types::themes::ColorSchemeIndex::Accent2 => "Accent2",
        ooxml_types::themes::ColorSchemeIndex::Accent3 => "Accent3",
        ooxml_types::themes::ColorSchemeIndex::Accent4 => "Accent4",
        ooxml_types::themes::ColorSchemeIndex::Accent5 => "Accent5",
        ooxml_types::themes::ColorSchemeIndex::Accent6 => "Accent6",
        ooxml_types::themes::ColorSchemeIndex::Hlink => "Hlink",
        ooxml_types::themes::ColorSchemeIndex::FolHlink => "FolHlink",
    }
}

fn parse_color_scheme_index(value: &str) -> Option<ooxml_types::themes::ColorSchemeIndex> {
    match value.replace('_', "").to_ascii_lowercase().as_str() {
        "dk1" => Some(ooxml_types::themes::ColorSchemeIndex::Dk1),
        "lt1" => Some(ooxml_types::themes::ColorSchemeIndex::Lt1),
        "dk2" => Some(ooxml_types::themes::ColorSchemeIndex::Dk2),
        "lt2" => Some(ooxml_types::themes::ColorSchemeIndex::Lt2),
        "accent1" => Some(ooxml_types::themes::ColorSchemeIndex::Accent1),
        "accent2" => Some(ooxml_types::themes::ColorSchemeIndex::Accent2),
        "accent3" => Some(ooxml_types::themes::ColorSchemeIndex::Accent3),
        "accent4" => Some(ooxml_types::themes::ColorSchemeIndex::Accent4),
        "accent5" => Some(ooxml_types::themes::ColorSchemeIndex::Accent5),
        "accent6" => Some(ooxml_types::themes::ColorSchemeIndex::Accent6),
        "hlink" => Some(ooxml_types::themes::ColorSchemeIndex::Hlink),
        "folhlink" => Some(ooxml_types::themes::ColorSchemeIndex::FolHlink),
        _ => None,
    }
}

fn required_mapping_slot(value: &Option<String>) -> Option<ooxml_types::themes::ColorSchemeIndex> {
    value.as_deref().and_then(parse_color_scheme_index)
}

/// Style/import diagnostic emitted while projecting imported chart styling.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartStyleDiagnosticData {
    pub category: String,
    pub owner_key: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub ooxml_path: Option<String>,
    pub severity: ChartStyleDiagnosticSeverityData,
    pub disposition: ChartStyleDiagnosticDispositionData,
    pub feature: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChartStyleDiagnosticSeverityData {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChartStyleDiagnosticDispositionData {
    Rendered,
    Approximated,
    PreservedForExportOnly,
    DroppedUnsupported,
    DroppedStale,
}

/// Chart-local color mapping override. Values are OOXML color-scheme slots such
/// as `Dk1`, `Lt1`, `Accent1`, `Hlink`, and `FolHlink`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartColorMappingData {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bg1: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tx1: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bg2: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tx2: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub accent1: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub accent2: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub accent3: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub accent4: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub accent5: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub accent6: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub hlink: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub fol_hlink: Option<String>,
}

impl From<&ooxml_types::themes::ColorMapping> for ChartColorMappingData {
    fn from(mapping: &ooxml_types::themes::ColorMapping) -> Self {
        Self {
            bg1: Some(color_scheme_index_name(mapping.bg1).to_string()),
            tx1: Some(color_scheme_index_name(mapping.tx1).to_string()),
            bg2: Some(color_scheme_index_name(mapping.bg2).to_string()),
            tx2: Some(color_scheme_index_name(mapping.tx2).to_string()),
            accent1: Some(color_scheme_index_name(mapping.accent1).to_string()),
            accent2: Some(color_scheme_index_name(mapping.accent2).to_string()),
            accent3: Some(color_scheme_index_name(mapping.accent3).to_string()),
            accent4: Some(color_scheme_index_name(mapping.accent4).to_string()),
            accent5: Some(color_scheme_index_name(mapping.accent5).to_string()),
            accent6: Some(color_scheme_index_name(mapping.accent6).to_string()),
            hlink: Some(color_scheme_index_name(mapping.hlink).to_string()),
            fol_hlink: Some(color_scheme_index_name(mapping.fol_hlink).to_string()),
        }
    }
}

impl ChartColorMappingData {
    pub fn to_ooxml(&self) -> Option<ooxml_types::themes::ColorMapping> {
        Some(ooxml_types::themes::ColorMapping {
            bg1: required_mapping_slot(&self.bg1)?,
            tx1: required_mapping_slot(&self.tx1)?,
            bg2: required_mapping_slot(&self.bg2)?,
            tx2: required_mapping_slot(&self.tx2)?,
            accent1: required_mapping_slot(&self.accent1)?,
            accent2: required_mapping_slot(&self.accent2)?,
            accent3: required_mapping_slot(&self.accent3)?,
            accent4: required_mapping_slot(&self.accent4)?,
            accent5: required_mapping_slot(&self.accent5)?,
            accent6: required_mapping_slot(&self.accent6)?,
            hlink: required_mapping_slot(&self.hlink)?,
            fol_hlink: required_mapping_slot(&self.fol_hlink)?,
            ext_lst: None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
// Keep the wire shape identical to the public TS chart style context.
#[allow(clippy::large_enum_variant)]
pub enum ChartColorMapOverrideData {
    #[serde(rename = "master")]
    Master,
    #[serde(rename = "override")]
    Override { mapping: ChartColorMappingData },
}

impl From<&ooxml_types::themes::ColorMappingOverride> for ChartColorMapOverrideData {
    fn from(value: &ooxml_types::themes::ColorMappingOverride) -> Self {
        match value {
            ooxml_types::themes::ColorMappingOverride::MasterClrMapping => Self::Master,
            ooxml_types::themes::ColorMappingOverride::OverrideClrMapping(mapping) => {
                Self::Override {
                    mapping: mapping.into(),
                }
            }
        }
    }
}

impl ChartColorMapOverrideData {
    pub fn to_ooxml(&self) -> Option<ooxml_types::themes::ColorMappingOverride> {
        match self {
            Self::Master => Some(ooxml_types::themes::ColorMappingOverride::MasterClrMapping),
            Self::Override { mapping } => mapping
                .to_ooxml()
                .map(ooxml_types::themes::ColorMappingOverride::OverrideClrMapping),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartStyleOwnerData {
    pub owner_key: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub source_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub edit_owner_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub rich_text: Option<Vec<ChartFormatStringData>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<ChartStyleDiagnosticData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub imported_drawing_ml: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartStyleContextData {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub color_map_override: Option<ChartColorMapOverrideData>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<ChartStyleDiagnosticData>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub owners: Vec<ChartStyleOwnerData>,
}
