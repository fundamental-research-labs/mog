//! 3D scene, camera, lighting, and material types for DrawingML.

use super::color::DrawingColor;
use super::primitives::{StCoordinate, StFovAngle, StPositiveCoordinate, StPositiveFixedAngle};

// =============================================================================
// PresetCameraType
// =============================================================================

/// Preset camera type (ECMA-376 ST_PresetCameraType, 20.1.10.45).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum PresetCameraType {
    LegacyObliqueTopLeft,
    LegacyObliqueTop,
    LegacyObliqueTopRight,
    LegacyObliqueFront,
    LegacyObliqueLeft,
    LegacyObliqueRight,
    LegacyObliqueBottomLeft,
    LegacyObliqueBottom,
    LegacyObliqueBottomRight,
    LegacyPerspectiveTopLeft,
    LegacyPerspectiveTop,
    LegacyPerspectiveTopRight,
    LegacyPerspectiveFront,
    LegacyPerspectiveLeft,
    LegacyPerspectiveRight,
    LegacyPerspectiveBottomLeft,
    LegacyPerspectiveBottom,
    LegacyPerspectiveBottomRight,
    OrthographicFront,
    IsometricTopUp,
    IsometricTopDown,
    IsometricBottomUp,
    IsometricBottomDown,
    IsometricLeftUp,
    IsometricLeftDown,
    IsometricRightUp,
    IsometricRightDown,
    IsometricOffAxis1Left,
    IsometricOffAxis1Right,
    IsometricOffAxis1Top,
    IsometricOffAxis2Left,
    IsometricOffAxis2Right,
    IsometricOffAxis2Top,
    IsometricOffAxis3Left,
    IsometricOffAxis3Right,
    IsometricOffAxis3Bottom,
    IsometricOffAxis4Left,
    IsometricOffAxis4Right,
    IsometricOffAxis4Bottom,
    ObliqueTopLeft,
    ObliqueTop,
    ObliqueTopRight,
    ObliqueLeft,
    ObliqueRight,
    ObliqueBottomLeft,
    ObliqueBottom,
    ObliqueBottomRight,
    PerspectiveFront,
    PerspectiveLeft,
    PerspectiveRight,
    PerspectiveAbove,
    PerspectiveAboveLeftFacing,
    PerspectiveAboveRightFacing,
    PerspectiveContrastingLeftFacing,
    PerspectiveContrastingRightFacing,
    PerspectiveHeroicLeftFacing,
    PerspectiveHeroicRightFacing,
    PerspectiveHeroicExtremeLeftFacing,
    PerspectiveHeroicExtremeRightFacing,
    PerspectiveBelow,
    PerspectiveRelaxed,
    PerspectiveRelaxedModerately,
}

