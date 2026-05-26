//! Blip fill mode — CT_BlipFillProperties child choice mirror
//! (typed OOXML preservation A.7 primitive).
//!
//! Mirror of `ooxml_types::drawings::FillMode`. The OOXML XSD expresses this
//! as a choice group between `<a:tile/>` (CT_TileInfoProperties) and
//! `<a:stretch>` (CT_StretchInfoProperties with optional `<a:fillRect/>`).
//! The domain type carries the same branches with structurally-equivalent
//! fields and round-trip converters.

use serde::{Deserialize, Serialize};

use super::source_rect::SourceRect;

/// Tile flip mode — `<a:tile flip="..."/>` token.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TileFlip {
    #[default]
    None,
    X,
    Y,
    Xy,
}

impl TileFlip {
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "x" => Self::X,
            "y" => Self::Y,
            "xy" => Self::Xy,
            _ => Self::None,
        }
    }
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::X => "x",
            Self::Y => "y",
            Self::Xy => "xy",
        }
    }
}

/// Tile alignment anchor — `<a:tile algn="..."/>` token.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TileAlign {
    TopLeft,
    Top,
    TopRight,
    Left,
    #[default]
    Center,
    Right,
    BottomLeft,
    Bottom,
    BottomRight,
}

impl TileAlign {
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "tl" => Self::TopLeft,
            "t" => Self::Top,
            "tr" => Self::TopRight,
            "l" => Self::Left,
            "ctr" => Self::Center,
            "r" => Self::Right,
            "bl" => Self::BottomLeft,
            "b" => Self::Bottom,
            "br" => Self::BottomRight,
            _ => Self::Center,
        }
    }
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::TopLeft => "tl",
            Self::Top => "t",
            Self::TopRight => "tr",
            Self::Left => "l",
            Self::Center => "ctr",
            Self::Right => "r",
            Self::BottomLeft => "bl",
            Self::Bottom => "b",
            Self::BottomRight => "br",
        }
    }
}

/// Blip fill mode — stretch or tile (CT_BlipFillProperties child choice).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FillMode {
    /// `<a:stretch>` with optional `<a:fillRect/>` inset.
    Stretch {
        #[serde(skip_serializing_if = "Option::is_none")]
        src_rect: Option<SourceRect>,
    },
    /// `<a:tile/>` with all six tile attributes.
    Tile {
        /// Horizontal tile offset in EMUs (`@tx`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tx: Option<i64>,
        /// Vertical tile offset in EMUs (`@ty`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ty: Option<i64>,
        /// Horizontal scale — OOXML percentage (`@sx`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sx: Option<i32>,
        /// Vertical scale — OOXML percentage (`@sy`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sy: Option<i32>,
        /// Tile flip mode (`@flip`).
        #[serde(default, skip_serializing_if = "is_default_flip")]
        flip: TileFlip,
        /// Tile alignment anchor (`@algn`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        algn: Option<TileAlign>,
    },
}

fn is_default_flip(v: &TileFlip) -> bool {
    matches!(v, TileFlip::None)
}

impl Default for FillMode {
    /// Default to `Stretch` with no inset — matches the OOXML "no mode
    /// specified" behavior (a stretched fill without a `<a:fillRect/>` inset
    /// is the ECMA-376 default when neither child is present).
    fn default() -> Self {
        Self::Stretch { src_rect: None }
    }
}

// ===========================================================================
// Converters to/from ooxml_types
// ===========================================================================

use ooxml_types::drawings::{
    FillMode as OFillMode, RectAlignment as ORectAlignment, TileFill as OTileFill,
    TileFlipMode as OTileFlipMode,
};

impl From<&OTileFlipMode> for TileFlip {
    fn from(t: &OTileFlipMode) -> Self {
        match t {
            OTileFlipMode::None => Self::None,
            OTileFlipMode::X => Self::X,
            OTileFlipMode::Y => Self::Y,
            OTileFlipMode::XY => Self::Xy,
        }
    }
}

impl From<TileFlip> for OTileFlipMode {
    fn from(t: TileFlip) -> Self {
        match t {
            TileFlip::None => Self::None,
            TileFlip::X => Self::X,
            TileFlip::Y => Self::Y,
            TileFlip::Xy => Self::XY,
        }
    }
}

impl From<&ORectAlignment> for TileAlign {
    fn from(a: &ORectAlignment) -> Self {
        match a {
            ORectAlignment::TopLeft => Self::TopLeft,
            ORectAlignment::Top => Self::Top,
            ORectAlignment::TopRight => Self::TopRight,
            ORectAlignment::Left => Self::Left,
            ORectAlignment::Center => Self::Center,
            ORectAlignment::Right => Self::Right,
            ORectAlignment::BottomLeft => Self::BottomLeft,
            ORectAlignment::Bottom => Self::Bottom,
            ORectAlignment::BottomRight => Self::BottomRight,
        }
    }
}

