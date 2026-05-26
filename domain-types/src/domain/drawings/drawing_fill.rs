//! CT_FillProperties / EG_FillProperties mirror — tagged union of fill kinds
//! on drawing primitives.
//!
//! Mirror of `ooxml_types::drawings::DrawingFill`. The OOXML XSD
//! EG_FillProperties group is a six-way choice among
//! `<a:noFill/>`, `<a:solidFill>`, `<a:gradFill>`, `<a:pattFill>`,
//! `<a:blipFill>`, and `<a:grpFill/>`. This module ships the domain-level
//! lossless typed union so Picture/Shape/Connector elevation can carry
//! `sp_pr.fill` without falling back to the UI-ergonomic simplified
//! `ObjectFill` subset.
//!
//! The sub-structs (`GradientFillSpec`, `PatternFillSpec`, `BlipFillSpec`)
//! are full-fidelity mirrors of their OOXML counterparts: they do not
//! reuse the simplified domain `GradientFill`/`PatternFill`/`BlipFill`
//! (those drop information for UI ergonomics). The existing `ObjectFill` view
//! remains a denormalized UI projection and this `DrawingFill` is the source of
//! truth.
//!
//! Color payloads use `DomainDrawingColor` so the domain layer does not
//! import `ooxml_types::DrawingColor` across the boundary.

use serde::{Deserialize, Serialize};

use super::color::DomainDrawingColor;
use super::fill_mode::TileFlip;
use super::source_rect::SourceRect;

// ===========================================================================
// Top-level union
// ===========================================================================

/// Fill specification — the EG_FillProperties choice group.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DrawingFill {
    /// `<a:noFill/>` — transparent.
    NoFill,
    /// `<a:solidFill>` — a single `DomainDrawingColor`.
    Solid { color: DomainDrawingColor },
    /// `<a:gradFill>` — gradient paint.
    Gradient(GradientFillSpec),
    /// `<a:pattFill>` — preset pattern with fg/bg colors.
    Pattern(PatternFillSpec),
    /// `<a:blipFill>` — image / texture fill.
    Blip(BlipFillSpec),
    /// `<a:grpFill/>` — inherit fill from parent group.
    GroupFill,
}

impl Default for DrawingFill {
    /// Default to `NoFill` — matches `ooxml_types::drawings::DrawingFill`.
    fn default() -> Self {
        Self::NoFill
    }
}

// ===========================================================================
// GradientFillSpec
// ===========================================================================

/// Gradient fill (CT_GradientFillProperties).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct GradientFillSpec {
    /// Linear-shade angle in 60_000ths of a degree (`lin/@ang`). None = no
    /// `<a:lin>` element / attribute absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lin_ang: Option<i32>,
    /// Whether the linear angle scales with the shape (`lin/@scaled`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lin_scaled: Option<bool>,
    /// Gradient color stops (2+ in valid gradients).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub stops: Vec<GradientStopSpec>,
    /// Path-shade type (`path/@path`). None = linear shading.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<GradientPathType>,
    /// Fill-to rectangle for path gradients.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill_to_rect: Option<SourceRect>,
    /// Tile rectangle for gradient tiling.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tile_rect: Option<SourceRect>,
    /// Tile flip mode.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flip: Option<TileFlip>,
    /// Whether the gradient rotates with the shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotate_with_shape: Option<bool>,
}

/// Gradient color stop (one entry inside `<a:gsLst>`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradientStopSpec {
    /// Position along the gradient on the 0..=100_000 scale.
    pub position: u32,
    /// Color at this stop.
    pub color: DomainDrawingColor,
}

/// Gradient path type (ST_PathShadeType).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GradientPathType {
    /// `circle` — circular gradient from center.
    Circle,
    /// `rect` — rectangular gradient.
    Rect,
    /// `shape` — shape-conforming gradient.
    Shape,
}

impl GradientPathType {
    #[must_use]
    pub fn from_ooxml(s: &str) -> Option<Self> {
        match s {
            "circle" => Some(Self::Circle),
            "rect" => Some(Self::Rect),
            "shape" => Some(Self::Shape),
            _ => None,
        }
    }
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Circle => "circle",
            Self::Rect => "rect",
            Self::Shape => "shape",
        }
    }
}