impl PresetCameraType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "legacyObliqueTopLeft" => Self::LegacyObliqueTopLeft,
            "legacyObliqueTop" => Self::LegacyObliqueTop,
            "legacyObliqueTopRight" => Self::LegacyObliqueTopRight,
            "legacyObliqueFront" => Self::LegacyObliqueFront,
            "legacyObliqueLeft" => Self::LegacyObliqueLeft,
            "legacyObliqueRight" => Self::LegacyObliqueRight,
            "legacyObliqueBottomLeft" => Self::LegacyObliqueBottomLeft,
            "legacyObliqueBottom" => Self::LegacyObliqueBottom,
            "legacyObliqueBottomRight" => Self::LegacyObliqueBottomRight,
            "legacyPerspectiveTopLeft" => Self::LegacyPerspectiveTopLeft,
            "legacyPerspectiveTop" => Self::LegacyPerspectiveTop,
            "legacyPerspectiveTopRight" => Self::LegacyPerspectiveTopRight,
            "legacyPerspectiveFront" => Self::LegacyPerspectiveFront,
            "legacyPerspectiveLeft" => Self::LegacyPerspectiveLeft,
            "legacyPerspectiveRight" => Self::LegacyPerspectiveRight,
            "legacyPerspectiveBottomLeft" => Self::LegacyPerspectiveBottomLeft,
            "legacyPerspectiveBottom" => Self::LegacyPerspectiveBottom,
            "legacyPerspectiveBottomRight" => Self::LegacyPerspectiveBottomRight,
            "orthographicFront" => Self::OrthographicFront,
            "isometricTopUp" => Self::IsometricTopUp,
            "isometricTopDown" => Self::IsometricTopDown,
            "isometricBottomUp" => Self::IsometricBottomUp,
            "isometricBottomDown" => Self::IsometricBottomDown,
            "isometricLeftUp" => Self::IsometricLeftUp,
            "isometricLeftDown" => Self::IsometricLeftDown,
            "isometricRightUp" => Self::IsometricRightUp,
            "isometricRightDown" => Self::IsometricRightDown,
            "isometricOffAxis1Left" => Self::IsometricOffAxis1Left,
            "isometricOffAxis1Right" => Self::IsometricOffAxis1Right,
            "isometricOffAxis1Top" => Self::IsometricOffAxis1Top,
            "isometricOffAxis2Left" => Self::IsometricOffAxis2Left,
            "isometricOffAxis2Right" => Self::IsometricOffAxis2Right,
            "isometricOffAxis2Top" => Self::IsometricOffAxis2Top,
            "isometricOffAxis3Left" => Self::IsometricOffAxis3Left,
            "isometricOffAxis3Right" => Self::IsometricOffAxis3Right,
            "isometricOffAxis3Bottom" => Self::IsometricOffAxis3Bottom,
            "isometricOffAxis4Left" => Self::IsometricOffAxis4Left,
            "isometricOffAxis4Right" => Self::IsometricOffAxis4Right,
            "isometricOffAxis4Bottom" => Self::IsometricOffAxis4Bottom,
            "obliqueTopLeft" => Self::ObliqueTopLeft,
            "obliqueTop" => Self::ObliqueTop,
            "obliqueTopRight" => Self::ObliqueTopRight,
            "obliqueLeft" => Self::ObliqueLeft,
            "obliqueRight" => Self::ObliqueRight,
            "obliqueBottomLeft" => Self::ObliqueBottomLeft,
            "obliqueBottom" => Self::ObliqueBottom,
            "obliqueBottomRight" => Self::ObliqueBottomRight,
            "perspectiveFront" => Self::PerspectiveFront,
            "perspectiveLeft" => Self::PerspectiveLeft,
            "perspectiveRight" => Self::PerspectiveRight,
            "perspectiveAbove" => Self::PerspectiveAbove,
            "perspectiveAboveLeftFacing" => Self::PerspectiveAboveLeftFacing,
            "perspectiveAboveRightFacing" => Self::PerspectiveAboveRightFacing,
            "perspectiveContrastingLeftFacing" => Self::PerspectiveContrastingLeftFacing,
            "perspectiveContrastingRightFacing" => Self::PerspectiveContrastingRightFacing,
            "perspectiveHeroicLeftFacing" => Self::PerspectiveHeroicLeftFacing,
            "perspectiveHeroicRightFacing" => Self::PerspectiveHeroicRightFacing,
            "perspectiveHeroicExtremeLeftFacing" => Self::PerspectiveHeroicExtremeLeftFacing,
            "perspectiveHeroicExtremeRightFacing" => Self::PerspectiveHeroicExtremeRightFacing,
            "perspectiveBelow" => Self::PerspectiveBelow,
            "perspectiveRelaxed" => Self::PerspectiveRelaxed,
            "perspectiveRelaxedModerately" => Self::PerspectiveRelaxedModerately,
            _ => Self::OrthographicFront,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::LegacyObliqueTopLeft => "legacyObliqueTopLeft",
            Self::LegacyObliqueTop => "legacyObliqueTop",
            Self::LegacyObliqueTopRight => "legacyObliqueTopRight",
            Self::LegacyObliqueFront => "legacyObliqueFront",
            Self::LegacyObliqueLeft => "legacyObliqueLeft",
            Self::LegacyObliqueRight => "legacyObliqueRight",
            Self::LegacyObliqueBottomLeft => "legacyObliqueBottomLeft",
            Self::LegacyObliqueBottom => "legacyObliqueBottom",
            Self::LegacyObliqueBottomRight => "legacyObliqueBottomRight",
            Self::LegacyPerspectiveTopLeft => "legacyPerspectiveTopLeft",
            Self::LegacyPerspectiveTop => "legacyPerspectiveTop",
            Self::LegacyPerspectiveTopRight => "legacyPerspectiveTopRight",
            Self::LegacyPerspectiveFront => "legacyPerspectiveFront",
            Self::LegacyPerspectiveLeft => "legacyPerspectiveLeft",
            Self::LegacyPerspectiveRight => "legacyPerspectiveRight",
            Self::LegacyPerspectiveBottomLeft => "legacyPerspectiveBottomLeft",
            Self::LegacyPerspectiveBottom => "legacyPerspectiveBottom",
            Self::LegacyPerspectiveBottomRight => "legacyPerspectiveBottomRight",
            Self::OrthographicFront => "orthographicFront",
            Self::IsometricTopUp => "isometricTopUp",
            Self::IsometricTopDown => "isometricTopDown",
            Self::IsometricBottomUp => "isometricBottomUp",
            Self::IsometricBottomDown => "isometricBottomDown",
            Self::IsometricLeftUp => "isometricLeftUp",
            Self::IsometricLeftDown => "isometricLeftDown",
            Self::IsometricRightUp => "isometricRightUp",
            Self::IsometricRightDown => "isometricRightDown",
            Self::IsometricOffAxis1Left => "isometricOffAxis1Left",
            Self::IsometricOffAxis1Right => "isometricOffAxis1Right",
            Self::IsometricOffAxis1Top => "isometricOffAxis1Top",
            Self::IsometricOffAxis2Left => "isometricOffAxis2Left",
            Self::IsometricOffAxis2Right => "isometricOffAxis2Right",
            Self::IsometricOffAxis2Top => "isometricOffAxis2Top",
            Self::IsometricOffAxis3Left => "isometricOffAxis3Left",
            Self::IsometricOffAxis3Right => "isometricOffAxis3Right",
            Self::IsometricOffAxis3Bottom => "isometricOffAxis3Bottom",
            Self::IsometricOffAxis4Left => "isometricOffAxis4Left",
            Self::IsometricOffAxis4Right => "isometricOffAxis4Right",
            Self::IsometricOffAxis4Bottom => "isometricOffAxis4Bottom",
            Self::ObliqueTopLeft => "obliqueTopLeft",
            Self::ObliqueTop => "obliqueTop",
            Self::ObliqueTopRight => "obliqueTopRight",
            Self::ObliqueLeft => "obliqueLeft",
            Self::ObliqueRight => "obliqueRight",
            Self::ObliqueBottomLeft => "obliqueBottomLeft",
            Self::ObliqueBottom => "obliqueBottom",
            Self::ObliqueBottomRight => "obliqueBottomRight",
            Self::PerspectiveFront => "perspectiveFront",
            Self::PerspectiveLeft => "perspectiveLeft",
            Self::PerspectiveRight => "perspectiveRight",
            Self::PerspectiveAbove => "perspectiveAbove",
            Self::PerspectiveAboveLeftFacing => "perspectiveAboveLeftFacing",
            Self::PerspectiveAboveRightFacing => "perspectiveAboveRightFacing",
            Self::PerspectiveContrastingLeftFacing => "perspectiveContrastingLeftFacing",
            Self::PerspectiveContrastingRightFacing => "perspectiveContrastingRightFacing",
            Self::PerspectiveHeroicLeftFacing => "perspectiveHeroicLeftFacing",
            Self::PerspectiveHeroicRightFacing => "perspectiveHeroicRightFacing",
            Self::PerspectiveHeroicExtremeLeftFacing => "perspectiveHeroicExtremeLeftFacing",
            Self::PerspectiveHeroicExtremeRightFacing => "perspectiveHeroicExtremeRightFacing",
            Self::PerspectiveBelow => "perspectiveBelow",
            Self::PerspectiveRelaxed => "perspectiveRelaxed",
            Self::PerspectiveRelaxedModerately => "perspectiveRelaxedModerately",
        }
    }
}

