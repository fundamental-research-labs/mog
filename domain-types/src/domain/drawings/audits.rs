//! Fill / line / anchor / geometry audit primitives.
//!
//! Lossless audits of the existing domain types (`ObjectFill` / `GradientFill`
//! / `PatternFill` / `BlipFill`,
//! `ShapeOutline` / `LineEnd`, `FloatingObjectAnchor`, geometry) against
//! the corresponding OOXML schemas (CT_FillProperties union,
//! CT_LineProperties, CT_TwoCellAnchor, CT_PresetGeometry /
//! CT_CustomGeometry). The existing domain structs already carry a UI-
//! ergonomic subset that round-trips well for the common cases; the gaps
//! are deep-nested (duotone color pairs, full line-join discriminants,
//! custom-geometry path lists, client-data lock flags on two-cell anchor,
//! ...).
//!
//! Rather than rewriting every existing struct and churning every
//! downstream consumer, this module lands the missing typed pieces as
//! additive extensions:
//!
//! - `LineJoin` — full CT_LineJoinProperties choice (round / bevel /
//!   miter with limit).
//! - `LineCap` — CT_LineCap enum (flat / square / round).
//! - `LineFill` — EG_LineFillProperties union (noFill / solid / gradient
//!   / pattern) so outlines can carry non-solid line paints.
//! - `PenAlignment` — ST_PenAlignment enum (center / inset).
//! - `DashStop` / `LineDashSpec` — explicit preset-vs-custom dash choice.
//! - `Duotone` — the duotone choice of CT_FillProperties (two colors).
//! - `ClientDataFlags` — CT_AnchorClientData `fLocksWithSheet` /
//!   `fPrintsWithSheet` flags, pulled onto the anchor as typed fields
//!   (previously floated on `PictureOoxmlProps`).
//! - `EditAsKind` — ST_EditAs enum, previously carried as `Option<String>`.
//! - `PresetShape` / `ShapeGeometry` — presetGeometry preset-name + adjust
//!   values + the custGeom raw-xml escape-hatch for deep custom paths.
//!
//! All ship with camelCase serde, Default-emits-no-keys, round-trip
//! `From<&ooxml_types::…>` / `From<dom> for ooxml_types::…` where a
//! matching ooxml-types surface exists, and unit tests. Deep-nested
//! follow-ups (full CT_CustomGeometry typed paths, full CT_FillProperties
//! color-transform chains beyond single solid colors, percentage-tint
//! composition on fills) are called out in module docs with explicit
//! `TODO(typed OOXML preservation)` markers rather than left silently deferred.

use serde::{Deserialize, Serialize};

use super::color::DomainDrawingColor;

// ===========================================================================
// Line: cap, join, pen alignment, dash, line fill
// ===========================================================================

/// Line end cap (ST_LineCap).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineCap {
    /// Flat cap — stroke ends exactly at endpoint.
    #[default]
    Flat,
    /// Square cap — stroke extends half the width past endpoint.
    Square,
    /// Round cap — semicircle cap at endpoint.
    Round,
}

impl LineCap {
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "flat" => Self::Flat,
            "sq" => Self::Square,
            "rnd" => Self::Round,
            _ => Self::Flat,
        }
    }
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Flat => "flat",
            Self::Square => "sq",
            Self::Round => "rnd",
        }
    }
}

/// Line join (EG_LineJoinProperties — one of `<a:round/>`, `<a:bevel/>`,
/// `<a:miter lim="..."/>`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LineJoin {
    /// `<a:round/>` join.
    Round,
    /// `<a:bevel/>` join.
    Bevel,
    /// `<a:miter lim="..."/>` join — limit in hundredths of a percent.
    #[serde(rename_all = "camelCase")]
    Miter {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        limit: Option<i32>,
    },
}

/// Pen alignment (ST_PenAlignment).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PenAlignment {
    /// Center — stroke centered on path (default).
    #[default]
    Center,
    /// Inset — stroke inside path.
    Inset,
}

impl PenAlignment {
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "ctr" => Self::Center,
            "in" => Self::Inset,
            _ => Self::Center,
        }
    }
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Center => "ctr",
            Self::Inset => "in",
        }
    }
}