// ===========================================================================
// PatternFillSpec
// ===========================================================================

/// Pattern fill (CT_PatternFillProperties) — preset pattern + fg/bg colors.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct PatternFillSpec {
    /// `@prst` token (e.g. `"pct5"`, `"dkHorz"`, `"diagCross"`). Empty =
    /// attribute absent.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub preset: String,
    /// `<a:fgClr>` foreground color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fg_color: Option<DomainDrawingColor>,
    /// `<a:bgClr>` background color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bg_color: Option<DomainDrawingColor>,
}

// ===========================================================================
// BlipFillSpec
// ===========================================================================

/// Blip fill (CT_BlipFillProperties) — image / texture fill.
///
/// A subset of the full CT_BlipFillProperties surface: relationship ids,
/// compression state, source-rect crop, and the stretch/tile choice. Deep
/// per-blip effect chains (the 17 BlipEffect variants, which have their
/// own primitive in `domain::drawings::blip_effect`) are carried via
/// [`super::blip_effect::BlipEffect`] to keep this struct focused on the
/// container.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct BlipFillSpec {
    /// `<a:blip r:embed="..."/>` relationship id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embed_id: Option<String>,
    /// `<a:blip r:link="..."/>` relationship id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_id: Option<String>,
    /// `<a:blip cstate="..."/>` compression state.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compression: Option<super::compression::CompressionState>,
    /// `<a:srcRect>` — crop percentages.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_rect: Option<SourceRect>,
    /// Blip-level effect chain (children of `<a:blip>`).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<super::blip_effect::BlipEffect>,
    /// Stretch / tile choice (CT_BlipFillProperties child).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill_mode: Option<super::fill_mode::FillMode>,
    /// `@dpi` image resolution.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dpi: Option<u32>,
    /// `@rotWithShape` — whether the fill rotates with the shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rot_with_shape: Option<bool>,
    /// `<a:blip>/<a:extLst>` opaque tier-1 passthrough.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext_lst: Option<String>,
    /// Writer bookkeeping: bitmask of which `srcRect` edges were explicit
    /// on parse (bit 0 = l, 1 = t, 2 = r, 3 = b). Lets the writer round-
    /// trip "attribute present but default 0" distinct from absent.
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    pub src_rect_explicit: u8,
}

fn is_zero_u8(v: &u8) -> bool {
    *v == 0
}

// ===========================================================================
// Converters to/from ooxml_types
// ===========================================================================

use ooxml_types::drawings as odraw;

impl From<&odraw::GradientStop> for GradientStopSpec {
    fn from(s: &odraw::GradientStop) -> Self {
        Self {
            position: s.position.value(),
            color: (&s.color).into(),
        }
    }
}

impl From<GradientStopSpec> for odraw::GradientStop {
    fn from(s: GradientStopSpec) -> Self {
        Self {
            position: odraw::StPositiveFixedPercentageDecimal::new_clamped(s.position),
            color: s.color.into(),
        }
    }
}

impl From<&odraw::GradientPathType> for GradientPathType {
    fn from(p: &odraw::GradientPathType) -> Self {
        match p {
            odraw::GradientPathType::Circle => Self::Circle,
            odraw::GradientPathType::Rect => Self::Rect,
            odraw::GradientPathType::Shape => Self::Shape,
        }
    }
}

impl From<GradientPathType> for odraw::GradientPathType {
    fn from(p: GradientPathType) -> Self {
        match p {
            GradientPathType::Circle => Self::Circle,
            GradientPathType::Rect => Self::Rect,
            GradientPathType::Shape => Self::Shape,
        }
    }
}

impl From<&odraw::GradientFill> for GradientFillSpec {
    fn from(g: &odraw::GradientFill) -> Self {
        Self {
            lin_ang: g.lin_ang.map(|a| a.value()),
            lin_scaled: g.lin_scaled,
            stops: g.stops.iter().map(Into::into).collect(),
            path: g.path.as_ref().map(Into::into),
            fill_to_rect: g.fill_to_rect.as_ref().map(Into::into),
            tile_rect: g.tile_rect.as_ref().map(Into::into),
            flip: g.flip.as_ref().map(Into::into),
            rotate_with_shape: g.rotate_with_shape,
        }
    }
}