// =============================================================================
// LightRigType
// =============================================================================

/// Light rig type (ECMA-376 ST_LightRigType, 20.1.10.41).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum LightRigType {
    Balanced,
    BrightRoom,
    Chilly,
    Contrasting,
    Flat,
    Flood,
    Freezing,
    Glow,
    Harsh,
    LegacyFlat1,
    LegacyFlat2,
    LegacyFlat3,
    LegacyFlat4,
    LegacyHarsh1,
    LegacyHarsh2,
    LegacyHarsh3,
    LegacyHarsh4,
    LegacyNormal1,
    LegacyNormal2,
    LegacyNormal3,
    LegacyNormal4,
    Morning,
    Soft,
    Sunrise,
    Sunset,
    ThreePt,
    TwoPt,
}

impl LightRigType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "balanced" => Self::Balanced,
            "brightRoom" => Self::BrightRoom,
            "chilly" => Self::Chilly,
            "contrasting" => Self::Contrasting,
            "flat" => Self::Flat,
            "flood" => Self::Flood,
            "freezing" => Self::Freezing,
            "glow" => Self::Glow,
            "harsh" => Self::Harsh,
            "legacyFlat1" => Self::LegacyFlat1,
            "legacyFlat2" => Self::LegacyFlat2,
            "legacyFlat3" => Self::LegacyFlat3,
            "legacyFlat4" => Self::LegacyFlat4,
            "legacyHarsh1" => Self::LegacyHarsh1,
            "legacyHarsh2" => Self::LegacyHarsh2,
            "legacyHarsh3" => Self::LegacyHarsh3,
            "legacyHarsh4" => Self::LegacyHarsh4,
            "legacyNormal1" => Self::LegacyNormal1,
            "legacyNormal2" => Self::LegacyNormal2,
            "legacyNormal3" => Self::LegacyNormal3,
            "legacyNormal4" => Self::LegacyNormal4,
            "morning" => Self::Morning,
            "soft" => Self::Soft,
            "sunrise" => Self::Sunrise,
            "sunset" => Self::Sunset,
            "threePt" => Self::ThreePt,
            "twoPt" => Self::TwoPt,
            _ => Self::ThreePt,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Balanced => "balanced",
            Self::BrightRoom => "brightRoom",
            Self::Chilly => "chilly",
            Self::Contrasting => "contrasting",
            Self::Flat => "flat",
            Self::Flood => "flood",
            Self::Freezing => "freezing",
            Self::Glow => "glow",
            Self::Harsh => "harsh",
            Self::LegacyFlat1 => "legacyFlat1",
            Self::LegacyFlat2 => "legacyFlat2",
            Self::LegacyFlat3 => "legacyFlat3",
            Self::LegacyFlat4 => "legacyFlat4",
            Self::LegacyHarsh1 => "legacyHarsh1",
            Self::LegacyHarsh2 => "legacyHarsh2",
            Self::LegacyHarsh3 => "legacyHarsh3",
            Self::LegacyHarsh4 => "legacyHarsh4",
            Self::LegacyNormal1 => "legacyNormal1",
            Self::LegacyNormal2 => "legacyNormal2",
            Self::LegacyNormal3 => "legacyNormal3",
            Self::LegacyNormal4 => "legacyNormal4",
            Self::Morning => "morning",
            Self::Soft => "soft",
            Self::Sunrise => "sunrise",
            Self::Sunset => "sunset",
            Self::ThreePt => "threePt",
            Self::TwoPt => "twoPt",
        }
    }
}

