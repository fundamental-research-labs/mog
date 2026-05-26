//! CT_LineProperties mirror — typed outline for drawing primitives.
//!
//! Mirror of `ooxml_types::drawings::Outline`. Consumes the line-level
//! primitives — `LineCap`, `LineJoin`, `PenAlignment`, `LineDashSpec`,
//! `LineFill` — plus a new
//! `CompoundLine` enum and `LineEndSpec` struct that mirror their OOXML
//! counterparts end-for-end. Head/tail arrow-end decorations are the
//! primary connector-specific surface this type exposes.
//!
//! Picture/Shape/Connector elevation consumes this type as the lossless
//! `sp_pr.ln` replacement for the existing simplified
//! `PictureData.border: Option<ShapeOutline>` / `ShapeData.outline:
//! Option<ShapeOutline>` field.

use serde::{Deserialize, Serialize};

use super::audits::{LineCap, LineDashSpec, LineFill, LineJoin, PenAlignment};

// ===========================================================================
// CompoundLine (ST_CompoundLine)
// ===========================================================================

/// Compound line style (ST_CompoundLine).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompoundLine {
    /// `sng` — single line (default).
    #[default]
    Single,
    /// `dbl` — double line.
    Double,
    /// `thickThin` — thick-thin double.
    ThickThin,
    /// `thinThick` — thin-thick double.
    ThinThick,
    /// `tri` — triple line.
    Triple,
}

impl CompoundLine {
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "sng" => Self::Single,
            "dbl" => Self::Double,
            "thickThin" => Self::ThickThin,
            "thinThick" => Self::ThinThick,
            "tri" => Self::Triple,
            _ => Self::Single,
        }
    }
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Single => "sng",
            Self::Double => "dbl",
            Self::ThickThin => "thickThin",
            Self::ThinThick => "thinThick",
            Self::Triple => "tri",
        }
    }
}

// ===========================================================================
// LineEndDecoration / LineEndSize / LineEndSpec
// ===========================================================================

/// Line end decoration kind (ST_LineEndType).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineEndDecoration {
    /// `none` — no decoration.
    #[default]
    None,
    /// `triangle` — filled triangle arrowhead.
    Triangle,
    /// `stealth` — stealth arrowhead.
    Stealth,
    /// `diamond` — diamond arrowhead.
    Diamond,
    /// `oval` — circle/oval end.
    Oval,
    /// `arrow` — open arrow.
    Arrow,
}

impl LineEndDecoration {
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "none" => Self::None,
            "triangle" => Self::Triangle,
            "stealth" => Self::Stealth,
            "diamond" => Self::Diamond,
            "oval" => Self::Oval,
            "arrow" => Self::Arrow,
            _ => Self::None,
        }
    }
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Triangle => "triangle",
            Self::Stealth => "stealth",
            Self::Diamond => "diamond",
            Self::Oval => "oval",
            Self::Arrow => "arrow",
        }
    }
}

/// Line end decoration size (ST_LineEndWidth / ST_LineEndLength).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineEndSizeKind {
    /// `sm` — small.
    #[default]
    Small,
    /// `med` — medium.
    Medium,
    /// `lg` — large.
    Large,
}

impl LineEndSizeKind {
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "sm" => Self::Small,
            "med" => Self::Medium,
            "lg" => Self::Large,
            _ => Self::Small,
        }
    }
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Small => "sm",
            Self::Medium => "med",
            Self::Large => "lg",
        }
    }
}

/// Line end (arrowhead) decoration — CT_LineEndProperties.
///
/// `type_`, `width`, `length` are all optional on the OOXML side; `None`
/// means the attribute was absent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct LineEndSpec {
    /// `@type` decoration kind.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "type")]
    pub kind: Option<LineEndDecoration>,
    /// `@w` decoration width.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<LineEndSizeKind>,
    /// `@len` decoration length.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length: Option<LineEndSizeKind>,
}

// ===========================================================================
// Outline (CT_LineProperties)
// ===========================================================================

/// Line / outline properties (CT_LineProperties).
///
/// Every field is `Option`-typed — absent fields round-trip as absent.
///
/// The `width` is measured in EMUs (matching `ooxml_types` `Emu = i64`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct Outline {
    /// `@w` line width in EMUs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<i64>,
    /// `@cap` line end cap.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cap: Option<LineCap>,
    /// `@cmpd` compound line style.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compound: Option<CompoundLine>,
    /// `@algn` pen alignment.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<PenAlignment>,
    /// EG_LineFillProperties child (`noFill` / `solidFill` / `gradFill` /
    /// `pattFill`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<LineFill>,
    /// EG_LineDashProperties child (`prstDash` or `custDash`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dash: Option<LineDashSpec>,
    /// EG_LineJoinProperties child (`round` / `bevel` / `miter`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub join: Option<LineJoin>,
    /// `<a:headEnd>` arrowhead decoration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_end: Option<LineEndSpec>,
    /// `<a:tailEnd>` arrowhead decoration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tail_end: Option<LineEndSpec>,
}

