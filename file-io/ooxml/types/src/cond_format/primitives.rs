use super::CfvoType;

pub(crate) fn default_true() -> bool {
    true
}

/// Simplified color for conditional formatting contexts (SpreadsheetML CT_Color).
///
/// This is the **SpreadsheetML** color model, NOT DrawingML. SpreadsheetML CF
/// uses a simple color model: RGB, theme index, indexed palette, or auto --
/// optionally with a tint. DrawingML's `DrawingColor` has 6 base types +
/// transforms and lives in the `drawings` module.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CfColor {
    /// sRGB color in ARGB hex (e.g., "FF00FF00").
    pub rgb: Option<String>,
    /// Theme color index (0-based).
    pub theme: Option<u32>,
    /// Indexed color palette entry.
    pub indexed: Option<u32>,
    /// Tint adjustment (-1.0 to 1.0). Applied on top of theme/indexed color.
    pub tint: Option<f64>,
    /// Automatic color flag.
    #[serde(default)]
    pub auto: bool,
}

/// Conditional format value object (ECMA-376 CT_Cfvo).
///
/// Defines a threshold/boundary value for color scales, data bars, and icon sets.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Cfvo {
    /// Value type (num, percent, max, min, formula, percentile, autoMin, autoMax).
    pub cfvo_type: CfvoType,
    /// Value string (number, formula, etc.). None for min/max/autoMin/autoMax.
    pub val: Option<String>,
    /// Greater-than-or-equal flag (default true per ECMA-376).
    /// When false, the threshold is exclusive (greater-than only).
    #[serde(default = "default_true")]
    pub gte: bool,
    /// Direct child `<extLst>` payload owned by this threshold.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
}

impl Default for Cfvo {
    fn default() -> Self {
        Self {
            cfvo_type: CfvoType::default(),
            val: None,
            gte: true,
            ext_lst_xml: None,
        }
    }
}

/// Color scale (ECMA-376 CT_ColorScale).
///
/// Maps cell values to a gradient between 2 or 3 colors.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ColorScale {
    /// 2 or 3 CFVO thresholds (min, [mid], max).
    pub cfvo: Vec<Cfvo>,
    /// 2 or 3 colors corresponding to the CFVOs.
    pub colors: Vec<CfColor>,
}