// =============================================================================
// LightRigDirection
// =============================================================================

/// Light rig direction (ECMA-376 ST_LightRigDirection, 20.1.10.40).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum LightRigDirection {
    Top,
    TopLeft,
    TopRight,
    Left,
    Right,
    Bottom,
    BottomLeft,
    BottomRight,
}

impl LightRigDirection {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "t" => Self::Top,
            "tl" => Self::TopLeft,
            "tr" => Self::TopRight,
            "l" => Self::Left,
            "r" => Self::Right,
            "b" => Self::Bottom,
            "bl" => Self::BottomLeft,
            "br" => Self::BottomRight,
            _ => Self::Top,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Top => "t",
            Self::TopLeft => "tl",
            Self::TopRight => "tr",
            Self::Left => "l",
            Self::Right => "r",
            Self::Bottom => "b",
            Self::BottomLeft => "bl",
            Self::BottomRight => "br",
        }
    }
}

// =============================================================================
// BevelPresetType
// =============================================================================

/// Bevel preset type (ECMA-376 ST_BevelPresetType, 20.1.10.6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum BevelPresetType {
    RelaxedInset,
    Circle,
    Slope,
    Cross,
    Angle,
    SoftRound,
    Convex,
    CoolSlant,
    Divot,
    Riblet,
    HardEdge,
    ArtDeco,
}

