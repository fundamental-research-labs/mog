use ooxml_types::cond_format::{CfvoType, DataBarAxisPosition, DataBarDirection, IconSetType};
use serde::{Deserialize, Serialize};

use super::CFValueRef;

/// A single point in a color scale (min, mid, max) or data bar (min, max).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CFColorPoint {
    /// Typed boundary value. The former `value_type: CfvoType` + `value:
    /// Option<serde_json::Value>` pair collapsed into one enum in
    /// typed OOXML preservation. See [`CFValueRef`].
    pub value: CFValueRef,
    /// Original OOXML `cfvo@val` text. Payload-carrying CFVO kinds can be
    /// reconstructed from `value`, but payloadless kinds such as `min`/`max`
    /// still sometimes carry `val="0"` in producer files. Preserve it for
    /// byte-fidelity without changing evaluation semantics.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ooxml_value: Option<String>,
    pub color: String,
    /// Theme color index (0-based), e.g. 0 = background1, 1 = text1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_theme: Option<u32>,
    /// Tint adjustment (-1.0 to 1.0) applied on top of theme/indexed color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_tint: Option<f64>,
    /// Indexed color palette entry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_indexed: Option<u32>,
    /// Automatic color flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_auto: Option<bool>,
    /// Direct child `<extLst>` payload owned by the threshold.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
}

/// Color scale configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CFColorScale {
    /// Ordered OOXML stop list. When populated, this is authoritative and may
    /// contain more than the legacy two/three public stops.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub points: Vec<CFColorPoint>,
    pub min_point: CFColorPoint,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mid_point: Option<CFColorPoint>,
    pub max_point: CFColorPoint,
}

impl CFColorScale {
    pub fn ordered_points(&self) -> Vec<&CFColorPoint> {
        if self.points.len() >= 2 {
            self.points.iter().collect()
        } else {
            let mut points = vec![&self.min_point];
            if let Some(mid) = &self.mid_point {
                points.push(mid);
            }
            points.push(&self.max_point);
            points
        }
    }
}

/// Data bar configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CFDataBar {
    pub min_point: CFColorPoint,
    pub max_point: CFColorPoint,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_length: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_length: Option<u32>,
    pub positive_color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub negative_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub negative_border_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_border: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gradient: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<DataBarDirection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis_position: Option<DataBarAxisPosition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_value: Option<bool>,
    /// When true, negative bars use the positive fill color instead of negative_color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub match_positive_fill_color: Option<bool>,
    /// When true, negative bars use the positive border color instead of negative_border_color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub match_positive_border_color: Option<bool>,
    /// XLSX round-trip: x14:id linking standard databar to its extended version.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_id: Option<String>,
}

/// Icon set configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CFIconSet {
    pub icon_set_name: IconSetType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reverse_order: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_icon_only: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub percent: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub thresholds: Vec<CFIconThreshold>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom_icons: Vec<Option<CFCustomIcon>>,
}

/// A threshold within an icon set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CFIconThreshold {
    #[serde(rename = "type")]
    pub value_type: CfvoType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    pub gte: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
}

/// A custom icon override within an icon set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CFCustomIcon {
    pub icon_set: String,
    pub icon_id: u32,
}
