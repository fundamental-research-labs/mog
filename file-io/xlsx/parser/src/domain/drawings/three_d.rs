//! 3D effect parsing for drawings (Scene3D and Shape3D).
//!
//! Parses `<a:scene3d>` and `<a:sp3d>` elements into typed structs from `ooxml_types`.

use crate::infra::scanner::{find_closing_tag, find_tag_simd};

use super::helpers::{extract_attr_value_in_element, parse_i64};
use ooxml_types::drawings::{
    Backdrop, Bevel, BevelPresetType, Camera, DrawingColor, LightRig, LightRigDirection,
    LightRigType, Point3D, PresetCameraType, PresetMaterialType, Rotation3D, Scene3D, SchemeColor,
    Shape3D, StCoordinate, StFovAngle, StPositiveCoordinate, StPositiveFixedAngle,
};

/// Parse a `<a:rot>` element into a `Rotation3D`.
fn parse_rotation_3d(xml: &[u8]) -> Option<Rotation3D> {
    let lat = extract_attr_value_in_element(xml, b"lat=\"").and_then(|v| parse_i64(v))?;
    let lon = extract_attr_value_in_element(xml, b"lon=\"").and_then(|v| parse_i64(v))?;
    let rev = extract_attr_value_in_element(xml, b"rev=\"").and_then(|v| parse_i64(v))?;
    Some(Rotation3D {
        lat: StPositiveFixedAngle::new_clamped(lat),
        lon: StPositiveFixedAngle::new_clamped(lon),
        rev: StPositiveFixedAngle::new_clamped(rev),
    })
}

