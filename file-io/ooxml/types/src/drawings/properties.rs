//! Composite shape property types for DrawingML (ECMA-376 CT_ShapeProperties).

use super::effects::EffectProperties;
use super::fill::DrawingFill;
use super::geometry::ShapeGeometry;
use super::line::Outline;
use super::style::BlackWhiteMode;
use super::three_d::{Scene3D, Shape3D};
use super::transform::{GroupTransform2D, Transform2D};

/// Shape properties (ECMA-376 CT_ShapeProperties, 20.1.2.2.35).
///
/// The primary visual properties container for shapes, pictures, connectors,
/// text boxes, and other drawing objects.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ShapeProperties {
    /// 2D transform (position, size, rotation, flip).
    pub xfrm: Option<Transform2D>,
    /// Geometry (preset or custom).
    pub geometry: Option<ShapeGeometry>,
    /// Fill.
    pub fill: Option<DrawingFill>,
    /// Line/outline.
    pub ln: Option<Outline>,
    /// Effect properties (effectLst or effectDag).
    pub effects: Option<EffectProperties>,
    /// 3D scene.
    pub scene3d: Option<Scene3D>,
    /// 3D shape properties.
    pub sp3d: Option<Shape3D>,
    /// Black and white mode.
    pub bw_mode: Option<BlackWhiteMode>,
    /// Extension list — opaque XML passthrough (CT_ShapeProperties extLst).
    pub ext_lst: Option<String>,
}

/// Group shape properties (ECMA-376 CT_GroupShapeProperties).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GroupShapeProperties {
    /// Group transform (includes child coordinate space).
    pub xfrm: Option<GroupTransform2D>,
    /// Fill for the group.
    pub fill: Option<DrawingFill>,
    /// Effect properties (effectLst or effectDag).
    pub effects: Option<EffectProperties>,
    /// 3D scene.
    pub scene3d: Option<Scene3D>,
    /// Black and white mode.
    pub bw_mode: Option<BlackWhiteMode>,
    /// Extension list — opaque XML passthrough.
    pub ext_lst: Option<String>,
}
