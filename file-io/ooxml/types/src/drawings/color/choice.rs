use super::{ColorTransform, PresetColorVal, SchemeColor, SystemColorVal};

/// Unified color specification (ECMA-376 EG_ColorChoice + EG_ColorTransform).
///
/// Every DrawingML color is one of 6 base types, optionally followed by
/// a chain of transforms applied in document order.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
pub enum DrawingColor {
    /// sRGB color (e.g., val="FF0000").
    SrgbClr {
        val: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransform>,
    },
    /// Theme/scheme color (e.g., val="accent1").
    SchemeClr {
        val: SchemeColor,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransform>,
    },
    /// HSL color.
    HslClr {
        hue: i32,
        sat: i32,
        lum: i32,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransform>,
    },
    /// System color (e.g., val="windowText").
    SysClr {
        val: SystemColorVal,
        /// Last computed color (sRGB hex), provided by producing application.
        last_clr: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransform>,
    },
    /// Preset named color (e.g., val="red").
    PrstClr {
        val: PresetColorVal,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransform>,
    },
    /// scRGB color (linear RGB, percentages).
    ScrgbClr {
        r: i32,
        g: i32,
        b: i32,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransform>,
    },
}

impl Default for DrawingColor {
    fn default() -> Self {
        Self::SrgbClr {
            val: String::new(),
            transforms: Vec::new(),
        }
    }
}