impl From<GradientFillSpec> for odraw::GradientFill {
    fn from(g: GradientFillSpec) -> Self {
        Self {
            lin_ang: g.lin_ang.map(odraw::StAngle::new),
            lin_scaled: g.lin_scaled,
            stops: g.stops.into_iter().map(Into::into).collect(),
            path: g.path.map(Into::into),
            fill_to_rect: g.fill_to_rect.map(Into::into),
            tile_rect: g.tile_rect.map(Into::into),
            flip: g.flip.map(Into::into),
            rotate_with_shape: g.rotate_with_shape,
        }
    }
}

impl From<&odraw::PatternFill> for PatternFillSpec {
    fn from(p: &odraw::PatternFill) -> Self {
        Self {
            preset: p
                .preset
                .map(|pr| pr.to_ooxml().to_string())
                .unwrap_or_default(),
            fg_color: p.fg_color.as_ref().map(Into::into),
            bg_color: p.bg_color.as_ref().map(Into::into),
        }
    }
}

impl From<PatternFillSpec> for odraw::PatternFill {
    fn from(p: PatternFillSpec) -> Self {
        Self {
            preset: if p.preset.is_empty() {
                None
            } else {
                odraw::PresetPatternVal::from_ooxml(&p.preset)
            },
            fg_color: p.fg_color.map(Into::into),
            bg_color: p.bg_color.map(Into::into),
        }
    }
}

impl From<&odraw::BlipFill> for BlipFillSpec {
    fn from(b: &odraw::BlipFill) -> Self {
        Self {
            embed_id: b.embed_id.clone(),
            link_id: b.link_id.clone(),
            compression: b.compression.as_ref().map(Into::into),
            source_rect: b.source_rect.as_ref().map(Into::into),
            effects: b.effects.iter().map(Into::into).collect(),
            fill_mode: b.fill_mode.as_ref().map(Into::into),
            dpi: b.dpi,
            rot_with_shape: b.rot_with_shape,
            ext_lst: b.ext_lst.clone(),
            src_rect_explicit: b.src_rect_explicit,
        }
    }
}

impl From<BlipFillSpec> for odraw::BlipFill {
    fn from(b: BlipFillSpec) -> Self {
        Self {
            embed_id: b.embed_id,
            link_id: b.link_id,
            compression: b.compression.map(Into::into),
            source_rect: b.source_rect.map(Into::into),
            effects: b.effects.into_iter().map(Into::into).collect(),
            fill_mode: b.fill_mode.map(Into::into),
            dpi: b.dpi,
            rot_with_shape: b.rot_with_shape,
            ext_lst: b.ext_lst,
            src_rect_explicit: b.src_rect_explicit,
        }
    }
}

impl From<&odraw::DrawingFill> for DrawingFill {
    fn from(f: &odraw::DrawingFill) -> Self {
        match f {
            odraw::DrawingFill::NoFill => Self::NoFill,
            odraw::DrawingFill::Solid(s) => Self::Solid {
                color: (&s.color).into(),
            },
            odraw::DrawingFill::Gradient(g) => Self::Gradient(g.into()),
            odraw::DrawingFill::Pattern(p) => Self::Pattern(p.into()),
            odraw::DrawingFill::Blip(b) => Self::Blip(b.into()),
            odraw::DrawingFill::Group => Self::GroupFill,
        }
    }
}