// ===========================================================================
// Converters to/from ooxml_types
// ===========================================================================

use ooxml_types::drawings as odraw;

impl From<&odraw::CompoundLine> for CompoundLine {
    fn from(c: &odraw::CompoundLine) -> Self {
        match c {
            odraw::CompoundLine::Single => Self::Single,
            odraw::CompoundLine::Double => Self::Double,
            odraw::CompoundLine::ThickThin => Self::ThickThin,
            odraw::CompoundLine::ThinThick => Self::ThinThick,
            odraw::CompoundLine::Triple => Self::Triple,
        }
    }
}

impl From<CompoundLine> for odraw::CompoundLine {
    fn from(c: CompoundLine) -> Self {
        match c {
            CompoundLine::Single => Self::Single,
            CompoundLine::Double => Self::Double,
            CompoundLine::ThickThin => Self::ThickThin,
            CompoundLine::ThinThick => Self::ThinThick,
            CompoundLine::Triple => Self::Triple,
        }
    }
}

impl From<&odraw::LineEndType> for LineEndDecoration {
    fn from(t: &odraw::LineEndType) -> Self {
        match t {
            odraw::LineEndType::None => Self::None,
            odraw::LineEndType::Triangle => Self::Triangle,
            odraw::LineEndType::Stealth => Self::Stealth,
            odraw::LineEndType::Diamond => Self::Diamond,
            odraw::LineEndType::Oval => Self::Oval,
            odraw::LineEndType::Arrow => Self::Arrow,
        }
    }
}

impl From<LineEndDecoration> for odraw::LineEndType {
    fn from(t: LineEndDecoration) -> Self {
        match t {
            LineEndDecoration::None => Self::None,
            LineEndDecoration::Triangle => Self::Triangle,
            LineEndDecoration::Stealth => Self::Stealth,
            LineEndDecoration::Diamond => Self::Diamond,
            LineEndDecoration::Oval => Self::Oval,
            LineEndDecoration::Arrow => Self::Arrow,
        }
    }
}

impl From<&odraw::LineEndSize> for LineEndSizeKind {
    fn from(s: &odraw::LineEndSize) -> Self {
        match s {
            odraw::LineEndSize::Small => Self::Small,
            odraw::LineEndSize::Medium => Self::Medium,
            odraw::LineEndSize::Large => Self::Large,
        }
    }
}

impl From<LineEndSizeKind> for odraw::LineEndSize {
    fn from(s: LineEndSizeKind) -> Self {
        match s {
            LineEndSizeKind::Small => Self::Small,
            LineEndSizeKind::Medium => Self::Medium,
            LineEndSizeKind::Large => Self::Large,
        }
    }
}

impl From<&odraw::LineEndProperties> for LineEndSpec {
    fn from(p: &odraw::LineEndProperties) -> Self {
        Self {
            kind: p.end_type.as_ref().map(Into::into),
            width: p.width.as_ref().map(Into::into),
            length: p.length.as_ref().map(Into::into),
        }
    }
}

impl From<LineEndSpec> for odraw::LineEndProperties {
    fn from(p: LineEndSpec) -> Self {
        Self {
            end_type: p.kind.map(Into::into),
            width: p.width.map(Into::into),
            length: p.length.map(Into::into),
        }
    }
}

impl From<&odraw::Outline> for Outline {
    fn from(o: &odraw::Outline) -> Self {
        Self {
            width: o.width,
            cap: o.cap.as_ref().map(Into::into),
            compound: o.compound.as_ref().map(Into::into),
            align: o.align.as_ref().map(Into::into),
            fill: o.fill.as_ref().map(Into::into),
            dash: o.dash.as_ref().map(Into::into),
            join: o.join.as_ref().map(Into::into),
            head_end: o.head_end.as_ref().map(Into::into),
            tail_end: o.tail_end.as_ref().map(Into::into),
        }
    }
}