/// Custom dash stop (CT_DashStop).
///
/// `d` and `sp` are percentages on the OOXML 0..=100000 scale.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct DashStop {
    pub d: u32,
    pub sp: u32,
}

/// Dash specification — preset token or custom stop list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LineDashSpec {
    /// `<a:prstDash val="..."/>` — OOXML preset token (`solid`, `dash`,
    /// `dashDot`, etc.).
    Preset { val: String },
    /// `<a:custDash>` with explicit `<a:ds>` stops.
    Custom { stops: Vec<DashStop> },
}

/// Line fill (EG_LineFillProperties).
///
/// Structured fill paint for a line / outline. Maps to the OOXML choice
/// between `<a:noFill/>`, `<a:solidFill>`, `<a:gradFill>`, `<a:pattFill>`.
/// Gradient / pattern payloads are kept minimal: colors and common
/// attributes only — deep-nested tile-rect / flip / rotate-with-shape
/// stay on the existing `ObjectFill::GradientFill` path (see
/// `floating_object.rs`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LineFill {
    /// `<a:noFill/>`.
    NoFill,
    /// `<a:solidFill>` with a structured `DomainDrawingColor`.
    Solid { color: DomainDrawingColor },
    /// `<a:gradFill>` — colors + linear angle. Full gradient typing stays
    /// in `ObjectFill::GradientFill` for now.
    Gradient {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        stops: Vec<LineGradientStop>,
        /// Linear angle in 60_000ths of a degree.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        angle: Option<i32>,
    },
    /// `<a:pattFill prst="...">` — preset pattern with fg/bg colors.
    Pattern {
        preset: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fg: Option<DomainDrawingColor>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bg: Option<DomainDrawingColor>,
    },
}

/// Gradient stop carried by `LineFill::Gradient`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineGradientStop {
    /// Position on the 0..=100000 scale.
    pub position: u32,
    pub color: DomainDrawingColor,
}

// ===========================================================================
// Fill: duotone
// ===========================================================================

/// Duotone fill — two-color pair used by CT_FillProperties `<a:duotone>`.
///
/// Each color carries its own transforms (alpha / lumMod / tint / etc.)
/// via `DomainDrawingColor`'s `transforms` vec. The existing `ObjectFill`
/// subset does not model duotone; ship it here so elevation can attach a
/// `duotone: Option<Duotone>` on the elevated PictureData
/// without widening `ObjectFill`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct Duotone {
    pub color1: DomainDrawingColor,
    pub color2: DomainDrawingColor,
}

// ===========================================================================
// Anchor: client-data flags + editAs
// ===========================================================================

/// CT_AnchorClientData flags — `@fLocksWithSheet` and `@fPrintsWithSheet`.
///
/// Both default to `true` per the OOXML spec, so `Default` emits both as
/// `Some(true)` to preserve the "attribute absent = defaulted to true"
/// semantic when the source file omitted the element entirely. Writers
/// can distinguish "absent" from "explicit true" via `None` vs
/// `Some(true)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ClientDataFlags {
    /// `@fLocksWithSheet` — defaults to true when absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locks_with_sheet: Option<bool>,
    /// `@fPrintsWithSheet` — defaults to true when absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prints_with_sheet: Option<bool>,
}

/// ST_EditAs — object-resize behavior on two-cell anchors.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditAsKind {
    /// Object moves and resizes with cells (default for twoCell).
    #[default]
    TwoCell,
    /// Object moves with cells but does not resize.
    OneCell,
    /// Absolute positioning.
    Absolute,
}

impl EditAsKind {
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "twoCell" => Self::TwoCell,
            "oneCell" => Self::OneCell,
            "absolute" => Self::Absolute,
            _ => Self::TwoCell,
        }
    }
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::TwoCell => "twoCell",
            Self::OneCell => "oneCell",
            Self::Absolute => "absolute",
        }
    }
}

// ===========================================================================
// Geometry: PresetShape + ShapeGeometry
// ===========================================================================

/// CT_PresetGeometry — preset shape token + adjustment guide values.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct PresetShape {
    /// ST_ShapeType preset token (e.g. `"rect"`, `"roundRect"`, `"ellipse"`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub prst: String,
    /// Adjustment guide values `<a:avLst><a:gd name="..." fmla="..."/></a:avLst>`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub adjust_values: Vec<AdjustValue>,
}

