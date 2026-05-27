//! Transform and fill/outline parsing for drawings.
//!
//! This module handles parsing of 2D transforms, fill styles (solid, gradient,
//! pattern), and outline/line properties from drawing XML.

use super::super::helpers::{extract_attr_value_in_element, parse_i32, parse_i64, parse_u32};
use super::super::reader::elements::{
    direct_child_elements, direct_child_slice, document_element, document_element_slice,
};
use super::super::reader::raw::extract_ext_lst_raw;
use super::super::types::{
    BlackWhiteMode, CompoundLine, DashStyle, DrawingColor, EffectList, Fill, GradientFill,
    GradientStop, LineCap, LineEndProperties, LineEndSize, LineEndType, LineJoin, Outline,
    PatternFill, PenAlignment, PresetGeometry, ShapeGeometry, ShapeProperties, ShapeStyle,
    SolidFill, StyleRef, Transform2D,
};
use super::shapes::parse_shape_preset;
use ooxml_types::drawings::{
    BlurEffect, FillOverlayEffect, Glow, InnerShadow, OuterShadow, PresetShadow, RectAlignment,
    Reflection, SoftEdge,
};
use ooxml_types::drawings::{
    FontReference, LineDash, LineFill, PresetColorVal, StAngle, StFixedAngle, StPercentage,
    StPositiveCoordinate, StPositiveFixedPercentageDecimal, StStyleMatrixColumnIndex,
    SystemColorVal,
};

