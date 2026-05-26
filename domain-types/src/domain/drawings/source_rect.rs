//! Source rectangle — CT_RelativeRect mirror (typed OOXML preservation A.7 primitive).
//!
//! Used by CT_BlipFillProperties `srcRect` (image crop) and by CT_FillMode
//! stretch fill-rect. The four edges are OOXML percentages on the
//! 0..=100000 scale (100000 = 100%). A rectangle with all zeros means "no
//! cropping / fills the full container".
//!
//! Field names use the short OOXML attribute names (`l`, `t`, `r`, `b`) so
//! the camelCase JSON shape matches the OOXML attribute names directly.
//! `Default` emits no JSON keys.

use serde::{Deserialize, Serialize};

/// Relative rectangle (CT_RelativeRect).
///
/// `CT_SourceRect` (used for image crop) uses the positive-only
/// `ST_PositiveFixedPercentageDecimal` scale (0..=100000 = 100%). The
/// generic `CT_RelativeRect` (used for gradient fill-to-rect, tile-rect,
/// stretch fill-rect) uses the signed `ST_Percentage` scale
/// (-2_147_483_648..=2_147_483_647 in OOXML terms; -100_000..=100_000 is
/// the meaningful range). Domain stores signed values and converts on
/// write; the source-rect path clamps negatives to zero.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct SourceRect {
    /// Left edge percentage (`@l`, default 0).
    #[serde(skip_serializing_if = "is_zero_i32")]
    pub l: i32,
    /// Top edge percentage (`@t`, default 0).
    #[serde(skip_serializing_if = "is_zero_i32")]
    pub t: i32,
    /// Right edge percentage (`@r`, default 0).
    #[serde(skip_serializing_if = "is_zero_i32")]
    pub r: i32,
    /// Bottom edge percentage (`@b`, default 0).
    #[serde(skip_serializing_if = "is_zero_i32")]
    pub b: i32,
}

fn is_zero_i32(v: &i32) -> bool {
    *v == 0
}

// ===========================================================================
// Converters to/from ooxml_types
// ===========================================================================
//
// The ooxml-types layer splits the crop rectangle into *two* shapes depending
// on the surface:
//   - `SourceRect` (non-optional fields) — used by `BlipFill.source_rect`.
//   - `RelativeRect` (optional fields)  — used by gradient `fill_to_rect` /
//     tile-rect / fill-mode stretch `fill_rect`.
//
// Both collapse to the same domain shape; missing percentages on
// `RelativeRect` round-trip as 0.

use ooxml_types::drawings::{RelativeRect as ORelativeRect, SourceRect as OSourceRect};

impl From<&OSourceRect> for SourceRect {
    fn from(s: &OSourceRect) -> Self {
        Self {
            l: s.left.value() as i32,
            t: s.top.value() as i32,
            r: s.right.value() as i32,
            b: s.bottom.value() as i32,
        }
    }
}

impl From<SourceRect> for OSourceRect {
    fn from(s: SourceRect) -> Self {
        use ooxml_types::drawings::StPositiveFixedPercentageDecimal as Pct;
        // CT_SourceRect is constrained to 0..=100000 on the OOXML side;
        // clamp negatives to zero and cap at the upper bound so an API
        // caller can't emit an out-of-range value.
        let clamp = |v: i32| -> u32 { v.max(0) as u32 };
        Self {
            top: Pct::new_clamped(clamp(s.t)),
            bottom: Pct::new_clamped(clamp(s.b)),
            left: Pct::new_clamped(clamp(s.l)),
            right: Pct::new_clamped(clamp(s.r)),
        }
    }
}

impl From<&ORelativeRect> for SourceRect {
    fn from(r: &ORelativeRect) -> Self {
        Self {
            l: r.l.map(|v| v.value()).unwrap_or(0),
            t: r.t.map(|v| v.value()).unwrap_or(0),
            r: r.r.map(|v| v.value()).unwrap_or(0),
            b: r.b.map(|v| v.value()).unwrap_or(0),
        }
    }
}

impl From<SourceRect> for ORelativeRect {
    fn from(s: SourceRect) -> Self {
        use ooxml_types::drawings::StPercentage as Pct;
        // Only emit attributes that were explicitly non-default. The OOXML
        // `RelativeRect` is used where missing attributes are the common
        // case; promoting every 0 to a `Some(0)` would change round-trip
        // semantics (attribute presence vs absence). Non-zero values
        // marshal back as present; zeros remain absent.
        Self {
            l: (s.l != 0).then(|| Pct::new(s.l)),
            t: (s.t != 0).then(|| Pct::new(s.t)),
            r: (s.r != 0).then(|| Pct::new(s.r)),
            b: (s.b != 0).then(|| Pct::new(s.b)),
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
        let s = SourceRect::default();
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(json, "{}");
    }

    #[test]
    fn source_rect_round_trip() {
        use ooxml_types::drawings::StPositiveFixedPercentageDecimal as Pct;
        let original = OSourceRect {
            top: Pct::new_clamped(5000),
            bottom: Pct::new_clamped(7500),
            left: Pct::new_clamped(1234),
            right: Pct::new_clamped(99_999),
        };
        let dom: SourceRect = (&original).into();
        let round: OSourceRect = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn relative_rect_round_trip_preserves_none() {
        use ooxml_types::drawings::StPercentage as Pct;
        let original = ORelativeRect {
            l: Some(Pct::new(500)),
            t: None,
            r: Some(Pct::new(-250)),
            b: None,
        };
        let dom: SourceRect = (&original).into();
        // `t`/`b` round-trip as 0 and collapse back to absent; `l`/`r`
        // remain present.
        let round: ORelativeRect = dom.into();
        assert_eq!(round.l, Some(Pct::new(500)));
        assert!(round.t.is_none());
        assert_eq!(round.r, Some(Pct::new(-250)));
        assert!(round.b.is_none());
    }

    #[test]
    fn camelcase_serialization() {
        let s = SourceRect {
            l: 1,
            t: 2,
            r: 3,
            b: 4,
        };
        let json = serde_json::to_string(&s).unwrap();
        // Fields are single-letter; camelCase is identity.
        assert_eq!(json, r#"{"l":1,"t":2,"r":3,"b":4}"#);
    }
}
