//! 3D shape settings for floating objects (domain mirror of `CT_Shape3D`).
//!
//! `Shape3DSettings` replaces `Option<ooxml_types::drawings::Shape3D>` on
//! `ShapeData`. Bevel/extrusion/material settings are UI-reachable first-class
//! state. Round-trip fidelity is preserved via `From` converters against the
//! `ooxml_types` form.

use serde::{Deserialize, Serialize};

use super::color::DomainDrawingColor;

// ===========================================================================
// Shape3DSettings (CT_Shape3D)
// ===========================================================================

/// 3D shape properties.
///
/// Mirror of `ooxml_types::drawings::Shape3D`. `Default` emits no keys.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct Shape3DSettings {
    /// Top bevel (CT_Bevel).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bevel_t: Option<Bevel>,
    /// Bottom bevel (CT_Bevel).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bevel_b: Option<Bevel>,
    /// Extrusion height in EMUs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extrusion_h: Option<i64>,
    /// Extrusion color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extrusion_clr: Option<DomainDrawingColor>,
    /// Contour width in EMUs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contour_w: Option<i64>,
    /// Contour color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contour_clr: Option<DomainDrawingColor>,
    /// Preset material token (ST_PresetMaterialType), e.g. `"matte"`, `"plastic"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prst_material: Option<String>,
    /// Z-coordinate (shape depth) in EMUs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub z: Option<i64>,
    /// Opaque `<a:extLst>` XML passthrough (CT_Shape3D extLst).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext_lst: Option<String>,
}

/// Bevel properties (CT_Bevel).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct Bevel {
    /// Bevel width in EMUs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub w: Option<i64>,
    /// Bevel height in EMUs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub h: Option<i64>,
    /// Preset bevel token (ST_BevelPresetType), e.g. `"circle"`, `"slope"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prst: Option<BevelPreset>,
}

/// Bevel preset token.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BevelPreset {
    #[default]
    Circle,
    RelaxedInset,
    Slope,
    Cross,
    Angle,
    SoftRound,
    Convex,
    CoolSlant,
    Divot,
    Riblet,
    HardEdge,
    ArtDeco,
}

impl BevelPreset {
    pub fn from_ooxml_token(s: &str) -> Self {
        match s {
            "relaxedInset" => Self::RelaxedInset,
            "circle" => Self::Circle,
            "slope" => Self::Slope,
            "cross" => Self::Cross,
            "angle" => Self::Angle,
            "softRound" => Self::SoftRound,
            "convex" => Self::Convex,
            "coolSlant" => Self::CoolSlant,
            "divot" => Self::Divot,
            "riblet" => Self::Riblet,
            "hardEdge" => Self::HardEdge,
            "artDeco" => Self::ArtDeco,
            _ => Self::Circle,
        }
    }

    pub fn to_ooxml_token(&self) -> &'static str {
        match self {
            Self::RelaxedInset => "relaxedInset",
            Self::Circle => "circle",
            Self::Slope => "slope",
            Self::Cross => "cross",
            Self::Angle => "angle",
            Self::SoftRound => "softRound",
            Self::Convex => "convex",
            Self::CoolSlant => "coolSlant",
            Self::Divot => "divot",
            Self::Riblet => "riblet",
            Self::HardEdge => "hardEdge",
            Self::ArtDeco => "artDeco",
        }
    }
}

// ===========================================================================
// Converters to/from ooxml_types
// ===========================================================================

use ooxml_types::drawings as odraw;

impl From<&odraw::Bevel> for Bevel {
    fn from(b: &odraw::Bevel) -> Self {
        Self {
            w: b.w.map(|v| v.value()),
            h: b.h.map(|v| v.value()),
            prst: b.prst.map(|p| BevelPreset::from_ooxml_token(p.to_ooxml())),
        }
    }
}

impl From<Bevel> for odraw::Bevel {
    fn from(b: Bevel) -> Self {
        Self {
            w: b.w.map(odraw::StPositiveCoordinate::new_clamped),
            h: b.h.map(odraw::StPositiveCoordinate::new_clamped),
            prst: b
                .prst
                .map(|p| odraw::BevelPresetType::from_ooxml(p.to_ooxml_token())),
        }
    }
}

