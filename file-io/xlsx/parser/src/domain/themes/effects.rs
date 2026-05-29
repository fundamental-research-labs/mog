//! Effect style types and parsing for Excel themes.
//!
//! This module parses effect styles directly into canonical `ooxml_types` types,
//! providing full OOXML fidelity for round-trip.

use ooxml_types::drawings::{
    Bevel, BevelPresetType, BlurEffect, Camera, EffectContainer, EffectContainerType, EffectList,
    EffectProperties, Glow, InnerShadow, LightRig, LightRigDirection, LightRigType, OuterShadow,
    PresetCameraType, PresetMaterialType, PresetShadow, PresetShadowVal, RectAlignment, Reflection,
    Rotation3D, Scene3D, Shape3D, SoftEdge, StAngle, StFixedAngle, StPercentage,
    StPositiveCoordinate, StPositiveFixedAngle, StPositiveFixedPercentageDecimal,
};
use ooxml_types::themes::EffectStyleItem;

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};

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

        if item.effect_properties.is_none()
            && let Some(dag_start) = find_tag_simd(eff_xml, b"effectDag", 0)
            && !is_self_closing_start_tag(eff_xml, dag_start)
        {
            let dag_end =
                find_closing_tag(eff_xml, b"effectDag", dag_start).unwrap_or(eff_xml.len());
            let dag_xml = &eff_xml[dag_start..dag_end];
            item.effect_properties =
                Some(EffectProperties::EffectDag(parse_effect_container(dag_xml)));
        }

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

fn is_self_closing_start_tag(xml: &[u8], start: usize) -> bool {
    find_gt_simd(xml, start).is_some_and(|gt| {
        gt > start && xml[..gt].iter().rev().find(|&&b| !b" \t\r\n".contains(&b)) == Some(&b'/')
    })
}

