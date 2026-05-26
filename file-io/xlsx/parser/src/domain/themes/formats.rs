//! Format scheme types and parsing for Excel themes.
//!
//! This module parses the format scheme portion of Excel themes directly into
//! canonical `ooxml_types` types, providing full OOXML fidelity for round-trip.

use ooxml_types::drawings::{
    ColorTransform, CompoundLine, DashStyle, DrawingColor, DrawingFill, Emu, GradientFill,
    GradientPathType, GradientStop, LineCap, LineDash, LineEndProperties, LineEndSize, LineEndType,
    LineFill, LineJoin, Outline, PatternFill, PenAlignment, PresetColorVal, PresetPatternVal,
    RelativeRect, SchemeColor, SolidFill, StAngle, StPercentage, StPositiveFixedPercentageDecimal,
    SystemColorVal, TileFlipMode,
};

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_lt_simd, find_tag_simd,
};
use crate::infra::xml::decode_xml_entities;

// =============================================================================
// Drawing Color Parsing (reusable helper)
// =============================================================================

/// Parse a DrawingColor from XML bytes.
///
/// Handles all OOXML EG_ColorChoice variants:
/// - `<a:srgbClr val="...">` with color transform children
/// - `<a:schemeClr val="...">` with transforms
/// - `<a:sysClr val="..." lastClr="...">` with transforms
/// - `<a:hslClr hue="..." sat="..." lum="...">` with transforms
/// - `<a:prstClr val="...">` with transforms
/// - `<a:scrgbClr r="..." g="..." b="...">` with transforms
pub fn parse_drawing_color(xml: &[u8]) -> Option<DrawingColor> {
    // Try srgbClr
    if let Some(start) = find_tag_simd(xml, b"srgbClr", 0) {
        let end = find_closing_tag(xml, b"srgbClr", start).unwrap_or(xml.len());
        let tag_xml = &xml[start..end];
        if let Some(val) = get_attr(tag_xml, b"val=\"") {
            let transforms = parse_color_transforms(tag_xml);
            return Some(DrawingColor::SrgbClr {
                val: val.to_string(),
                transforms,
            });
        }
    }

    // Try schemeClr
    if let Some(start) = find_tag_simd(xml, b"schemeClr", 0) {
        let end = find_closing_tag(xml, b"schemeClr", start).unwrap_or(xml.len());
        let tag_xml = &xml[start..end];
        if let Some(val) = get_attr(tag_xml, b"val=\"") {
            if let Some(scheme) = SchemeColor::from_ooxml(val) {
                let transforms = parse_color_transforms(tag_xml);
                return Some(DrawingColor::SchemeClr {
                    val: scheme,
                    transforms,
                });
            }
        }
    }

    // Try sysClr
    if let Some(start) = find_tag_simd(xml, b"sysClr", 0) {
        let end = find_closing_tag(xml, b"sysClr", start).unwrap_or(xml.len());
        let tag_xml = &xml[start..end];
        if let Some(val) = get_attr(tag_xml, b"val=\"") {
            let sys_val = SystemColorVal::from_ooxml(val);
            let last_clr = get_attr(tag_xml, b"lastClr=\"").map(|s| s.to_string());
            let transforms = parse_color_transforms(tag_xml);
            return Some(DrawingColor::SysClr {
                val: sys_val,
                last_clr,
                transforms,
            });
        }
    }

    // Try hslClr
    if let Some(start) = find_tag_simd(xml, b"hslClr", 0) {
        let end = find_closing_tag(xml, b"hslClr", start).unwrap_or(xml.len());
        let tag_xml = &xml[start..end];
        let hue = get_attr_i32(tag_xml, b"hue=\"").unwrap_or(0);
        let sat = get_attr_i32(tag_xml, b"sat=\"").unwrap_or(0);
        let lum = get_attr_i32(tag_xml, b"lum=\"").unwrap_or(0);
        let transforms = parse_color_transforms(tag_xml);
        return Some(DrawingColor::HslClr {
            hue,
            sat,
            lum,
            transforms,
        });
    }

    // Try prstClr
    if let Some(start) = find_tag_simd(xml, b"prstClr", 0) {
        let end = find_closing_tag(xml, b"prstClr", start).unwrap_or(xml.len());
        let tag_xml = &xml[start..end];
        if let Some(val) = get_attr(tag_xml, b"val=\"") {
            let preset = PresetColorVal::from_ooxml(val);
            let transforms = parse_color_transforms(tag_xml);
            return Some(DrawingColor::PrstClr {
                val: preset,
                transforms,
            });
        }
    }

    // Try scrgbClr
    if let Some(start) = find_tag_simd(xml, b"scrgbClr", 0) {
        let end = find_closing_tag(xml, b"scrgbClr", start).unwrap_or(xml.len());
        let tag_xml = &xml[start..end];
        let r = get_attr_i32(tag_xml, b"r=\"").unwrap_or(0);
        let g = get_attr_i32(tag_xml, b"g=\"").unwrap_or(0);
        let b = get_attr_i32(tag_xml, b"b=\"").unwrap_or(0);
        let transforms = parse_color_transforms(tag_xml);
        return Some(DrawingColor::ScrgbClr {
            r,
            g,
            b,
            transforms,
        });
    }

    None
}