impl From<&odraw::Shape3D> for Shape3DSettings {
    fn from(s: &odraw::Shape3D) -> Self {
        Self {
            bevel_t: s.bevel_t.as_ref().map(Into::into),
            bevel_b: s.bevel_b.as_ref().map(Into::into),
            extrusion_h: s.extrusion_h.map(|v| v.value()),
            extrusion_clr: s.extrusion_clr.as_ref().map(Into::into),
            contour_w: s.contour_w.map(|v| v.value()),
            contour_clr: s.contour_clr.as_ref().map(Into::into),
            prst_material: s.prst_material.map(|m| m.to_ooxml().to_string()),
            z: s.z.map(|v| v.value()),
            ext_lst: s.ext_lst.clone(),
        }
    }
}

impl From<Shape3DSettings> for odraw::Shape3D {
    fn from(s: Shape3DSettings) -> Self {
        Self {
            bevel_t: s.bevel_t.map(Into::into),
            bevel_b: s.bevel_b.map(Into::into),
            extrusion_h: s.extrusion_h.map(odraw::StPositiveCoordinate::new_clamped),
            extrusion_clr: s.extrusion_clr.map(Into::into),
            contour_w: s.contour_w.map(odraw::StPositiveCoordinate::new_clamped),
            contour_clr: s.contour_clr.map(Into::into),
            prst_material: s
                .prst_material
                .map(|m| odraw::PresetMaterialType::from_ooxml(&m)),
            z: s.z.map(odraw::StCoordinate::new),
            ext_lst: s.ext_lst,
        }
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_shape3d() -> odraw::Shape3D {
        odraw::Shape3D {
            bevel_t: Some(odraw::Bevel {
                w: Some(odraw::StPositiveCoordinate::new_clamped(76200)),
                h: Some(odraw::StPositiveCoordinate::new_clamped(38100)),
                prst: Some(odraw::BevelPresetType::Slope),
            }),
            bevel_b: None,
            extrusion_h: Some(odraw::StPositiveCoordinate::new_clamped(100000)),
            extrusion_clr: Some(odraw::DrawingColor::SrgbClr {
                val: "FF0000".into(),
                transforms: Vec::new(),
            }),
            contour_w: None,
            contour_clr: None,
            prst_material: Some(odraw::PresetMaterialType::Matte),
            z: Some(odraw::StCoordinate::new(12700)),
            ext_lst: None,
        }
    }

    #[test]
    fn shape3d_round_trip_full() {
        let original = sample_shape3d();
        let dom: Shape3DSettings = (&original).into();
        let round: odraw::Shape3D = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn shape3d_default_emits_no_keys() {
        let s = Shape3DSettings::default();
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(json, "{}");
    }

    #[test]
    fn bevel_default_emits_no_keys() {
        let b = Bevel::default();
        let json = serde_json::to_string(&b).unwrap();
        assert_eq!(json, "{}");
    }

    #[test]
    fn bevel_preset_tokens_round_trip() {
        for preset in [
            odraw::BevelPresetType::RelaxedInset,
            odraw::BevelPresetType::Circle,
            odraw::BevelPresetType::Slope,
            odraw::BevelPresetType::Cross,
            odraw::BevelPresetType::Angle,
            odraw::BevelPresetType::SoftRound,
            odraw::BevelPresetType::Convex,
            odraw::BevelPresetType::CoolSlant,
            odraw::BevelPresetType::Divot,
            odraw::BevelPresetType::Riblet,
            odraw::BevelPresetType::HardEdge,
            odraw::BevelPresetType::ArtDeco,
        ] {
            let dom = BevelPreset::from_ooxml_token(preset.to_ooxml());
            assert_eq!(dom.to_ooxml_token(), preset.to_ooxml());
        }
    }

    #[test]
    fn shape3d_with_ext_lst_round_trip() {
        let mut original = sample_shape3d();
        original.ext_lst = Some("<a:extLst><a:ext uri=\"x\"/></a:extLst>".into());
        let dom: Shape3DSettings = (&original).into();
        let round: odraw::Shape3D = dom.into();
        assert_eq!(original, round);
    }
}
