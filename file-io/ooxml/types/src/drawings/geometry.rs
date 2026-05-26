//! Geometry types for DrawingML (ECMA-376 CT_CustomGeometry2D, CT_PresetGeometry2D).

use super::preset::ShapePreset;

/// Geometry guide (ECMA-376 CT_GeomGuide).
///
/// Represents a single adjustment value or formula used in preset geometries.
/// Used by both `CT_PresetTextShape/avLst` and `CT_PresetGeometry2D/avLst`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GeomGuide {
    /// Guide name (e.g., "adj", "adj1", "adj2").
    pub name: String,
    /// Guide formula (e.g., "val 12500").
    pub fmla: String,
}

/// Custom geometry definition (ECMA-376 CT_CustomGeometry2D).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CustomGeometry {
    /// Adjustment values (user-modifiable parameters).
    pub av_list: Vec<GeomGuide>,
    /// Geometry guide formulas.
    pub gd_list: Vec<GeomGuide>,
    /// Adjustment handles.
    pub ah_list: Vec<AdjustHandle>,
    /// Connection sites for connectors.
    pub cxn_list: Vec<ConnectionSite>,
    /// Text rectangle bounds.
    pub rect: Option<GeomRect>,
    /// Path list (the actual geometry).
    pub path_list: Vec<Path2D>,
}

/// A single geometry path (ECMA-376 CT_Path2D).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Path2D {
    /// Path width (coordinate space).
    pub w: Option<i64>,
    /// Path height (coordinate space).
    pub h: Option<i64>,
    /// Fill mode for this path.
    pub fill: Option<PathFillMode>,
    /// Whether to stroke this path.
    pub stroke: Option<bool>,
    /// Whether to extrude this path in 3D.
    pub extrusion_ok: Option<bool>,
    /// Path commands.
    pub commands: Vec<PathCommand>,
}

/// Individual path drawing command.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
pub enum PathCommand {
    /// Move to point (no line drawn).
    MoveTo { x: GeomCoord, y: GeomCoord },
    /// Line to point.
    LineTo { x: GeomCoord, y: GeomCoord },
    /// Arc to (elliptical arc).
    ArcTo {
        w_r: GeomCoord,
        h_r: GeomCoord,
        st_ang: GeomCoord,
        sw_ang: GeomCoord,
    },
    /// Quadratic Bezier curve (1 control point + endpoint).
    QuadBezTo {
        x1: GeomCoord,
        y1: GeomCoord,
        x: GeomCoord,
        y: GeomCoord,
    },
    /// Cubic Bezier curve (2 control points + endpoint).
    CubicBezTo {
        x1: GeomCoord,
        y1: GeomCoord,
        x2: GeomCoord,
        y2: GeomCoord,
        x: GeomCoord,
        y: GeomCoord,
    },
    /// Close path (line back to last moveTo).
    Close,
}

/// Geometry coordinate — either a literal value or a guide reference.
///
/// OOXML geometry coordinates can be literal integers or references to
/// named guides (e.g., "adj", "adj1", formulas). We store the raw string
/// so the evaluator can resolve guide references.
pub type GeomCoord = String;

/// Path fill mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PathFillMode {
    None,
    Norm,
    Lighten,
    LightenLess,
    Darken,
    DarkenLess,
}

impl PathFillMode {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "none" => Self::None,
            "norm" => Self::Norm,
            "lighten" => Self::Lighten,
            "lightenLess" => Self::LightenLess,
            "darken" => Self::Darken,
            "darkenLess" => Self::DarkenLess,
            _ => Self::Norm,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Norm => "norm",
            Self::Lighten => "lighten",
            Self::LightenLess => "lightenLess",
            Self::Darken => "darken",
            Self::DarkenLess => "darkenLess",
        }
    }
}

/// Adjustment handle (ECMA-376 CT_AdjustHandleList).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
pub enum AdjustHandle {
    /// XY position handle.
    Xy {
        gd_ref_x: Option<String>,
        gd_ref_y: Option<String>,
        min_x: Option<GeomCoord>,
        max_x: Option<GeomCoord>,
        min_y: Option<GeomCoord>,
        max_y: Option<GeomCoord>,
        /// Required position X (CT_AdjPoint2D).
        pos_x: GeomCoord,
        /// Required position Y (CT_AdjPoint2D).
        pos_y: GeomCoord,
    },
    /// Polar handle (angle + radius).
    Polar {
        gd_ref_r: Option<String>,
        gd_ref_ang: Option<String>,
        min_r: Option<GeomCoord>,
        max_r: Option<GeomCoord>,
        min_ang: Option<GeomCoord>,
        max_ang: Option<GeomCoord>,
        /// Required position X (CT_AdjPoint2D).
        pos_x: GeomCoord,
        /// Required position Y (CT_AdjPoint2D).
        pos_y: GeomCoord,
    },
}

/// Connection site on a shape (ECMA-376 CT_ConnectionSite, dml-main.xsd:1984).
///
/// **Intentional flattening**: The XSD child `pos` (CT_AdjPoint2D) with attributes
/// `@x` and `@y` is flattened into `x` and `y` fields directly on this struct,
/// since the intermediate wrapper type adds no semantic value.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ConnectionSite {
    /// Angle of the connector at this site (XSD `@ang`, required).
    pub ang: GeomCoord,
    /// Position X (from `pos/@x`, CT_AdjPoint2D).
    pub x: GeomCoord,
    /// Position Y (from `pos/@y`, CT_AdjPoint2D).
    pub y: GeomCoord,
}

/// Text rectangle bounds (ECMA-376 CT_GeomRect).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GeomRect {
    pub l: GeomCoord,
    pub t: GeomCoord,
    pub r: GeomCoord,
    pub b: GeomCoord,
}

/// Preset geometry with optional adjustment overrides (ECMA-376 CT_PresetGeometry2D).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PresetGeometry {
    /// Preset shape type.
    pub prst: ShapePreset,
    /// Adjustment value overrides (e.g., corner radius for roundRect).
    pub av_list: Vec<GeomGuide>,
}

/// Shape geometry — either preset or custom (ECMA-376 EG_Geometry).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ShapeGeometry {
    Preset(PresetGeometry),
    Custom(CustomGeometry),
}