/// Parse shape properties
pub fn parse_shape_properties(xml: &[u8]) -> ShapeProperties {
    let mut props = ShapeProperties::default();

    // Parse bwMode attribute on the <a:spPr> element itself
    props.bw_mode = extract_attr_value_in_element(xml, b"bwMode=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(BlackWhiteMode::from_ooxml);

    // Parse transform
    if let Some(xfrm) = direct_child_slice(xml, b"xfrm") {
        props.xfrm = parse_transform_2d(xfrm);
    }

    // Parse preset geometry
    if let Some(prst_xml) = direct_child_slice(xml, b"prstGeom") {
        props.geometry = extract_attr_value_in_element(prst_xml, b"prst=\"")
            .and_then(|v| parse_shape_preset(v))
            .map(|prst| {
                let mut av_list = Vec::new();
                if let Some(avlst_xml) = direct_child_slice(prst_xml, b"avLst") {
                    for gd in direct_child_elements(avlst_xml)
                        .filter(|child| child.local_name == b"gd")
                        .map(|child| child.full_slice(avlst_xml))
                    {
                        if let (Some(name_val), Some(fmla_val)) = (
                            extract_attr_value_in_element(gd, b"name=\""),
                            extract_attr_value_in_element(gd, b"fmla=\""),
                        ) {
                            av_list.push(ooxml_types::drawings::GeomGuide {
                                name: String::from_utf8_lossy(name_val).into_owned(),
                                fmla: String::from_utf8_lossy(fmla_val).into_owned(),
                            });
                        }
                    }
                }
                ShapeGeometry::Preset(PresetGeometry { prst, av_list })
            });
    }

    props.fill = parse_direct_fill(xml);

    // Parse outline
    if let Some(ln) = direct_child_slice(xml, b"ln") {
        props.ln = parse_outline(ln);
    }

    // Parse effect list
    if let Some(effect_lst) = direct_child_slice(xml, b"effectLst") {
        props.effects =
            parse_effect_list(effect_lst).map(ooxml_types::drawings::EffectProperties::EffectList);
    }

    // Parse scene3d
    if let Some(scene3d) = direct_child_slice(xml, b"scene3d") {
        props.scene3d = super::three_d::parse_scene3d(scene3d);
    }

    // Parse sp3d
    if let Some(sp3d) = direct_child_slice(xml, b"sp3d") {
        props.sp3d = super::three_d::parse_shape3d(sp3d);
    }

    // Capture extLst within shape properties
    props.ext_lst = extract_ext_lst_raw(xml);

    props
}

/// Parse 2D transform
pub fn parse_transform_2d(xml: &[u8]) -> Option<Transform2D> {
    let mut transform = Transform2D::default();

    // Parse rotation
    transform.rotation = extract_attr_value_in_element(xml, b"rot=\"")
        .and_then(|v| parse_i32(v))
        .map(StAngle::new);

    // Parse flips
    transform.flip_h =
        extract_attr_value_in_element(xml, b"flipH=\"").map(|v| v == b"1" || v == b"true");

    transform.flip_v =
        extract_attr_value_in_element(xml, b"flipV=\"").map(|v| v == b"1" || v == b"true");

    // Parse offset
    if let Some(off) = direct_child_slice(xml, b"off") {
        let x = extract_attr_value_in_element(off, b"x=\"")
            .and_then(|v| parse_i64(v))
            .unwrap_or(0);
        let y = extract_attr_value_in_element(off, b"y=\"")
            .and_then(|v| parse_i64(v))
            .unwrap_or(0);
        transform.offset = Some((x, y));
    }

    // Parse extent
    if let Some(ext) = direct_child_slice(xml, b"ext") {
        let cx = extract_attr_value_in_element(ext, b"cx=\"")
            .and_then(|v| parse_i64(v))
            .unwrap_or(0) as u64;
        let cy = extract_attr_value_in_element(ext, b"cy=\"")
            .and_then(|v| parse_i64(v))
            .unwrap_or(0) as u64;
        transform.extent = Some((cx, cy));
    }

    Some(transform)
}

/// Parse fill styles
pub fn parse_fill(xml: &[u8]) -> Option<Fill> {
    let root = document_element(xml)?;
    if let Some(fill) = parse_fill_element(root.local_name, root.full_slice(xml)) {
        return Some(fill);
    }

    parse_direct_fill(root.full_slice(xml))
}

fn parse_direct_fill(xml: &[u8]) -> Option<Fill> {
    direct_child_elements(xml)
        .find_map(|child| parse_fill_element(child.local_name, child.full_slice(xml)))
}

fn parse_fill_element(local_name: &[u8], xml: &[u8]) -> Option<Fill> {
    match local_name {
        b"noFill" => Some(Fill::NoFill),
        b"solidFill" => Some(Fill::Solid(SolidFill {
            color: parse_color(xml),
        })),
        b"gradFill" => Some(Fill::Gradient(parse_gradient_fill(xml))),
        b"pattFill" => Some(Fill::Pattern(parse_pattern_fill(xml))),
        _ => None,
    }
}

/// Parse all color transforms from an element.
///
/// Delegates to the comprehensive parser in themes/formats which handles all
/// OOXML color transforms (alpha, tint, shade, satMod, lumMod, lumOff, etc.)
/// in document order.
fn parse_color_transforms(element: &[u8]) -> Vec<ooxml_types::drawings::ColorTransform> {
    crate::domain::themes::formats::parse_color_transforms(element)
}

/// Parse color
pub fn parse_color(xml: &[u8]) -> DrawingColor {
    let Some(root) = document_element(xml) else {
        return DrawingColor::default();
    };

    if let Some(color) = parse_color_element(root.local_name, root.full_slice(xml)) {
        return color;
    }

    parse_direct_color(root.full_slice(xml)).unwrap_or_default()
}

fn parse_color_element(local_name: &[u8], element: &[u8]) -> Option<DrawingColor> {
    use ooxml_types::drawings::SchemeColor;

    match local_name {
        b"srgbClr" => {
            let val = extract_attr_value_in_element(element, b"val=\"")
                .map(|v| String::from_utf8_lossy(v).into_owned())
                .unwrap_or_default();
            let transforms = parse_color_transforms(element);
            Some(DrawingColor::SrgbClr { val, transforms })
        }
        b"schemeClr" => {
            let scheme = extract_attr_value_in_element(element, b"val=\"")
                .and_then(|v| std::str::from_utf8(v).ok())
                .and_then(SchemeColor::from_ooxml)
                .unwrap_or_default();
            let transforms = parse_color_transforms(element);
            Some(DrawingColor::SchemeClr {
                val: scheme,
                transforms,
            })
        }
        b"scrgbClr" => {
            let r = extract_attr_value_in_element(element, b"r=\"")
                .and_then(|v| parse_i64(v))
                .unwrap_or(0) as i32;
            let g = extract_attr_value_in_element(element, b"g=\"")
                .and_then(|v| parse_i64(v))
                .unwrap_or(0) as i32;
            let b_val = extract_attr_value_in_element(element, b"b=\"")
                .and_then(|v| parse_i64(v))
                .unwrap_or(0) as i32;
            let transforms = parse_color_transforms(element);
            Some(DrawingColor::ScrgbClr {
                r,
                g,
                b: b_val,
                transforms,
            })
        }
        b"sysClr" => {
            let val_str = extract_attr_value_in_element(element, b"val=\"")
                .map(|v| String::from_utf8_lossy(v).into_owned())
                .unwrap_or_default();
            let val = SystemColorVal::from_ooxml(&val_str);
            let last_clr = extract_attr_value_in_element(element, b"lastClr=\"")
                .map(|v| String::from_utf8_lossy(v).into_owned());
            let transforms = parse_color_transforms(element);
            Some(DrawingColor::SysClr {
                val,
                last_clr,
                transforms,
            })
        }
        b"prstClr" => {
            let val_str = extract_attr_value_in_element(element, b"val=\"")
                .map(|v| String::from_utf8_lossy(v).into_owned())
                .unwrap_or_default();
            let val = PresetColorVal::from_ooxml(&val_str);
            let transforms = parse_color_transforms(element);
            Some(DrawingColor::PrstClr { val, transforms })
        }
        b"hslClr" => {
            let hue = extract_attr_value_in_element(element, b"hue=\"")
                .and_then(|v| parse_i64(v))
                .unwrap_or(0) as i32;
            let sat = extract_attr_value_in_element(element, b"sat=\"")
                .and_then(|v| parse_i64(v))
                .unwrap_or(0) as i32;
            let lum = extract_attr_value_in_element(element, b"lum=\"")
                .and_then(|v| parse_i64(v))
                .unwrap_or(0) as i32;
            let transforms = parse_color_transforms(element);
            Some(DrawingColor::HslClr {
                hue,
                sat,
                lum,
                transforms,
            })
        }
        _ => None,
    }
}

/// Parse gradient fill
fn parse_gradient_fill(xml: &[u8]) -> GradientFill {
    let mut fill = GradientFill::default();

    if let Some(lin) = direct_child_slice(xml, b"lin") {
        if let Some(ang) = extract_attr_value_in_element(lin, b"ang=\"") {
            if let Some(val) = parse_i64(ang) {
                // Angle is in 60000ths of a degree
                fill.lin_ang = Some(StAngle::new(val as i32));
            }
        }
    }

    if let Some(gs_lst) = direct_child_slice(xml, b"gsLst") {
        for gs in direct_child_elements(gs_lst)
            .filter(|child| child.local_name == b"gs")
            .map(|child| child.full_slice(gs_lst))
        {
            if let Some(position) = extract_attr_value_in_element(gs, b"pos=\"") {
                if let Some(pos_val) = parse_u32(position) {
                    let color = parse_color(gs);
                    fill.stops.push(GradientStop {
                        position: StPositiveFixedPercentageDecimal::new_clamped(pos_val),
                        color,
                    });
                }
            }
        }
    }

    fill
}

/// Parse pattern fill
fn parse_pattern_fill(xml: &[u8]) -> PatternFill {
    let mut fill = PatternFill::default();

    fill.preset = extract_attr_value_in_element(xml, b"prst=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .and_then(ooxml_types::drawings::PresetPatternVal::from_ooxml);

    if let Some(fg) = direct_child_slice(xml, b"fgClr") {
        fill.fg_color = Some(parse_color(fg));
    }

    if let Some(bg) = direct_child_slice(xml, b"bgClr") {
        fill.bg_color = Some(parse_color(bg));
    }

    fill
}

/// Parse outline/line properties
pub fn parse_outline(xml: &[u8]) -> Option<Outline> {
    let xml = document_element_slice(xml)?;
    let mut outline = Outline::default();

    outline.width = extract_attr_value_in_element(xml, b"w=\"").and_then(|v| parse_i64(v));

    outline.cap = extract_attr_value_in_element(xml, b"cap=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(LineCap::from_ooxml);

    outline.compound = extract_attr_value_in_element(xml, b"cmpd=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(CompoundLine::from_ooxml);

    outline.align = extract_attr_value_in_element(xml, b"algn=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .and_then(PenAlignment::from_ooxml);

    for child in direct_child_elements(xml) {
        let child_xml = child.full_slice(xml);
        match child.local_name {
            b"noFill" => outline.fill = Some(LineFill::NoFill),
            b"solidFill" => {
                outline.fill = Some(LineFill::Solid(SolidFill {
                    color: parse_color(child_xml),
                }));
            }
            b"prstDash" => {
                outline.dash = extract_attr_value_in_element(child_xml, b"val=\"")
                    .and_then(|v| parse_dash_style(v))
                    .map(LineDash::Preset);
            }
            b"headEnd" => outline.head_end = Some(parse_line_end_properties(child_xml)),
            b"tailEnd" => outline.tail_end = Some(parse_line_end_properties(child_xml)),
            b"round" => outline.join = Some(LineJoin::Round),
            b"bevel" => outline.join = Some(LineJoin::Bevel),
            b"miter" => {
                let limit =
                    extract_attr_value_in_element(child_xml, b"lim=\"").and_then(|v| parse_i32(v));
                outline.join = Some(LineJoin::Miter { limit });
            }
            _ => {}
        }
    }

    Some(outline)
}

/// Parse line end properties (`headEnd` or `tailEnd`)
fn parse_line_end_properties(xml: &[u8]) -> LineEndProperties {
    LineEndProperties {
        end_type: extract_attr_value_in_element(xml, b"type=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(LineEndType::from_ooxml),
        width: extract_attr_value_in_element(xml, b"w=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(LineEndSize::from_ooxml),
        length: extract_attr_value_in_element(xml, b"len=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(LineEndSize::from_ooxml),
    }
}

/// Parse shape style
pub fn parse_shape_style(xml: &[u8]) -> Option<ShapeStyle> {
    let mut style = ShapeStyle::default();

    if let Some(ln_ref) = direct_child_slice(xml, b"lnRef") {
        if let Some(sr) = parse_style_ref(ln_ref) {
            style.line_ref = sr;
        }
    }

    if let Some(fill_ref) = direct_child_slice(xml, b"fillRef") {
        if let Some(sr) = parse_style_ref(fill_ref) {
            style.fill_ref = sr;
        }
    }

    if let Some(effect_ref) = direct_child_slice(xml, b"effectRef") {
        if let Some(sr) = parse_style_ref(effect_ref) {
            style.effect_ref = sr;
        }
    }

    if let Some(font_ref) = direct_child_slice(xml, b"fontRef") {
        style.font_ref = parse_font_ref(font_ref);
    }

    Some(style)
}

/// Parse a font reference (`<a:fontRef idx="minor">...</a:fontRef>`).
fn parse_font_ref(xml: &[u8]) -> FontReference {
    use ooxml_types::drawings::FontCollectionIndex;

    let idx = extract_attr_value_in_element(xml, b"idx=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(FontCollectionIndex::from_ooxml)
        .unwrap_or_default();

    FontReference {
        idx,
        color: parse_direct_color(xml),
    }
}

/// Parse style reference.
///
/// Limits colour search to the current element's boundaries to avoid
/// picking up sibling elements' colour children.
fn parse_style_ref(xml: &[u8]) -> Option<StyleRef> {
    let idx = StStyleMatrixColumnIndex::new(
        extract_attr_value_in_element(xml, b"idx=\"").and_then(|v| parse_u32(v))?,
    );

    Some(StyleRef {
        idx,
        color: parse_direct_color(xml),
    })
}

fn parse_direct_color(xml: &[u8]) -> Option<DrawingColor> {
    direct_child_elements(xml)
        .find_map(|child| parse_color_element(child.local_name, child.full_slice(xml)))
}

/// Parse dash style, delegating to `DashStyle::from_ooxml()`.
pub fn parse_dash_style(bytes: &[u8]) -> Option<DashStyle> {
    let s = std::str::from_utf8(bytes).ok()?;
    let parsed = DashStyle::from_ooxml(s);
    // from_ooxml defaults to Solid for unknown inputs; we return None instead.
    if parsed != DashStyle::Solid || s == "solid" {
        Some(parsed)
    } else {
        None
    }
}

/// Map scheme color name to theme index, delegating to `SchemeColor::from_ooxml()`.
pub fn scheme_name_to_index(name: &[u8]) -> Option<u32> {
    let s = std::str::from_utf8(name).ok()?;
    ooxml_types::drawings::SchemeColor::from_ooxml(s).map(|c| c.to_theme_index())
}

/// Parse an effect color from XML, returning an `Option<DrawingColor>`.
///
/// Reuses the existing `parse_color` function and returns `Some` only if
/// the parsed color contains meaningful data (i.e., not the empty default).
fn parse_effect_color(xml: &[u8]) -> Option<DrawingColor> {
    let c = parse_color(xml);
    // Only return Some if the color is not the empty default
    match &c {
        DrawingColor::SrgbClr { val, .. } if val.is_empty() => None,
        _ => Some(c),
    }
}

/// Parse an `<a:effectLst>` element into an `EffectList`.
///
/// Returns `Some(EffectList::default())` for an empty `<a:effectLst/>`, so that
/// the serialiser round-trips it faithfully.  Previously returned `None` for
/// the empty case which caused the tag to be dropped.
pub fn parse_effect_list(xml: &[u8]) -> Option<EffectList> {
    let xml = document_element_slice(xml)?;

    let mut effects = EffectList::default();
    let mut found_any = false;

    for child in direct_child_elements(xml) {
        let el = child.full_slice(xml);
        match child.local_name {
            b"outerShdw" => {
                let mut shadow = OuterShadow::default();
                shadow.blur_rad = StPositiveCoordinate::new_clamped(
                    extract_attr_value_in_element(el, b"blurRad=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                );
                shadow.dist = StPositiveCoordinate::new_clamped(
                    extract_attr_value_in_element(el, b"dist=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                );
                shadow.dir = StAngle::new(
                    extract_attr_value_in_element(el, b"dir=\"")
                        .and_then(|v| parse_i32(v))
                        .unwrap_or(0),
                );
                shadow.sx = StPercentage::new(
                    extract_attr_value_in_element(el, b"sx=\"")
                        .and_then(|v| parse_i32(v))
                        .unwrap_or(100_000),
                );
                shadow.sy = StPercentage::new(
                    extract_attr_value_in_element(el, b"sy=\"")
                        .and_then(|v| parse_i32(v))
                        .unwrap_or(100_000),
                );
                shadow.kx = StFixedAngle::new_clamped(
                    extract_attr_value_in_element(el, b"kx=\"")
                        .and_then(|v| parse_i32(v))
                        .unwrap_or(0),
                );
                shadow.ky = StFixedAngle::new_clamped(
                    extract_attr_value_in_element(el, b"ky=\"")
                        .and_then(|v| parse_i32(v))
                        .unwrap_or(0),
                );
                shadow.align = extract_attr_value_in_element(el, b"algn=\"")
                    .and_then(|v| std::str::from_utf8(v).ok())
                    .map(RectAlignment::from_ooxml);
                shadow.rot_with_shape = extract_attr_value_in_element(el, b"rotWithShape=\"")
                    .map(|v| v != b"0" && v != b"false")
                    .unwrap_or(true);
                shadow.color = parse_effect_color(el);
                effects.outer_shadow = Some(shadow);
                found_any = true;
            }
            b"innerShdw" => {
                let mut shadow = InnerShadow::default();
                shadow.blur_rad = StPositiveCoordinate::new_clamped(
                    extract_attr_value_in_element(el, b"blurRad=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                );
                shadow.dist = StPositiveCoordinate::new_clamped(
                    extract_attr_value_in_element(el, b"dist=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                );
                shadow.dir = StAngle::new(
                    extract_attr_value_in_element(el, b"dir=\"")
                        .and_then(|v| parse_i32(v))
                        .unwrap_or(0),
                );
                shadow.color = parse_effect_color(el);
                effects.inner_shadow = Some(shadow);
                found_any = true;
            }
            b"glow" => {
                let mut glow = Glow::default();
                glow.rad = StPositiveCoordinate::new_clamped(
                    extract_attr_value_in_element(el, b"rad=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                );
                glow.color = parse_effect_color(el);
                effects.glow = Some(glow);
                found_any = true;
            }
            b"softEdge" => {
                let rad = extract_attr_value_in_element(el, b"rad=\"")
                    .and_then(|v| parse_i64(v))
                    .unwrap_or(0);
                effects.soft_edge = Some(SoftEdge {
                    rad: StPositiveCoordinate::new_clamped(rad),
                });
                found_any = true;
            }
            b"reflection" => {
                let mut refl = Reflection::default();
                refl.blur_rad = StPositiveCoordinate::new_clamped(
                    extract_attr_value_in_element(el, b"blurRad=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                );
                refl.start_alpha = StPositiveFixedPercentageDecimal::new_clamped(
                    extract_attr_value_in_element(el, b"stA=\"")
                        .and_then(|v| parse_u32(v))
                        .unwrap_or(100_000),
                );
                refl.start_pos = StPositiveFixedPercentageDecimal::new_clamped(
                    extract_attr_value_in_element(el, b"stPos=\"")
                        .and_then(|v| parse_u32(v))
                        .unwrap_or(0),
                );
                refl.end_alpha = StPositiveFixedPercentageDecimal::new_clamped(
                    extract_attr_value_in_element(el, b"endA=\"")
                        .and_then(|v| parse_u32(v))
                        .unwrap_or(0),
                );
                refl.end_pos = StPositiveFixedPercentageDecimal::new_clamped(
                    extract_attr_value_in_element(el, b"endPos=\"")
                        .and_then(|v| parse_u32(v))
                        .unwrap_or(100_000),
                );
                refl.dist = StPositiveCoordinate::new_clamped(
                    extract_attr_value_in_element(el, b"dist=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                );
                refl.dir = StAngle::new(
                    extract_attr_value_in_element(el, b"dir=\"")
                        .and_then(|v| parse_i32(v))
                        .unwrap_or(0),
                );
                refl.fade_dir = StAngle::new(
                    extract_attr_value_in_element(el, b"fadeDir=\"")
                        .and_then(|v| parse_i32(v))
                        .unwrap_or(5_400_000),
                );
                refl.sx = StPercentage::new(
                    extract_attr_value_in_element(el, b"sx=\"")
                        .and_then(|v| parse_i32(v))
                        .unwrap_or(100_000),
                );
                refl.sy = StPercentage::new(
                    extract_attr_value_in_element(el, b"sy=\"")
                        .and_then(|v| parse_i32(v))
                        .unwrap_or(100_000),
                );
                refl.kx = StFixedAngle::new_clamped(
                    extract_attr_value_in_element(el, b"kx=\"")
                        .and_then(|v| parse_i32(v))
                        .unwrap_or(0),
                );
                refl.ky = StFixedAngle::new_clamped(
                    extract_attr_value_in_element(el, b"ky=\"")
                        .and_then(|v| parse_i32(v))
                        .unwrap_or(0),
                );
                refl.align = extract_attr_value_in_element(el, b"algn=\"")
                    .and_then(|v| std::str::from_utf8(v).ok())
                    .map(RectAlignment::from_ooxml);
                refl.rot_with_shape = extract_attr_value_in_element(el, b"rotWithShape=\"")
                    .map(|v| v != b"0" && v != b"false")
                    .unwrap_or(true);
                effects.reflection = Some(refl);
                found_any = true;
            }
            b"prstShdw" => {
                let mut shadow = PresetShadow::default();
                shadow.preset = extract_attr_value_in_element(el, b"prst=\"")
                    .and_then(|v| std::str::from_utf8(v).ok())
                    .and_then(ooxml_types::drawings::PresetShadowVal::from_ooxml)
                    .unwrap_or_default();
                shadow.dist = StPositiveCoordinate::new_clamped(
                    extract_attr_value_in_element(el, b"dist=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                );
                shadow.dir = StAngle::new(
                    extract_attr_value_in_element(el, b"dir=\"")
                        .and_then(|v| parse_i32(v))
                        .unwrap_or(0),
                );
                shadow.color = parse_effect_color(el);
                effects.preset_shadow = Some(shadow);
                found_any = true;
            }
            b"blur" => {
                let mut blur = BlurEffect::default();
                blur.rad = StPositiveCoordinate::new_clamped(
                    extract_attr_value_in_element(el, b"rad=\"")
                        .and_then(|v| parse_i64(v))
                        .unwrap_or(0),
                );
                blur.grow = extract_attr_value_in_element(el, b"grow=\"")
                    .map(|v| v != b"0" && v != b"false")
                    .unwrap_or(true);
                effects.blur = Some(blur);
                found_any = true;
            }
            b"fillOverlay" => {
                let blend = extract_attr_value_in_element(el, b"blend=\"")
                    .and_then(|v| std::str::from_utf8(v).ok())
                    .map(ooxml_types::drawings::BlendMode::from_ooxml)
                    .unwrap_or_default();
                effects.fill_overlay = Some(FillOverlayEffect { blend, fill: None });
                found_any = true;
            }
            _ => {}
        }
    }

    // Always return Some — even for empty `<a:effectLst/>` — so the
    // serialiser can round-trip the tag faithfully.
    let _ = found_any;
    Some(effects)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shape_properties_read_direct_children_only() {
        let xml = br#"<a:spPr>
            <a:extLst>
                <a:ext>
                    <a:xfrm><a:off x="900" y="901"/><a:ext cx="902" cy="903"/></a:xfrm>
                    <a:effectLst><a:glow rad="777"/></a:effectLst>
                </a:ext>
            </a:extLst>
            <a:xfrm><a:off x="10" y="20"/><a:ext cx="30" cy="40"/></a:xfrm>
            <a:ln><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>
        </a:spPr>"#;

        let props = parse_shape_properties(xml);

        let xfrm = props.xfrm.expect("direct xfrm");
        assert_eq!(xfrm.offset, Some((10, 20)));
        assert_eq!(xfrm.extent, Some((30, 40)));
        assert!(props.effects.is_none());
        assert!(props.fill.is_none());
        assert!(props.ln.is_some());
    }

    #[test]
    fn shape_properties_fill_precedes_line_fill_by_direct_child_order() {
        let xml = br#"<a:spPr>
            <a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>
            <a:ln><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>
        </a:spPr>"#;

        let props = parse_shape_properties(xml);

        match props.fill.expect("direct fill") {
            Fill::Solid(fill) => match fill.color {
                DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "00FF00"),
                other => panic!("expected srgb fill, got {other:?}"),
            },
            other => panic!("expected solid fill, got {other:?}"),
        }
        let outline = props.ln.expect("direct outline");
        match outline.fill.expect("outline fill") {
            LineFill::Solid(fill) => match fill.color {
                DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
                other => panic!("expected srgb line fill, got {other:?}"),
            },
            other => panic!("expected solid line fill, got {other:?}"),
        }
    }

    #[test]
    fn fill_parsers_read_direct_children_only() {
        let xml = br#"<a:spPr>
            <a:extLst>
                <a:ext>
                    <a:noFill/>
                    <a:gradFill>
                        <a:gsLst><a:gs pos="0"><a:srgbClr val="111111"/></a:gs></a:gsLst>
                    </a:gradFill>
                    <a:pattFill>
                        <a:fgClr><a:srgbClr val="222222"/></a:fgClr>
                    </a:pattFill>
                </a:ext>
            </a:extLst>
            <a:gradFill>
                <a:extLst>
                    <a:ext>
                        <a:lin ang="111"/>
                        <a:gs pos="25000"><a:srgbClr val="333333"/></a:gs>
                    </a:ext>
                </a:extLst>
                <a:gsLst>
                    <a:extLst><a:ext><a:gs pos="50000"><a:srgbClr val="444444"/></a:gs></a:ext></a:extLst>
                    <a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>
                    <a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>
                </a:gsLst>
                <a:lin ang="5400000"/>
            </a:gradFill>
        </a:spPr>"#;

        let fill = parse_fill(xml).expect("direct fill");

        let Fill::Gradient(grad) = fill else {
            panic!("expected direct gradient fill");
        };
        assert_eq!(grad.lin_ang, Some(StAngle::new(5_400_000)));
        assert_eq!(grad.stops.len(), 2);
        match &grad.stops[0].color {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
            other => panic!("expected first direct gradient stop, got {other:?}"),
        }
        match &grad.stops[1].color {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "0000FF"),
            other => panic!("expected second direct gradient stop, got {other:?}"),
        }
    }

    #[test]
    fn pattern_fill_reads_direct_colors_only() {
        let xml = br#"<a:pattFill prst="pct5">
            <a:extLst>
                <a:ext>
                    <a:fgClr><a:srgbClr val="111111"/></a:fgClr>
                    <a:bgClr><a:srgbClr val="222222"/></a:bgClr>
                </a:ext>
            </a:extLst>
            <a:fgClr><a:srgbClr val="ABCDEF"/></a:fgClr>
            <a:bgClr><a:srgbClr val="123456"/></a:bgClr>
        </a:pattFill>"#;

        let Fill::Pattern(pattern) = parse_fill(xml).expect("pattern fill") else {
            panic!("expected pattern fill");
        };

        match pattern.fg_color.as_ref().unwrap() {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "ABCDEF"),
            other => panic!("expected direct foreground color, got {other:?}"),
        }
        match pattern.bg_color.as_ref().unwrap() {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "123456"),
            other => panic!("expected direct background color, got {other:?}"),
        }
    }

    #[test]
    fn color_parser_reads_root_or_direct_color_only() {
        let container = br#"<a:solidFill>
            <a:extLst><a:ext><a:srgbClr val="111111"/></a:ext></a:extLst>
            <a:schemeClr val="accent1"><a:tint val="50000"/></a:schemeClr>
        </a:solidFill>"#;

        match parse_color(container) {
            DrawingColor::SchemeClr { val, transforms } => {
                assert_eq!(val, ooxml_types::drawings::SchemeColor::Accent1);
                assert_eq!(transforms.len(), 1);
            }
            other => panic!("expected direct scheme color, got {other:?}"),
        }

        match parse_color(br#"<a:srgbClr val="ABCDEF"/>"#) {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "ABCDEF"),
            other => panic!("expected root srgb color, got {other:?}"),
        }
    }

    #[test]
    fn outline_reads_direct_children_only() {
        let xml = br#"<a:ln w="12700" cap="rnd">
            <a:extLst>
                <a:ext>
                    <a:noFill/>
                    <a:prstDash val="dash"/>
                    <a:headEnd type="triangle"/>
                    <a:round/>
                </a:ext>
            </a:extLst>
            <a:solidFill><a:srgbClr val="336699"/></a:solidFill>
            <a:prstDash val="dot"/>
            <a:tailEnd type="stealth" w="lg" len="sm"/>
            <a:miter lim="800000"/>
        </a:ln>"#;

        let outline = parse_outline(xml).unwrap();

        assert_eq!(outline.width, Some(12700));
        assert_eq!(outline.cap, Some(LineCap::Round));
        match outline.fill.unwrap() {
            LineFill::Solid(fill) => match fill.color {
                DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "336699"),
                other => panic!("expected direct solid line fill, got {other:?}"),
            },
            other => panic!("expected direct solid line fill, got {other:?}"),
        }
        assert_eq!(outline.dash, Some(LineDash::Preset(DashStyle::Dot)));
        assert!(outline.head_end.is_none());
        assert_eq!(
            outline.tail_end.as_ref().unwrap().end_type,
            Some(LineEndType::Stealth)
        );
        assert_eq!(
            outline.join,
            Some(LineJoin::Miter {
                limit: Some(800000)
            })
        );
    }

    #[test]
    fn effect_list_reads_direct_effect_children_only() {
        let xml = br#"<a:effectLst>
            <a:extLst>
                <a:ext>
                    <a:outerShdw blurRad="999" dist="998" dir="997"/>
                    <a:glow rad="996"/>
                </a:ext>
            </a:extLst>
            <a:glow rad="63500"><a:srgbClr val="ABCDEF"/></a:glow>
            <a:softEdge rad="12700"/>
        </a:effectLst>"#;

        let effects = parse_effect_list(xml).expect("effect list");

        assert!(effects.outer_shadow.is_none());
        let glow = effects.glow.expect("direct glow");
        assert_eq!(glow.rad, StPositiveCoordinate::new_clamped(63500));
        match glow.color.expect("direct glow color") {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "ABCDEF"),
            other => panic!("expected direct glow color, got {other:?}"),
        }
        assert_eq!(
            effects.soft_edge.expect("direct soft edge").rad,
            StPositiveCoordinate::new_clamped(12700)
        );
    }

    #[test]
    fn shape_style_reads_direct_refs_and_direct_ref_colors_only() {
        let xml = br#"<a:style>
            <a:extLst>
                <a:ext>
                    <a:lnRef idx="9"><a:srgbClr val="999999"/></a:lnRef>
                    <a:fillRef idx="8"><a:srgbClr val="888888"/></a:fillRef>
                    <a:fontRef idx="major"><a:srgbClr val="777777"/></a:fontRef>
                </a:ext>
            </a:extLst>
            <a:lnRef idx="1">
                <a:extLst><a:ext><a:srgbClr val="AAAAAA"/></a:ext></a:extLst>
                <a:srgbClr val="111111"/>
            </a:lnRef>
            <a:fillRef idx="2">
                <a:schemeClr val="accent2"/>
            </a:fillRef>
            <a:effectRef idx="3"/>
            <a:fontRef idx="minor">
                <a:extLst><a:ext><a:srgbClr val="BBBBBB"/></a:ext></a:extLst>
                <a:srgbClr val="222222"/>
            </a:fontRef>
        </a:style>"#;

        let style = parse_shape_style(xml).unwrap();

        assert_eq!(style.line_ref.idx.value(), 1);
        match style.line_ref.color.as_ref().unwrap() {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "111111"),
            other => panic!("expected direct line ref color, got {other:?}"),
        }
        assert_eq!(style.fill_ref.idx.value(), 2);
        assert!(matches!(
            style.fill_ref.color,
            Some(DrawingColor::SchemeClr { .. })
        ));
        assert_eq!(style.effect_ref.idx.value(), 3);
        assert!(style.effect_ref.color.is_none());
        match style.font_ref.color.as_ref().unwrap() {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "222222"),
            other => panic!("expected direct font ref color, got {other:?}"),
        }
    }

    #[test]
    fn transform_ignores_nested_off_and_ext() {
        let xml = br#"<a:xfrm>
            <a:extLst><a:ext><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></a:ext></a:extLst>
            <a:off x="11" y="22"/>
            <a:ext cx="33" cy="44"/>
        </a:xfrm>"#;

        let xfrm = parse_transform_2d(xml).expect("xfrm");
        assert_eq!(xfrm.offset, Some((11, 22)));
        assert_eq!(xfrm.extent, Some((33, 44)));
    }
}
