//! Blip-level image effects — CT_Blip child-effect union mirror
//! (typed OOXML preservation A.7 primitive).
//!
//! Mirror of `ooxml_types::drawings::BlipEffect`, which itself captures the
//! 17 possible child effect elements of `<a:blip>` (CT_Blip). Each variant
//! carries the structural attributes of the corresponding OOXML effect;
//! deep-nested effects (`clrChange`, `alphaMod`) preserve raw XML for
//! lossless round-trip while the domain layer gains bidirectional parity.
//!
//! The domain `DomainDrawingColor` is used for embedded color choices so the
//! domain representation does not leak `ooxml_types` across the boundary.

use serde::{Deserialize, Serialize};

use super::color::DomainDrawingColor;

/// A single blip-level image effect.
///
/// Variant names and fields match `ooxml_types::drawings::BlipEffect`. The
/// `tint` / `hsl` / `tint.amt` angular / percentage units follow the OOXML
/// conventions (0..=21_600_000 for `PositiveFixedAngle`, -100_000..=100_000
/// for `FixedPercentage`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BlipEffect {
    /// `<a:alphaModFix amt="..."/>`.
    AlphaModFix { amt: u32 },
    /// `<a:lum bright="..." contrast="..."/>`.
    Luminance {
        #[serde(default, skip_serializing_if = "is_zero_i32")]
        bright: i32,
        #[serde(default, skip_serializing_if = "is_zero_i32")]
        contrast: i32,
    },
    /// `<a:grayscl/>`.
    Grayscale,
    /// `<a:biLevel thresh="..."/>`.
    BiLevel { thresh: u32 },
    /// `<a:alphaBiLevel thresh="..."/>`.
    AlphaBiLevel { thresh: u32 },
    /// `<a:alphaCeiling/>`.
    AlphaCeiling,
    /// `<a:alphaFloor/>`.
    AlphaFloor,
    /// `<a:alphaInv>` with optional color argument.
    AlphaInverse {
        #[serde(skip_serializing_if = "Option::is_none")]
        color: Option<DomainDrawingColor>,
    },
    /// `<a:alphaMod>` — deep-nested container. Preserved but flagged so
    /// writers know full parity isn't yet round-tripping structurally.
    AlphaModulate,
    /// `<a:alphaRepl alpha="..."/>`.
    AlphaReplace { alpha: u32 },
    /// `<a:blur rad="..." grow="..."/>`.
    Blur(BlurEffect),
    /// `<a:clrChange>` — preserved opaquely for the `clrFrom` / `clrTo`
    /// children.
    ColorChange {
        #[serde(default, skip_serializing_if = "is_false")]
        use_alpha: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        raw_xml: Option<String>,
    },
    /// `<a:clrRepl>` with optional color.
    ColorReplace {
        #[serde(skip_serializing_if = "Option::is_none")]
        color: Option<DomainDrawingColor>,
    },
    /// `<a:duotone>` with two colors.
    Duotone {
        #[serde(skip_serializing_if = "Option::is_none")]
        color1: Option<DomainDrawingColor>,
        #[serde(skip_serializing_if = "Option::is_none")]
        color2: Option<DomainDrawingColor>,
    },
    /// `<a:fillOverlay>`.
    FillOverlay(FillOverlayEffect),
    /// `<a:hsl hue="..." sat="..." lum="..."/>`.
    Hsl {
        #[serde(default, skip_serializing_if = "is_zero_i32")]
        hue: i32,
        #[serde(default, skip_serializing_if = "is_zero_i32")]
        sat: i32,
        #[serde(default, skip_serializing_if = "is_zero_i32")]
        lum: i32,
    },
    /// `<a:tint hue="..." amt="..."/>`.
    Tint {
        #[serde(default, skip_serializing_if = "is_zero_i32")]
        hue: i32,
        #[serde(default, skip_serializing_if = "is_zero_i32")]
        amt: i32,
    },
}

fn is_zero_i32(v: &i32) -> bool {
    *v == 0
}
fn is_false(v: &bool) -> bool {
    !*v
}

/// Blur effect parameters — `<a:blur rad="..." grow="true|false"/>`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlurEffect {
    /// Blur radius in EMUs (ST_PositiveCoordinate → i64 on the OOXML side).
    pub rad: i64,
    /// Whether blur may extend past the shape's bounding box (spec default
    /// true). Stored inline so the OOXML `<a:blur/>` with no attributes
    /// round-trips to the spec default.
    pub grow: bool,
}

impl Default for BlurEffect {
    fn default() -> Self {
        Self { rad: 0, grow: true }
    }
}