/// Parse color transform children from a color element.
///
/// Scans XML sequentially to preserve document order of transforms,
/// which matters because transforms are applied in sequence.
pub(crate) fn parse_color_transforms(xml: &[u8]) -> Vec<ColorTransform> {
    let mut transforms = Vec::new();

    // All known transform local names (without namespace prefix).
    // Longer names must come before shorter prefixes so we match greedily
    // (e.g. "satMod" before "sat", "alphaMod" before "alpha").
    static TRANSFORM_NAMES: &[(&[u8], &str)] = &[
        (b"tint", "tint"),
        (b"shade", "shade"),
        (b"satMod", "satMod"),
        (b"satOff", "satOff"),
        (b"sat", "sat"),
        (b"lumMod", "lumMod"),
        (b"lumOff", "lumOff"),
        (b"lum", "lum"),
        (b"alphaMod", "alphaMod"),
        (b"alphaOff", "alphaOff"),
        (b"alpha", "alpha"),
        (b"hueMod", "hueMod"),
        (b"hueOff", "hueOff"),
        (b"hue", "hue"),
        (b"redMod", "redMod"),
        (b"redOff", "redOff"),
        (b"red", "red"),
        (b"greenMod", "greenMod"),
        (b"greenOff", "greenOff"),
        (b"green", "green"),
        (b"blueMod", "blueMod"),
        (b"blueOff", "blueOff"),
        (b"blue", "blue"),
        (b"comp", "comp"),
        (b"invGamma", "invGamma"),
        (b"inv", "inv"),
        (b"gray", "gray"),
        (b"gamma", "gamma"),
    ];

    // Scan forward through XML, finding each '<' and checking if the tag
    // matches a known transform. This preserves document order.
    let mut pos = 0;
    while let Some(lt_pos) = find_lt_simd(xml, pos) {
        let after_lt = lt_pos + 1;
        if after_lt >= xml.len() {
            break;
        }

        // Skip closing tags and processing instructions
        if xml[after_lt] == b'/' || xml[after_lt] == b'?' {
            pos = after_lt;
            continue;
        }

        // Find the end of the element name area (up to space, >, /, or end)
        let mut name_end = after_lt;
        while name_end < xml.len() {
            let b = xml[name_end];
            if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
                break;
            }
            name_end += 1;
        }

        // Extract the local name (strip namespace prefix if present)
        let full_name = &xml[after_lt..name_end];
        let local_name = if let Some(colon_pos) = full_name.iter().position(|&b| b == b':') {
            &full_name[colon_pos + 1..]
        } else {
            full_name
        };

        // Check against known transform names (longer names listed first
        // in the array to ensure greedy matching)
        let mut matched_name = None;
        let mut matched_tag = None;
        for &(tag_bytes, name) in TRANSFORM_NAMES {
            if local_name == tag_bytes {
                matched_name = Some(name);
                matched_tag = Some(tag_bytes);
                break;
            }
        }

        if let (Some(name), Some(_tag_bytes)) = (matched_name, matched_tag) {
            // Found a matching transform element; extract its val attribute.
            // Transform elements are typically self-closing (e.g., <a:tint val="67000"/>),
            // so find the next '>' to delimit the element rather than looking for a closing tag.
            let gt_pos = xml[lt_pos..]
                .iter()
                .position(|&b| b == b'>')
                .map(|p| lt_pos + p);
            let element_end = gt_pos.map(|p| p + 1).unwrap_or(xml.len());
            let element_xml = &xml[lt_pos..element_end];
            let val = get_attr_i32(element_xml, b"val=\"");

            if let Some(transform) = ColorTransform::from_ooxml(name, val) {
                transforms.push(transform);
            }

            pos = element_end;
        } else {
            pos = after_lt;
        }
    }

    transforms
}