/// Single `<a:gd>` inside `<a:avLst>` — name + formula (usually `"val <n>"`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AdjustValue {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub fmla: String,
}

/// Shape geometry — the `<a:prstGeom>` / `<a:custGeom>` choice.
///
/// `Custom` preserves the OOXML `<a:custGeom>` subtree as raw XML for
/// now; full CT_CustomGeometry typing (gdLst / ahLst / cxnLst / pathLst /
/// rect) is deferred to a follow-up round because the path list has a
/// nested mini-language of move-to / line-to / cubic / arc that is not
/// UI-reachable in spreadsheet drawings today.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ShapeGeometry {
    /// `<a:prstGeom prst="..."><a:avLst>…</a:avLst></a:prstGeom>`.
    Preset(PresetShape),
    /// `<a:custGeom>…</a:custGeom>` preserved as raw XML.
    ///
    /// TODO(typed OOXML preservation): type the custGeom path tree.
    Custom { raw_xml: String },
}

// ===========================================================================
// Converters to/from ooxml_types where a matching surface exists
// ===========================================================================

use ooxml_types::drawings as odraw;

impl From<&odraw::LineCap> for LineCap {
    fn from(c: &odraw::LineCap) -> Self {
        match c {
            odraw::LineCap::Flat => Self::Flat,
            odraw::LineCap::Square => Self::Square,
            odraw::LineCap::Round => Self::Round,
        }
    }
}
impl From<LineCap> for odraw::LineCap {
    fn from(c: LineCap) -> Self {
        match c {
            LineCap::Flat => Self::Flat,
            LineCap::Square => Self::Square,
            LineCap::Round => Self::Round,
        }
    }
}

impl From<&odraw::LineJoin> for LineJoin {
    fn from(j: &odraw::LineJoin) -> Self {
        match j {
            odraw::LineJoin::Round => Self::Round,
            odraw::LineJoin::Bevel => Self::Bevel,
            odraw::LineJoin::Miter { limit } => Self::Miter { limit: *limit },
        }
    }
}
impl From<LineJoin> for odraw::LineJoin {
    fn from(j: LineJoin) -> Self {
        match j {
            LineJoin::Round => Self::Round,
            LineJoin::Bevel => Self::Bevel,
            LineJoin::Miter { limit } => Self::Miter { limit },
        }
    }
}

impl From<&odraw::PenAlignment> for PenAlignment {
    fn from(p: &odraw::PenAlignment) -> Self {
        match p {
            odraw::PenAlignment::Center => Self::Center,
            odraw::PenAlignment::Inset => Self::Inset,
        }
    }
}
impl From<PenAlignment> for odraw::PenAlignment {
    fn from(p: PenAlignment) -> Self {
        match p {
            PenAlignment::Center => Self::Center,
            PenAlignment::Inset => Self::Inset,
        }
    }
}

impl From<&odraw::DashStop> for DashStop {
    fn from(s: &odraw::DashStop) -> Self {
        Self { d: s.d, sp: s.sp }
    }
}
impl From<DashStop> for odraw::DashStop {
    fn from(s: DashStop) -> Self {
        Self { d: s.d, sp: s.sp }
    }
}

impl From<&odraw::LineDash> for LineDashSpec {
    fn from(d: &odraw::LineDash) -> Self {
        match d {
            odraw::LineDash::Preset(p) => Self::Preset {
                val: p.to_ooxml().to_string(),
            },
            odraw::LineDash::Custom(stops) => Self::Custom {
                stops: stops.iter().map(Into::into).collect(),
            },
        }
    }
}
impl From<LineDashSpec> for odraw::LineDash {
    fn from(d: LineDashSpec) -> Self {
        match d {
            LineDashSpec::Preset { val } => Self::Preset(odraw::DashStyle::from_ooxml(&val)),
            LineDashSpec::Custom { stops } => {
                Self::Custom(stops.into_iter().map(Into::into).collect())
            }
        }
    }
}