impl From<TileAlign> for ORectAlignment {
    fn from(a: TileAlign) -> Self {
        match a {
            TileAlign::TopLeft => Self::TopLeft,
            TileAlign::Top => Self::Top,
            TileAlign::TopRight => Self::TopRight,
            TileAlign::Left => Self::Left,
            TileAlign::Center => Self::Center,
            TileAlign::Right => Self::Right,
            TileAlign::BottomLeft => Self::BottomLeft,
            TileAlign::Bottom => Self::Bottom,
            TileAlign::BottomRight => Self::BottomRight,
        }
    }
}

impl From<&OFillMode> for FillMode {
    fn from(f: &OFillMode) -> Self {
        match f {
            OFillMode::Stretch { fill_rect } => Self::Stretch {
                src_rect: fill_rect.as_ref().map(Into::into),
            },
            OFillMode::Tile(tf) => Self::Tile {
                tx: tf.tx.map(|v| v.value()),
                ty: tf.ty.map(|v| v.value()),
                sx: tf.sx.map(|v| v.value()),
                sy: tf.sy.map(|v| v.value()),
                flip: (&tf.flip).into(),
                algn: tf.align.as_ref().map(Into::into),
            },
        }
    }
}

impl From<FillMode> for OFillMode {
    fn from(f: FillMode) -> Self {
        use ooxml_types::drawings::{StCoordinate, StPercentage};
        match f {
            FillMode::Stretch { src_rect } => Self::Stretch {
                fill_rect: src_rect.map(Into::into),
            },
            FillMode::Tile {
                tx,
                ty,
                sx,
                sy,
                flip,
                algn,
            } => Self::Tile(OTileFill {
                tx: tx.map(StCoordinate::new),
                ty: ty.map(StCoordinate::new),
                sx: sx.map(StPercentage::new),
                sy: sy.map(StPercentage::new),
                flip: flip.into(),
                align: algn.map(Into::into),
            }),
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
    fn round_trip_stretch_no_rect() {
        let original = OFillMode::Stretch { fill_rect: None };
        let dom: FillMode = (&original).into();
        let round: OFillMode = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn round_trip_stretch_with_rect() {
        use ooxml_types::drawings::{
            SourceRect as OSourceRect, StPositiveFixedPercentageDecimal as Pct,
        };
        let original = OFillMode::Stretch {
            fill_rect: Some(OSourceRect {
                top: Pct::new_clamped(0),
                bottom: Pct::new_clamped(5_000),
                left: Pct::new_clamped(5_000),
                right: Pct::new_clamped(0),
            }),
        };
        let dom: FillMode = (&original).into();
        let round: OFillMode = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn round_trip_tile_full() {
        use ooxml_types::drawings::{StCoordinate, StPercentage};
        let original = OFillMode::Tile(OTileFill {
            tx: Some(StCoordinate::new(1000)),
            ty: Some(StCoordinate::new(2000)),
            sx: Some(StPercentage::new(50_000)),
            sy: Some(StPercentage::new(50_000)),
            flip: OTileFlipMode::XY,
            align: Some(ORectAlignment::Center),
        });
        let dom: FillMode = (&original).into();
        let round: OFillMode = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn round_trip_tile_minimal() {
        let original = OFillMode::Tile(OTileFill::default());
        let dom: FillMode = (&original).into();
        let round: OFillMode = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn tile_flip_tokens_round_trip() {
        for s in ["none", "x", "y", "xy"] {
            let parsed = TileFlip::from_ooxml(s);
            assert_eq!(parsed.to_ooxml(), s);
        }
    }

    #[test]
    fn tile_align_tokens_round_trip() {
        for s in ["tl", "t", "tr", "l", "ctr", "r", "bl", "b", "br"] {
            let parsed = TileAlign::from_ooxml(s);
            assert_eq!(parsed.to_ooxml(), s);
        }
    }

    #[test]
    fn default_is_stretch_no_rect() {
        let f = FillMode::default();
        match f {
            FillMode::Stretch { src_rect } => assert!(src_rect.is_none()),
            _ => panic!("expected stretch default"),
        }
    }

    #[test]
    fn camelcase_tag_serialization() {
        let tile = FillMode::Tile {
            tx: None,
            ty: None,
            sx: None,
            sy: None,
            flip: TileFlip::None,
            algn: None,
        };
        let json = serde_json::to_string(&tile).unwrap();
        assert_eq!(json, r#"{"type":"tile"}"#);

        let stretch = FillMode::Stretch { src_rect: None };
        let json = serde_json::to_string(&stretch).unwrap();
        assert_eq!(json, r#"{"type":"stretch"}"#);
    }
}