impl From<DrawingFill> for odraw::DrawingFill {
    fn from(f: DrawingFill) -> Self {
        match f {
            DrawingFill::NoFill => Self::NoFill,
            DrawingFill::Solid { color } => Self::Solid(odraw::SolidFill {
                color: color.into(),
            }),
            DrawingFill::Gradient(g) => Self::Gradient(g.into()),
            DrawingFill::Pattern(p) => Self::Pattern(p.into()),
            DrawingFill::Blip(b) => Self::Blip(b.into()),
            DrawingFill::GroupFill => Self::Group,
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
    fn default_is_no_fill() {
        assert_eq!(DrawingFill::default(), DrawingFill::NoFill);
    }

    #[test]
    fn no_fill_round_trip() {
        let original = odraw::DrawingFill::NoFill;
        let dom: DrawingFill = (&original).into();
        let round: odraw::DrawingFill = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn group_fill_round_trip() {
        let original = odraw::DrawingFill::Group;
        let dom: DrawingFill = (&original).into();
        let round: odraw::DrawingFill = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn solid_round_trip() {
        let original = odraw::DrawingFill::Solid(odraw::SolidFill {
            color: odraw::DrawingColor::SrgbClr {
                val: "4285F4".into(),
                transforms: vec![],
            },
        });
        let dom: DrawingFill = (&original).into();
        let round: odraw::DrawingFill = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn gradient_round_trip_full() {
        use odraw::StPositiveFixedPercentageDecimal as Pct;
        let original = odraw::DrawingFill::Gradient(odraw::GradientFill {
            lin_ang: Some(odraw::StAngle::new(5_400_000)),
            lin_scaled: Some(true),
            stops: vec![
                odraw::GradientStop {
                    position: Pct::new_clamped(0),
                    color: odraw::DrawingColor::SrgbClr {
                        val: "FF0000".into(),
                        transforms: vec![],
                    },
                },
                odraw::GradientStop {
                    position: Pct::new_clamped(100_000),
                    color: odraw::DrawingColor::SrgbClr {
                        val: "0000FF".into(),
                        transforms: vec![],
                    },
                },
            ],
            path: None,
            fill_to_rect: None,
            tile_rect: None,
            flip: None,
            rotate_with_shape: Some(true),
        });
        let dom: DrawingFill = (&original).into();
        let round: odraw::DrawingFill = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn gradient_path_type_round_trip() {
        for original in [
            odraw::GradientPathType::Circle,
            odraw::GradientPathType::Rect,
            odraw::GradientPathType::Shape,
        ] {
            let dom: GradientPathType = (&original).into();
            let round: odraw::GradientPathType = dom.into();
            assert_eq!(original, round);
        }
    }

    #[test]
    fn pattern_round_trip() {
        let original = odraw::DrawingFill::Pattern(odraw::PatternFill {
            preset: Some(odraw::PresetPatternVal::DiagCross),
            fg_color: Some(odraw::DrawingColor::SrgbClr {
                val: "000000".into(),
                transforms: vec![],
            }),
            bg_color: Some(odraw::DrawingColor::SrgbClr {
                val: "FFFFFF".into(),
                transforms: vec![],
            }),
        });
        let dom: DrawingFill = (&original).into();
        let round: odraw::DrawingFill = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn blip_round_trip_minimal() {
        let original = odraw::DrawingFill::Blip(odraw::BlipFill {
            embed_id: Some("rId7".into()),
            ..Default::default()
        });
        let dom: DrawingFill = (&original).into();
        let round: odraw::DrawingFill = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn tagged_enum_json_shape() {
        let solid = DrawingFill::Solid {
            color: DomainDrawingColor::SrgbClr {
                val: "FF00FF".into(),
                transforms: vec![],
            },
        };
        let json = serde_json::to_string(&solid).unwrap();
        assert_eq!(
            json,
            r#"{"type":"solid","color":{"type":"srgbClr","val":"FF00FF"}}"#
        );

        let no_fill = DrawingFill::NoFill;
        let json = serde_json::to_string(&no_fill).unwrap();
        assert_eq!(json, r#"{"type":"noFill"}"#);

        let group = DrawingFill::GroupFill;
        let json = serde_json::to_string(&group).unwrap();
        assert_eq!(json, r#"{"type":"groupFill"}"#);
    }

    #[test]
    fn sub_struct_defaults_emit_no_keys() {
        // GradientFillSpec / PatternFillSpec / BlipFillSpec all
        // skip-if-default fields.
        let g = GradientFillSpec::default();
        assert_eq!(serde_json::to_string(&g).unwrap(), "{}");
        let p = PatternFillSpec::default();
        assert_eq!(serde_json::to_string(&p).unwrap(), "{}");
        let b = BlipFillSpec::default();
        assert_eq!(serde_json::to_string(&b).unwrap(), "{}");
    }
}
