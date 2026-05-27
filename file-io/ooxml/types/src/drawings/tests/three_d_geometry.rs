use super::*;

// PresetCameraType
// -----------------------------------------------------------------------

#[test]
fn preset_camera_type_roundtrip() {
    let variants = [
        PresetCameraType::LegacyObliqueTopLeft,
        PresetCameraType::LegacyObliqueTop,
        PresetCameraType::LegacyObliqueTopRight,
        PresetCameraType::LegacyObliqueFront,
        PresetCameraType::LegacyObliqueLeft,
        PresetCameraType::LegacyObliqueRight,
        PresetCameraType::LegacyPerspectiveTopLeft,
        PresetCameraType::LegacyPerspectiveTop,
        PresetCameraType::LegacyPerspectiveTopRight,
        PresetCameraType::LegacyPerspectiveFront,
        PresetCameraType::LegacyPerspectiveLeft,
        PresetCameraType::LegacyPerspectiveRight,
        PresetCameraType::OrthographicFront,
        PresetCameraType::IsometricTopUp,
        PresetCameraType::IsometricTopDown,
        PresetCameraType::IsometricBottomUp,
        PresetCameraType::IsometricBottomDown,
        PresetCameraType::IsometricLeftUp,
        PresetCameraType::IsometricLeftDown,
        PresetCameraType::IsometricRightUp,
        PresetCameraType::IsometricRightDown,
        PresetCameraType::IsometricOffAxis1Left,
        PresetCameraType::IsometricOffAxis1Right,
        PresetCameraType::IsometricOffAxis1Top,
        PresetCameraType::IsometricOffAxis2Left,
        PresetCameraType::IsometricOffAxis2Right,
        PresetCameraType::IsometricOffAxis2Top,
        PresetCameraType::IsometricOffAxis3Left,
        PresetCameraType::IsometricOffAxis3Right,
        PresetCameraType::IsometricOffAxis3Bottom,
        PresetCameraType::IsometricOffAxis4Left,
        PresetCameraType::IsometricOffAxis4Right,
        PresetCameraType::IsometricOffAxis4Bottom,
        PresetCameraType::ObliqueTopLeft,
        PresetCameraType::ObliqueTop,
        PresetCameraType::ObliqueTopRight,
        PresetCameraType::ObliqueLeft,
        PresetCameraType::ObliqueRight,
        PresetCameraType::ObliqueBottomLeft,
        PresetCameraType::ObliqueBottom,
        PresetCameraType::ObliqueBottomRight,
        PresetCameraType::PerspectiveFront,
        PresetCameraType::PerspectiveLeft,
        PresetCameraType::PerspectiveRight,
        PresetCameraType::PerspectiveAbove,
        PresetCameraType::PerspectiveAboveLeftFacing,
        PresetCameraType::PerspectiveAboveRightFacing,
        PresetCameraType::PerspectiveContrastingLeftFacing,
        PresetCameraType::PerspectiveContrastingRightFacing,
        PresetCameraType::PerspectiveHeroicLeftFacing,
        PresetCameraType::PerspectiveHeroicRightFacing,
        PresetCameraType::PerspectiveHeroicExtremeLeftFacing,
        PresetCameraType::PerspectiveHeroicExtremeRightFacing,
        PresetCameraType::PerspectiveBelow,
        PresetCameraType::PerspectiveRelaxed,
        PresetCameraType::PerspectiveRelaxedModerately,
    ];
    for v in variants {
        assert_eq!(
            PresetCameraType::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn preset_camera_type_unknown_defaults() {
    assert_eq!(
        PresetCameraType::from_ooxml("bogus"),
        PresetCameraType::OrthographicFront
    );
}

// -----------------------------------------------------------------------
// LightRigType
// -----------------------------------------------------------------------

#[test]
fn light_rig_type_roundtrip() {
    let variants = [
        LightRigType::Balanced,
        LightRigType::BrightRoom,
        LightRigType::Chilly,
        LightRigType::Contrasting,
        LightRigType::Flat,
        LightRigType::Flood,
        LightRigType::Freezing,
        LightRigType::Glow,
        LightRigType::Harsh,
        LightRigType::LegacyFlat1,
        LightRigType::LegacyFlat2,
        LightRigType::LegacyFlat3,
        LightRigType::LegacyFlat4,
        LightRigType::LegacyHarsh1,
        LightRigType::LegacyHarsh2,
        LightRigType::LegacyHarsh3,
        LightRigType::LegacyHarsh4,
        LightRigType::LegacyNormal1,
        LightRigType::LegacyNormal2,
        LightRigType::LegacyNormal3,
        LightRigType::LegacyNormal4,
        LightRigType::Morning,
        LightRigType::Soft,
        LightRigType::Sunrise,
        LightRigType::Sunset,
        LightRigType::ThreePt,
        LightRigType::TwoPt,
    ];
    for v in variants {
        assert_eq!(
            LightRigType::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn light_rig_type_unknown_defaults() {
    assert_eq!(LightRigType::from_ooxml("bogus"), LightRigType::ThreePt);
}

// -----------------------------------------------------------------------
// LightRigDirection
// -----------------------------------------------------------------------

#[test]
fn light_rig_direction_roundtrip() {
    let variants = [
        LightRigDirection::Top,
        LightRigDirection::TopLeft,
        LightRigDirection::TopRight,
        LightRigDirection::Left,
        LightRigDirection::Right,
        LightRigDirection::Bottom,
        LightRigDirection::BottomLeft,
        LightRigDirection::BottomRight,
    ];
    for v in variants {
        assert_eq!(
            LightRigDirection::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn light_rig_direction_unknown_defaults() {
    assert_eq!(
        LightRigDirection::from_ooxml("bogus"),
        LightRigDirection::Top
    );
}

// -----------------------------------------------------------------------
// BevelPresetType
// -----------------------------------------------------------------------

#[test]
fn bevel_preset_type_roundtrip() {
    let variants = [
        BevelPresetType::RelaxedInset,
        BevelPresetType::Circle,
        BevelPresetType::Slope,
        BevelPresetType::Cross,
        BevelPresetType::Angle,
        BevelPresetType::SoftRound,
        BevelPresetType::Convex,
        BevelPresetType::CoolSlant,
        BevelPresetType::Divot,
        BevelPresetType::Riblet,
        BevelPresetType::HardEdge,
        BevelPresetType::ArtDeco,
    ];
    for v in variants {
        assert_eq!(
            BevelPresetType::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn bevel_preset_type_unknown_defaults() {
    assert_eq!(
        BevelPresetType::from_ooxml("bogus"),
        BevelPresetType::Circle
    );
}

// -----------------------------------------------------------------------
// PresetMaterialType
// -----------------------------------------------------------------------

#[test]
fn preset_material_type_roundtrip() {
    let variants = [
        PresetMaterialType::DkEdge,
        PresetMaterialType::Flat,
        PresetMaterialType::LegacyMatte,
        PresetMaterialType::LegacyMetal,
        PresetMaterialType::LegacyPlastic,
        PresetMaterialType::LegacyWireframe,
        PresetMaterialType::Matte,
        PresetMaterialType::Metal,
        PresetMaterialType::Plastic,
        PresetMaterialType::Powder,
        PresetMaterialType::SoftEdge,
        PresetMaterialType::SoftMetal,
        PresetMaterialType::TranslucentPowder,
        PresetMaterialType::WarmMatte,
    ];
    for v in variants {
        assert_eq!(
            PresetMaterialType::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn preset_material_type_unknown_defaults() {
    assert_eq!(
        PresetMaterialType::from_ooxml("bogus"),
        PresetMaterialType::WarmMatte
    );
}

// -----------------------------------------------------------------------
// 3D Structs
// -----------------------------------------------------------------------

#[test]
fn rotation_3d_basic() {
    let rot = Rotation3D {
        lat: StPositiveFixedAngle::new_unchecked(0),
        lon: StPositiveFixedAngle::new_unchecked(0),
        rev: StPositiveFixedAngle::new_unchecked(0),
    };
    assert_eq!(rot.lat, StPositiveFixedAngle::new_unchecked(0));
    assert_eq!(rot.lon, StPositiveFixedAngle::new_unchecked(0));
    assert_eq!(rot.rev, StPositiveFixedAngle::new_unchecked(0));
}

#[test]
fn camera_basic() {
    let cam = Camera {
        prst: PresetCameraType::OrthographicFront,
        fov: Some(StFovAngle::new_unchecked(4_500_000)),
        zoom: None,
        rot: Some(Rotation3D {
            lat: StPositiveFixedAngle::new_unchecked(100),
            lon: StPositiveFixedAngle::new_unchecked(200),
            rev: StPositiveFixedAngle::new_unchecked(300),
        }),
    };
    assert_eq!(cam.prst, PresetCameraType::OrthographicFront);
    assert_eq!(cam.fov, Some(StFovAngle::new_unchecked(4_500_000)));
    assert!(cam.rot.is_some());
}

#[test]
fn light_rig_basic() {
    let rig = LightRig {
        rig: LightRigType::ThreePt,
        dir: LightRigDirection::Top,
        rot: None,
    };
    assert_eq!(rig.rig, LightRigType::ThreePt);
    assert_eq!(rig.dir, LightRigDirection::Top);
    assert!(rig.rot.is_none());
}

#[test]
fn scene_3d_basic() {
    let scene = Scene3D {
        camera: Camera {
            prst: PresetCameraType::OrthographicFront,
            fov: None,
            zoom: None,
            rot: None,
        },
        light_rig: LightRig {
            rig: LightRigType::ThreePt,
            dir: LightRigDirection::Top,
            rot: None,
        },
        backdrop: None,
        ext_lst: None,
    };
    assert_eq!(scene.camera.prst, PresetCameraType::OrthographicFront);
    assert_eq!(scene.light_rig.rig, LightRigType::ThreePt);
}

#[test]
fn bevel_basic() {
    let bevel = Bevel {
        w: Some(StPositiveCoordinate::new_unchecked(76_200)),
        h: Some(StPositiveCoordinate::new_unchecked(50_800)),
        prst: Some(BevelPresetType::Circle),
    };
    assert_eq!(bevel.w, Some(StPositiveCoordinate::new_unchecked(76_200)));
    assert_eq!(bevel.h, Some(StPositiveCoordinate::new_unchecked(50_800)));
    assert_eq!(bevel.prst, Some(BevelPresetType::Circle));
}

#[test]
fn shape_3d_basic() {
    let shape = Shape3D {
        bevel_t: Some(Bevel {
            w: Some(StPositiveCoordinate::new_unchecked(76_200)),
            h: Some(StPositiveCoordinate::new_unchecked(50_800)),
            prst: None,
        }),
        bevel_b: None,
        extrusion_h: Some(StPositiveCoordinate::new_unchecked(25_400)),
        extrusion_clr: Some(DrawingColor::SrgbClr {
            val: "FF0000".to_string(),
            transforms: vec![],
        }),
        contour_w: Some(StPositiveCoordinate::new_unchecked(12_700)),
        contour_clr: None,
        prst_material: Some(PresetMaterialType::Plastic),
        z: None,
        ext_lst: None,
    };
    assert!(shape.bevel_t.is_some());
    assert!(shape.bevel_b.is_none());
    assert_eq!(
        shape.extrusion_h,
        Some(StPositiveCoordinate::new_unchecked(25_400))
    );
    assert_eq!(shape.prst_material, Some(PresetMaterialType::Plastic));
}

// -----------------------------------------------------------------------
// Geometry types
// -----------------------------------------------------------------------

#[test]
fn custom_geometry_empty() {
    let geom = CustomGeometry {
        av_list: vec![],
        gd_list: vec![],
        ah_list: vec![],
        cxn_list: vec![],
        rect: None,
        path_list: vec![],
    };
    assert!(geom.path_list.is_empty());
}

#[test]
fn path_command_roundtrip() {
    let path = Path2D {
        w: Some(1000),
        h: Some(1000),
        fill: Some(PathFillMode::Norm),
        stroke: Some(true),
        extrusion_ok: None,
        commands: vec![
            PathCommand::MoveTo {
                x: "0".to_string(),
                y: "0".to_string(),
            },
            PathCommand::LineTo {
                x: "1000".to_string(),
                y: "0".to_string(),
            },
            PathCommand::CubicBezTo {
                x1: "1000".to_string(),
                y1: "0".to_string(),
                x2: "1000".to_string(),
                y2: "1000".to_string(),
                x: "500".to_string(),
                y: "1000".to_string(),
            },
            PathCommand::Close,
        ],
    };
    assert_eq!(path.commands.len(), 4);
    let json = serde_json::to_string(&path).unwrap();
    let deserialized: Path2D = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, path);
}

#[test]
fn shape_geometry_preset() {
    let geom = ShapeGeometry::Preset(PresetGeometry {
        prst: ShapePreset::RoundRect,
        av_list: vec![GeomGuide {
            name: "adj".to_string(),
            fmla: "val 16667".to_string(),
        }],
    });
    match geom {
        ShapeGeometry::Preset(p) => {
            assert_eq!(p.prst, ShapePreset::RoundRect);
            assert_eq!(p.av_list.len(), 1);
        }
        _ => panic!("expected Preset"),
    }
}

#[test]
fn path_fill_mode_roundtrip() {
    let variants = [
        PathFillMode::None,
        PathFillMode::Norm,
        PathFillMode::Lighten,
        PathFillMode::LightenLess,
        PathFillMode::Darken,
        PathFillMode::DarkenLess,
    ];
    for v in variants {
        assert_eq!(
            PathFillMode::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

// -----------------------------------------------------------------------
// ShapeProperties / GroupShapeProperties
// -----------------------------------------------------------------------

#[test]
fn shape_properties_default() {
    let sp = ShapeProperties::default();
    assert!(sp.xfrm.is_none());
    assert!(sp.geometry.is_none());
    assert!(sp.fill.is_none());
    assert!(sp.ln.is_none());
    assert!(sp.effects.is_none());
    assert!(sp.scene3d.is_none());
    assert!(sp.sp3d.is_none());
    assert!(sp.bw_mode.is_none());
}

#[test]
fn group_shape_properties_default() {
    let gsp = GroupShapeProperties::default();
    assert!(gsp.xfrm.is_none());
    assert!(gsp.fill.is_none());
    assert!(gsp.effects.is_none());
    assert!(gsp.scene3d.is_none());
    assert!(gsp.bw_mode.is_none());
    assert!(gsp.ext_lst.is_none());
}

#[test]
fn drawing_color_scheme_with_transforms_serde_roundtrip() {
    let color = DrawingColor::SchemeClr {
        val: SchemeColor::Accent1,
        transforms: vec![
            ColorTransform::Tint { val: 40000 },
            ColorTransform::SatMod { val: 120000 },
        ],
    };
    let json = serde_json::to_string(&color).unwrap();
    let deserialized: DrawingColor = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, color);
}

#[test]
fn drawing_color_srgb_no_transforms_serde_roundtrip() {
    let color = DrawingColor::SrgbClr {
        val: "FF0000".to_string(),
        transforms: vec![],
    };
    let json = serde_json::to_string(&color).unwrap();
    let deserialized: DrawingColor = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, color);
    // Verify transforms field is omitted when empty
    assert!(!json.contains("transforms"));
}

#[test]
fn color_transform_from_ooxml_roundtrip() {
    let cases = [
        ("tint", Some(40000), "tint"),
        ("shade", Some(60000), "shade"),
        ("lumMod", Some(75000), "lumMod"),
        ("lumOff", Some(25000), "lumOff"),
        ("satMod", Some(120000), "satMod"),
        ("alpha", Some(50000), "alpha"),
        ("comp", None, "comp"),
        ("inv", None, "inv"),
        ("gray", None, "gray"),
        ("gamma", None, "gamma"),
        ("invGamma", None, "invGamma"),
    ];
    for (name, val, expected_name) in cases {
        let ct = ColorTransform::from_ooxml(name, val)
            .unwrap_or_else(|| panic!("from_ooxml({name}) returned None"));
        assert_eq!(
            ct.to_ooxml_name(),
            expected_name,
            "to_ooxml_name mismatch for {name}"
        );
        if let Some(v) = val {
            assert_eq!(ct.val(), Some(v), "val mismatch for {name}");
        }
    }
}