// =============================================================================
// Fill Style List Parsing
// =============================================================================

/// Parse `<a:fillStyleLst>` children into canonical `Vec<DrawingFill>`.
pub fn parse_fill_style_list_canonical(xml: &[u8]) -> Vec<DrawingFill> {
    parse_fill_list_children(xml)
}

/// Parse `<a:bgFillStyleLst>` children into canonical `Vec<DrawingFill>`.
pub fn parse_bg_fill_style_list_canonical(xml: &[u8]) -> Vec<DrawingFill> {
    parse_fill_list_children(xml)
}

/// Parse fill children shared between fill style list and bg fill style list.
fn parse_fill_list_children(xml: &[u8]) -> Vec<DrawingFill> {
    let mut fills = Vec::new();
    let mut pos = 0;

    while pos < xml.len() {
        // Find the next fill element (solidFill, gradFill, noFill, pattFill)
        let mut earliest: Option<(usize, &str)> = None;

        for tag in &["solidFill", "gradFill", "noFill", "pattFill"] {
            if let Some(start) = find_tag_simd(xml, tag.as_bytes(), pos) {
                if earliest.is_none() || start < earliest.unwrap().0 {
                    earliest = Some((start, tag));
                }
            }
        }

        match earliest {
            Some((start, "solidFill")) => {
                let end = find_closing_tag(xml, b"solidFill", start).unwrap_or(xml.len());
                let fill_xml = &xml[start..end];
                let color = parse_drawing_color(fill_xml).unwrap_or_default();
                fills.push(DrawingFill::Solid(SolidFill { color }));
                pos = end;
            }
            Some((start, "gradFill")) => {
                let end = find_closing_tag(xml, b"gradFill", start).unwrap_or(xml.len());
                let fill_xml = &xml[start..end];
                fills.push(DrawingFill::Gradient(parse_gradient_fill(fill_xml)));
                pos = end;
            }
            Some((start, "noFill")) => {
                let end = find_closing_tag(xml, b"noFill", start).unwrap_or(xml.len());
                fills.push(DrawingFill::NoFill);
                pos = end;
            }
            Some((start, "pattFill")) => {
                let end = find_closing_tag(xml, b"pattFill", start).unwrap_or(xml.len());
                let fill_xml = &xml[start..end];
                fills.push(DrawingFill::Pattern(parse_pattern_fill(fill_xml)));
                pos = end;
            }
            _ => break,
        }
    }

    fills
}