impl BevelPresetType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "relaxedInset" => Self::RelaxedInset,
            "circle" => Self::Circle,
            "slope" => Self::Slope,
            "cross" => Self::Cross,
            "angle" => Self::Angle,
            "softRound" => Self::SoftRound,
            "convex" => Self::Convex,
            "coolSlant" => Self::CoolSlant,
            "divot" => Self::Divot,
            "riblet" => Self::Riblet,
            "hardEdge" => Self::HardEdge,
            "artDeco" => Self::ArtDeco,
            _ => Self::Circle,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::RelaxedInset => "relaxedInset",
            Self::Circle => "circle",
            Self::Slope => "slope",
            Self::Cross => "cross",
            Self::Angle => "angle",
            Self::SoftRound => "softRound",
            Self::Convex => "convex",
            Self::CoolSlant => "coolSlant",
            Self::Divot => "divot",
            Self::Riblet => "riblet",
            Self::HardEdge => "hardEdge",
            Self::ArtDeco => "artDeco",
        }
    }
}

// =============================================================================
// PresetMaterialType
// =============================================================================

/// Preset material type (ECMA-376 ST_PresetMaterialType, 20.1.10.43).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum PresetMaterialType {
    Clear,
    DkEdge,
    Flat,
    LegacyMatte,
    LegacyMetal,
    LegacyPlastic,
    LegacyWireframe,
    Matte,
    Metal,
    Plastic,
    Powder,
    SoftEdge,
    SoftMetal,
    TranslucentPowder,
    WarmMatte,
}

impl PresetMaterialType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "clear" => Self::Clear,
            "dkEdge" => Self::DkEdge,
            "flat" => Self::Flat,
            "legacyMatte" => Self::LegacyMatte,
            "legacyMetal" => Self::LegacyMetal,
            "legacyPlastic" => Self::LegacyPlastic,
            "legacyWireframe" => Self::LegacyWireframe,
            "matte" => Self::Matte,
            "metal" => Self::Metal,
            "plastic" => Self::Plastic,
            "powder" => Self::Powder,
            "softEdge" => Self::SoftEdge,
            "softmetal" => Self::SoftMetal,
            "translucentPowder" => Self::TranslucentPowder,
            "warmMatte" => Self::WarmMatte,
            _ => Self::WarmMatte,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Clear => "clear",
            Self::DkEdge => "dkEdge",
            Self::Flat => "flat",
            Self::LegacyMatte => "legacyMatte",
            Self::LegacyMetal => "legacyMetal",
            Self::LegacyPlastic => "legacyPlastic",
            Self::LegacyWireframe => "legacyWireframe",
            Self::Matte => "matte",
            Self::Metal => "metal",
            Self::Plastic => "plastic",
            Self::Powder => "powder",
            Self::SoftEdge => "softEdge",
            Self::SoftMetal => "softmetal",
            Self::TranslucentPowder => "translucentPowder",
            Self::WarmMatte => "warmMatte",
        }
    }
}

// =============================================================================
// Rotation3D
// =============================================================================

/// 3D rotation angles (used by Camera and LightRig).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct Rotation3D {
    /// Latitude in 60,000ths of a degree.
    pub lat: StPositiveFixedAngle,
    /// Longitude in 60,000ths of a degree.
    pub lon: StPositiveFixedAngle,
    /// Revolution in 60,000ths of a degree.
    pub rev: StPositiveFixedAngle,
}

