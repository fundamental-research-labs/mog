//! Transform, position, and anchor types for DrawingML.

use super::primitives::{Emu, StAngle};

// =============================================================================
// GroupTransform2D
// =============================================================================

/// Group transform (ECMA-376 `CT_GroupTransform2D`, `dml-main.xsd:622-632`).
///
/// Extends the regular `CT_Transform2D` with a **child coordinate space** defined by
/// `chOff` (child offset) and `chExt` (child extent). Children's positions are expressed
/// in the `chOff`/`chExt` coordinate space, then mapped to the group's `off`/`ext` space.
/// If `chExt` differs from `ext`, children are scaled proportionally.
///
/// ## Roundtrip fidelity
///
/// `rot`, `flipH`, `flipV` all have spec defaults (0, false, false) but are stored as
/// `Option` so we can distinguish "attribute absent" from "attribute explicitly set to
/// default value." On write, `None` omits the attribute; `Some(0)` / `Some(false)` writes
/// it explicitly. This preserves byte-identical roundtrip.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GroupTransform2D {
    /// Offset: x, y in EMUs (`<a:off>`).
    pub offset: Option<(i64, i64)>,
    /// Extent: cx, cy in EMUs (`<a:ext>`).
    pub extent: Option<(u64, u64)>,
    /// Child offset: x, y in EMUs (`<a:chOff>`) — group-specific.
    pub child_offset: Option<(i64, i64)>,
    /// Child extent: cx, cy in EMUs (`<a:chExt>`) — group-specific.
    pub child_extent: Option<(u64, u64)>,
    /// Rotation in 60,000ths of a degree (`@rot`, default 0).
    pub rotation: Option<StAngle>,
    /// Horizontal flip (`@flipH`, default false).
    pub flip_h: Option<bool>,
    /// Vertical flip (`@flipV`, default false).
    pub flip_v: Option<bool>,
}

// =============================================================================
// Transform2D
// =============================================================================

/// 2D transformation (ECMA-376 `CT_Transform2D`, `dml-main.xsd`).
///
/// All fields are optional to match the XSD: offset and extent are optional child
/// elements, and `rot`/`flipH`/`flipV` are optional attributes with spec defaults.
/// Storing as `Option` lets us distinguish "absent" from "explicitly set to default"
/// for byte-identical roundtrip, matching the `GroupTransform2D` pattern.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Transform2D {
    /// Offset: x, y in EMUs (`<a:off>`). None = absent.
    pub offset: Option<(i64, i64)>,
    /// Extent: cx, cy in EMUs (`<a:ext>`). None = absent.
    pub extent: Option<(u64, u64)>,
    /// Rotation in 60,000ths of a degree (`@rot`, default 0). None = omit on write.
    pub rotation: Option<StAngle>,
    /// Horizontal flip (`@flipH`, default false). None = omit on write.
    pub flip_h: Option<bool>,
    /// Vertical flip (`@flipV`, default false). None = omit on write.
    pub flip_v: Option<bool>,
}

impl Transform2D {
    /// Whether any transform child or attribute was explicitly populated.
    pub fn has_explicit_content(&self) -> bool {
        self.offset.is_some()
            || self.extent.is_some()
            || self.rotation.is_some()
            || self.flip_h.is_some()
            || self.flip_v.is_some()
    }

    /// Offset X in EMUs (0 if absent).
    pub fn off_x(&self) -> i64 {
        self.offset.map_or(0, |(x, _)| x)
    }
    /// Offset Y in EMUs (0 if absent).
    pub fn off_y(&self) -> i64 {
        self.offset.map_or(0, |(_, y)| y)
    }
    /// Extent CX in EMUs (0 if absent).
    pub fn ext_cx(&self) -> u64 {
        self.extent.map_or(0, |(cx, _)| cx)
    }
    /// Extent CY in EMUs (0 if absent).
    pub fn ext_cy(&self) -> u64 {
        self.extent.map_or(0, |(_, cy)| cy)
    }
    /// Rotation in 60,000ths of a degree (0 if absent).
    pub fn rot(&self) -> StAngle {
        self.rotation.unwrap_or_default()
    }
    /// Horizontal flip (false if absent).
    pub fn is_flip_h(&self) -> bool {
        self.flip_h.unwrap_or(false)
    }
    /// Vertical flip (false if absent).
    pub fn is_flip_v(&self) -> bool {
        self.flip_v.unwrap_or(false)
    }
}

// =============================================================================
// Scale2D
// =============================================================================

/// 2D scale (ECMA-376 CT_Scale2D).
///
/// Contains horizontal and vertical scale ratios.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Scale2D {
    /// Horizontal scale ratio (numerator, denominator).
    pub sx: ScaleRatio,
    /// Vertical scale ratio (numerator, denominator).
    pub sy: ScaleRatio,
}

/// Scale ratio (ECMA-376 CT_Ratio).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ScaleRatio {
    /// Numerator.
    pub n: i64,
    /// Denominator.
    pub d: i64,
}

// =============================================================================
// Anchor and Position Types
// =============================================================================

/// Cell anchor position with offset (used in from/to elements).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct CellAnchor {
    /// Zero-based column index.
    pub col: u32,
    /// Column offset in EMUs.
    pub col_off: Emu,
    /// Zero-based row index.
    pub row: u32,
    /// Row offset in EMUs.
    pub row_off: Emu,
}

/// Absolute position in EMUs.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Position {
    /// X coordinate in EMUs.
    pub x: Emu,
    /// Y coordinate in EMUs.
    pub y: Emu,
}

/// Object extent (size) in EMUs.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Extent {
    /// Width in EMUs (914400 EMUs = 1 inch).
    pub cx: Emu,
    /// Height in EMUs.
    pub cy: Emu,
}