/// Parse a `<a:gradFill>` element into a canonical `GradientFill`.
fn parse_gradient_fill(xml: &[u8]) -> GradientFill {
    let mut fill = GradientFill::default();

    // Parse attributes on gradFill itself
    fill.flip = get_attr(xml, b"flip=\"").map(|v| TileFlipMode::from_ooxml(v));
    fill.rotate_with_shape = get_attr(xml, b"rotWithShape=\"").map(|v| v == "1" || v == "true");

    // Parse gradient stops: <a:gsLst> -> <a:gs pos="..."> -> color
    if let Some(gs_lst_start) = find_tag_simd(xml, b"gsLst", 0) {
        let gs_lst_end = find_closing_tag(xml, b"gsLst", gs_lst_start).unwrap_or(xml.len());
        let gs_lst_xml = &xml[gs_lst_start..gs_lst_end];

        let mut gs_pos = 0;
        while let Some(gs_start) = find_tag_simd(gs_lst_xml, b"gs", gs_pos) {
            // Make sure we don't match gsLst itself
            if gs_start + 2 < gs_lst_xml.len() {
                let after = gs_lst_xml[gs_start + 2];
                if after == b'L' {
                    // This is "gsLst", skip
                    gs_pos = gs_start + 5;
                    continue;
                }
            }

            let gs_end = find_closing_tag(gs_lst_xml, b"gs", gs_start).unwrap_or(gs_lst_xml.len());
            let gs_xml = &gs_lst_xml[gs_start..gs_end];

            let position = get_attr_u32(gs_xml, b"pos=\"").unwrap_or(0);
            if let Some(color) = parse_drawing_color(gs_xml) {
                fill.stops.push(GradientStop {
                    position: StPositiveFixedPercentageDecimal::new_clamped(position),
                    color,
                });
            }

            gs_pos = gs_end;
        }
    }

    // Parse linear gradient: <a:lin ang="..." scaled="..."/>
    if let Some(lin_start) = find_tag_simd(xml, b"lin", 0) {
        // Make sure we're not matching "line" or something else
        let lin_end = find_closing_tag(xml, b"lin", lin_start).unwrap_or(xml.len());
        let lin_xml = &xml[lin_start..lin_end];
        fill.lin_ang = get_attr_i32(lin_xml, b"ang=\"").map(StAngle::new);
        fill.lin_scaled = get_attr(lin_xml, b"scaled=\"").map(|v| v == "1" || v == "true");
    }

    // Parse path gradient: <a:path path="..."> with <a:fillToRect>
    if let Some(path_start) = find_tag_simd(xml, b"path", 0) {
        let path_end = find_closing_tag(xml, b"path", path_start).unwrap_or(xml.len());
        let path_xml = &xml[path_start..path_end];
        if let Some(path_val) = get_attr(path_xml, b"path=\"") {
            fill.path = GradientPathType::from_ooxml(path_val);
        }
        // Parse fillToRect
        if let Some(ftr_start) = find_tag_simd(path_xml, b"fillToRect", 0) {
            let ftr_end =
                find_closing_tag(path_xml, b"fillToRect", ftr_start).unwrap_or(path_xml.len());
            let ftr_xml = &path_xml[ftr_start..ftr_end];
            fill.fill_to_rect = Some(parse_relative_rect(ftr_xml));
        }
    }

    // Parse tileRect
    if let Some(tr_start) = find_tag_simd(xml, b"tileRect", 0) {
        let tr_end = find_closing_tag(xml, b"tileRect", tr_start).unwrap_or(xml.len());
        let tr_xml = &xml[tr_start..tr_end];
        fill.tile_rect = Some(parse_relative_rect(tr_xml));
    }

    fill
}

/// Parse a `<a:pattFill>` element into a canonical `PatternFill`.
fn parse_pattern_fill(xml: &[u8]) -> PatternFill {
    let mut fill = PatternFill::default();

    fill.preset = get_attr(xml, b"prst=\"").and_then(|v| PresetPatternVal::from_ooxml(v));

    // Parse fgClr
    if let Some(fg_start) = find_tag_simd(xml, b"fgClr", 0) {
        let fg_end = find_closing_tag(xml, b"fgClr", fg_start).unwrap_or(xml.len());
        fill.fg_color = parse_drawing_color(&xml[fg_start..fg_end]);
    }

    // Parse bgClr
    if let Some(bg_start) = find_tag_simd(xml, b"bgClr", 0) {
        let bg_end = find_closing_tag(xml, b"bgClr", bg_start).unwrap_or(xml.len());
        fill.bg_color = parse_drawing_color(&xml[bg_start..bg_end]);
    }

    fill
}

/// Parse a relative rect element (CT_RelativeRect) attributes.
fn parse_relative_rect(xml: &[u8]) -> RelativeRect {
    RelativeRect {
        l: get_attr_i32(xml, b"l=\"").map(StPercentage::new),
        t: get_attr_i32(xml, b"t=\"").map(StPercentage::new),
        r: get_attr_i32(xml, b"r=\"").map(StPercentage::new),
        b: get_attr_i32(xml, b"b=\"").map(StPercentage::new),
    }
}

// =============================================================================
// Line Style List Parsing
// =============================================================================

