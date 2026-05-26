//! CT_EffectLst sibling effect types to complete coverage alongside the
//! existing `OuterShadowEffect` in `domain::floating_object`.
//!
//! Follows the same domain-facing shape as `OuterShadowEffect`:
//! - Blur/distance measured in EMUs as `f64`.
//! - Angles in degrees as `f64`.
//! - Color as a hex string (`"#RRGGBB"` or `"RRGGBB"`) — matches the
//!   `ObjectFill`/`ShapeOutline` convention.
//! - `Default` emits no JSON keys (only non-default fields serialize).
//!
//! These are API-ergonomic summaries, not a lossless OOXML mirror — the
//! full typed OOXML-form lives in `ooxml_types::drawings::effects`. These can
//! be widened (or paired with a parallel lossless form) if the corpus shows
//! drift.

use serde::{Deserialize, Serialize};

// ===========================================================================
// InnerShadowEffect (CT_InnerShadowEffect)
// ===========================================================================

/// Inner shadow effect — shadow rendered *inside* the shape's outline.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct InnerShadowEffect {
    /// Blur radius in EMUs.
    #[serde(skip_serializing_if = "is_zero_f64")]
    pub blur_radius: f64,
    /// Shadow offset distance in EMUs.
    #[serde(skip_serializing_if = "is_zero_f64")]
    pub distance: f64,
    /// Shadow direction in degrees (0..360).
    #[serde(skip_serializing_if = "is_zero_f64")]
    pub direction: f64,
    /// Shadow color (hex string).
    #[serde(skip_serializing_if = "String::is_empty")]
    pub color: String,
    /// Shadow opacity (0.0..=1.0).
    #[serde(skip_serializing_if = "is_zero_f64")]
    pub opacity: f64,
}

// ===========================================================================
// GlowEffect (CT_GlowEffect)
// ===========================================================================

/// Glow effect — color halo extending outward from the shape.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct GlowEffect {
    /// Glow radius in EMUs.
    #[serde(skip_serializing_if = "is_zero_f64")]
    pub radius: f64,
    /// Glow color (hex string).
    #[serde(skip_serializing_if = "String::is_empty")]
    pub color: String,
    /// Glow opacity (0.0..=1.0).
    #[serde(skip_serializing_if = "is_zero_f64")]
    pub opacity: f64,
}

// ===========================================================================
// SoftEdgeEffect (CT_SoftEdgesEffect)
// ===========================================================================

/// Soft-edges effect — feathers the shape's outline by `radius` EMUs.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct SoftEdgeEffect {
    /// Feather radius in EMUs.
    #[serde(skip_serializing_if = "is_zero_f64")]
    pub radius: f64,
}

// ===========================================================================
// BlurEffect (CT_BlurEffect)
// ===========================================================================

/// Blur effect — applies a Gaussian blur of `radius` EMUs.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct BlurEffect {
    /// Blur radius in EMUs.
    #[serde(skip_serializing_if = "is_zero_f64")]
    pub radius: f64,
    /// Whether the blur can extend past the bounding box (OOXML default: true).
    /// Serialized only when `false` — matches the spec default and keeps the
    /// zero-keys idle shape.
    #[serde(skip_serializing_if = "is_true")]
    pub grow: bool,
}

impl Default for BlurEffect {
    fn default() -> Self {
        Self {
            radius: 0.0,
            grow: true,
        }
    }
}

// ===========================================================================
// ReflectionEffect (CT_ReflectionEffect)
// ===========================================================================

/// Reflection effect — mirrored copy of the shape below itself with fade.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ReflectionEffect {
    /// Blur radius in EMUs.
    #[serde(skip_serializing_if = "is_zero_f64")]
    pub blur_radius: f64,
    /// Start alpha (0.0..=1.0) — opacity at gradient start.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_alpha: Option<f64>,
    /// Start position along gradient (0.0..=1.0).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_pos: Option<f64>,
    /// End alpha (0.0..=1.0).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_alpha: Option<f64>,
    /// End position along gradient (0.0..=1.0).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_pos: Option<f64>,
    /// Offset distance in EMUs.
    #[serde(skip_serializing_if = "is_zero_f64")]
    pub distance: f64,
    /// Offset direction in degrees.
    #[serde(skip_serializing_if = "is_zero_f64")]
    pub direction: f64,
    /// Fade direction in degrees.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fade_direction: Option<f64>,
    /// Horizontal scale (1.0 = 100%).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_x: Option<f64>,
    /// Vertical scale (1.0 = 100%).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_y: Option<f64>,
    /// Horizontal skew angle in degrees.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skew_x: Option<f64>,
    /// Vertical skew angle in degrees.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skew_y: Option<f64>,
    /// Whether reflection rotates with the shape (OOXML default: true).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotate_with_shape: Option<bool>,
}

// ===========================================================================
// serde helpers
// ===========================================================================

#[inline]
#[allow(clippy::trivially_copy_pass_by_ref)]
fn is_zero_f64(v: &f64) -> bool {
    *v == 0.0
}

#[inline]
#[allow(clippy::trivially_copy_pass_by_ref)]
fn is_true(v: &bool) -> bool {
    *v
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inner_shadow_default_emits_no_keys() {
        let e = InnerShadowEffect::default();
        assert_eq!(serde_json::to_string(&e).unwrap(), "{}");
    }

    #[test]
    fn glow_default_emits_no_keys() {
        let e = GlowEffect::default();
        assert_eq!(serde_json::to_string(&e).unwrap(), "{}");
    }

    #[test]
    fn soft_edge_default_emits_no_keys() {
        let e = SoftEdgeEffect::default();
        assert_eq!(serde_json::to_string(&e).unwrap(), "{}");
    }

    #[test]
    fn blur_default_emits_no_keys() {
        let e = BlurEffect::default();
        assert_eq!(serde_json::to_string(&e).unwrap(), "{}");
    }

    #[test]
    fn blur_grow_false_is_serialized() {
        let e = BlurEffect {
            radius: 12.0,
            grow: false,
        };
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"radius\":12"));
        assert!(json.contains("\"grow\":false"));
    }

    #[test]
    fn reflection_default_emits_no_keys() {
        let e = ReflectionEffect::default();
        assert_eq!(serde_json::to_string(&e).unwrap(), "{}");
    }

    #[test]
    fn inner_shadow_partial_serialization() {
        let e = InnerShadowEffect {
            blur_radius: 0.0,
            distance: 10.0,
            direction: 0.0,
            color: "000000".into(),
            opacity: 0.5,
        };
        let json = serde_json::to_string(&e).unwrap();
        assert!(!json.contains("blurRadius"));
        assert!(!json.contains("direction"));
        assert!(json.contains("\"distance\":10"));
        assert!(json.contains("\"color\":\"000000\""));
        assert!(json.contains("\"opacity\":0.5"));
    }

    #[test]
    fn reflection_round_trips_partial() {
        let e = ReflectionEffect {
            blur_radius: 20.0,
            start_alpha: Some(1.0),
            end_alpha: Some(0.0),
            scale_y: Some(-1.0),
            ..ReflectionEffect::default()
        };
        let json = serde_json::to_string(&e).unwrap();
        let back: ReflectionEffect = serde_json::from_str(&json).unwrap();
        assert_eq!(e, back);
    }
}
