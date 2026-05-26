//! Shape style — theme-ref indirection (CT_ShapeStyle).
//!
//! Pictures and shapes carry a `<xdr:style>` element that references the
//! theme's style matrix for line / fill / effect / font. Mirror of
//! `ooxml_types::drawings::ShapeStyle`.

use serde::{Deserialize, Serialize};

use super::color::DomainDrawingColor;

/// Shape style reference (CT_ShapeStyle).
///
/// Four theme-matrix references: line, fill, effect, and font.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ShapeStyle {
    /// Line reference (CT_StyleMatrixReference).
    pub line_ref: StyleRef,
    /// Fill reference.
    pub fill_ref: StyleRef,
    /// Effect reference.
    pub effect_ref: StyleRef,
    /// Font reference (CT_FontReference).
    pub font_ref: FontReference,
}

/// A reference into a theme's style matrix (CT_StyleMatrixReference).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct StyleRef {
    /// Index into the theme's style matrix column.
    pub idx: u32,
    /// Optional color override.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<DomainDrawingColor>,
}

/// Font reference (CT_FontReference).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct FontReference {
    /// Font collection token (ST_FontCollectionIndex): `"major"`, `"minor"`, `"none"`.
    /// Empty = `"minor"` (ST_FontCollectionIndex default), which lets `Default`
    /// emit no keys.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub idx: String,
    /// Optional color override.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<DomainDrawingColor>,
}

// ===========================================================================
// Converters to/from ooxml_types
// ===========================================================================

use ooxml_types::drawings as odraw;

impl From<&odraw::StyleRef> for StyleRef {
    fn from(s: &odraw::StyleRef) -> Self {
        Self {
            idx: s.idx.value(),
            color: s.color.as_ref().map(Into::into),
        }
    }
}

impl From<StyleRef> for odraw::StyleRef {
    fn from(s: StyleRef) -> Self {
        Self {
            idx: odraw::StStyleMatrixColumnIndex::new(s.idx),
            color: s.color.map(Into::into),
        }
    }
}

impl From<&odraw::FontReference> for FontReference {
    fn from(f: &odraw::FontReference) -> Self {
        Self {
            idx: f.idx.to_ooxml().to_string(),
            color: f.color.as_ref().map(Into::into),
        }
    }
}

impl From<FontReference> for odraw::FontReference {
    fn from(f: FontReference) -> Self {
        let idx = if f.idx.is_empty() {
            odraw::FontCollectionIndex::default()
        } else {
            odraw::FontCollectionIndex::from_ooxml(&f.idx)
        };
        Self {
            idx,
            color: f.color.map(Into::into),
        }
    }
}

impl From<&odraw::ShapeStyle> for ShapeStyle {
    fn from(s: &odraw::ShapeStyle) -> Self {
        Self {
            line_ref: (&s.line_ref).into(),
            fill_ref: (&s.fill_ref).into(),
            effect_ref: (&s.effect_ref).into(),
            font_ref: (&s.font_ref).into(),
        }
    }
}

impl From<ShapeStyle> for odraw::ShapeStyle {
    fn from(s: ShapeStyle) -> Self {
        Self {
            line_ref: s.line_ref.into(),
            fill_ref: s.fill_ref.into(),
            effect_ref: s.effect_ref.into(),
            font_ref: s.font_ref.into(),
        }
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_shape_style() -> odraw::ShapeStyle {
        odraw::ShapeStyle {
            line_ref: odraw::StyleRef {
                idx: odraw::StStyleMatrixColumnIndex::new(2),
                color: Some(odraw::DrawingColor::SchemeClr {
                    val: odraw::SchemeColor::Accent1,
                    transforms: Vec::new(),
                }),
            },
            fill_ref: odraw::StyleRef {
                idx: odraw::StStyleMatrixColumnIndex::new(1001),
                color: Some(odraw::DrawingColor::SchemeClr {
                    val: odraw::SchemeColor::Accent1,
                    transforms: Vec::new(),
                }),
            },
            effect_ref: odraw::StyleRef {
                idx: odraw::StStyleMatrixColumnIndex::new(0),
                color: None,
            },
            font_ref: odraw::FontReference {
                idx: odraw::FontCollectionIndex::Minor,
                color: Some(odraw::DrawingColor::SchemeClr {
                    val: odraw::SchemeColor::Tx1,
                    transforms: Vec::new(),
                }),
            },
        }
    }

    #[test]
    fn shape_style_round_trip() {
        let original = sample_shape_style();
        let dom: ShapeStyle = (&original).into();
        let round: odraw::ShapeStyle = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn default_emits_no_keys() {
        let s = ShapeStyle::default();
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(
            json,
            r#"{"lineRef":{"idx":0},"fillRef":{"idx":0},"effectRef":{"idx":0},"fontRef":{}}"#
        );
    }

    #[test]
    fn style_ref_with_no_color_serialization() {
        let s = StyleRef::default();
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(json, r#"{"idx":0}"#);
    }

    #[test]
    fn font_ref_with_empty_idx_defaults_to_minor_on_write() {
        let f = FontReference::default();
        let ox: odraw::FontReference = f.into();
        assert_eq!(ox.idx, odraw::FontCollectionIndex::Minor);
    }
}
