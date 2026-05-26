//! Transform and fill/outline parsing for drawings.
//!
//! This module handles parsing of 2D transforms, fill styles (solid, gradient,
//! pattern), and outline/line properties from drawing XML.

use crate::infra::scanner::find_tag_simd;

use super::helpers::{
    extract_attr_value_in_element, extract_ext_lst_raw, parse_i32, parse_i64, parse_u32,
};
use super::shapes::parse_shape_preset;
use super::types::{
    BlackWhiteMode, CompoundLine, DashStyle, DrawingColor, EffectList, Fill, GradientFill,
    GradientStop, LineCap, LineEndProperties, LineEndSize, LineEndType, LineJoin, Outline,
    PatternFill, PenAlignment, PresetGeometry, ShapeGeometry, ShapeProperties, ShapeStyle,
    SolidFill, StyleRef, Transform2D,
};
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
    if let Some(xfrm_start) = find_tag_simd(xml, b"xfrm", 0) {
        props.xfrm = parse_transform_2d(&xml[xfrm_start..]);
    }

    // Parse preset geometry
    if let Some(prst_start) = find_tag_simd(xml, b"prstGeom", 0) {
        let prst_xml = &xml[prst_start..];
        props.geometry = extract_attr_value_in_element(prst_xml, b"prst=\"")
            .and_then(|v| parse_shape_preset(v))
            .map(|prst| {
                let mut av_list = Vec::new();
                // Parse avLst child and its gd elements
                if let Some(avlst_start) = find_tag_simd(prst_xml, b"avLst", 0) {
                    let avlst_xml = &prst_xml[avlst_start..];
                    let mut gd_pos = 0;
                    while let Some(gd_start) = find_tag_simd(avlst_xml, b"gd", gd_pos) {
                        let gd_xml = &avlst_xml[gd_start..];
                        if let (Some(name_val), Some(fmla_val)) = (
                            extract_attr_value_in_element(gd_xml, b"name=\""),
                            extract_attr_value_in_element(gd_xml, b"fmla=\""),
                        ) {
                            av_list.push(ooxml_types::drawings::GeomGuide {
                                name: String::from_utf8_lossy(name_val).into_owned(),
                                fmla: String::from_utf8_lossy(fmla_val).into_owned(),
                            });
                        }
                        gd_pos = gd_start + 1;
                    }
                }
                ShapeGeometry::Preset(PresetGeometry { prst, av_list })
            });
    }

    // Parse fill — only search before <a:ln> to avoid picking up solidFill inside the line
    let ln_pos = find_tag_simd(xml, b"ln", 0);
    let fill_search_range = if let Some(lp) = ln_pos {
        &xml[..lp]
    } else {
        xml
    };
    props.fill = parse_fill(fill_search_range);

    // Parse outline
    if let Some(ln_start) = ln_pos {
        props.ln = parse_outline(&xml[ln_start..]);
    }

    // Parse effect list
    if let Some(eff_start) = find_tag_simd(xml, b"effectLst", 0) {
        props.effects = parse_effect_list(&xml[eff_start..])
            .map(ooxml_types::drawings::EffectProperties::EffectList);
    }

    // Parse scene3d
    if let Some(s3d_start) = find_tag_simd(xml, b"scene3d", 0) {
        if let Some(s3d_end) = crate::infra::scanner::find_closing_tag(xml, b"scene3d", s3d_start) {
            props.scene3d = super::three_d::parse_scene3d(&xml[s3d_start..s3d_end]);
        }
    }

    // Parse sp3d
    if let Some(sp3d_start) = find_tag_simd(xml, b"sp3d", 0) {
        if let Some(sp3d_end) = crate::infra::scanner::find_closing_tag(xml, b"sp3d", sp3d_start) {
            props.sp3d = super::three_d::parse_shape3d(&xml[sp3d_start..sp3d_end]);
        }
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
        .and_then(|v| super::helpers::parse_i32(v))
        .map(StAngle::new);

    // Parse flips
    transform.flip_h =
        extract_attr_value_in_element(xml, b"flipH=\"").map(|v| v == b"1" || v == b"true");

    transform.flip_v =
        extract_attr_value_in_element(xml, b"flipV=\"").map(|v| v == b"1" || v == b"true");

    // Parse offset
    if let Some(off_start) = find_tag_simd(xml, b"off", 0) {
        let off_element = &xml[off_start..];
        let x = extract_attr_value_in_element(off_element, b"x=\"")
            .and_then(|v| parse_i64(v))
            .unwrap_or(0);
        let y = extract_attr_value_in_element(off_element, b"y=\"")
            .and_then(|v| parse_i64(v))
            .unwrap_or(0);
        transform.offset = Some((x, y));
    }

    // Parse extent
    if let Some(ext_start) = find_tag_simd(xml, b"ext", 0) {
        let ext_element = &xml[ext_start..];
        let cx = extract_attr_value_in_element(ext_element, b"cx=\"")
            .and_then(|v| parse_i64(v))
            .unwrap_or(0) as u64;
        let cy = extract_attr_value_in_element(ext_element, b"cy=\"")
            .and_then(|v| parse_i64(v))
            .unwrap_or(0) as u64;
        transform.extent = Some((cx, cy));
    }

    Some(transform)
}