/// Parse `<a:lnStyleLst>` children into canonical `Vec<Outline>`.
pub fn parse_line_style_list_canonical(xml: &[u8]) -> Vec<Outline> {
    let mut lines = Vec::new();
    let mut pos = 0;

    while let Some(ln_start) = find_tag_simd(xml, b"ln", pos) {
        // Verify this is <a:ln ...> not <a:lin ...> or similar
        let after_pos = ln_start + 2;
        if after_pos < xml.len() {
            let c = xml[after_pos];
            if c.is_ascii_alphabetic() && c != b' ' && c != b'>' && c != b'/' {
                // Not "ln" alone — skip
                pos = after_pos;
                continue;
            }
        }

        let ln_end = find_closing_tag(xml, b"ln", ln_start).unwrap_or(xml.len());
        let ln_xml = &xml[ln_start..ln_end];

        let mut outline = Outline::default();

        // Parse attributes
        outline.width = get_attr_i32(ln_xml, b"w=\"").map(|v| v as Emu);
        outline.cap = get_attr(ln_xml, b"cap=\"").map(LineCap::from_ooxml);
        outline.compound = get_attr(ln_xml, b"cmpd=\"").map(CompoundLine::from_ooxml);
        outline.align = get_attr(ln_xml, b"algn=\"").and_then(PenAlignment::from_ooxml);

        // Parse line fill
        outline.fill = parse_line_fill(ln_xml);

        // Parse dash
        outline.dash = parse_line_dash(ln_xml);

        // Parse join
        outline.join = parse_line_join(ln_xml);

        // Parse head/tail ends
        outline.head_end = parse_line_end(ln_xml, b"headEnd");
        outline.tail_end = parse_line_end(ln_xml, b"tailEnd");

        lines.push(outline);
        pos = ln_end;
    }

    lines
}

/// Parse line fill (EG_LineFillProperties) from a line element.
fn parse_line_fill(xml: &[u8]) -> Option<LineFill> {
    if find_tag_simd(xml, b"noFill", 0).is_some() {
        return Some(LineFill::NoFill);
    }

    if let Some(start) = find_tag_simd(xml, b"solidFill", 0) {
        let end = find_closing_tag(xml, b"solidFill", start).unwrap_or(xml.len());
        let fill_xml = &xml[start..end];
        let color = parse_drawing_color(fill_xml).unwrap_or_default();
        return Some(LineFill::Solid(SolidFill { color }));
    }

    if let Some(start) = find_tag_simd(xml, b"gradFill", 0) {
        let end = find_closing_tag(xml, b"gradFill", start).unwrap_or(xml.len());
        let fill_xml = &xml[start..end];
        return Some(LineFill::Gradient(parse_gradient_fill(fill_xml)));
    }

    if let Some(start) = find_tag_simd(xml, b"pattFill", 0) {
        let end = find_closing_tag(xml, b"pattFill", start).unwrap_or(xml.len());
        let fill_xml = &xml[start..end];
        return Some(LineFill::Pattern(parse_pattern_fill(fill_xml)));
    }

    None
}

/// Parse line dash (prstDash or custDash).
fn parse_line_dash(xml: &[u8]) -> Option<LineDash> {
    if let Some(start) = find_tag_simd(xml, b"prstDash", 0) {
        let end = find_closing_tag(xml, b"prstDash", start).unwrap_or(xml.len());
        let dash_xml = &xml[start..end];
        if let Some(val) = get_attr(dash_xml, b"val=\"") {
            return Some(LineDash::Preset(DashStyle::from_ooxml(val)));
        }
    }

    if let Some(start) = find_tag_simd(xml, b"custDash", 0) {
        let end = find_closing_tag(xml, b"custDash", start).unwrap_or(xml.len());
        let dash_xml = &xml[start..end];
        let mut stops = Vec::new();
        let mut ds_pos = 0;
        while let Some(ds_start) = find_tag_simd(dash_xml, b"ds", ds_pos) {
            let ds_end = find_closing_tag(dash_xml, b"ds", ds_start).unwrap_or(dash_xml.len());
            let ds_xml = &dash_xml[ds_start..ds_end];
            let d = get_attr_u32(ds_xml, b"d=\"").unwrap_or(0);
            let sp = get_attr_u32(ds_xml, b"sp=\"").unwrap_or(0);
            stops.push(ooxml_types::drawings::DashStop { d, sp });
            ds_pos = ds_end;
        }
        return Some(LineDash::Custom(stops));
    }

    None
}

/// Parse line join.
fn parse_line_join(xml: &[u8]) -> Option<LineJoin> {
    if find_tag_simd(xml, b"round", 0).is_some() {
        return Some(LineJoin::Round);
    }
    if find_tag_simd(xml, b"bevel", 0).is_some() {
        return Some(LineJoin::Bevel);
    }
    if let Some(start) = find_tag_simd(xml, b"miter", 0) {
        let end = find_closing_tag(xml, b"miter", start).unwrap_or(xml.len());
        let miter_xml = &xml[start..end];
        let limit = get_attr_i32(miter_xml, b"lim=\"");
        return Some(LineJoin::Miter { limit });
    }
    None
}