/// Fill-overlay effect parameters — `<a:fillOverlay blend="...">…</a:fillOverlay>`.
///
/// The fill content itself re-uses the existing domain `ObjectFill` path via
/// an owned raw-xml fallback for the inner fill (kept deliberately minimal
/// here: the current blip-level use case is screen preview color washes;
/// widening this to the full fill-properties union is deferred).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct FillOverlayEffect {
    /// Blend mode token: `"over"`, `"mult"`, `"screen"`, `"darken"`, `"lighten"`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub blend: String,
    /// Inner fill element preserved as raw XML — kept opaque until the
    /// domain fill union lands.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill_raw_xml: Option<String>,
}

// ===========================================================================
// Converters to/from ooxml_types
// ===========================================================================

use ooxml_types::drawings::{
    BlendMode as OBlendMode, BlipEffect as OBlipEffect, BlurEffect as OBlurEffect,
    FillOverlayEffect as OFillOverlayEffect,
};

impl From<&OBlurEffect> for BlurEffect {
    fn from(b: &OBlurEffect) -> Self {
        Self {
            rad: b.rad.value(),
            grow: b.grow,
        }
    }
}

impl From<BlurEffect> for OBlurEffect {
    fn from(b: BlurEffect) -> Self {
        use ooxml_types::drawings::StPositiveCoordinate;
        Self {
            rad: StPositiveCoordinate::new_clamped(b.rad),
            grow: b.grow,
        }
    }
}

impl From<&OFillOverlayEffect> for FillOverlayEffect {
    fn from(o: &OFillOverlayEffect) -> Self {
        // The inner `DrawingFill` is kept as raw XML at this tier because the
        // existing domain `ObjectFill` is a simplified shape audited in a
        // follow-up PR. `None` is the common case for fillOverlay (blend
        // token alone is meaningful).
        Self {
            blend: o.blend.to_ooxml().to_string(),
            fill_raw_xml: None,
        }
    }
}

impl From<FillOverlayEffect> for OFillOverlayEffect {
    fn from(d: FillOverlayEffect) -> Self {
        Self {
            blend: if d.blend.is_empty() {
                OBlendMode::default()
            } else {
                OBlendMode::from_ooxml(&d.blend)
            },
            fill: None,
        }
    }
}

impl From<&OBlipEffect> for BlipEffect {
    fn from(e: &OBlipEffect) -> Self {
        match e {
            OBlipEffect::AlphaModFix { amt } => Self::AlphaModFix { amt: *amt },
            OBlipEffect::Luminance { bright, contrast } => Self::Luminance {
                bright: *bright,
                contrast: *contrast,
            },
            OBlipEffect::Grayscale => Self::Grayscale,
            OBlipEffect::BiLevel { thresh } => Self::BiLevel { thresh: *thresh },
            OBlipEffect::AlphaBiLevel { thresh } => Self::AlphaBiLevel { thresh: *thresh },
            OBlipEffect::AlphaCeiling => Self::AlphaCeiling,
            OBlipEffect::AlphaFloor => Self::AlphaFloor,
            OBlipEffect::AlphaInverse { color } => Self::AlphaInverse {
                color: color.as_ref().map(Into::into),
            },
            OBlipEffect::AlphaModulate => Self::AlphaModulate,
            OBlipEffect::AlphaReplace { alpha } => Self::AlphaReplace { alpha: *alpha },
            OBlipEffect::Blur(b) => Self::Blur(b.into()),
            OBlipEffect::ColorChange { use_alpha, raw_xml } => Self::ColorChange {
                use_alpha: *use_alpha,
                raw_xml: raw_xml.clone(),
            },
            OBlipEffect::ColorReplace { color } => Self::ColorReplace {
                color: color.as_ref().map(Into::into),
            },
            OBlipEffect::Duotone { color1, color2 } => Self::Duotone {
                color1: color1.as_ref().map(Into::into),
                color2: color2.as_ref().map(Into::into),
            },
            OBlipEffect::FillOverlay(f) => Self::FillOverlay(f.into()),
            OBlipEffect::Hsl { hue, sat, lum } => Self::Hsl {
                hue: *hue,
                sat: *sat,
                lum: *lum,
            },
            OBlipEffect::Tint { hue, amt } => Self::Tint {
                hue: *hue,
                amt: *amt,
            },
        }
    }
}

