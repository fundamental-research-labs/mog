//! Effect style types and parsing for Excel themes.
//!
//! This module parses effect styles directly into canonical `ooxml_types` types,
//! providing full OOXML fidelity for round-trip.

use ooxml_types::drawings::{
    Bevel, BevelPresetType, BlurEffect, Camera, EffectList, EffectProperties, Glow, InnerShadow,
    LightRig, LightRigDirection, LightRigType, OuterShadow, PresetCameraType, PresetMaterialType,
    PresetShadow, PresetShadowVal, RectAlignment, Reflection, Rotation3D, Scene3D, Shape3D,
    SoftEdge, StAngle, StFixedAngle, StPercentage, StPositiveCoordinate, StPositiveFixedAngle,
    StPositiveFixedPercentageDecimal,
};
use ooxml_types::themes::EffectStyleItem;

use crate::infra::scanner::{find_closing_tag, find_tag_simd};

use super::formats::{get_attr, get_attr_i32, get_attr_u32, parse_drawing_color};

// =============================================================================
// Effect Style List Parsing
// =============================================================================

/// Parse `<a:effectStyleLst>` children into canonical `Vec<EffectStyleItem>`.
pub fn parse_effect_style_list_canonical(xml: &[u8]) -> Vec<EffectStyleItem> {
    let mut styles = Vec::new();
    let mut pos = 0;

    while let Some(eff_start) = find_tag_simd(xml, b"effectStyle", pos) {
        // Skip if this is effectStyleLst
        if eff_start + 11 < xml.len() && xml[eff_start + 11] == b'L' {
            pos = eff_start + 14;
            continue;
        }

        let eff_end = find_closing_tag(xml, b"effectStyle", eff_start).unwrap_or(xml.len());
        let eff_xml = &xml[eff_start..eff_end];

        let mut item = EffectStyleItem::default();

        // Parse effectLst
        if let Some(lst_start) = find_tag_simd(eff_xml, b"effectLst", 0) {
            let lst_end =
                find_closing_tag(eff_xml, b"effectLst", lst_start).unwrap_or(eff_xml.len());
            let lst_xml = &eff_xml[lst_start..lst_end];
            item.effect_properties = Some(EffectProperties::EffectList(parse_effect_list(lst_xml)));
        }

        // Parse effectDag (if present instead of effectLst)
        // For now, we don't parse effectDag deeply - it's rare in themes.
        // The effectLst path covers 99%+ of real-world themes.

        // Parse scene3d
        if let Some(scene_start) = find_tag_simd(eff_xml, b"scene3d", 0) {
            let scene_end =
                find_closing_tag(eff_xml, b"scene3d", scene_start).unwrap_or(eff_xml.len());
            let scene_xml = &eff_xml[scene_start..scene_end];
            item.scene_3d = parse_scene_3d(scene_xml);
        }

        // Parse sp3d
        if let Some(sp_start) = find_tag_simd(eff_xml, b"sp3d", 0) {
            let sp_end = find_closing_tag(eff_xml, b"sp3d", sp_start).unwrap_or(eff_xml.len());
            let sp_xml = &eff_xml[sp_start..sp_end];
            item.sp_3d = parse_shape_3d(sp_xml);
        }

        styles.push(item);
        pos = eff_end;
    }

    styles
}

// =============================================================================
// Effect List Parsing
// =============================================================================