/// Parse a `<a:bevelT>` or `<a:bevelB>` element into a `Bevel`.
fn parse_bevel(xml: &[u8]) -> Bevel {
    let w = extract_attr_value_in_element(xml, b"w=\"").and_then(|v| parse_i64(v));
    let h = extract_attr_value_in_element(xml, b"h=\"").and_then(|v| parse_i64(v));
    let prst = extract_attr_value_in_element(xml, b"prst=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(BevelPresetType::from_ooxml);
    Bevel {
        w: w.map(StPositiveCoordinate::new_clamped),
        h: h.map(StPositiveCoordinate::new_clamped),
        prst,
    }
}

/// Parse a color reference child element (schemeClr, srgbClr, sysClr, prstClr, hslClr).
///
/// Looks for the first recognized color child element in the given XML slice.
fn parse_color_ref(xml: &[u8]) -> Option<DrawingColor> {
    if let Some(start) = find_tag_simd(xml, b"schemeClr", 0) {
        let val_str = extract_attr_value_in_element(&xml[start..], b"val=\"")
            .and_then(|v| std::str::from_utf8(v).ok())?;
        let scheme = SchemeColor::from_ooxml(val_str).unwrap_or_default();
        return Some(DrawingColor::SchemeClr {
            val: scheme,
            transforms: vec![],
        });
    }
    if let Some(start) = find_tag_simd(xml, b"srgbClr", 0) {
        let val = extract_attr_value_in_element(&xml[start..], b"val=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .map(|s| s.to_string())?;
        return Some(DrawingColor::SrgbClr {
            val,
            transforms: vec![],
        });
    }
    if let Some(start) = find_tag_simd(xml, b"sysClr", 0) {
        let val = extract_attr_value_in_element(&xml[start..], b"val=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .map(ooxml_types::drawings::SystemColorVal::from_ooxml)?;
        return Some(DrawingColor::SysClr {
            val,
            last_clr: None,
            transforms: vec![],
        });
    }
    if let Some(start) = find_tag_simd(xml, b"prstClr", 0) {
        let val = extract_attr_value_in_element(&xml[start..], b"val=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .map(ooxml_types::drawings::PresetColorVal::from_ooxml)?;
        return Some(DrawingColor::PrstClr {
            val,
            transforms: vec![],
        });
    }
    if let Some(start) = find_tag_simd(xml, b"hslClr", 0) {
        let el = &xml[start..];
        let hue = extract_attr_value_in_element(el, b"hue=\"").and_then(|v| parse_i64(v))? as i32;
        let sat = extract_attr_value_in_element(el, b"sat=\"").and_then(|v| parse_i64(v))? as i32;
        let lum = extract_attr_value_in_element(el, b"lum=\"").and_then(|v| parse_i64(v))? as i32;
        return Some(DrawingColor::HslClr {
            hue,
            sat,
            lum,
            transforms: vec![],
        });
    }
    if let Some(start) = find_tag_simd(xml, b"scrgbClr", 0) {
        let el = &xml[start..];
        let r = extract_attr_value_in_element(el, b"r=\"")
            .and_then(|v| parse_i64(v))
            .unwrap_or(0) as i32;
        let g = extract_attr_value_in_element(el, b"g=\"")
            .and_then(|v| parse_i64(v))
            .unwrap_or(0) as i32;
        let b = extract_attr_value_in_element(el, b"b=\"")
            .and_then(|v| parse_i64(v))
            .unwrap_or(0) as i32;
        return Some(DrawingColor::ScrgbClr {
            r,
            g,
            b,
            transforms: vec![],
        });
    }
    None
}

/// Parse a `<a:scene3d>` element into a typed `Scene3D`.
///
/// Expects `xml` to start at the opening `<a:scene3d>` tag (or `<scene3d>` without
/// namespace prefix) and extend to (at least) its closing tag.
///
/// Returns `None` if the required `<a:camera>` or `<a:lightRig>` children are missing
/// or if their required attributes cannot be parsed.
pub fn parse_scene3d(xml: &[u8]) -> Option<Scene3D> {
    // Parse camera
    let cam_start = find_tag_simd(xml, b"camera", 0)?;
    let cam_el = &xml[cam_start..];
    let prst = extract_attr_value_in_element(cam_el, b"prst=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(PresetCameraType::from_ooxml)?;
    let fov = extract_attr_value_in_element(cam_el, b"fov=\"").and_then(|v| parse_i64(v));
    let cam_rot = find_tag_simd(cam_el, b"rot", 0)
        .and_then(|rot_start| parse_rotation_3d(&cam_el[rot_start..]));
    let zoom = extract_attr_value_in_element(cam_el, b"zoom=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .and_then(|v| v.parse::<u32>().ok());
    let camera = Camera {
        prst,
        fov: fov.map(StFovAngle::new_clamped),
        zoom,
        rot: cam_rot,
    };

    // Parse light rig
    let lr_start = find_tag_simd(xml, b"lightRig", 0)?;
    let lr_el = &xml[lr_start..];
    let rig = extract_attr_value_in_element(lr_el, b"rig=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(LightRigType::from_ooxml)?;
    let dir = extract_attr_value_in_element(lr_el, b"dir=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(LightRigDirection::from_ooxml)?;
    let lr_rot = find_tag_simd(lr_el, b"rot", 0)
        .and_then(|rot_start| parse_rotation_3d(&lr_el[rot_start..]));
    let light_rig = LightRig {
        rig,
        dir,
        rot: lr_rot,
    };

    // Parse optional backdrop
    let backdrop = find_tag_simd(xml, b"backdrop", 0).and_then(|bd_start| {
        let bd_end = find_closing_tag(xml, b"backdrop", bd_start).unwrap_or(xml.len());
        let bd_slice = &xml[bd_start..bd_end];

        let anchor = find_tag_simd(bd_slice, b"anchor", 0).map(|s| {
            let el = &bd_slice[s..];
            Point3D {
                x: StCoordinate::new(
                    extract_attr_value_in_element(el, b"x=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                ),
                y: StCoordinate::new(
                    extract_attr_value_in_element(el, b"y=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                ),
                z: StCoordinate::new(
                    extract_attr_value_in_element(el, b"z=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                ),
            }
        })?;

        let norm = find_tag_simd(bd_slice, b"norm", 0).map(|s| {
            let el = &bd_slice[s..];
            Point3D {
                x: StCoordinate::new(
                    extract_attr_value_in_element(el, b"x=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                ),
                y: StCoordinate::new(
                    extract_attr_value_in_element(el, b"y=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                ),
                z: StCoordinate::new(
                    extract_attr_value_in_element(el, b"z=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                ),
            }
        })?;

        let up = find_tag_simd(bd_slice, b"up", 0).map(|s| {
            let el = &bd_slice[s..];
            Point3D {
                x: StCoordinate::new(
                    extract_attr_value_in_element(el, b"x=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                ),
                y: StCoordinate::new(
                    extract_attr_value_in_element(el, b"y=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                ),
                z: StCoordinate::new(
                    extract_attr_value_in_element(el, b"z=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                ),
            }
        })?;

        let ext_lst = find_tag_simd(bd_slice, b"extLst", 0).and_then(|ext_start| {
            let mut open = ext_start;
            while open > 0 && bd_slice[open - 1] != b'<' {
                open -= 1;
            }
            open = open.saturating_sub(1);
            find_closing_tag(bd_slice, b"extLst", ext_start).and_then(|close_lt| {
                let mut close_end = close_lt;
                while close_end < bd_slice.len() && bd_slice[close_end] != b'>' {
                    close_end += 1;
                }
                if close_end < bd_slice.len() {
                    Some(String::from_utf8_lossy(&bd_slice[open..=close_end]).into_owned())
                } else {
                    None
                }
            })
        });

        Some(Backdrop {
            anchor,
            norm,
            up,
            ext_lst,
        })
    });

    // Parse optional ext_lst for Scene3D
    let ext_lst = find_tag_simd(xml, b"extLst", 0).and_then(|ext_start| {
        let mut open = ext_start;
        while open > 0 && xml[open - 1] != b'<' {
            open -= 1;
        }
        open = open.saturating_sub(1);
        find_closing_tag(xml, b"extLst", ext_start).and_then(|close_lt| {
            let mut close_end = close_lt;
            while close_end < xml.len() && xml[close_end] != b'>' {
                close_end += 1;
            }
            if close_end < xml.len() {
                Some(String::from_utf8_lossy(&xml[open..=close_end]).into_owned())
            } else {
                None
            }
        })
    });

    Some(Scene3D {
        camera,
        light_rig,
        backdrop,
        ext_lst,
    })
}

/// Parse an `<a:sp3d>` element into a typed `Shape3D`.
///
/// Expects `xml` to start at the opening `<a:sp3d>` tag and extend to (at least)
/// its closing tag. Returns `None` only if the slice is empty.
pub fn parse_shape3d(xml: &[u8]) -> Option<Shape3D> {
    if xml.is_empty() {
        return None;
    }

    let prst_material = extract_attr_value_in_element(xml, b"prstMaterial=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(PresetMaterialType::from_ooxml);
    let z = extract_attr_value_in_element(xml, b"z=\"").and_then(|v| parse_i64(v));
    let extrusion_h =
        extract_attr_value_in_element(xml, b"extrusionH=\"").and_then(|v| parse_i64(v));
    let contour_w = extract_attr_value_in_element(xml, b"contourW=\"").and_then(|v| parse_i64(v));

    // Parse top bevel
    let bevel_t = find_tag_simd(xml, b"bevelT", 0).map(|start| parse_bevel(&xml[start..]));

    // Parse bottom bevel
    let bevel_b = find_tag_simd(xml, b"bevelB", 0).map(|start| parse_bevel(&xml[start..]));

    // Parse extrusion color
    let extrusion_clr = find_tag_simd(xml, b"extrusionClr", 0).and_then(|start| {
        let end = find_closing_tag(xml, b"extrusionClr", start).unwrap_or(xml.len());
        parse_color_ref(&xml[start..end])
    });

    // Parse contour color
    let contour_clr = find_tag_simd(xml, b"contourClr", 0).and_then(|start| {
        let end = find_closing_tag(xml, b"contourClr", start).unwrap_or(xml.len());
        parse_color_ref(&xml[start..end])
    });

    // Parse optional ext_lst for Shape3D
    let ext_lst = find_tag_simd(xml, b"extLst", 0).and_then(|ext_start| {
        let mut open = ext_start;
        while open > 0 && xml[open - 1] != b'<' {
            open -= 1;
        }
        open = open.saturating_sub(1);
        find_closing_tag(xml, b"extLst", ext_start).and_then(|close_lt| {
            let mut close_end = close_lt;
            while close_end < xml.len() && xml[close_end] != b'>' {
                close_end += 1;
            }
            if close_end < xml.len() {
                Some(String::from_utf8_lossy(&xml[open..=close_end]).into_owned())
            } else {
                None
            }
        })
    });

    Some(Shape3D {
        bevel_t,
        bevel_b,
        extrusion_h: extrusion_h.map(StPositiveCoordinate::new_clamped),
        extrusion_clr,
        contour_w: contour_w.map(StPositiveCoordinate::new_clamped),
        contour_clr,
        prst_material,
        z: z.map(StCoordinate::new),
        ext_lst,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_scene3d_full() {
        let xml = br#"<a:scene3d>
            <a:camera prst="orthographicFront" fov="3600000">
                <a:rot lat="1200000" lon="0" rev="0"/>
            </a:camera>
            <a:lightRig rig="threePt" dir="t">
                <a:rot lat="0" lon="0" rev="600000"/>
            </a:lightRig>
        </a:scene3d>"#;

        let scene = parse_scene3d(xml).expect("should parse");
        assert_eq!(scene.camera.prst, PresetCameraType::OrthographicFront);
        assert_eq!(scene.camera.fov, Some(StFovAngle::new_clamped(3_600_000)));
        let cam_rot = scene.camera.rot.expect("camera rotation");
        assert_eq!(cam_rot.lat, StPositiveFixedAngle::new_clamped(1_200_000));
        assert_eq!(cam_rot.lon, StPositiveFixedAngle::new_clamped(0));
        assert_eq!(cam_rot.rev, StPositiveFixedAngle::new_clamped(0));

        assert_eq!(scene.light_rig.rig, LightRigType::ThreePt);
        assert_eq!(scene.light_rig.dir, LightRigDirection::Top);
        let lr_rot = scene.light_rig.rot.expect("light rig rotation");
        assert_eq!(lr_rot.lat, StPositiveFixedAngle::new_clamped(0));
        assert_eq!(lr_rot.rev, StPositiveFixedAngle::new_clamped(600_000));
    }

    #[test]
    fn test_parse_scene3d_minimal() {
        let xml = br#"<a:scene3d>
            <a:camera prst="perspectiveFront"/>
            <a:lightRig rig="balanced" dir="bl"/>
        </a:scene3d>"#;

        let scene = parse_scene3d(xml).expect("should parse");
        assert_eq!(scene.camera.prst, PresetCameraType::PerspectiveFront);
        assert_eq!(scene.camera.fov, None);
        assert!(scene.camera.rot.is_none());
        assert_eq!(scene.light_rig.rig, LightRigType::Balanced);
        assert_eq!(scene.light_rig.dir, LightRigDirection::BottomLeft);
        assert!(scene.light_rig.rot.is_none());
    }

    #[test]
    fn test_parse_scene3d_missing_camera() {
        let xml = b"<a:scene3d><a:lightRig rig=\"threePt\" dir=\"t\"/></a:scene3d>";
        assert!(parse_scene3d(xml).is_none());
    }

    #[test]
    fn test_parse_scene3d_missing_light_rig() {
        let xml = b"<a:scene3d><a:camera prst=\"orthographicFront\"/></a:scene3d>";
        assert!(parse_scene3d(xml).is_none());
    }

    #[test]
    fn test_parse_shape3d_full() {
        let xml = br#"<a:sp3d prstMaterial="plastic" z="50800" extrusionH="76200" contourW="12700">
            <a:bevelT w="63500" h="25400" prst="circle"/>
            <a:bevelB w="50800" h="19050" prst="angle"/>
            <a:extrusionClr>
                <a:schemeClr val="accent1"/>
            </a:extrusionClr>
            <a:contourClr>
                <a:srgbClr val="FF0000"/>
            </a:contourClr>
        </a:sp3d>"#;

        let sp3d = parse_shape3d(xml).expect("should parse");
        assert_eq!(sp3d.prst_material, Some(PresetMaterialType::Plastic));
        assert_eq!(sp3d.z, Some(StCoordinate::new(50_800)));
        assert_eq!(
            sp3d.extrusion_h,
            Some(StPositiveCoordinate::new_clamped(76_200))
        );
        assert_eq!(
            sp3d.contour_w,
            Some(StPositiveCoordinate::new_clamped(12_700))
        );

        let bt = sp3d.bevel_t.expect("bevelT");
        assert_eq!(bt.w, Some(StPositiveCoordinate::new_clamped(63_500)));
        assert_eq!(bt.h, Some(StPositiveCoordinate::new_clamped(25_400)));
        assert_eq!(bt.prst, Some(BevelPresetType::Circle));

        let bb = sp3d.bevel_b.expect("bevelB");
        assert_eq!(bb.w, Some(StPositiveCoordinate::new_clamped(50_800)));
        assert_eq!(bb.h, Some(StPositiveCoordinate::new_clamped(19_050)));
        assert_eq!(bb.prst, Some(BevelPresetType::Angle));

        assert_eq!(
            sp3d.extrusion_clr,
            Some(DrawingColor::SchemeClr {
                val: SchemeColor::Accent1,
                transforms: vec![]
            })
        );
        assert_eq!(
            sp3d.contour_clr,
            Some(DrawingColor::SrgbClr {
                val: "FF0000".into(),
                transforms: vec![]
            })
        );
    }

    #[test]
    fn test_parse_shape3d_minimal() {
        let xml = b"<a:sp3d/>";
        let sp3d = parse_shape3d(xml).expect("should parse");
        assert!(sp3d.prst_material.is_none());
        assert!(sp3d.z.is_none());
        assert!(sp3d.extrusion_h.is_none());
        assert!(sp3d.contour_w.is_none());
        assert!(sp3d.bevel_t.is_none());
        assert!(sp3d.bevel_b.is_none());
        assert!(sp3d.extrusion_clr.is_none());
        assert!(sp3d.contour_clr.is_none());
    }

    #[test]
    fn test_parse_shape3d_empty_returns_none() {
        assert!(parse_shape3d(b"").is_none());
    }

    #[test]
    fn test_parse_color_ref_scheme_clr() {
        let xml = b"<a:extrusionClr><a:schemeClr val=\"accent1\"/></a:extrusionClr>";
        let clr = parse_color_ref(xml).expect("schemeClr");
        assert_eq!(
            clr,
            DrawingColor::SchemeClr {
                val: SchemeColor::Accent1,
                transforms: vec![]
            }
        );
    }

    #[test]
    fn test_parse_color_ref_srgb_clr() {
        let xml = b"<a:contourClr><a:srgbClr val=\"FF0000\"/></a:contourClr>";
        let clr = parse_color_ref(xml).expect("srgbClr");
        assert_eq!(
            clr,
            DrawingColor::SrgbClr {
                val: "FF0000".into(),
                transforms: vec![]
            }
        );
    }

    #[test]
    fn test_parse_color_ref_hsl_clr() {
        let xml = b"<a:extrusionClr><a:hslClr hue=\"14400000\" sat=\"100000\" lum=\"50000\"/></a:extrusionClr>";
        let clr = parse_color_ref(xml).expect("hslClr");
        assert_eq!(
            clr,
            DrawingColor::HslClr {
                hue: 14_400_000,
                sat: 100_000,
                lum: 50_000,
                transforms: vec![]
            }
        );
    }

    #[test]
    fn test_parse_color_ref_sys_clr() {
        let xml = b"<a:extrusionClr><a:sysClr val=\"windowText\"/></a:extrusionClr>";
        let clr = parse_color_ref(xml).expect("sysClr");
        assert_eq!(
            clr,
            DrawingColor::SysClr {
                val: ooxml_types::drawings::SystemColorVal::from_ooxml("windowText"),
                last_clr: None,
                transforms: vec![]
            }
        );
    }

    #[test]
    fn test_parse_color_ref_prst_clr() {
        let xml = b"<a:contourClr><a:prstClr val=\"red\"/></a:contourClr>";
        let clr = parse_color_ref(xml).expect("prstClr");
        assert_eq!(
            clr,
            DrawingColor::PrstClr {
                val: ooxml_types::drawings::PresetColorVal::from_ooxml("red"),
                transforms: vec![]
            }
        );
    }

    #[test]
    fn test_parse_color_ref_no_color_child() {
        let xml = b"<a:extrusionClr></a:extrusionClr>";
        assert!(parse_color_ref(xml).is_none());
    }

    #[test]
    fn test_parse_shape3d_material_only() {
        let xml = b"<a:sp3d prstMaterial=\"metal\"/>";
        let sp3d = parse_shape3d(xml).expect("should parse");
        assert_eq!(sp3d.prst_material, Some(PresetMaterialType::Metal));
        assert!(sp3d.z.is_none());
        assert!(sp3d.extrusion_h.is_none());
        assert!(sp3d.contour_w.is_none());
        assert!(sp3d.bevel_t.is_none());
        assert!(sp3d.bevel_b.is_none());
        assert!(sp3d.extrusion_clr.is_none());
        assert!(sp3d.contour_clr.is_none());
    }

    #[test]
    fn test_parse_shape3d_bevel_t_only() {
        let xml = br#"<a:sp3d>
            <a:bevelT w="63500" h="25400" prst="circle"/>
        </a:sp3d>"#;
        let sp3d = parse_shape3d(xml).expect("should parse");
        assert!(sp3d.prst_material.is_none());
        let bt = sp3d.bevel_t.expect("bevelT");
        assert_eq!(bt.w, Some(StPositiveCoordinate::new_clamped(63_500)));
        assert_eq!(bt.h, Some(StPositiveCoordinate::new_clamped(25_400)));
        assert_eq!(bt.prst, Some(BevelPresetType::Circle));
        assert!(sp3d.bevel_b.is_none());
        assert!(sp3d.extrusion_clr.is_none());
        assert!(sp3d.contour_clr.is_none());
    }

    #[test]
    fn test_parse_scene3d_empty_bytes() {
        assert!(parse_scene3d(b"").is_none());
    }

    #[test]
    fn test_parse_scene3d_tag_no_children() {
        let xml = b"<a:scene3d></a:scene3d>";
        assert!(parse_scene3d(xml).is_none());
    }

    #[test]
    fn test_parse_scene3d_malformed_camera_no_prst() {
        let xml = br#"<a:scene3d>
            <a:camera fov="3600000"/>
            <a:lightRig rig="threePt" dir="t"/>
        </a:scene3d>"#;
        assert!(parse_scene3d(xml).is_none());
    }

    #[test]
    fn test_parse_shape3d_attributes_with_whitespace_in_values() {
        // XML attributes themselves don't typically have whitespace in numeric values,
        // but test that the parser handles surrounding XML whitespace gracefully.
        let xml = br#"<a:sp3d  prstMaterial="plastic"  z="50800" >
            <a:bevelT  w="63500"  h="25400" />
        </a:sp3d>"#;
        let sp3d = parse_shape3d(xml).expect("should parse with extra whitespace");
        assert_eq!(sp3d.prst_material, Some(PresetMaterialType::Plastic));
        assert_eq!(sp3d.z, Some(StCoordinate::new(50_800)));
        let bt = sp3d.bevel_t.expect("bevelT");
        assert_eq!(bt.w, Some(StPositiveCoordinate::new_clamped(63_500)));
        assert_eq!(bt.h, Some(StPositiveCoordinate::new_clamped(25_400)));
    }

    #[test]
    fn test_parse_scene3d_attributes_with_extra_whitespace() {
        let xml = br#"<a:scene3d>
            <a:camera  prst="orthographicFront"  fov="3600000" />
            <a:lightRig  rig="threePt"  dir="t" />
        </a:scene3d>"#;
        let scene = parse_scene3d(xml).expect("should parse with extra whitespace");
        assert_eq!(scene.camera.prst, PresetCameraType::OrthographicFront);
        assert_eq!(scene.camera.fov, Some(StFovAngle::new_clamped(3_600_000)));
        assert_eq!(scene.light_rig.rig, LightRigType::ThreePt);
        assert_eq!(scene.light_rig.dir, LightRigDirection::Top);
    }

    // =========================================================================
    // Roundtrip tests: write → parse → assert equality
    // =========================================================================

    use crate::domain::drawings::write::{write_scene3d, write_shape3d};
    use crate::write::xml_writer::XmlWriter;

    #[test]
    fn test_roundtrip_scene3d_full() {
        let original = Scene3D {
            camera: Camera {
                prst: PresetCameraType::OrthographicFront,
                fov: Some(StFovAngle::new_clamped(3_600_000)),
                zoom: None,
                rot: Some(Rotation3D {
                    lat: StPositiveFixedAngle::new_clamped(1_200_000),
                    lon: StPositiveFixedAngle::new_clamped(0),
                    rev: StPositiveFixedAngle::new_clamped(0),
                }),
            },
            light_rig: LightRig {
                rig: LightRigType::ThreePt,
                dir: LightRigDirection::Top,
                rot: Some(Rotation3D {
                    lat: StPositiveFixedAngle::new_clamped(0),
                    lon: StPositiveFixedAngle::new_clamped(0),
                    rev: StPositiveFixedAngle::new_clamped(600_000),
                }),
            },
            backdrop: None,
            ext_lst: None,
        };

        let mut w = XmlWriter::new();
        write_scene3d(&mut w, &original);
        let xml = w.finish();

        let parsed = parse_scene3d(&xml).expect("roundtrip parse should succeed");
        assert_eq!(parsed.camera.prst, original.camera.prst);
        assert_eq!(parsed.camera.fov, original.camera.fov);
        assert_eq!(parsed.camera.rot, original.camera.rot);
        assert_eq!(parsed.light_rig.rig, original.light_rig.rig);
        assert_eq!(parsed.light_rig.dir, original.light_rig.dir);
        assert_eq!(parsed.light_rig.rot, original.light_rig.rot);
    }

    #[test]
    fn test_roundtrip_scene3d_minimal() {
        let original = Scene3D {
            camera: Camera {
                prst: PresetCameraType::PerspectiveFront,
                fov: None,
                zoom: None,
                rot: None,
            },
            light_rig: LightRig {
                rig: LightRigType::Balanced,
                dir: LightRigDirection::BottomLeft,
                rot: None,
            },
            backdrop: None,
            ext_lst: None,
        };

        let mut w = XmlWriter::new();
        write_scene3d(&mut w, &original);
        let xml = w.finish();

        let parsed = parse_scene3d(&xml).expect("roundtrip parse should succeed");
        assert_eq!(parsed.camera.prst, original.camera.prst);
        assert_eq!(parsed.camera.fov, None);
        assert!(parsed.camera.rot.is_none());
        assert_eq!(parsed.light_rig.rig, original.light_rig.rig);
        assert_eq!(parsed.light_rig.dir, original.light_rig.dir);
        assert!(parsed.light_rig.rot.is_none());
    }

    #[test]
    fn test_roundtrip_shape3d_full() {
        let original = Shape3D {
            prst_material: Some(PresetMaterialType::Plastic),
            z: Some(StCoordinate::new(50_800)),
            extrusion_h: Some(StPositiveCoordinate::new_clamped(76_200)),
            contour_w: Some(StPositiveCoordinate::new_clamped(12_700)),
            bevel_t: Some(Bevel {
                w: Some(StPositiveCoordinate::new_clamped(63_500)),
                h: Some(StPositiveCoordinate::new_clamped(25_400)),
                prst: Some(BevelPresetType::Circle),
            }),
            bevel_b: Some(Bevel {
                w: Some(StPositiveCoordinate::new_clamped(50_800)),
                h: Some(StPositiveCoordinate::new_clamped(19_050)),
                prst: Some(BevelPresetType::Angle),
            }),
            extrusion_clr: Some(DrawingColor::SchemeClr {
                val: SchemeColor::Accent1,
                transforms: vec![],
            }),
            contour_clr: Some(DrawingColor::SrgbClr {
                val: "FF0000".into(),
                transforms: vec![],
            }),
            ext_lst: None,
        };

        let mut w = XmlWriter::new();
        write_shape3d(&mut w, &original);
        let xml = w.finish();

        let parsed = parse_shape3d(&xml).expect("roundtrip parse should succeed");
        assert_eq!(parsed.prst_material, original.prst_material);
        assert_eq!(parsed.z, original.z);
        assert_eq!(parsed.extrusion_h, original.extrusion_h);
        assert_eq!(parsed.contour_w, original.contour_w);
        assert_eq!(parsed.bevel_t, original.bevel_t);
        assert_eq!(parsed.bevel_b, original.bevel_b);
        assert_eq!(parsed.extrusion_clr, original.extrusion_clr);
        assert_eq!(parsed.contour_clr, original.contour_clr);
    }

    #[test]
    fn test_roundtrip_shape3d_minimal() {
        let original = Shape3D {
            prst_material: None,
            z: None,
            extrusion_h: None,
            contour_w: None,
            bevel_t: None,
            bevel_b: None,
            extrusion_clr: None,
            contour_clr: None,
            ext_lst: None,
        };

        let mut w = XmlWriter::new();
        write_shape3d(&mut w, &original);
        let xml = w.finish();

        let parsed = parse_shape3d(&xml).expect("roundtrip parse should succeed");
        assert!(parsed.prst_material.is_none());
        assert!(parsed.z.is_none());
        assert!(parsed.extrusion_h.is_none());
        assert!(parsed.contour_w.is_none());
        assert!(parsed.bevel_t.is_none());
        assert!(parsed.bevel_b.is_none());
        assert!(parsed.extrusion_clr.is_none());
        assert!(parsed.contour_clr.is_none());
    }

    #[test]
    fn test_roundtrip_shape3d_with_all_color_types() {
        // Test each color variant roundtrips correctly
        let test_cases: Vec<(DrawingColor, DrawingColor)> = vec![
            (
                DrawingColor::SchemeClr {
                    val: SchemeColor::Dk1,
                    transforms: vec![],
                },
                DrawingColor::SchemeClr {
                    val: SchemeColor::Dk1,
                    transforms: vec![],
                },
            ),
            (
                DrawingColor::SrgbClr {
                    val: "00FF00".into(),
                    transforms: vec![],
                },
                DrawingColor::SrgbClr {
                    val: "00FF00".into(),
                    transforms: vec![],
                },
            ),
            (
                DrawingColor::HslClr {
                    hue: 14_400_000,
                    sat: 100_000,
                    lum: 50_000,
                    transforms: vec![],
                },
                DrawingColor::HslClr {
                    hue: 14_400_000,
                    sat: 100_000,
                    lum: 50_000,
                    transforms: vec![],
                },
            ),
            (
                DrawingColor::SysClr {
                    val: ooxml_types::drawings::SystemColorVal::from_ooxml("windowText"),
                    last_clr: None,
                    transforms: vec![],
                },
                DrawingColor::SysClr {
                    val: ooxml_types::drawings::SystemColorVal::from_ooxml("windowText"),
                    last_clr: None,
                    transforms: vec![],
                },
            ),
            (
                DrawingColor::PrstClr {
                    val: ooxml_types::drawings::PresetColorVal::from_ooxml("red"),
                    transforms: vec![],
                },
                DrawingColor::PrstClr {
                    val: ooxml_types::drawings::PresetColorVal::from_ooxml("red"),
                    transforms: vec![],
                },
            ),
        ];

        for (extrusion_clr, expected) in test_cases {
            let original = Shape3D {
                extrusion_clr: Some(extrusion_clr),
                contour_clr: None,
                prst_material: None,
                z: None,
                extrusion_h: None,
                contour_w: None,
                bevel_t: None,
                bevel_b: None,
                ext_lst: None,
            };

            let mut w = XmlWriter::new();
            write_shape3d(&mut w, &original);
            let xml = w.finish();

            let parsed = parse_shape3d(&xml).expect("roundtrip parse should succeed");
            assert_eq!(parsed.extrusion_clr, Some(expected));
        }
    }
}
