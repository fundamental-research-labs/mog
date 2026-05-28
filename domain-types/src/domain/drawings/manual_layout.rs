//! Manual layout for chart elements (domain mirror of `CT_ManualLayout`).
//!
//! Shared between drawings and charts (inventory rows 2.11, 2.12) — lives in
//! `drawings` because chart domain types already import from drawings
//! (e.g. `ShapeProperties`). Placing it here avoids introducing a new
//! cross-boundary module while keeping both drawings and charts able to reach
//! it.
//!
//! Replaces `Option<ooxml_types::charts::ManualLayout>` on
//! chart plot-area layout and `TrendlineLabelData.layout` when
//! they are migrated.

use serde::{Deserialize, Serialize};

// ===========================================================================
// ManualLayout (CT_ManualLayout)
// ===========================================================================

/// Manual layout for chart elements.
///
/// Mirror of `ooxml_types::charts::ManualLayout`. All attributes are optional;
/// `Default` emits no keys.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ManualLayout {
    /// Layout target (inner plot area vs. outer chart area). Default `"outer"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout_target: Option<LayoutTarget>,
    /// X layout mode. Default `"factor"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x_mode: Option<LayoutMode>,
    /// Y layout mode. Default `"factor"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y_mode: Option<LayoutMode>,
    /// Width layout mode. Default `"factor"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub w_mode: Option<LayoutMode>,
    /// Height layout mode. Default `"factor"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub h_mode: Option<LayoutMode>,
    /// X position (interpretation depends on `x_mode`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    /// Y position (interpretation depends on `y_mode`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    /// Width (interpretation depends on `w_mode`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
    /// Height (interpretation depends on `h_mode`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub h: Option<f64>,
    /// Opaque extLst XML passthrough.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext_lst: Option<String>,
}

/// Layout target (CT_ManualLayout/@layoutTarget, ST_LayoutTarget).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LayoutTarget {
    /// Inner plot area.
    Inner,
    /// Outer chart area (default per ST_LayoutTarget).
    #[default]
    Outer,
}

/// Layout mode (ST_LayoutMode).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LayoutMode {
    /// Relative to edge.
    Edge,
    /// Factor of chart dimension (default per ST_LayoutMode).
    #[default]
    Factor,
}

// ===========================================================================
// Converters to/from ooxml_types
// ===========================================================================

use ooxml_types::charts as ocharts;

impl From<ocharts::LayoutTarget> for LayoutTarget {
    fn from(v: ocharts::LayoutTarget) -> Self {
        match v {
            ocharts::LayoutTarget::Inner => Self::Inner,
            ocharts::LayoutTarget::Outer => Self::Outer,
        }
    }
}

impl From<LayoutTarget> for ocharts::LayoutTarget {
    fn from(v: LayoutTarget) -> Self {
        match v {
            LayoutTarget::Inner => Self::Inner,
            LayoutTarget::Outer => Self::Outer,
        }
    }
}

impl From<ocharts::LayoutMode> for LayoutMode {
    fn from(v: ocharts::LayoutMode) -> Self {
        match v {
            ocharts::LayoutMode::Edge => Self::Edge,
            ocharts::LayoutMode::Factor => Self::Factor,
        }
    }
}

impl From<LayoutMode> for ocharts::LayoutMode {
    fn from(v: LayoutMode) -> Self {
        match v {
            LayoutMode::Edge => Self::Edge,
            LayoutMode::Factor => Self::Factor,
        }
    }
}

impl From<&ocharts::ManualLayout> for ManualLayout {
    /// Converts from the ooxml form, preserving all structured content.
    /// The `extensions` vector on the ooxml side is serialized to JSON to fit
    /// into our opaque `ext_lst` slot; chart elevation will own the full
    /// extensions typing.
    fn from(m: &ocharts::ManualLayout) -> Self {
        let ext_lst = if m.extensions.is_empty() {
            None
        } else {
            serde_json::to_string(&m.extensions).ok()
        };
        Self {
            layout_target: m.layout_target.map(Into::into),
            x_mode: m.x_mode.map(Into::into),
            y_mode: m.y_mode.map(Into::into),
            w_mode: m.w_mode.map(Into::into),
            h_mode: m.h_mode.map(Into::into),
            x: m.x,
            y: m.y,
            w: m.w,
            h: m.h,
            ext_lst,
        }
    }
}

impl From<ManualLayout> for ocharts::ManualLayout {
    fn from(m: ManualLayout) -> Self {
        let extensions = m
            .ext_lst
            .as_deref()
            .and_then(|s| serde_json::from_str::<Vec<ocharts::ExtensionEntry>>(s).ok())
            .unwrap_or_default();
        Self {
            layout_target: m.layout_target.map(Into::into),
            x_mode: m.x_mode.map(Into::into),
            y_mode: m.y_mode.map(Into::into),
            w_mode: m.w_mode.map(Into::into),
            h_mode: m.h_mode.map(Into::into),
            x: m.x,
            y: m.y,
            w: m.w,
            h: m.h,
            extensions,
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
    fn round_trip_full() {
        let original = ocharts::ManualLayout {
            layout_target: Some(ocharts::LayoutTarget::Inner),
            x_mode: Some(ocharts::LayoutMode::Edge),
            y_mode: Some(ocharts::LayoutMode::Factor),
            w_mode: Some(ocharts::LayoutMode::Factor),
            h_mode: Some(ocharts::LayoutMode::Edge),
            x: Some(0.1),
            y: Some(0.2),
            w: Some(0.8),
            h: Some(0.6),
            extensions: Vec::new(),
        };
        let dom: ManualLayout = (&original).into();
        let round: ocharts::ManualLayout = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn default_emits_no_keys() {
        let m = ManualLayout::default();
        let json = serde_json::to_string(&m).unwrap();
        assert_eq!(json, "{}");
    }

    #[test]
    fn empty_round_trip() {
        let original = ocharts::ManualLayout::default();
        let dom: ManualLayout = (&original).into();
        let round: ocharts::ManualLayout = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn layout_target_enum_round_trip() {
        for v in [ocharts::LayoutTarget::Inner, ocharts::LayoutTarget::Outer] {
            let dom: LayoutTarget = v.into();
            let round: ocharts::LayoutTarget = dom.into();
            assert_eq!(v, round);
        }
    }

    #[test]
    fn layout_mode_enum_round_trip() {
        for v in [ocharts::LayoutMode::Edge, ocharts::LayoutMode::Factor] {
            let dom: LayoutMode = v.into();
            let round: ocharts::LayoutMode = dom.into();
            assert_eq!(v, round);
        }
    }
}