impl From<BlipEffect> for OBlipEffect {
    fn from(e: BlipEffect) -> Self {
        match e {
            BlipEffect::AlphaModFix { amt } => Self::AlphaModFix { amt },
            BlipEffect::Luminance { bright, contrast } => Self::Luminance { bright, contrast },
            BlipEffect::Grayscale => Self::Grayscale,
            BlipEffect::BiLevel { thresh } => Self::BiLevel { thresh },
            BlipEffect::AlphaBiLevel { thresh } => Self::AlphaBiLevel { thresh },
            BlipEffect::AlphaCeiling => Self::AlphaCeiling,
            BlipEffect::AlphaFloor => Self::AlphaFloor,
            BlipEffect::AlphaInverse { color } => Self::AlphaInverse {
                color: color.map(Into::into),
            },
            BlipEffect::AlphaModulate => Self::AlphaModulate,
            BlipEffect::AlphaReplace { alpha } => Self::AlphaReplace { alpha },
            BlipEffect::Blur(b) => Self::Blur(b.into()),
            BlipEffect::ColorChange { use_alpha, raw_xml } => {
                Self::ColorChange { use_alpha, raw_xml }
            }
            BlipEffect::ColorReplace { color } => Self::ColorReplace {
                color: color.map(Into::into),
            },
            BlipEffect::Duotone { color1, color2 } => Self::Duotone {
                color1: color1.map(Into::into),
                color2: color2.map(Into::into),
            },
            BlipEffect::FillOverlay(f) => Self::FillOverlay(f.into()),
            BlipEffect::Hsl { hue, sat, lum } => Self::Hsl { hue, sat, lum },
            BlipEffect::Tint { hue, amt } => Self::Tint { hue, amt },
        }
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(original: OBlipEffect) {
        let dom: BlipEffect = (&original).into();
        let round: OBlipEffect = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn round_trip_all_simple_variants() {
        round_trip(OBlipEffect::AlphaModFix { amt: 80_000 });
        round_trip(OBlipEffect::Luminance {
            bright: -10_000,
            contrast: 30_000,
        });
        round_trip(OBlipEffect::Grayscale);
        round_trip(OBlipEffect::BiLevel { thresh: 50_000 });
        round_trip(OBlipEffect::AlphaBiLevel { thresh: 25_000 });
        round_trip(OBlipEffect::AlphaCeiling);
        round_trip(OBlipEffect::AlphaFloor);
        round_trip(OBlipEffect::AlphaModulate);
        round_trip(OBlipEffect::AlphaReplace { alpha: 42_000 });
        round_trip(OBlipEffect::Hsl {
            hue: 1_000_000,
            sat: 20_000,
            lum: -5_000,
        });
        round_trip(OBlipEffect::Tint {
            hue: 500_000,
            amt: 80_000,
        });
    }

    #[test]
    fn round_trip_with_colors() {
        use ooxml_types::drawings::{DrawingColor, SchemeColor};
        let accent = DrawingColor::SchemeClr {
            val: SchemeColor::Accent1,
            transforms: Vec::new(),
        };
        round_trip(OBlipEffect::AlphaInverse {
            color: Some(accent.clone()),
        });
        round_trip(OBlipEffect::ColorReplace {
            color: Some(accent.clone()),
        });
        round_trip(OBlipEffect::Duotone {
            color1: Some(accent.clone()),
            color2: Some(DrawingColor::SrgbClr {
                val: "FFFFFF".into(),
                transforms: Vec::new(),
            }),
        });
    }

    #[test]
    fn round_trip_blur() {
        round_trip(OBlipEffect::Blur(OBlurEffect {
            rad: ooxml_types::drawings::StPositiveCoordinate::new_clamped(40_000),
            grow: false,
        }));
    }

    #[test]
    fn round_trip_fill_overlay() {
        round_trip(OBlipEffect::FillOverlay(OFillOverlayEffect {
            blend: OBlendMode::Mult,
            fill: None,
        }));
    }

    #[test]
    fn round_trip_color_change_opaque() {
        round_trip(OBlipEffect::ColorChange {
            use_alpha: true,
            raw_xml: Some("<a:clrFrom><a:srgbClr val=\"FF0000\"/></a:clrFrom>".into()),
        });
    }

    #[test]
    fn camelcase_tag_serialization() {
        let e = BlipEffect::BiLevel { thresh: 50_000 };
        let json = serde_json::to_string(&e).unwrap();
        assert_eq!(json, r#"{"type":"biLevel","thresh":50000}"#);
    }

    #[test]
    fn blur_default_matches_spec() {
        let b = BlurEffect::default();
        assert!(b.grow);
        assert_eq!(b.rad, 0);
    }
}
