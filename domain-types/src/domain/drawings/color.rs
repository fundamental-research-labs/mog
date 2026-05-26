//! Domain-level drawing color representation.
//!
//! `DomainDrawingColor` is the structural mirror of `ooxml_types::drawings::DrawingColor`,
//! rebuilt in `domain-types` so shared drawing primitives (Scene/Shape3D, effects,
//! shape outlines) can carry color content without importing `ooxml_types` across
//! the domain boundary.
//!
//! Scheme / system / preset color tokens are stored as the raw OOXML token string
//! (e.g. `"accent1"`, `"windowText"`, `"red"`). Converters translate to/from the
//! `ooxml_types` enum variants. This keeps the domain representation independent
//! of the OOXML enum surface while remaining lossless — an unknown token survives
//! round-trip as its original string.

use serde::{Deserialize, Serialize};

/// Color specification — structural mirror of `ooxml_types::drawings::DrawingColor`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DomainDrawingColor {
    /// sRGB hex (e.g. `"FF0000"`).
    SrgbClr {
        val: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransformSpec>,
    },
    /// Theme scheme color token (e.g. `"accent1"`, `"dk1"`).
    SchemeClr {
        val: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransformSpec>,
    },
    /// HSL color.
    HslClr {
        hue: i32,
        sat: i32,
        lum: i32,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransformSpec>,
    },
    /// System color token (e.g. `"windowText"`), with the last resolved sRGB hex.
    SysClr {
        val: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        last_clr: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransformSpec>,
    },
    /// Preset named color (e.g. `"red"`).
    PrstClr {
        val: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransformSpec>,
    },
    /// scRGB (linear RGB) in percent units (0..=100000).
    ScrgbClr {
        r: i32,
        g: i32,
        b: i32,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransformSpec>,
    },
}

impl Default for DomainDrawingColor {
    fn default() -> Self {
        Self::SrgbClr {
            val: String::new(),
            transforms: Vec::new(),
        }
    }
}

/// A color transform applied to a base color (mirror of
/// `ooxml_types::drawings::ColorTransform`).
///
/// `name` holds the OOXML element name (e.g. `"alpha"`, `"lumMod"`, `"tint"`,
/// `"comp"`, `"gray"`). `val` is the transform's integer value where applicable
/// (`None` for flag-style transforms: `comp`, `inv`, `gray`, `gamma`, `invGamma`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorTransformSpec {
    /// OOXML element name (e.g. `"alpha"`, `"lumMod"`).
    pub name: ColorTransformKind,
    /// Transform value in OOXML units. `None` for flag-only transforms.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub val: Option<i32>,
}

/// Enumeration of color-transform kinds (mirror of `ooxml_types::drawings::ColorTransform`
/// discriminants).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColorTransformKind {
    Alpha,
    AlphaOff,
    AlphaMod,
    Hue,
    HueOff,
    HueMod,
    Sat,
    SatOff,
    SatMod,
    Lum,
    LumOff,
    LumMod,
    Red,
    RedOff,
    RedMod,
    Green,
    GreenOff,
    GreenMod,
    Blue,
    BlueOff,
    BlueMod,
    Tint,
    Shade,
    Comp,
    Inv,
    Gray,
    Gamma,
    InvGamma,
}

// ===========================================================================
// Converters to/from ooxml_types
// ===========================================================================

use ooxml_types::drawings::{ColorTransform as OColorTransform, DrawingColor as ODrawingColor};

