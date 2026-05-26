//! 3D scene settings for floating objects (domain mirror of `CT_Scene3D`).
//!
//! `SceneSettings` replaces `Option<ooxml_types::drawings::Scene3D>` on
//! `ShapeData` — 3D scene fields are UI-reachable first-class state
//! (camera preset, zoom, FOV, light rig), not a round-trip blob. Round-trip
//! fidelity is preserved via `From` converters against the `ooxml_types`
//! form.

use serde::{Deserialize, Serialize};

// ===========================================================================
// SceneSettings (CT_Scene3D)
// ===========================================================================

/// 3D scene (camera + light rig + optional backdrop).
///
/// Mirror of `ooxml_types::drawings::Scene3D` as a domain-level first-class
/// type. Default emits no keys; extension XML survives as an opaque string
/// per the typed OOXML preservation tier-1 rule.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct SceneSettings {
    /// Camera properties (CT_Camera). Parent spec requires the element, but
    /// we keep it `Option<_>` so `Default` emits no keys.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera: Option<Camera>,
    /// Light rig properties (CT_LightRig).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub light_rig: Option<LightRig>,
    /// Backdrop plane (CT_Backdrop).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backdrop: Option<Backdrop>,
    /// Opaque `<a:extLst>` XML passthrough.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext_lst: Option<String>,
}

/// Camera (CT_Camera) — preset + optional FOV/zoom/rotation.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct Camera {
    /// Preset camera token (ST_PresetCameraType), e.g. `"orthographicFront"`.
    pub prst: String,
    /// Field of view in 60000ths of a degree (ST_FOVAngle).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fov: Option<i64>,
    /// Zoom percentage in 1000ths of a percent (100000 = 100%). Default 100%.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom: Option<u32>,
    /// Rotation (lat/lon/rev in 60000ths of a degree).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rot: Option<Rotation3D>,
}

/// Light rig (CT_LightRig) — rig type + direction + optional rotation.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct LightRig {
    /// Light rig type token (ST_LightRigType), e.g. `"threePt"`.
    pub rig: String,
    /// Light direction token (ST_LightRigDirection), e.g. `"t"`, `"bl"`.
    pub dir: String,
    /// Rotation (lat/lon/rev in 60000ths of a degree).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rot: Option<Rotation3D>,
}

/// 3D rotation angles (mirror of `CT_SphereCoords` used by Camera and LightRig).
/// All three components in 60000ths of a degree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rotation3D {
    pub lat: i64,
    pub lon: i64,
    pub rev: i64,
}

/// Backdrop plane for a 3D scene (CT_Backdrop).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct Backdrop {
    pub anchor: Point3D,
    pub norm: Point3D,
    pub up: Point3D,
    /// Opaque `<a:extLst>` XML passthrough (CT_Backdrop extLst).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext_lst: Option<String>,
}

/// 3D point (CT_Point3D). Coordinates in EMUs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point3D {
    pub x: i64,
    pub y: i64,
    pub z: i64,
}

// ===========================================================================
// Converters to/from ooxml_types
// ===========================================================================

use ooxml_types::drawings as odraw;

impl From<&odraw::Rotation3D> for Rotation3D {
    fn from(r: &odraw::Rotation3D) -> Self {
        Self {
            lat: r.lat.value(),
            lon: r.lon.value(),
            rev: r.rev.value(),
        }
    }
}

impl From<Rotation3D> for odraw::Rotation3D {
    fn from(r: Rotation3D) -> Self {
        Self {
            lat: odraw::StPositiveFixedAngle::new_clamped(r.lat),
            lon: odraw::StPositiveFixedAngle::new_clamped(r.lon),
            rev: odraw::StPositiveFixedAngle::new_clamped(r.rev),
        }
    }
}

impl From<&odraw::Point3D> for Point3D {
    fn from(p: &odraw::Point3D) -> Self {
        Self {
            x: p.x.value(),
            y: p.y.value(),
            z: p.z.value(),
        }
    }
}

impl From<Point3D> for odraw::Point3D {
    fn from(p: Point3D) -> Self {
        Self {
            x: odraw::StCoordinate::new(p.x),
            y: odraw::StCoordinate::new(p.y),
            z: odraw::StCoordinate::new(p.z),
        }
    }
}

impl From<&odraw::Camera> for Camera {
    fn from(c: &odraw::Camera) -> Self {
        Self {
            prst: c.prst.to_ooxml().to_string(),
            fov: c.fov.map(|v| v.value()),
            zoom: c.zoom,
            rot: c.rot.as_ref().map(Into::into),
        }
    }
}

impl From<Camera> for odraw::Camera {
    fn from(c: Camera) -> Self {
        Self {
            prst: odraw::PresetCameraType::from_ooxml(&c.prst),
            fov: c.fov.map(odraw::StFovAngle::new_clamped),
            zoom: c.zoom,
            rot: c.rot.map(Into::into),
        }
    }
}