/// Parse fill styles
pub fn parse_fill(xml: &[u8]) -> Option<Fill> {
    // Find the position of each fill variant to pick whichever appears first.
    // This avoids matching a <a:noFill/> inside a nested <a:ln> element when
    // the actual fill for the parent element is a <a:solidFill>.
    let no_fill_pos = find_tag_simd(xml, b"noFill", 0);
    let solid_pos = find_tag_simd(xml, b"solidFill", 0);
    let grad_pos = find_tag_simd(xml, b"gradFill", 0);
    let patt_pos = find_tag_simd(xml, b"pattFill", 0);

    // Pick the earliest match
    let mut earliest: Option<(usize, u8)> = None; // (pos, type: 0=noFill, 1=solid, 2=grad, 3=patt)
    if let Some(p) = no_fill_pos {
        earliest = Some((p, 0));
    }
    if let Some(p) = solid_pos {
        if earliest.map_or(true, |(ep, _)| p < ep) {
            earliest = Some((p, 1));
        }
    }
    if let Some(p) = grad_pos {
        if earliest.map_or(true, |(ep, _)| p < ep) {
            earliest = Some((p, 2));
        }
    }
    if let Some(p) = patt_pos {
        if earliest.map_or(true, |(ep, _)| p < ep) {
            earliest = Some((p, 3));
        }
    }

    match earliest {
        Some((_, 0)) => Some(Fill::NoFill),
        Some((p, 1)) => {
            let color = parse_color(&xml[p..]);
            Some(Fill::Solid(SolidFill { color }))
        }
        Some((p, 2)) => Some(Fill::Gradient(parse_gradient_fill(&xml[p..]))),
        Some((p, 3)) => Some(Fill::Pattern(parse_pattern_fill(&xml[p..]))),
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
    use ooxml_types::drawings::SchemeColor;

    // Check for srgbClr
    if let Some(srgb_start) = find_tag_simd(xml, b"srgbClr", 0) {
        let element = &xml[srgb_start..];
        let val = extract_attr_value_in_element(element, b"val=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned())
            .unwrap_or_default();
        let transforms = parse_color_transforms(element);
        return DrawingColor::SrgbClr { val, transforms };
    }

    // Check for schemeClr (theme color)
    if let Some(scheme_start) = find_tag_simd(xml, b"schemeClr", 0) {
        let element = &xml[scheme_start..];
        let scheme = extract_attr_value_in_element(element, b"val=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(SchemeColor::from_ooxml)
            .unwrap_or_default();
        let transforms = parse_color_transforms(element);
        return DrawingColor::SchemeClr {
            val: scheme,
            transforms,
        };
    }

    // Check for scrgbClr (linear RGB, percentages 0-100000)
    if let Some(scrgb_start) = find_tag_simd(xml, b"scrgbClr", 0) {
        let element = &xml[scrgb_start..];
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
        return DrawingColor::ScrgbClr {
            r,
            g,
            b: b_val,
            transforms,
        };
    }

    // Check for sysClr (system color)
    if let Some(sys_start) = find_tag_simd(xml, b"sysClr", 0) {
        let element = &xml[sys_start..];
        let val_str = extract_attr_value_in_element(element, b"val=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned())
            .unwrap_or_default();
        let val = SystemColorVal::from_ooxml(&val_str);
        let last_clr = extract_attr_value_in_element(element, b"lastClr=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned());
        let transforms = parse_color_transforms(element);
        return DrawingColor::SysClr {
            val,
            last_clr,
            transforms,
        };
    }

    // Check for prstClr (preset named color)
    if let Some(prst_start) = find_tag_simd(xml, b"prstClr", 0) {
        let element = &xml[prst_start..];
        let val_str = extract_attr_value_in_element(element, b"val=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned())
            .unwrap_or_default();
        let val = PresetColorVal::from_ooxml(&val_str);
        let transforms = parse_color_transforms(element);
        return DrawingColor::PrstClr { val, transforms };
    }

    // Check for hslClr
    if let Some(hsl_start) = find_tag_simd(xml, b"hslClr", 0) {
        let element = &xml[hsl_start..];
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
        return DrawingColor::HslClr {
            hue,
            sat,
            lum,
            transforms,
        };
    }

    DrawingColor::default()
}

/// Parse gradient fill
fn parse_gradient_fill(xml: &[u8]) -> GradientFill {
    let mut fill = GradientFill::default();

    // Parse rotation from lin element
    if let Some(lin_start) = find_tag_simd(xml, b"lin", 0) {
        if let Some(ang) = extract_attr_value_in_element(&xml[lin_start..], b"ang=\"") {
            if let Some(val) = parse_i64(ang) {
                // Angle is in 60000ths of a degree
                fill.lin_ang = Some(StAngle::new(val as i32));
            }
        }
    }

    // Parse gradient stops
    let mut pos = 0;
    while let Some(gs_start) = find_tag_simd(xml, b"gs", pos) {
        let element = &xml[gs_start..];
        if let Some(position) = extract_attr_value_in_element(element, b"pos=\"") {
            if let Some(pos_val) = parse_u32(position) {
                let color = parse_color(element);
                fill.stops.push(GradientStop {
                    position: StPositiveFixedPercentageDecimal::new_clamped(pos_val),
                    color,
                });
            }
        }
        pos = gs_start + 1;
    }

    fill
}

/// Parse pattern fill
fn parse_pattern_fill(xml: &[u8]) -> PatternFill {
    let mut fill = PatternFill::default();

    fill.preset = extract_attr_value_in_element(xml, b"prst=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .and_then(ooxml_types::drawings::PresetPatternVal::from_ooxml);

    // Parse foreground color
    if let Some(fg_start) = find_tag_simd(xml, b"fgClr", 0) {
        fill.fg_color = Some(parse_color(&xml[fg_start..]));
    }

    // Parse background color
    if let Some(bg_start) = find_tag_simd(xml, b"bgClr", 0) {
        fill.bg_color = Some(parse_color(&xml[bg_start..]));
    }

    fill
}

/// Parse outline/line properties
pub fn parse_outline(xml: &[u8]) -> Option<Outline> {
    // Bound the search to just the <a:ln> element content.
    // Without this, attribute/child searches can leak into sibling elements
    // like <a14:hiddenLine> inside <a:extLst>.
    let element_end = crate::infra::scanner::find_element_end(xml, 0)?;
    let is_self_closing = element_end > 0 && xml[element_end - 1] == b'/';
    let xml = if is_self_closing {
        &xml[..=element_end]
    } else {
        let closing =
            crate::infra::scanner::find_closing_tag(xml, b"ln", element_end).unwrap_or(xml.len());
        &xml[..closing]
    };

    let mut outline = Outline::default();

    // Parse width
    outline.width = extract_attr_value_in_element(xml, b"w=\"").and_then(|v| parse_i64(v));

    // Parse cap and compound attributes on <a:ln>
    outline.cap = extract_attr_value_in_element(xml, b"cap=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(LineCap::from_ooxml);

    outline.compound = extract_attr_value_in_element(xml, b"cmpd=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(CompoundLine::from_ooxml);

    outline.align = extract_attr_value_in_element(xml, b"algn=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .and_then(PenAlignment::from_ooxml);

    // Parse line fill
    if find_tag_simd(xml, b"noFill", 0).is_some() {
        outline.fill = Some(LineFill::NoFill);
    } else if let Some(solid_start) = find_tag_simd(xml, b"solidFill", 0) {
        let color = parse_color(&xml[solid_start..]);
        outline.fill = Some(LineFill::Solid(SolidFill { color }));
    }

    // Parse dash style
    if let Some(prst_start) = find_tag_simd(xml, b"prstDash", 0) {
        outline.dash = extract_attr_value_in_element(&xml[prst_start..], b"val=\"")
            .and_then(|v| parse_dash_style(v))
            .map(LineDash::Preset);
    }

    // Parse head end
    if let Some(head_start) = find_tag_simd(xml, b"headEnd", 0) {
        outline.head_end = Some(parse_line_end_properties(&xml[head_start..]));
    }

    // Parse tail end
    if let Some(tail_start) = find_tag_simd(xml, b"tailEnd", 0) {
        outline.tail_end = Some(parse_line_end_properties(&xml[tail_start..]));
    }

    // Parse line join
    if find_tag_simd(xml, b"round", 0).is_some() {
        outline.join = Some(LineJoin::Round);
    } else if find_tag_simd(xml, b"bevel", 0).is_some() {
        outline.join = Some(LineJoin::Bevel);
    } else if let Some(miter_start) = find_tag_simd(xml, b"miter", 0) {
        let limit = extract_attr_value_in_element(&xml[miter_start..], b"lim=\"")
            .and_then(|v| parse_i32(v));
        outline.join = Some(LineJoin::Miter { limit });
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

    if let Some(ln_start) = find_tag_simd(xml, b"lnRef", 0) {
        if let Some(sr) = parse_style_ref(&xml[ln_start..]) {
            style.line_ref = sr;
        }
    }

    if let Some(fill_start) = find_tag_simd(xml, b"fillRef", 0) {
        if let Some(sr) = parse_style_ref(&xml[fill_start..]) {
            style.fill_ref = sr;
        }
    }

    if let Some(effect_start) = find_tag_simd(xml, b"effectRef", 0) {
        if let Some(sr) = parse_style_ref(&xml[effect_start..]) {
            style.effect_ref = sr;
        }
    }

    if let Some(font_start) = find_tag_simd(xml, b"fontRef", 0) {
        style.font_ref = parse_font_ref(&xml[font_start..]);
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

    // Determine if the element is self-closing.
    let first_gt = xml.iter().position(|&b| b == b'>');
    let self_closing = first_gt.map_or(true, |pos| pos > 0 && xml[pos - 1] == b'/');

    let color = if !self_closing {
        // Limit search to just this fontRef element's boundaries.
        let ref_end =
            crate::infra::scanner::find_closing_tag(xml, b"fontRef", 0).unwrap_or(xml.len());
        let ref_slice = &xml[..ref_end];
        if find_tag_simd(ref_slice, b"srgbClr", 0).is_some()
            || find_tag_simd(ref_slice, b"schemeClr", 0).is_some()
            || find_tag_simd(ref_slice, b"scrgbClr", 0).is_some()
            || find_tag_simd(ref_slice, b"sysClr", 0).is_some()
            || find_tag_simd(ref_slice, b"prstClr", 0).is_some()
            || find_tag_simd(ref_slice, b"hslClr", 0).is_some()
        {
            Some(parse_color(ref_slice))
        } else {
            None
        }
    } else {
        None
    };

    FontReference { idx, color }
}

/// Parse style reference.
///
/// Limits colour search to the current element's boundaries to avoid
/// picking up sibling elements' colour children.
fn parse_style_ref(xml: &[u8]) -> Option<StyleRef> {
    let idx = StStyleMatrixColumnIndex::new(
        extract_attr_value_in_element(xml, b"idx=\"").and_then(|v| parse_u32(v))?,
    );

    // Determine if the element is self-closing (`<a:fillRef idx="0"/>`).
    // A self-closing element cannot have child colour elements.
    let first_gt = xml.iter().position(|&b| b == b'>');
    let self_closing = first_gt.map_or(true, |pos| pos > 0 && xml[pos - 1] == b'/');

    let color = if !self_closing {
        // Limit the search scope to just THIS ref element (up to its closing tag)
        // to avoid picking up color elements from sibling ref elements.
        // Extract the local tag name (after any namespace prefix) for find_closing_tag.
        let ref_tag = {
            let start = if xml.starts_with(b"<") { 1 } else { 0 };
            let end = xml[start..]
                .iter()
                .position(|&b| matches!(b, b' ' | b'>' | b'/'))
                .map_or(xml.len(), |p| p + start);
            let full_tag = &xml[start..end];
            // Strip namespace prefix (e.g., "a:lnRef" → "lnRef")
            if let Some(colon) = full_tag.iter().position(|&b| b == b':') {
                &full_tag[colon + 1..]
            } else {
                full_tag
            }
        };
        let ref_end = crate::infra::scanner::find_closing_tag(xml, ref_tag, 0).unwrap_or(xml.len());
        let ref_slice = &xml[..ref_end];
        if find_tag_simd(ref_slice, b"srgbClr", 0).is_some()
            || find_tag_simd(ref_slice, b"schemeClr", 0).is_some()
            || find_tag_simd(ref_slice, b"scrgbClr", 0).is_some()
            || find_tag_simd(ref_slice, b"sysClr", 0).is_some()
            || find_tag_simd(ref_slice, b"prstClr", 0).is_some()
            || find_tag_simd(ref_slice, b"hslClr", 0).is_some()
        {
            Some(parse_color(ref_slice))
        } else {
            None
        }
    } else {
        None
    };

    Some(StyleRef { idx, color })
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
    // Bound the search to just the <a:effectLst> element content.
    // Without this, child searches can leak into sibling elements like
    // <a14:hiddenEffects> which also contain <a:effectLst> children.
    let element_end = crate::infra::scanner::find_element_end(xml, 0)?;
    let is_self_closing = element_end > 0 && xml[element_end - 1] == b'/';
    if is_self_closing {
        // Empty <a:effectLst/> — return default so the tag round-trips.
        return Some(EffectList::default());
    }
    let closing = crate::infra::scanner::find_closing_tag(xml, b"effectLst", element_end)
        .unwrap_or(xml.len());
    let xml = &xml[..closing];

    let mut effects = EffectList::default();
    let mut found_any = false;

    // Parse <a:outerShdw>
    if let Some(start) = find_tag_simd(xml, b"outerShdw", 0) {
        let el = &xml[start..];
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

    // Parse <a:innerShdw>
    if let Some(start) = find_tag_simd(xml, b"innerShdw", 0) {
        let el = &xml[start..];
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

    // Parse <a:glow>
    if let Some(start) = find_tag_simd(xml, b"glow", 0) {
        let el = &xml[start..];
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

    // Parse <a:softEdge>
    if let Some(start) = find_tag_simd(xml, b"softEdge", 0) {
        let el = &xml[start..];
        let rad = extract_attr_value_in_element(el, b"rad=\"")
            .and_then(|v| parse_i64(v))
            .unwrap_or(0);
        effects.soft_edge = Some(SoftEdge {
            rad: StPositiveCoordinate::new_clamped(rad),
        });
        found_any = true;
    }

    // Parse <a:reflection>
    if let Some(start) = find_tag_simd(xml, b"reflection", 0) {
        let el = &xml[start..];
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

    // Parse <a:prstShdw>
    if let Some(start) = find_tag_simd(xml, b"prstShdw", 0) {
        let el = &xml[start..];
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

    // Parse <a:blur>
    if let Some(start) = find_tag_simd(xml, b"blur", 0) {
        let el = &xml[start..];
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

    // Parse <a:fillOverlay>
    if let Some(start) = find_tag_simd(xml, b"fillOverlay", 0) {
        let el = &xml[start..];
        let blend = extract_attr_value_in_element(el, b"blend=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .map(ooxml_types::drawings::BlendMode::from_ooxml)
            .unwrap_or_default();
        effects.fill_overlay = Some(FillOverlayEffect { blend, fill: None });
        found_any = true;
    }

    // Always return Some — even for empty `<a:effectLst/>` — so the
    // serialiser can round-trip the tag faithfully.
    let _ = found_any;
    Some(effects)
}