impl From<&OColorTransform> for ColorTransformSpec {
    fn from(t: &OColorTransform) -> Self {
        let (name, val) = match *t {
            OColorTransform::Alpha { val } => (ColorTransformKind::Alpha, Some(val)),
            OColorTransform::AlphaOff { val } => (ColorTransformKind::AlphaOff, Some(val)),
            OColorTransform::AlphaMod { val } => (ColorTransformKind::AlphaMod, Some(val)),
            OColorTransform::Hue { val } => (ColorTransformKind::Hue, Some(val)),
            OColorTransform::HueOff { val } => (ColorTransformKind::HueOff, Some(val)),
            OColorTransform::HueMod { val } => (ColorTransformKind::HueMod, Some(val)),
            OColorTransform::Sat { val } => (ColorTransformKind::Sat, Some(val)),
            OColorTransform::SatOff { val } => (ColorTransformKind::SatOff, Some(val)),
            OColorTransform::SatMod { val } => (ColorTransformKind::SatMod, Some(val)),
            OColorTransform::Lum { val } => (ColorTransformKind::Lum, Some(val)),
            OColorTransform::LumOff { val } => (ColorTransformKind::LumOff, Some(val)),
            OColorTransform::LumMod { val } => (ColorTransformKind::LumMod, Some(val)),
            OColorTransform::Red { val } => (ColorTransformKind::Red, Some(val)),
            OColorTransform::RedOff { val } => (ColorTransformKind::RedOff, Some(val)),
            OColorTransform::RedMod { val } => (ColorTransformKind::RedMod, Some(val)),
            OColorTransform::Green { val } => (ColorTransformKind::Green, Some(val)),
            OColorTransform::GreenOff { val } => (ColorTransformKind::GreenOff, Some(val)),
            OColorTransform::GreenMod { val } => (ColorTransformKind::GreenMod, Some(val)),
            OColorTransform::Blue { val } => (ColorTransformKind::Blue, Some(val)),
            OColorTransform::BlueOff { val } => (ColorTransformKind::BlueOff, Some(val)),
            OColorTransform::BlueMod { val } => (ColorTransformKind::BlueMod, Some(val)),
            OColorTransform::Tint { val } => (ColorTransformKind::Tint, Some(val)),
            OColorTransform::Shade { val } => (ColorTransformKind::Shade, Some(val)),
            OColorTransform::Comp => (ColorTransformKind::Comp, None),
            OColorTransform::Inv => (ColorTransformKind::Inv, None),
            OColorTransform::Gray => (ColorTransformKind::Gray, None),
            OColorTransform::Gamma => (ColorTransformKind::Gamma, None),
            OColorTransform::InvGamma => (ColorTransformKind::InvGamma, None),
        };
        Self { name, val }
    }
}

impl From<ColorTransformSpec> for OColorTransform {
    fn from(t: ColorTransformSpec) -> Self {
        let v = t.val.unwrap_or(0);
        match t.name {
            ColorTransformKind::Alpha => Self::Alpha { val: v },
            ColorTransformKind::AlphaOff => Self::AlphaOff { val: v },
            ColorTransformKind::AlphaMod => Self::AlphaMod { val: v },
            ColorTransformKind::Hue => Self::Hue { val: v },
            ColorTransformKind::HueOff => Self::HueOff { val: v },
            ColorTransformKind::HueMod => Self::HueMod { val: v },
            ColorTransformKind::Sat => Self::Sat { val: v },
            ColorTransformKind::SatOff => Self::SatOff { val: v },
            ColorTransformKind::SatMod => Self::SatMod { val: v },
            ColorTransformKind::Lum => Self::Lum { val: v },
            ColorTransformKind::LumOff => Self::LumOff { val: v },
            ColorTransformKind::LumMod => Self::LumMod { val: v },
            ColorTransformKind::Red => Self::Red { val: v },
            ColorTransformKind::RedOff => Self::RedOff { val: v },
            ColorTransformKind::RedMod => Self::RedMod { val: v },
            ColorTransformKind::Green => Self::Green { val: v },
            ColorTransformKind::GreenOff => Self::GreenOff { val: v },
            ColorTransformKind::GreenMod => Self::GreenMod { val: v },
            ColorTransformKind::Blue => Self::Blue { val: v },
            ColorTransformKind::BlueOff => Self::BlueOff { val: v },
            ColorTransformKind::BlueMod => Self::BlueMod { val: v },
            ColorTransformKind::Tint => Self::Tint { val: v },
            ColorTransformKind::Shade => Self::Shade { val: v },
            ColorTransformKind::Comp => Self::Comp,
            ColorTransformKind::Inv => Self::Inv,
            ColorTransformKind::Gray => Self::Gray,
            ColorTransformKind::Gamma => Self::Gamma,
            ColorTransformKind::InvGamma => Self::InvGamma,
        }
    }
}

fn transforms_from(xs: &[OColorTransform]) -> Vec<ColorTransformSpec> {
    xs.iter().map(Into::into).collect()
}

fn transforms_into(xs: Vec<ColorTransformSpec>) -> Vec<OColorTransform> {
    xs.into_iter().map(Into::into).collect()
}

