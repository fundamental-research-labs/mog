//! Floating object mutation operations and serialization types.
//!
//! These structs define the payloads that TypeScript sends across the bridge
//! to create, move, resize, style, flip, and reorder floating objects.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use domain_types::{
    FillType, ObjectFill, OuterShadowEffect, OutlineStyle, ShapeOutline, ShapeText, ShapeType,
};
use value_types::FiniteF64;

// ── Create ──────────────────────────────────────────────────────────────────

/// Configuration payload sent from TS to create a new shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreateShapeConfig {
    /// The preset geometry type.
    pub shape_type: ShapeType,

    /// Anchor row in the grid.
    pub anchor_row: u32,

    /// Anchor column in the grid.
    pub anchor_col: u32,

    /// Pixel offset from the anchor cell (x).
    pub x_offset: FiniteF64,

    /// Pixel offset from the anchor cell (y).
    pub y_offset: FiniteF64,

    /// Shape width in pixels.
    pub width: FiniteF64,

    /// Shape height in pixels.
    pub height: FiniteF64,

    /// Absolute pixel X position on the sheet. When present, Rust resolves
    /// this to `anchor_col` + `x_offset` using the layout index, overriding
    /// the caller-supplied values.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pixel_x: Option<FiniteF64>,

    /// Absolute pixel Y position on the sheet. When present, Rust resolves
    /// this to `anchor_row` + `y_offset` using the layout index, overriding
    /// the caller-supplied values.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pixel_y: Option<FiniteF64>,

    /// Fill configuration. `None` means Rust applies `default_fill()`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<ObjectFill>,

    /// Outline configuration. `None` means Rust applies `default_outline()`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline: Option<ShapeOutline>,

    /// Text content inside the shape.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<ShapeText>,

    /// Shadow effect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<OuterShadowEffect>,

    /// Rotation in degrees.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation: Option<FiniteF64>,

    /// Human-readable name for the shape.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// Geometry adjustment handles (e.g. corner radius).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adjustments: Option<HashMap<String, FiniteF64>>,

    /// Whether the shape should preserve its aspect ratio when resized.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lock_aspect_ratio: Option<bool>,
}

impl CreateShapeConfig {
    /// Default solid fill: Google-blue `#4285f4`.
    pub fn default_fill() -> ObjectFill {
        ObjectFill {
            fill_type: FillType::Solid,
            color: Some("#4285f4".to_string()),
            gradient: None,
            transparency: None,
            pattern: None,
            blip: None,
        }
    }

    /// Default solid outline: darker blue `#1a73e8`, 1px width.
    pub fn default_outline() -> ShapeOutline {
        ShapeOutline {
            style: OutlineStyle::Solid,
            color: "#1a73e8".to_string(),
            width: 1.0,
            head_end: None,
            tail_end: None,
            dash: None,
            transparency: None,
            compound: None,
            visible: None,
        }
    }

    /// Default shape width in pixels.
    pub fn default_width() -> FiniteF64 {
        FiniteF64::must(200.0)
    }

    /// Default shape height in pixels.
    pub fn default_height() -> FiniteF64 {
        FiniteF64::must(200.0)
    }
}

// ── Move ────────────────────────────────────────────────────────────────────

/// Target position for a move operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MoveTarget {
    /// Move to an absolute cell-anchored position.
    Absolute {
        anchor_row: u32,
        anchor_col: u32,
        x_offset: FiniteF64,
        y_offset: FiniteF64,
    },
    /// Move by a relative pixel delta from the current position.
    Delta { dx: FiniteF64, dy: FiniteF64 },
}

// ── Resize ──────────────────────────────────────────────────────────────────

/// Configuration for resizing a floating object.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResizeConfig {
    /// New width in pixels.
    pub width: FiniteF64,

    /// New height in pixels.
    pub height: FiniteF64,

    /// Which corner/edge stays fixed during the resize.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_corner: Option<ResizeAnchor>,
}

/// Which corner or edge remains fixed when the shape is resized.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ResizeAnchor {
    TopLeft,
    Top,
    TopRight,
    Left,
    Center,
    Right,
    BottomLeft,
    Bottom,
    BottomRight,
}

// ── Style ───────────────────────────────────────────────────────────────────

/// Partial style update — all fields optional so callers can patch individual
/// properties without resending the entire style.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShapeStyleUpdate {
    /// Updated fill configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<ObjectFill>,

    /// Updated outline configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline: Option<ShapeOutline>,

    /// Updated text configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<ShapeText>,

    /// Updated shadow configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<OuterShadowEffect>,

    /// Updated geometry adjustment handles.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adjustments: Option<HashMap<String, FiniteF64>>,

    /// Overall opacity (0.0 fully transparent, 1.0 fully opaque).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<FiniteF64>,

    /// Whether the shape is locked from editing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,

    /// Whether to lock the aspect ratio.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lock_aspect_ratio: Option<bool>,
}

// ── Flip ────────────────────────────────────────────────────────────────────

/// Axis along which a shape is flipped.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FlipAxis {
    Horizontal,
    Vertical,
}

// ── Z-Order ─────────────────────────────────────────────────────────────────

/// Z-order manipulation action.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ZOrderAction {
    BringToFront,
    SendToBack,
    BringForward,
    SendBackward,
}

// ── Serialization types ─────────────────────────────────────────────────────

/// Serialized floating object group.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedFloatingObjectGroup {
    /// Unique group identifier.
    pub id: String,
    /// Sheet this group belongs to.
    pub sheet_id: String,
    /// Child object IDs in this group.
    #[serde(default)]
    pub children: Vec<String>,
    /// Group position.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<FiniteF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<FiniteF64>,
    /// Group dimensions.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<FiniteF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<FiniteF64>,
    /// Z-order index (shared z-space with charts and floating objects).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub z_index: Option<i32>,
    /// Display name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Whether the group is locked from editing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
    /// Catch-all for additional fields.
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Entry in the unified z-order list (charts + floating objects interleaved).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ZOrderEntry {
    Chart { id: String, z_index: i32 },
    FloatingObject { id: String, z_index: i32 },
}