fn parse_effect_container(xml: &[u8]) -> EffectContainer {
    EffectContainer {
        container_type: get_attr(xml, b"type=\"").and_then(EffectContainerType::from_ooxml),
        name: get_attr(xml, b"name=\"").map(str::to_string),
        effects: Vec::new(),
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use ooxml_types::drawings::{ColorTransform, DrawingColor, EffectProperties};

    #[test]
    fn test_parse_effect_style_list_skips_wrapper_and_keeps_empty_effect_list() {
        let styles = parse_effect_style_list_canonical(
            br#"<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>"#,
        );

        assert_eq!(styles.len(), 1);
        match &styles[0].effect_properties {
            Some(EffectProperties::EffectList(list)) => assert!(list.is_empty()),
            _ => panic!("Expected empty EffectList"),
        }
    }

    #[test]
    fn test_parse_effect_list_supported_members() {
        let styles = parse_effect_style_list_canonical(
            br#"
            <a:effectStyleLst>
                <a:effectStyle>
                    <a:effectLst>
                        <a:outerShdw blurRad="40000" dist="23000" dir="5400000" rotWithShape="0">
                            <a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr>
                        </a:outerShdw>
                        <a:innerShdw blurRad="10000" dist="20000" dir="30000">
                            <a:schemeClr val="accent1"/>
                        </a:innerShdw>
                        <a:glow rad="5000"><a:prstClr val="red"/></a:glow>
                        <a:softEdge rad="6000"/>
                        <a:reflection blurRad="7000" stA="8000" stPos="9000" endA="10000" endPos="11000" dist="12000" dir="13000" fadeDir="14000" sx="15000" sy="16000" kx="17000" ky="18000" rotWithShape="0"/>
                        <a:prstShdw prst="shdw1" dist="19000" dir="20000"><a:srgbClr val="111111"/></a:prstShdw>
                        <a:blur rad="21000" grow="0"/>
                    </a:effectLst>
                </a:effectStyle>
            </a:effectStyleLst>
            "#,
        );

        let list = match &styles[0].effect_properties {
            Some(EffectProperties::EffectList(list)) => list,
            _ => panic!("Expected EffectList"),
        };

        let outer = list.outer_shadow.as_ref().expect("outer shadow");
        assert_eq!(outer.blur_rad.value(), 40000);
        assert_eq!(outer.dist.value(), 23000);
        assert_eq!(outer.dir.value(), 5400000);
        assert!(!outer.rot_with_shape);
        match outer.color.as_ref().expect("outer color") {
            DrawingColor::SrgbClr { transforms, .. } => {
                assert_eq!(transforms, &vec![ColorTransform::Alpha { val: 35000 }]);
            }
            _ => panic!("Expected SrgbClr"),
        }

        assert_eq!(
            list.inner_shadow
                .as_ref()
                .expect("inner shadow")
                .dist
                .value(),
            20000
        );
        assert_eq!(list.glow.as_ref().expect("glow").rad.value(), 5000);
        assert_eq!(
            list.soft_edge.as_ref().expect("soft edge").rad.value(),
            6000
        );
        assert_eq!(
            list.reflection.as_ref().expect("reflection").dist.value(),
            12000
        );
        assert_eq!(
            list.preset_shadow
                .as_ref()
                .expect("preset shadow")
                .dist
                .value(),
            19000
        );
        let blur = list.blur.as_ref().expect("blur");
        assert_eq!(blur.rad.value(), 21000);
        assert!(!blur.grow);
    }

    #[test]
    fn test_parse_scene3d_and_sp3d_preserve_current_fidelity() {
        let styles = parse_effect_style_list_canonical(
            br#"
            <a:effectStyleLst>
                <a:effectStyle>
                    <a:effectLst/>
                    <a:scene3d>
                        <a:camera prst="perspectiveRelaxed" fov="5400000" zoom="150000">
                            <a:rot lat="1000" lon="2000" rev="3000"/>
                        </a:camera>
                        <a:lightRig rig="balanced" dir="br">
                            <a:rot lat="4000" lon="5000" rev="6000"/>
                        </a:lightRig>
                    </a:scene3d>
                    <a:sp3d extrusionH="7000" contourW="8000" prstMaterial="metal" z="9000">
                        <a:bevelT w="10000" h="11000" prst="circle"/>
                        <a:bevelB w="12000" h="13000" prst="relaxedInset"/>
                        <a:extrusionClr><a:srgbClr val="222222"/></a:extrusionClr>
                        <a:contourClr><a:srgbClr val="333333"/></a:contourClr>
                    </a:sp3d>
                </a:effectStyle>
            </a:effectStyleLst>
            "#,
        );

        let scene = styles[0].scene_3d.as_ref().expect("scene3d");
        assert_eq!(scene.camera.fov.as_ref().map(|v| v.value()), Some(5400000));
        assert_eq!(scene.camera.zoom, Some(150000));
        let cam_rot = scene.camera.rot.as_ref().expect("camera rot");
        assert_eq!(cam_rot.lat.value(), 1000);
        assert_eq!(cam_rot.lon.value(), 2000);
        assert_eq!(cam_rot.rev.value(), 3000);
        let rig_rot = scene.light_rig.rot.as_ref().expect("light rig rot");
        assert_eq!(rig_rot.lat.value(), 4000);
        assert_eq!(rig_rot.lon.value(), 5000);
        assert_eq!(rig_rot.rev.value(), 6000);

        let sp3d = styles[0].sp_3d.as_ref().expect("sp3d");
        assert_eq!(sp3d.extrusion_h.as_ref().map(|v| v.value()), Some(7000));
        assert_eq!(sp3d.contour_w.as_ref().map(|v| v.value()), Some(8000));
        assert_eq!(sp3d.z.as_ref().map(|v| v.value()), Some(9000));
        assert!(matches!(
            &sp3d.extrusion_clr,
            Some(DrawingColor::SrgbClr { .. })
        ));
        assert!(matches!(
            &sp3d.contour_clr,
            Some(DrawingColor::SrgbClr { .. })
        ));
        assert_eq!(
            sp3d.bevel_t
                .as_ref()
                .and_then(|bevel| bevel.w)
                .map(|v| v.value()),
            Some(10000)
        );
        assert_eq!(
            sp3d.bevel_b
                .as_ref()
                .and_then(|bevel| bevel.h)
                .map(|v| v.value()),
            Some(13000)
        );
    }

    #[test]
    fn test_parse_effect_dag_remains_shallow() {
        let styles = parse_effect_style_list_canonical(
            br#"<a:effectStyleLst><a:effectStyle><a:effectDag/></a:effectStyle></a:effectStyleLst>"#,
        );

        assert_eq!(styles.len(), 1);
        assert!(styles[0].effect_properties.is_none());
    }
}