impl From<&ODrawingColor> for DomainDrawingColor {
    fn from(c: &ODrawingColor) -> Self {
        match c {
            ODrawingColor::SrgbClr { val, transforms } => Self::SrgbClr {
                val: val.clone(),
                transforms: transforms_from(transforms),
            },
            ODrawingColor::SchemeClr { val, transforms } => Self::SchemeClr {
                val: val.to_ooxml().to_string(),
                transforms: transforms_from(transforms),
            },
            ODrawingColor::HslClr {
                hue,
                sat,
                lum,
                transforms,
            } => Self::HslClr {
                hue: *hue,
                sat: *sat,
                lum: *lum,
                transforms: transforms_from(transforms),
            },
            ODrawingColor::SysClr {
                val,
                last_clr,
                transforms,
            } => Self::SysClr {
                val: val.to_ooxml().to_string(),
                last_clr: last_clr.clone(),
                transforms: transforms_from(transforms),
            },
            ODrawingColor::PrstClr { val, transforms } => Self::PrstClr {
                val: val.to_ooxml().to_string(),
                transforms: transforms_from(transforms),
            },
            ODrawingColor::ScrgbClr {
                r,
                g,
                b,
                transforms,
            } => Self::ScrgbClr {
                r: *r,
                g: *g,
                b: *b,
                transforms: transforms_from(transforms),
            },
        }
    }
}

impl From<DomainDrawingColor> for ODrawingColor {
    fn from(c: DomainDrawingColor) -> Self {
        use ooxml_types::drawings::{PresetColorVal, SchemeColor, SystemColorVal};
        match c {
            DomainDrawingColor::SrgbClr { val, transforms } => Self::SrgbClr {
                val,
                transforms: transforms_into(transforms),
            },
            DomainDrawingColor::SchemeClr { val, transforms } => Self::SchemeClr {
                val: SchemeColor::from_ooxml(&val).unwrap_or_default(),
                transforms: transforms_into(transforms),
            },
            DomainDrawingColor::HslClr {
                hue,
                sat,
                lum,
                transforms,
            } => Self::HslClr {
                hue,
                sat,
                lum,
                transforms: transforms_into(transforms),
            },
            DomainDrawingColor::SysClr {
                val,
                last_clr,
                transforms,
            } => Self::SysClr {
                val: SystemColorVal::from_ooxml(&val),
                last_clr,
                transforms: transforms_into(transforms),
            },
            DomainDrawingColor::PrstClr { val, transforms } => Self::PrstClr {
                val: PresetColorVal::from_ooxml(&val),
                transforms: transforms_into(transforms),
            },
            DomainDrawingColor::ScrgbClr {
                r,
                g,
                b,
                transforms,
            } => Self::ScrgbClr {
                r,
                g,
                b,
                transforms: transforms_into(transforms),
            },
        }
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srgb_round_trip() {
        let original = ODrawingColor::SrgbClr {
            val: "FF00AA".into(),
            transforms: vec![
                OColorTransform::LumMod { val: 80000 },
                OColorTransform::Alpha { val: 50000 },
            ],
        };
        let dom: DomainDrawingColor = (&original).into();
        let round: ODrawingColor = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn scheme_round_trip_known() {
        use ooxml_types::drawings::SchemeColor;
        let original = ODrawingColor::SchemeClr {
            val: SchemeColor::Accent3,
            transforms: vec![OColorTransform::Shade { val: 50000 }],
        };
        let dom: DomainDrawingColor = (&original).into();
        let round: ODrawingColor = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn scrgb_and_hsl_round_trip() {
        let scrgb = ODrawingColor::ScrgbClr {
            r: 10000,
            g: 20000,
            b: 30000,
            transforms: Vec::new(),
        };
        let dom_scrgb: DomainDrawingColor = (&scrgb).into();
        assert_eq!(scrgb, dom_scrgb.into());

        let hsl = ODrawingColor::HslClr {
            hue: 5,
            sat: 80000,
            lum: 50000,
            transforms: vec![OColorTransform::Comp],
        };
        let dom_hsl: DomainDrawingColor = (&hsl).into();
        assert_eq!(hsl, dom_hsl.into());
    }

    #[test]
    fn sys_round_trip_with_last_clr() {
        use ooxml_types::drawings::SystemColorVal;
        let original = ODrawingColor::SysClr {
            val: SystemColorVal::WindowText,
            last_clr: Some("000000".into()),
            transforms: Vec::new(),
        };
        let dom: DomainDrawingColor = (&original).into();
        let round: ODrawingColor = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn flag_transforms_round_trip() {
        let original = ODrawingColor::SrgbClr {
            val: "123456".into(),
            transforms: vec![
                OColorTransform::Comp,
                OColorTransform::Inv,
                OColorTransform::Gray,
                OColorTransform::Gamma,
                OColorTransform::InvGamma,
            ],
        };
        let dom: DomainDrawingColor = (&original).into();
        let round: ODrawingColor = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn default_serialization_is_srgb_empty() {
        let default = DomainDrawingColor::default();
        let json = serde_json::to_string(&default).unwrap();
        assert_eq!(json, r#"{"type":"srgbClr","val":""}"#);
    }
}