impl From<Outline> for odraw::Outline {
    fn from(o: Outline) -> Self {
        Self {
            width: o.width,
            cap: o.cap.map(Into::into),
            compound: o.compound.map(Into::into),
            align: o.align.map(Into::into),
            fill: o.fill.map(Into::into),
            dash: o.dash.map(Into::into),
            join: o.join.map(Into::into),
            head_end: o.head_end.map(Into::into),
            tail_end: o.tail_end.map(Into::into),
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
    fn default_emits_no_keys() {
        let o = Outline::default();
        assert_eq!(serde_json::to_string(&o).unwrap(), "{}");
    }

    #[test]
    fn default_line_end_spec_emits_no_keys() {
        let e = LineEndSpec::default();
        assert_eq!(serde_json::to_string(&e).unwrap(), "{}");
    }

    #[test]
    fn compound_line_round_trip() {
        for original in [
            odraw::CompoundLine::Single,
            odraw::CompoundLine::Double,
            odraw::CompoundLine::ThickThin,
            odraw::CompoundLine::ThinThick,
            odraw::CompoundLine::Triple,
        ] {
            let dom: CompoundLine = (&original).into();
            let round: odraw::CompoundLine = dom.into();
            assert_eq!(original, round);
        }
    }

    #[test]
    fn line_end_type_round_trip() {
        for original in [
            odraw::LineEndType::None,
            odraw::LineEndType::Triangle,
            odraw::LineEndType::Stealth,
            odraw::LineEndType::Diamond,
            odraw::LineEndType::Oval,
            odraw::LineEndType::Arrow,
        ] {
            let dom: LineEndDecoration = (&original).into();
            let round: odraw::LineEndType = dom.into();
            assert_eq!(original, round);
        }
    }

    #[test]
    fn line_end_size_round_trip() {
        for original in [
            odraw::LineEndSize::Small,
            odraw::LineEndSize::Medium,
            odraw::LineEndSize::Large,
        ] {
            let dom: LineEndSizeKind = (&original).into();
            let round: odraw::LineEndSize = dom.into();
            assert_eq!(original, round);
        }
    }

    #[test]
    fn line_end_spec_round_trip() {
        let original = odraw::LineEndProperties {
            end_type: Some(odraw::LineEndType::Arrow),
            width: Some(odraw::LineEndSize::Medium),
            length: Some(odraw::LineEndSize::Large),
        };
        let dom: LineEndSpec = (&original).into();
        let round: odraw::LineEndProperties = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn outline_empty_round_trip() {
        let original = odraw::Outline::default();
        let dom: Outline = (&original).into();
        let round: odraw::Outline = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn outline_full_round_trip() {
        let original = odraw::Outline {
            width: Some(19_050), // 1.5pt
            cap: Some(odraw::LineCap::Round),
            compound: Some(odraw::CompoundLine::ThinThick),
            align: Some(odraw::PenAlignment::Center),
            fill: Some(odraw::LineFill::Solid(odraw::SolidFill {
                color: odraw::DrawingColor::SrgbClr {
                    val: "202020".into(),
                    transforms: vec![],
                },
            })),
            dash: Some(odraw::LineDash::Preset(odraw::DashStyle::DashDot)),
            join: Some(odraw::LineJoin::Miter {
                limit: Some(800_000),
            }),
            head_end: Some(odraw::LineEndProperties {
                end_type: Some(odraw::LineEndType::Oval),
                width: Some(odraw::LineEndSize::Small),
                length: None,
            }),
            tail_end: Some(odraw::LineEndProperties {
                end_type: Some(odraw::LineEndType::Arrow),
                width: None,
                length: Some(odraw::LineEndSize::Large),
            }),
        };
        let dom: Outline = (&original).into();
        let round: odraw::Outline = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn outline_preserves_absence_precisely() {
        // Only `width` set; nothing else.
        let original = odraw::Outline {
            width: Some(6350),
            ..Default::default()
        };
        let dom: Outline = (&original).into();
        let round: odraw::Outline = dom.clone().into();
        assert_eq!(original, round);
        // Domain side: width is Some, everything else None.
        assert_eq!(dom.width, Some(6350));
        assert!(dom.cap.is_none());
        assert!(dom.fill.is_none());
        assert!(dom.dash.is_none());
        assert!(dom.join.is_none());
        assert!(dom.head_end.is_none());
        assert!(dom.tail_end.is_none());
    }

    #[test]
    fn camelcase_serialization() {
        let o = Outline {
            width: Some(100),
            cap: Some(LineCap::Round),
            head_end: Some(LineEndSpec {
                kind: Some(LineEndDecoration::Arrow),
                width: Some(LineEndSizeKind::Medium),
                length: Some(LineEndSizeKind::Large),
            }),
            ..Outline::default()
        };
        let json = serde_json::to_string(&o).unwrap();
        assert!(json.contains("\"width\":100"));
        assert!(json.contains("\"cap\":\"round\""));
        assert!(json.contains("\"headEnd\""));
        assert!(json.contains("\"type\":\"arrow\""));
        assert!(json.contains("\"width\":\"medium\""));
        assert!(json.contains("\"length\":\"large\""));
    }
}