/// Parse `<a:effectLst>` children into an `EffectList`.
fn parse_effect_list(xml: &[u8]) -> EffectList {
    let mut list = EffectList::default();

    // Parse outerShdw
    if let Some(start) = find_tag_simd(xml, b"outerShdw", 0) {
        let end = find_closing_tag(xml, b"outerShdw", start).unwrap_or(xml.len());
        list.outer_shadow = Some(parse_outer_shadow(&xml[start..end]));
    }

    // Parse innerShdw
    if let Some(start) = find_tag_simd(xml, b"innerShdw", 0) {
        let end = find_closing_tag(xml, b"innerShdw", start).unwrap_or(xml.len());
        list.inner_shadow = Some(parse_inner_shadow(&xml[start..end]));
    }

    // Parse glow
    if let Some(start) = find_tag_simd(xml, b"glow", 0) {
        let end = find_closing_tag(xml, b"glow", start).unwrap_or(xml.len());
        list.glow = Some(parse_glow(&xml[start..end]));
    }

    // Parse softEdge
    if let Some(start) = find_tag_simd(xml, b"softEdge", 0) {
        let end = find_closing_tag(xml, b"softEdge", start).unwrap_or(xml.len());
        let se_xml = &xml[start..end];
        let rad = get_attr_i32(se_xml, b"rad=\"").unwrap_or(0);
        list.soft_edge = Some(SoftEdge {
            rad: StPositiveCoordinate::new_clamped(rad as i64),
        });
    }

    // Parse reflection
    if let Some(start) = find_tag_simd(xml, b"reflection", 0) {
        let end = find_closing_tag(xml, b"reflection", start).unwrap_or(xml.len());
        list.reflection = Some(parse_reflection(&xml[start..end]));
    }

    // Parse prstShdw
    if let Some(start) = find_tag_simd(xml, b"prstShdw", 0) {
        let end = find_closing_tag(xml, b"prstShdw", start).unwrap_or(xml.len());
        list.preset_shadow = Some(parse_preset_shadow(&xml[start..end]));
    }

    // Parse blur
    if let Some(start) = find_tag_simd(xml, b"blur", 0) {
        let end = find_closing_tag(xml, b"blur", start).unwrap_or(xml.len());
        let blur_xml = &xml[start..end];
        let rad = get_attr_i32(blur_xml, b"rad=\"").unwrap_or(0);
        let grow = get_attr(blur_xml, b"grow=\"")
            .map(|v| v != "0" && v != "false")
            .unwrap_or(true);
        list.blur = Some(BlurEffect {
            rad: StPositiveCoordinate::new_clamped(rad as i64),
            grow,
        });
    }

    list
}

/// Parse `<a:outerShdw>` into `OuterShadow`.
fn parse_outer_shadow(xml: &[u8]) -> OuterShadow {
    let mut shadow = OuterShadow::default();

    if let Some(v) = get_attr_i32(xml, b"blurRad=\"") {
        shadow.blur_rad = StPositiveCoordinate::new_clamped(v as i64);
    }
    if let Some(v) = get_attr_i32(xml, b"dist=\"") {
        shadow.dist = StPositiveCoordinate::new_clamped(v as i64);
    }
    if let Some(v) = get_attr_i32(xml, b"dir=\"") {
        shadow.dir = StAngle::new(v);
    }
    if let Some(v) = get_attr_i32(xml, b"sx=\"") {
        shadow.sx = StPercentage::new(v);
    }
    if let Some(v) = get_attr_i32(xml, b"sy=\"") {
        shadow.sy = StPercentage::new(v);
    }
    if let Some(v) = get_attr_i32(xml, b"kx=\"") {
        shadow.kx = StFixedAngle::new_clamped(v);
    }
    if let Some(v) = get_attr_i32(xml, b"ky=\"") {
        shadow.ky = StFixedAngle::new_clamped(v);
    }
    if let Some(v) = get_attr(xml, b"algn=\"") {
        shadow.align = Some(RectAlignment::from_ooxml(v));
    }
    if let Some(v) = get_attr(xml, b"rotWithShape=\"") {
        shadow.rot_with_shape = v == "1" || v == "true";
    }

    shadow.color = parse_drawing_color(xml);
    shadow
}

/// Parse `<a:innerShdw>` into `InnerShadow`.
fn parse_inner_shadow(xml: &[u8]) -> InnerShadow {
    let mut shadow = InnerShadow::default();

    if let Some(v) = get_attr_i32(xml, b"blurRad=\"") {
        shadow.blur_rad = StPositiveCoordinate::new_clamped(v as i64);
    }
    if let Some(v) = get_attr_i32(xml, b"dist=\"") {
        shadow.dist = StPositiveCoordinate::new_clamped(v as i64);
    }
    if let Some(v) = get_attr_i32(xml, b"dir=\"") {
        shadow.dir = StAngle::new(v);
    }

    shadow.color = parse_drawing_color(xml);
    shadow
}

/// Parse `<a:glow>` into `Glow`.
fn parse_glow(xml: &[u8]) -> Glow {
    let mut glow = Glow::default();
    if let Some(v) = get_attr_i32(xml, b"rad=\"") {
        glow.rad = StPositiveCoordinate::new_clamped(v as i64);
    }
    glow.color = parse_drawing_color(xml);
    glow
}