/// Parse a line end (headEnd or tailEnd) element.
fn parse_line_end(xml: &[u8], tag: &[u8]) -> Option<LineEndProperties> {
    let start = find_tag_simd(xml, tag, 0)?;
    let end = find_closing_tag(xml, tag, start).unwrap_or(xml.len());
    let end_xml = &xml[start..end];

    Some(LineEndProperties {
        end_type: get_attr(end_xml, b"type=\"").and_then(LineEndType::from_ooxml),
        width: get_attr(end_xml, b"w=\"").and_then(LineEndSize::from_ooxml),
        length: get_attr(end_xml, b"len=\"").and_then(LineEndSize::from_ooxml),
    })
}

// =============================================================================
// Format Scheme Top-Level Parsing
// =============================================================================

/// Parse `<a:fmtScheme>` from theme XML into a canonical `ooxml_types::themes::FormatScheme`.
pub fn parse_format_scheme_canonical(xml: &[u8]) -> ooxml_types::themes::FormatScheme {
    use super::effects::parse_effect_style_list_canonical;

    let mut scheme = ooxml_types::themes::FormatScheme::default();

    // Find fmtScheme element
    if let Some(fmt_start) = find_tag_simd(xml, b"fmtScheme", 0) {
        let fmt_end = find_closing_tag(xml, b"fmtScheme", fmt_start).unwrap_or(xml.len());
        let fmt_xml = &xml[fmt_start..fmt_end];

        // Parse scheme name (decode XML entities so we don't double-escape on write)
        if let Some(name_pos) = find_attr_simd(fmt_xml, b"name=\"", 0) {
            let value_start = name_pos + 6;
            if let Some((start, end)) = extract_quoted_value(fmt_xml, value_start) {
                scheme.name = decode_xml_entities(&fmt_xml[start..end]);
            }
        }

        // Parse fill styles
        if let Some(fill_start) = find_tag_simd(fmt_xml, b"fillStyleLst", 0) {
            let fill_end =
                find_closing_tag(fmt_xml, b"fillStyleLst", fill_start).unwrap_or(fmt_xml.len());
            scheme.fill_style_lst = parse_fill_style_list_canonical(&fmt_xml[fill_start..fill_end]);
        }

        // Parse line styles
        if let Some(ln_start) = find_tag_simd(fmt_xml, b"lnStyleLst", 0) {
            let ln_end =
                find_closing_tag(fmt_xml, b"lnStyleLst", ln_start).unwrap_or(fmt_xml.len());
            scheme.ln_style_lst = parse_line_style_list_canonical(&fmt_xml[ln_start..ln_end]);
        }

        // Parse effect styles
        if let Some(eff_start) = find_tag_simd(fmt_xml, b"effectStyleLst", 0) {
            let eff_end =
                find_closing_tag(fmt_xml, b"effectStyleLst", eff_start).unwrap_or(fmt_xml.len());
            scheme.effect_style_lst =
                parse_effect_style_list_canonical(&fmt_xml[eff_start..eff_end]);
        }

        // Parse background fill styles
        if let Some(bg_start) = find_tag_simd(fmt_xml, b"bgFillStyleLst", 0) {
            let bg_end =
                find_closing_tag(fmt_xml, b"bgFillStyleLst", bg_start).unwrap_or(fmt_xml.len());
            scheme.bg_fill_style_lst =
                parse_bg_fill_style_list_canonical(&fmt_xml[bg_start..bg_end]);
        }
    }

    scheme
}

// =============================================================================
// Attribute Helpers
// =============================================================================

/// Get a string attribute value from XML bytes.
pub(crate) fn get_attr<'a>(xml: &'a [u8], attr_prefix: &[u8]) -> Option<&'a str> {
    let pos = find_attr_simd(xml, attr_prefix, 0)?;
    let value_start = pos + attr_prefix.len(); // position after the opening quote
    let (start, end) = extract_quoted_value(xml, value_start)?;
    std::str::from_utf8(&xml[start..end]).ok()
}

/// Get an i32 attribute value from XML bytes.
pub(crate) fn get_attr_i32(xml: &[u8], attr_prefix: &[u8]) -> Option<i32> {
    get_attr(xml, attr_prefix)?.parse().ok()
}

/// Get a u32 attribute value from XML bytes.
pub(crate) fn get_attr_u32(xml: &[u8], attr_prefix: &[u8]) -> Option<u32> {
    get_attr(xml, attr_prefix)?.parse().ok()
}
