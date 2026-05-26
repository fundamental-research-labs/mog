//! CT_Transform2D mirror — 2D transform for drawing primitives.
//!
//! Mirror of `ooxml_types::drawings::Transform2D`. Carries the five
//! CT_Transform2D fields: `<a:off>` offset, `<a:ext>` extent, `@rot`
//! rotation, `@flipH` / `@flipV` flip flags.
//!
//! All fields are `Option`-typed so the domain layer can distinguish
//! "attribute absent" from "attribute explicitly set to the spec default"
//! for byte-identical round-trip — the same discipline the OOXML-types
//! struct follows.
//!
//! Picture/Shape/Connector elevation consumes this type as the lossless
//! `sp_pr.xfrm` replacement for the existing
//! `FloatingObjectCommon.width`/`height`/`rotation`/`flip_h`/`flip_v`
//! denormalized view.

use serde::{Deserialize, Serialize};

/// 2D transform (CT_Transform2D).
///
/// `offset` is a `(x, y)` pair in EMUs; `extent` is a `(cx, cy)` pair in
/// EMUs. `rotation` is in 60_000ths of a degree (matches `ST_Angle`).
/// `flip_h` / `flip_v` toggle horizontal / vertical flips.
///
/// Default emits no JSON keys — the empty transform represents "no xfrm
/// element present".
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct Transform2D {
    /// `<a:off x="..." y="..."/>` in EMUs. None = element absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<(i64, i64)>,
    /// `<a:ext cx="..." cy="..."/>` in EMUs. None = element absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extent: Option<(u64, u64)>,
    /// `@rot` in 60_000ths of a degree (spec default 0). None = attribute
    /// absent; `Some(0)` = explicitly zero.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation: Option<i32>,
    /// `@flipH` (spec default false). None = attribute absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flip_h: Option<bool>,
    /// `@flipV` (spec default false). None = attribute absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flip_v: Option<bool>,
}

// ===========================================================================
// Converters to/from ooxml_types
// ===========================================================================

use ooxml_types::drawings::{StAngle, Transform2D as OTransform2D};

impl From<&OTransform2D> for Transform2D {
    fn from(t: &OTransform2D) -> Self {
        Self {
            offset: t.offset,
            extent: t.extent,
            rotation: t.rotation.map(|a| a.value()),
            flip_h: t.flip_h,
            flip_v: t.flip_v,
        }
    }
}

impl From<Transform2D> for OTransform2D {
    fn from(t: Transform2D) -> Self {
        Self {
            offset: t.offset,
            extent: t.extent,
            rotation: t.rotation.map(StAngle::new),
            flip_h: t.flip_h,
            flip_v: t.flip_v,
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
        let t = Transform2D::default();
        assert_eq!(serde_json::to_string(&t).unwrap(), "{}");
    }

    #[test]
    fn empty_round_trip() {
        let original = OTransform2D::default();
        let dom: Transform2D = (&original).into();
        let round: OTransform2D = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn full_round_trip() {
        let original = OTransform2D {
            offset: Some((914_400, 457_200)),
            extent: Some((2_743_200, 1_828_800)),
            rotation: Some(StAngle::new(5_400_000)),
            flip_h: Some(true),
            flip_v: Some(false),
        };
        let dom: Transform2D = (&original).into();
        let round: OTransform2D = dom.clone().into();
        assert_eq!(original, round);

        // Structural checks on the domain side.
        assert_eq!(dom.offset, Some((914_400, 457_200)));
        assert_eq!(dom.extent, Some((2_743_200, 1_828_800)));
        assert_eq!(dom.rotation, Some(5_400_000));
        assert_eq!(dom.flip_h, Some(true));
        assert_eq!(dom.flip_v, Some(false));
    }

    #[test]
    fn partial_absence_preserved() {
        // Only offset set — everything else stays None.
        let original = OTransform2D {
            offset: Some((100, 200)),
            extent: None,
            rotation: None,
            flip_h: None,
            flip_v: None,
        };
        let dom: Transform2D = (&original).into();
        let round: OTransform2D = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn explicit_zero_rotation_distinct_from_absent() {
        let absent = OTransform2D {
            rotation: None,
            ..Default::default()
        };
        let explicit_zero = OTransform2D {
            rotation: Some(StAngle::new(0)),
            ..Default::default()
        };
        let dom_absent: Transform2D = (&absent).into();
        let dom_zero: Transform2D = (&explicit_zero).into();
        assert_ne!(dom_absent, dom_zero);
        assert_eq!(dom_absent.rotation, None);
        assert_eq!(dom_zero.rotation, Some(0));
    }

    #[test]
    fn camelcase_serialization() {
        let t = Transform2D {
            offset: Some((100, 200)),
            extent: Some((300, 400)),
            rotation: Some(5_400_000),
            flip_h: Some(true),
            flip_v: None,
        };
        let json = serde_json::to_string(&t).unwrap();
        assert_eq!(
            json,
            r#"{"offset":[100,200],"extent":[300,400],"rotation":5400000,"flipH":true}"#
        );
    }
}