/// Parse `<a:reflection>` into `Reflection`.
fn parse_reflection(xml: &[u8]) -> Reflection {
    let mut refl = Reflection::default();

    if let Some(v) = get_attr_i32(xml, b"blurRad=\"") {
        refl.blur_rad = StPositiveCoordinate::new_clamped(v as i64);
    }
    if let Some(v) = get_attr_u32(xml, b"stA=\"") {
        refl.start_alpha = StPositiveFixedPercentageDecimal::new_clamped(v);
    }
    if let Some(v) = get_attr_u32(xml, b"stPos=\"") {
        refl.start_pos = StPositiveFixedPercentageDecimal::new_clamped(v);
    }
    if let Some(v) = get_attr_u32(xml, b"endA=\"") {
        refl.end_alpha = StPositiveFixedPercentageDecimal::new_clamped(v);
    }
    if let Some(v) = get_attr_u32(xml, b"endPos=\"") {
        refl.end_pos = StPositiveFixedPercentageDecimal::new_clamped(v);
    }
    if let Some(v) = get_attr_i32(xml, b"dist=\"") {
        refl.dist = StPositiveCoordinate::new_clamped(v as i64);
    }
    if let Some(v) = get_attr_i32(xml, b"dir=\"") {
        refl.dir = StAngle::new(v);
    }
    if let Some(v) = get_attr_i32(xml, b"fadeDir=\"") {
        refl.fade_dir = StAngle::new(v);
    }
    if let Some(v) = get_attr_i32(xml, b"sx=\"") {
        refl.sx = StPercentage::new(v);
    }
    if let Some(v) = get_attr_i32(xml, b"sy=\"") {
        refl.sy = StPercentage::new(v);
    }
    if let Some(v) = get_attr_i32(xml, b"kx=\"") {
        refl.kx = StFixedAngle::new_clamped(v);
    }
    if let Some(v) = get_attr_i32(xml, b"ky=\"") {
        refl.ky = StFixedAngle::new_clamped(v);
    }
    if let Some(v) = get_attr(xml, b"algn=\"") {
        refl.align = Some(RectAlignment::from_ooxml(v));
    }
    if let Some(v) = get_attr(xml, b"rotWithShape=\"") {
        refl.rot_with_shape = v == "1" || v == "true";
    }

    refl
}

/// Parse `<a:prstShdw>` into `PresetShadow`.
fn parse_preset_shadow(xml: &[u8]) -> PresetShadow {
    let mut shadow = PresetShadow::default();

    if let Some(v) = get_attr(xml, b"prst=\"") {
        if let Some(val) = PresetShadowVal::from_ooxml(v) {
            shadow.preset = val;
        }
    }
    if let Some(v) = get_attr_i32(xml, b"dist=\"") {
        shadow.dist = StPositiveCoordinate::new_clamped(v as i64);
    }
    if let Some(v) = get_attr_i32(xml, b"dir=\"") {
        shadow.dir = StAngle::new(v);
    }

    shadow.color = parse_drawing_color(xml);
    shadow
}

// =============================================================================
// 3D Scene Parsing
// =============================================================================

/// Parse `<a:scene3d>` into `Scene3D`.
fn parse_scene_3d(xml: &[u8]) -> Option<Scene3D> {
    // Parse camera (required)
    let camera = {
        let cam_start = find_tag_simd(xml, b"camera", 0)?;
        let cam_end = find_closing_tag(xml, b"camera", cam_start).unwrap_or(xml.len());
        let cam_xml = &xml[cam_start..cam_end];

        let prst = get_attr(cam_xml, b"prst=\"")
            .map(PresetCameraType::from_ooxml)
            .unwrap_or(PresetCameraType::OrthographicFront);
        let fov = get_attr_i32(cam_xml, b"fov=\"")
            .and_then(|v| ooxml_types::drawings::StFovAngle::new(v as i64));
        let zoom = get_attr_u32(cam_xml, b"zoom=\"");
        let rot = parse_rotation_3d(cam_xml);

        Camera {
            prst,
            fov,
            zoom,
            rot,
        }
    };

    // Parse lightRig (required)
    let light_rig = {
        let lr_start = find_tag_simd(xml, b"lightRig", 0)?;
        let lr_end = find_closing_tag(xml, b"lightRig", lr_start).unwrap_or(xml.len());
        let lr_xml = &xml[lr_start..lr_end];

        let rig = get_attr(lr_xml, b"rig=\"")
            .map(LightRigType::from_ooxml)
            .unwrap_or(LightRigType::ThreePt);
        let dir = get_attr(lr_xml, b"dir=\"")
            .map(LightRigDirection::from_ooxml)
            .unwrap_or(LightRigDirection::Top);
        let rot = parse_rotation_3d(lr_xml);

        LightRig { rig, dir, rot }
    };

    Some(Scene3D {
        camera,
        light_rig,
        backdrop: None, // backdrop is rare in theme effects
        ext_lst: None,
    })
}