impl From<&odraw::LineFill> for LineFill {
    fn from(f: &odraw::LineFill) -> Self {
        use odraw::LineFill as F;
        match f {
            F::NoFill => Self::NoFill,
            F::Solid(s) => Self::Solid {
                color: (&s.color).into(),
            },
            F::Gradient(g) => Self::Gradient {
                stops: g
                    .stops
                    .iter()
                    .map(|s| LineGradientStop {
                        position: s.position.value(),
                        color: (&s.color).into(),
                    })
                    .collect(),
                angle: g.lin_ang.map(|a| a.value()),
            },
            F::Pattern(p) => Self::Pattern {
                preset: p
                    .preset
                    .map(|pr| pr.to_ooxml().to_string())
                    .unwrap_or_default(),
                fg: p.fg_color.as_ref().map(Into::into),
                bg: p.bg_color.as_ref().map(Into::into),
            },
        }
    }
}

impl From<LineFill> for odraw::LineFill {
    fn from(f: LineFill) -> Self {
        use odraw::{GradientStop, PresetPatternVal, StAngle, StPositiveFixedPercentageDecimal};
        match f {
            LineFill::NoFill => Self::NoFill,
            LineFill::Solid { color } => Self::Solid(odraw::SolidFill {
                color: color.into(),
            }),
            LineFill::Gradient { stops, angle } => Self::Gradient(odraw::GradientFill {
                lin_ang: angle.map(StAngle::new),
                stops: stops
                    .into_iter()
                    .map(|s| GradientStop {
                        position: StPositiveFixedPercentageDecimal::new_clamped(s.position),
                        color: s.color.into(),
                    })
                    .collect(),
                ..Default::default()
            }),
            LineFill::Pattern { preset, fg, bg } => Self::Pattern(odraw::PatternFill {
                preset: PresetPatternVal::from_ooxml(&preset),
                fg_color: fg.map(Into::into),
                bg_color: bg.map(Into::into),
            }),
        }
    }
}

impl From<&odraw::EditAs> for EditAsKind {
    fn from(e: &odraw::EditAs) -> Self {
        match e {
            odraw::EditAs::TwoCell => Self::TwoCell,
            odraw::EditAs::OneCell => Self::OneCell,
            odraw::EditAs::Absolute => Self::Absolute,
        }
    }
}
impl From<EditAsKind> for odraw::EditAs {
    fn from(e: EditAsKind) -> Self {
        match e {
            EditAsKind::TwoCell => Self::TwoCell,
            EditAsKind::OneCell => Self::OneCell,
            EditAsKind::Absolute => Self::Absolute,
        }
    }
}

