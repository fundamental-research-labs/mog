use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::{
    ConnectorBinding, ConnectorOoxmlProps, FormControlOoxmlProps, ObjectFill, OleObjectOoxmlProps,
    OuterShadowEffect, PictureAdjustments, PictureCrop, PictureOoxmlProps, ShapeOoxmlProps,
    ShapeOutline, ShapeText,
};
use crate::domain::text_effects::TextEffectConfig;

// ===========================================================================
// SECTION E: Per-Type Data Structs
// ===========================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct ShapeData {
    pub shape_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<ObjectFill>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline: Option<ShapeOutline>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<ShapeText>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadow: Option<OuterShadowEffect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adjustments: Option<HashMap<String, f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scene_3d: Option<crate::domain::drawings::SceneSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sp_3d: Option<crate::domain::drawings::Shape3DSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ooxml: Option<ShapeOoxmlProps>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorData {
    pub shape_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<ObjectFill>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline: Option<ShapeOutline>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_connection: Option<ConnectorBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_connection: Option<ConnectorBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adjustments: Option<HashMap<String, f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ooxml: Option<ConnectorOoxmlProps>,
}

/// Image color transform type.
/// Maps to OfficeJS Image.colorType.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageColorType {
    Automatic,
    GrayScale,
    BlackAndWhite,
    Watermark,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PictureData {
    pub src: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crop: Option<PictureCrop>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adjustments: Option<PictureAdjustments>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border: Option<ShapeOutline>,
    /// Image color transform type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_type: Option<ImageColorType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ooxml: Option<PictureOoxmlProps>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextboxData {
    /// Text content and formatting — shared model with ShapeData.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<ShapeText>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<ObjectFill>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border: Option<ShapeOutline>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_effects: Option<TextEffectConfig>,
    /// Textboxes use SpreadsheetShape (same as shapes — txBox is a flag on the shape).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ooxml: Option<ShapeOoxmlProps>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraData {
    pub source_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EquationData {
    pub equation: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramData {
    #[serde(default)]
    pub definition: crate::domain::smartart::SmartArtDefinition,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<crate::domain::smartart::SmartArtCategory>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OleObjectData {
    pub prog_id: String,
    pub dv_aspect: String,
    pub is_linked: bool,
    pub is_embedded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_image_src: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ooxml: Option<OleObjectOoxmlProps>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormControlData {
    pub control_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_link: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_range: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ooxml: Option<FormControlOoxmlProps>,
}

/// Slicer marker payload on a floating object.
///
/// Slicers are persisted as canonical `StoredSlicer` entries in the
/// workbook-level slicers Y.Map. The `FloatingObjectData::Slicer` variant
/// only exists as the tag/discriminant for slicer-kind floating objects;
/// it carries no per-slicer state and (historically) held a
/// `serde_json::Value` bag with no writer — that bag is now removed per
/// typed OOXML preservation elimination of untyped boundaries.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerData {}