// =============================================================================
// Camera
// =============================================================================

/// Camera properties (ECMA-376 CT_Camera, 20.1.4.1.5).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Camera {
    /// Preset camera type.
    pub prst: PresetCameraType,
    /// Field of view in 60,000ths of a degree.
    pub fov: Option<StFovAngle>,
    /// Zoom percentage in 1/1000ths of a percent (100000 = 100%). Default: 100%.
    pub zoom: Option<u32>,
    /// Camera rotation.
    pub rot: Option<Rotation3D>,
}

// =============================================================================
// LightRig
// =============================================================================

/// Light rig properties (ECMA-376 CT_LightRig, 20.1.4.1.19).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct LightRig {
    /// Light rig type.
    pub rig: LightRigType,
    /// Light direction.
    pub dir: LightRigDirection,
    /// Light rig rotation.
    pub rot: Option<Rotation3D>,
}

// =============================================================================
// Point3D
// =============================================================================

/// 3D point (ECMA-376 CT_Point3D).
///
/// Coordinates are in EMUs (ST_Coordinate).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub struct Point3D {
    /// X-coordinate in EMUs.
    pub x: StCoordinate,
    /// Y-coordinate in EMUs.
    pub y: StCoordinate,
    /// Z-coordinate in EMUs.
    pub z: StCoordinate,
}

// =============================================================================
// Vector3D
// =============================================================================

/// 3D vector (ECMA-376 CT_Vector3D).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub struct Vector3D {
    /// X component in EMUs.
    pub dx: StCoordinate,
    /// Y component in EMUs.
    pub dy: StCoordinate,
    /// Z component in EMUs.
    pub dz: StCoordinate,
}

// =============================================================================
// Backdrop
// =============================================================================

/// Backdrop plane for a 3D scene (ECMA-376 CT_Backdrop).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Backdrop {
    /// Anchor point of the backdrop plane.
    pub anchor: Point3D,
    /// Normal vector of the backdrop plane.
    pub norm: Point3D,
    /// Up vector of the backdrop plane.
    pub up: Point3D,
    /// Extension list — opaque XML passthrough (CT_Backdrop extLst).
    pub ext_lst: Option<String>,
}

// =============================================================================
// Scene3D
// =============================================================================

/// 3D scene properties (ECMA-376 CT_Scene3D, 20.1.4.1.26).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Scene3D {
    /// Camera properties.
    pub camera: Camera,
    /// Light rig properties.
    pub light_rig: LightRig,
    /// Optional backdrop plane.
    pub backdrop: Option<Backdrop>,
    /// Extension list — opaque XML passthrough (CT_Scene3D extLst).
    pub ext_lst: Option<String>,
}

// =============================================================================
// Bevel
// =============================================================================

/// Bevel properties (ECMA-376 CT_Bevel, 20.1.5.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct Bevel {
    /// Bevel width in EMUs.
    pub w: Option<StPositiveCoordinate>,
    /// Bevel height in EMUs.
    pub h: Option<StPositiveCoordinate>,
    /// Bevel preset type.
    pub prst: Option<BevelPresetType>,
}

// =============================================================================
// Shape3D
// =============================================================================

/// 3D shape properties (ECMA-376 CT_Shape3D, 20.1.5.12).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Shape3D {
    /// Top bevel.
    pub bevel_t: Option<Bevel>,
    /// Bottom bevel.
    pub bevel_b: Option<Bevel>,
    /// Extrusion height in EMUs.
    pub extrusion_h: Option<StPositiveCoordinate>,
    /// Extrusion color.
    pub extrusion_clr: Option<DrawingColor>,
    /// Contour width in EMUs.
    pub contour_w: Option<StPositiveCoordinate>,
    /// Contour color.
    pub contour_clr: Option<DrawingColor>,
    /// Preset material type.
    pub prst_material: Option<PresetMaterialType>,
    /// Shape depth (z-coordinate) in EMUs.
    pub z: Option<StCoordinate>,
    /// Extension list — opaque XML passthrough (CT_Shape3D extLst).
    pub ext_lst: Option<String>,
}