impl From<&odraw::LightRig> for LightRig {
    fn from(l: &odraw::LightRig) -> Self {
        Self {
            rig: l.rig.to_ooxml().to_string(),
            dir: l.dir.to_ooxml().to_string(),
            rot: l.rot.as_ref().map(Into::into),
        }
    }
}

impl From<LightRig> for odraw::LightRig {
    fn from(l: LightRig) -> Self {
        Self {
            rig: odraw::LightRigType::from_ooxml(&l.rig),
            dir: odraw::LightRigDirection::from_ooxml(&l.dir),
            rot: l.rot.map(Into::into),
        }
    }
}

impl From<&odraw::Backdrop> for Backdrop {
    fn from(b: &odraw::Backdrop) -> Self {
        Self {
            anchor: (&b.anchor).into(),
            norm: (&b.norm).into(),
            up: (&b.up).into(),
            ext_lst: b.ext_lst.clone(),
        }
    }
}

impl From<Backdrop> for odraw::Backdrop {
    fn from(b: Backdrop) -> Self {
        Self {
            anchor: b.anchor.into(),
            norm: b.norm.into(),
            up: b.up.into(),
            ext_lst: b.ext_lst,
        }
    }
}

impl From<&odraw::Scene3D> for SceneSettings {
    fn from(s: &odraw::Scene3D) -> Self {
        Self {
            camera: Some((&s.camera).into()),
            light_rig: Some((&s.light_rig).into()),
            backdrop: s.backdrop.as_ref().map(Into::into),
            ext_lst: s.ext_lst.clone(),
        }
    }
}

impl From<SceneSettings> for odraw::Scene3D {
    /// Lossy only if `camera`/`light_rig` were `None` — those are spec-required
    /// children of CT_Scene3D and this converter materializes defaults for
    /// API-created instances. Round-tripped instances always have them.
    fn from(s: SceneSettings) -> Self {
        Self {
            camera: s.camera.map(Into::into).unwrap_or_else(|| odraw::Camera {
                prst: odraw::PresetCameraType::OrthographicFront,
                fov: None,
                zoom: None,
                rot: None,
            }),
            light_rig: s
                .light_rig
                .map(Into::into)
                .unwrap_or_else(|| odraw::LightRig {
                    rig: odraw::LightRigType::ThreePt,
                    dir: odraw::LightRigDirection::Top,
                    rot: None,
                }),
            backdrop: s.backdrop.map(Into::into),
            ext_lst: s.ext_lst,
        }
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_scene() -> odraw::Scene3D {
        odraw::Scene3D {
            camera: odraw::Camera {
                prst: odraw::PresetCameraType::IsometricTopDown,
                fov: Some(odraw::StFovAngle::new_clamped(10800000)),
                zoom: Some(150000),
                rot: Some(odraw::Rotation3D {
                    lat: odraw::StPositiveFixedAngle::new_clamped(1_000_000),
                    lon: odraw::StPositiveFixedAngle::new_clamped(2_000_000),
                    rev: odraw::StPositiveFixedAngle::new_clamped(3_000_000),
                }),
            },
            light_rig: odraw::LightRig {
                rig: odraw::LightRigType::Sunset,
                dir: odraw::LightRigDirection::BottomLeft,
                rot: None,
            },
            backdrop: Some(odraw::Backdrop {
                anchor: odraw::Point3D {
                    x: odraw::StCoordinate::new(100),
                    y: odraw::StCoordinate::new(200),
                    z: odraw::StCoordinate::new(300),
                },
                norm: odraw::Point3D::default(),
                up: odraw::Point3D::default(),
                ext_lst: None,
            }),
            ext_lst: None,
        }
    }

    #[test]
    fn scene_round_trip_full() {
        let original = sample_scene();
        let dom: SceneSettings = (&original).into();
        let round: odraw::Scene3D = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn scene_round_trip_with_ext_lst() {
        let mut original = sample_scene();
        original.ext_lst = Some("<a:extLst><a:ext uri=\"foo\"/></a:extLst>".into());
        let dom: SceneSettings = (&original).into();
        let round: odraw::Scene3D = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn default_emits_no_keys() {
        let s = SceneSettings::default();
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(json, "{}");
    }

    #[test]
    fn camera_default_emits_only_prst_empty() {
        let c = Camera::default();
        let json = serde_json::to_string(&c).unwrap();
        assert_eq!(json, r#"{"prst":""}"#);
    }

    #[test]
    fn light_rig_default_emits_only_rig_dir_empty() {
        let l = LightRig::default();
        let json = serde_json::to_string(&l).unwrap();
        assert_eq!(json, r#"{"rig":"","dir":""}"#);
    }

    #[test]
    fn unknown_preset_token_falls_back_on_conversion() {
        let dom = SceneSettings {
            camera: Some(Camera {
                prst: "unknownFuturePreset".into(),
                ..Camera::default()
            }),
            ..SceneSettings::default()
        };
        let ox: odraw::Scene3D = dom.into();
        assert_eq!(ox.camera.prst, odraw::PresetCameraType::OrthographicFront);
    }
}