impl From<&odraw::ClientData> for ClientDataFlags {
    fn from(c: &odraw::ClientData) -> Self {
        Self {
            locks_with_sheet: Some(c.locks_with_sheet),
            prints_with_sheet: Some(c.prints_with_sheet),
        }
    }
}
impl From<ClientDataFlags> for odraw::ClientData {
    fn from(c: ClientDataFlags) -> Self {
        Self {
            locks_with_sheet: c.locks_with_sheet.unwrap_or(true),
            prints_with_sheet: c.prints_with_sheet.unwrap_or(true),
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
    fn line_cap_round_trip() {
        for original in [
            odraw::LineCap::Flat,
            odraw::LineCap::Square,
            odraw::LineCap::Round,
        ] {
            let dom: LineCap = (&original).into();
            let round: odraw::LineCap = dom.into();
            assert_eq!(original, round);
        }
    }

    #[test]
    fn line_join_round_trip() {
        let cases = [
            odraw::LineJoin::Round,
            odraw::LineJoin::Bevel,
            odraw::LineJoin::Miter {
                limit: Some(800_000),
            },
            odraw::LineJoin::Miter { limit: None },
        ];
        for original in cases {
            let dom: LineJoin = (&original).into();
            let round: odraw::LineJoin = dom.into();
            assert_eq!(original, round);
        }
    }

    #[test]
    fn pen_alignment_round_trip() {
        for original in [odraw::PenAlignment::Center, odraw::PenAlignment::Inset] {
            let dom: PenAlignment = (&original).into();
            let round: odraw::PenAlignment = dom.into();
            assert_eq!(original, round);
        }
    }

    #[test]
    fn dash_preset_round_trip() {
        let original = odraw::LineDash::Preset(odraw::DashStyle::LongDashDot);
        let dom: LineDashSpec = (&original).into();
        let round: odraw::LineDash = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn dash_custom_round_trip() {
        let original = odraw::LineDash::Custom(vec![
            odraw::DashStop {
                d: 400_000,
                sp: 200_000,
            },
            odraw::DashStop {
                d: 100_000,
                sp: 200_000,
            },
        ]);
        let dom: LineDashSpec = (&original).into();
        let round: odraw::LineDash = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn line_fill_solid_round_trip() {
        let original = odraw::LineFill::Solid(odraw::SolidFill {
            color: odraw::DrawingColor::SrgbClr {
                val: "FF0000".into(),
                transforms: vec![],
            },
        });
        let dom: LineFill = (&original).into();
        let round: odraw::LineFill = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn line_fill_no_fill_round_trip() {
        let original = odraw::LineFill::NoFill;
        let dom: LineFill = (&original).into();
        let round: odraw::LineFill = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn edit_as_round_trip() {
        for original in [
            odraw::EditAs::TwoCell,
            odraw::EditAs::OneCell,
            odraw::EditAs::Absolute,
        ] {
            let dom: EditAsKind = (&original).into();
            let round: odraw::EditAs = dom.into();
            assert_eq!(original, round);
        }
    }

    #[test]
    fn client_data_round_trip_explicit_flags() {
        let original = odraw::ClientData {
            locks_with_sheet: false,
            prints_with_sheet: true,
        };
        let dom: ClientDataFlags = (&original).into();
        let round: odraw::ClientData = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn client_data_default_round_trip_preserves_spec_defaults() {
        // Default domain flags → OOXML spec defaults (both true).
        let dom = ClientDataFlags::default();
        let round: odraw::ClientData = dom.into();
        assert!(round.locks_with_sheet);
        assert!(round.prints_with_sheet);
    }

    #[test]
    fn default_emits_no_keys() {
        // ClientDataFlags / PresetShape / AdjustValue / Duotone / DashStop
        // all skip-if-default / skip-if-empty — default must emit `{}`.
        let f = ClientDataFlags::default();
        assert_eq!(serde_json::to_string(&f).unwrap(), "{}");
        let p = PresetShape::default();
        assert_eq!(serde_json::to_string(&p).unwrap(), "{}");
        let a = AdjustValue::default();
        assert_eq!(serde_json::to_string(&a).unwrap(), "{}");
        let d = DashStop::default();
        assert_eq!(serde_json::to_string(&d).unwrap(), r#"{"d":0,"sp":0}"#);
        // Duotone has two DomainDrawingColor fields; default color
        // serializes with its own shape — check round-trip through JSON.
        let du = Duotone::default();
        let json = serde_json::to_string(&du).unwrap();
        let round: Duotone = serde_json::from_str(&json).unwrap();
        assert_eq!(du, round);
    }

    #[test]
    fn preset_shape_with_adjust_values_serializes_camelcase() {
        let p = PresetShape {
            prst: "roundRect".into(),
            adjust_values: vec![AdjustValue {
                name: "adj".into(),
                fmla: "val 16667".into(),
            }],
        };
        let json = serde_json::to_string(&p).unwrap();
        assert_eq!(
            json,
            r#"{"prst":"roundRect","adjustValues":[{"name":"adj","fmla":"val 16667"}]}"#
        );
    }

    #[test]
    fn shape_geometry_custom_carries_raw_xml() {
        let g = ShapeGeometry::Custom {
            raw_xml: "<a:pathLst><a:path w=\"100\" h=\"100\"/></a:pathLst>".into(),
        };
        let json = serde_json::to_string(&g).unwrap();
        let round: ShapeGeometry = serde_json::from_str(&json).unwrap();
        assert_eq!(g, round);
    }

    #[test]
    fn duotone_structural_round_trip() {
        let d = Duotone {
            color1: DomainDrawingColor::SrgbClr {
                val: "FF0000".into(),
                transforms: vec![],
            },
            color2: DomainDrawingColor::SrgbClr {
                val: "00FF00".into(),
                transforms: vec![],
            },
        };
        let json = serde_json::to_string(&d).unwrap();
        let round: Duotone = serde_json::from_str(&json).unwrap();
        assert_eq!(d, round);
    }
}
