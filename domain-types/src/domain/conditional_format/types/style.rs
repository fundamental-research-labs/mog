use ooxml_types::styles::{BorderStyle, UnderlineStyle};
use serde::{Deserialize, Serialize};

/// Style to apply when a CF rule matches.
/// All properties are optional — only specified properties are applied.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CFStyle {
    // -- Background --
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,

    // -- Font --
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    /// Underline type (ECMA-376 ST_UnderlineValues). Serializes as OOXML
    /// tokens: `"none"` | `"single"` | `"double"` | `"singleAccounting"` |
    /// `"doubleAccounting"`. Legacy `underline: true/false` values are
    /// accepted via the separate `underline_legacy` field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline_type: Option<UnderlineStyle>,
    /// Legacy boolean underline — accepted on read (alias), but we always
    /// write `underlineType` for new data. Kept for backward compat with
    /// existing Yrs documents that stored `"underline": true`.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "underline")]
    pub underline_legacy: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strikethrough: Option<bool>,

    // -- Number format --
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,

    // -- Borders (unified) --
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_color: Option<String>,
    /// Unified border style (ECMA-376 ST_BorderStyle). Serializes as
    /// OOXML tokens like `"thin"`, `"medium"`, `"dashed"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_style: Option<BorderStyle>,

    // -- Per-side borders --
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_top_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_top_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_bottom_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_bottom_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_left_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_left_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_right_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_right_style: Option<String>,

    /// OOXML dxfId index — preserved for roundtrip fidelity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dxf_id: Option<u32>,
}
