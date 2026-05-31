use serde::{Deserialize, Serialize};

/// Color value. Hex for direct colors, theme ref for theme-aware colors.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ChartColorData {
    Hex(String), // "4472C4"
    Theme {
        theme: String, // "accent1", "dk1", etc.
        #[serde(skip_serializing_if = "Option::is_none")]
        tint_shade: Option<f64>,
    },
}

/// Fill. Maps to OOXML EG_FillProperties.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChartFillData {
    #[serde(rename = "none")]
    NoFill,
    #[serde(rename = "solid")]
    Solid {
        color: ChartColorData,
        #[serde(skip_serializing_if = "Option::is_none")]
        transparency: Option<f64>,
    },
    #[serde(rename = "gradient")]
    Gradient {
        gradient_type: ChartGradientType,
        #[serde(skip_serializing_if = "Option::is_none")]
        angle: Option<f64>,
        stops: Vec<ChartGradientStop>,
    },
    #[serde(rename = "pattern")]
    Pattern {
        pattern: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        foreground: Option<ChartColorData>,
        #[serde(skip_serializing_if = "Option::is_none")]
        background: Option<ChartColorData>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChartGradientType {
    Linear,
    Radial,
    Rectangular,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartGradientStop {
    pub position: f64,
    pub color: ChartColorData,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transparency: Option<f64>,
}

/// Line/border. Maps to OOXML CT_LineProperties.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartLineData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<ChartColorData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>, // points
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dash_style: Option<ChartDashStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transparency: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChartDashStyle {
    Solid,
    Dot,
    Dash,
    DashDot,
    LongDash,
    LongDashDot,
    LongDashDotDot,
}

/// Font. Maps to OOXML tx_pr -> defRPr.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartFontData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>, // points
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<ChartColorData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub underline: Option<ChartUnderlineStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strikethrough: Option<ChartStrikeStyle>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChartUnderlineStyle {
    None,
    Single,
    Double,
    SingleAccountant,
    DoubleAccountant,
    Dash,
    DashLong,
    DotDash,
    DotDotDash,
    Dotted,
    Heavy,
    Wavy,
    WavyDouble,
    WavyHeavy,
    Words,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChartStrikeStyle {
    Single,
    Double,
}

/// DrawingML text vertical mode (`a:bodyPr@vert`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ChartTextVerticalType {
    #[serde(rename = "horz")]
    Horizontal,
    #[serde(rename = "vert")]
    Vertical,
    #[serde(rename = "vert270")]
    Vertical270,
    #[serde(rename = "wordArtVert")]
    WordArtVert,
    #[serde(rename = "eaVert")]
    EastAsianVert,
    #[serde(rename = "mongolianVert")]
    MongolianVert,
    #[serde(rename = "wordArtVertRtl")]
    WordArtVertRtl,
}

/// A styled text run for rich text in chart titles and data labels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartFormatStringData {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub font: Option<ChartFontData>,
}

/// Shadow effect for chart elements.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartShadowData {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub visible: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub color: Option<ChartColorData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub blur: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub offset_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub offset_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub transparency: Option<f64>,
}

/// Composite format for a chart element.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartFormatData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<ChartFillData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<ChartLineData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font: Option<ChartFontData>,
    /// Text rotation angle in degrees (`a:bodyPr@rot` divided by 60000).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_rotation: Option<f64>,
    /// DrawingML vertical text mode (`a:bodyPr@vert`).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub text_vertical_type: Option<ChartTextVerticalType>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub shadow: Option<ChartShadowData>,
}