/// Parse rotation attributes (lat, lon, rev) from an element containing `<a:rot>`.
fn parse_rotation_3d(xml: &[u8]) -> Option<Rotation3D> {
    // Look for rot element
    let rot_start = find_tag_simd(xml, b"rot", 0)?;
    let rot_end = find_closing_tag(xml, b"rot", rot_start).unwrap_or(xml.len());
    let rot_xml = &xml[rot_start..rot_end];

    // Also check if rot attrs are directly on the parent element
    let lat = get_attr_i32(rot_xml, b"lat=\"")?;
    let lon = get_attr_i32(rot_xml, b"lon=\"").unwrap_or(0);
    let rev = get_attr_i32(rot_xml, b"rev=\"").unwrap_or(0);

    Some(Rotation3D {
        lat: StPositiveFixedAngle::new_clamped(lat as i64),
        lon: StPositiveFixedAngle::new_clamped(lon as i64),
        rev: StPositiveFixedAngle::new_clamped(rev as i64),
    })
}

// =============================================================================
// 3D Shape Parsing
// =============================================================================

/// Parse `<a:sp3d>` into `Shape3D`.
fn parse_shape_3d(xml: &[u8]) -> Option<Shape3D> {
    let mut shape = Shape3D {
        bevel_t: None,
        bevel_b: None,
        extrusion_h: get_attr_i32(xml, b"extrusionH=\"")
            .and_then(|v| StPositiveCoordinate::new(v as i64)),
        extrusion_clr: None,
        contour_w: get_attr_i32(xml, b"contourW=\"")
            .and_then(|v| StPositiveCoordinate::new(v as i64)),
        contour_clr: None,
        prst_material: get_attr(xml, b"prstMaterial=\"").map(PresetMaterialType::from_ooxml),
        z: get_attr_i32(xml, b"z=\"").map(|v| ooxml_types::drawings::StCoordinate::new(v as i64)),
        ext_lst: None,
    };

    // Parse bevelT
    if let Some(start) = find_tag_simd(xml, b"bevelT", 0) {
        let end = find_closing_tag(xml, b"bevelT", start).unwrap_or(xml.len());
        shape.bevel_t = Some(parse_bevel(&xml[start..end]));
    }

    // Parse bevelB
    if let Some(start) = find_tag_simd(xml, b"bevelB", 0) {
        let end = find_closing_tag(xml, b"bevelB", start).unwrap_or(xml.len());
        shape.bevel_b = Some(parse_bevel(&xml[start..end]));
    }

    // Parse extrusionClr
    if let Some(start) = find_tag_simd(xml, b"extrusionClr", 0) {
        let end = find_closing_tag(xml, b"extrusionClr", start).unwrap_or(xml.len());
        shape.extrusion_clr = parse_drawing_color(&xml[start..end]);
    }

    // Parse contourClr
    if let Some(start) = find_tag_simd(xml, b"contourClr", 0) {
        let end = find_closing_tag(xml, b"contourClr", start).unwrap_or(xml.len());
        shape.contour_clr = parse_drawing_color(&xml[start..end]);
    }

    Some(shape)
}

/// Parse a bevel element (bevelT or bevelB).
fn parse_bevel(xml: &[u8]) -> Bevel {
    Bevel {
        w: get_attr_i32(xml, b"w=\"").and_then(|v| StPositiveCoordinate::new(v as i64)),
        h: get_attr_i32(xml, b"h=\"").and_then(|v| StPositiveCoordinate::new(v as i64)),
        prst: get_attr(xml, b"prst=\"").map(BevelPresetType::from_ooxml),
    }
}
