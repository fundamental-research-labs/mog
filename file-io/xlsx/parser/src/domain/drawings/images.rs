//! Image/picture parsing for drawings.
//!
//! This module handles parsing of picture elements (pic) and blip fills
//! from drawing XML.

use crate::infra::scanner::{find_closing_tag, find_element_end, find_tag_simd};

use super::helpers::{
    extract_attr_value_in_element, extract_ext_lst_raw, parse_i32, parse_i64, parse_u32,
};
use super::shapes::parse_nv_props;
use super::transforms::{parse_shape_properties, parse_shape_style};
use super::types::{
    BlipEffect, BlipFill, CompressionState, DrawingLocking, FillMode, RectAlignment, SourceRect,
    SpreadsheetPicture, TileFill, TileFlipMode,
};
use ooxml_types::drawings::{
    BlurEffect, FillOverlayEffect, StCoordinate, StPercentage, StPositiveCoordinate,
    StPositiveFixedPercentageDecimal,
};

/// Parse a picture element
pub fn parse_picture(xml: &[u8], start: usize) -> Option<SpreadsheetPicture> {
    let end = find_closing_tag(xml, b"pic", start)?;
    let element = &xml[start..end];

    let mut pic = SpreadsheetPicture::default();

    // Parse macro attribute from the <xdr:pic> opening tag
    pic.macro_name = extract_attr_value_in_element(element, b"macro=\"")
        .filter(|v| !v.is_empty())
        .map(|v| String::from_utf8_lossy(v).into_owned());

    // Parse fPublished attribute from the <xdr:pic> opening tag
    pic.f_published =
        extract_attr_value_in_element(element, b"fPublished=\"").map(|v| v == b"1" || v == b"true");

    // Parse non-visual properties
    if let Some(nv_start) = find_tag_simd(element, b"nvPicPr", 0) {
        pic.nv_pic_pr.c_nv_pr = parse_nv_props(&element[nv_start..]);

        // Parse cNvPicPr for picture-specific non-visual properties
        let nv_element = &element[nv_start..];
        if let Some(cnv_pic_start) = find_tag_simd(nv_element, b"cNvPicPr", 0) {
            let cnv_pic_element = &nv_element[cnv_pic_start..];

            // Parse preferRelativeResize attribute
            pic.nv_pic_pr.prefer_relative_resize =
                extract_attr_value_in_element(cnv_pic_element, b"preferRelativeResize=\"")
                    .map(|v| v == b"1" || v == b"true");

            // Parse picLocks element — track presence for round-trip fidelity.
            // Scope to picLocks boundary to avoid capturing sibling extLst.
            if let Some(locks_start) = find_tag_simd(cnv_pic_element, b"picLocks", 0) {
                pic.nv_pic_pr.has_pic_locks = true;
                let locks_scope = if let Some(close) =
                    find_closing_tag(cnv_pic_element, b"picLocks", locks_start)
                {
                    &cnv_pic_element[locks_start..close]
                } else if let Some(tag_end) = find_element_end(cnv_pic_element, locks_start) {
                    &cnv_pic_element[locks_start..=tag_end]
                } else {
                    &cnv_pic_element[locks_start..]
                };
                pic.nv_pic_pr.locks = parse_picture_locking(locks_scope);
            }

            // Capture extLst within cNvPicPr scope
            pic.nv_pic_pr.c_nv_pic_pr_ext_lst = extract_ext_lst_raw(cnv_pic_element);
        }
    }

    // Parse blip fill
    if let Some(blip_start) = find_tag_simd(element, b"blipFill", 0) {
        pic.blip_fill = parse_blip_fill(&element[blip_start..]);
    }

    // Parse shape properties — scope to just the spPr element
    if let Some(sp_start) = find_tag_simd(element, b"spPr", 0) {
        let sp_end = find_closing_tag(element, b"spPr", sp_start).unwrap_or(element.len());
        pic.sp_pr = parse_shape_properties(&element[sp_start..sp_end]);
    }

    // Parse shape style (can appear as <xdr:style> or <a:style>)
    if let Some(style_start) = find_tag_simd(element, b"style", 0) {
        pic.style = parse_shape_style(&element[style_start..]);
    }

    Some(pic)
}

/// Parse blip fill
pub fn parse_blip_fill(xml: &[u8]) -> BlipFill {
    let mut fill = BlipFill::default();

    // 1. Parse attributes on the blipFill element itself (dpi, rotWithShape).
    //    The xml slice starts at the '<' of the blipFill opening tag.
    fill.dpi = extract_attr_value_in_element(xml, b"dpi=\"").and_then(|v| parse_u32(v));
    fill.rot_with_shape =
        extract_attr_value_in_element(xml, b"rotWithShape=\"").map(|v| v == b"1" || v == b"true");

    // 2. Parse <a:blip> element — embed, link, cstate, and child effects.
    if let Some(blip_start) = find_tag_simd(xml, b"blip", 0) {
        let element = &xml[blip_start..];

        fill.embed_id = extract_attr_value_in_element(element, b"embed=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned());

        fill.link_id = extract_attr_value_in_element(element, b"link=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned());

        // Also check for r:embed and r:link (namespaced)
        if fill.embed_id.is_none() {
            fill.embed_id = extract_attr_value_in_element(element, b"r:embed=\"")
                .map(|v| String::from_utf8_lossy(v).into_owned());
        }
        if fill.link_id.is_none() {
            fill.link_id = extract_attr_value_in_element(element, b"r:link=\"")
                .map(|v| String::from_utf8_lossy(v).into_owned());
        }

        fill.compression = extract_attr_value_in_element(element, b"cstate=\"")
            .and_then(|v| parse_compression_state(v));

        // Parse blip child effects and extLst.
        // Determine if the blip tag is self-closing (ends with />) or has children.
        if let Some(gt_pos) = find_element_end(element, 0) {
            let is_self_closing = gt_pos > 0 && element[gt_pos - 1] == b'/';
            if !is_self_closing {
                // The blip has children — parse effects between the opening tag '>' and </blip>.
                let children_start = gt_pos + 1;
                if let Some(close_pos) = find_closing_tag(element, b"blip", 0) {
                    let children = &element[children_start..close_pos];
                    fill.effects = parse_blip_effects(children);
                    // Capture extLst within blip children scope
                    fill.ext_lst = extract_ext_lst_raw(children);
                }
            }
        }
    }

    // 3. Parse <a:srcRect> for source cropping rectangle.
    if let Some(src_start) = find_tag_simd(xml, b"srcRect", 0) {
        let src_elem = &xml[src_start..];
        let l_val = extract_attr_value_in_element(src_elem, b"l=\"");
        let t_val = extract_attr_value_in_element(src_elem, b"t=\"");
        let r_val = extract_attr_value_in_element(src_elem, b"r=\"");
        let b_val = extract_attr_value_in_element(src_elem, b"b=\"");
        // Track which attributes were explicitly present (bitmask: bit0=l, bit1=t, bit2=r, bit3=b).
        let mut explicit: u8 = 0;
        if l_val.is_some() {
            explicit |= 1;
        }
        if t_val.is_some() {
            explicit |= 2;
        }
        if r_val.is_some() {
            explicit |= 4;
        }
        if b_val.is_some() {
            explicit |= 8;
        }
        let source_rect = SourceRect {
            top: StPositiveFixedPercentageDecimal::new_clamped(
                t_val.and_then(|v| parse_u32(v)).unwrap_or(0),
            ),
            bottom: StPositiveFixedPercentageDecimal::new_clamped(
                b_val.and_then(|v| parse_u32(v)).unwrap_or(0),
            ),
            left: StPositiveFixedPercentageDecimal::new_clamped(
                l_val.and_then(|v| parse_u32(v)).unwrap_or(0),
            ),
            right: StPositiveFixedPercentageDecimal::new_clamped(
                r_val.and_then(|v| parse_u32(v)).unwrap_or(0),
            ),
        };
        fill.source_rect = Some(source_rect);
        fill.src_rect_explicit = explicit;
    }

    // 4. Parse fill mode — <a:stretch> or <a:tile>.
    if let Some(stretch_start) = find_tag_simd(xml, b"stretch", 0) {
        let stretch_elem = &xml[stretch_start..];
        let fill_rect = if let Some(fr_start) = find_tag_simd(stretch_elem, b"fillRect", 0) {
            let fr_elem = &stretch_elem[fr_start..];
            Some(SourceRect {
                top: StPositiveFixedPercentageDecimal::new_clamped(
                    extract_attr_value_in_element(fr_elem, b"t=\"")
                        .and_then(|v| parse_u32(v))
                        .unwrap_or(0),
                ),
                bottom: StPositiveFixedPercentageDecimal::new_clamped(
                    extract_attr_value_in_element(fr_elem, b"b=\"")
                        .and_then(|v| parse_u32(v))
                        .unwrap_or(0),
                ),
                left: StPositiveFixedPercentageDecimal::new_clamped(
                    extract_attr_value_in_element(fr_elem, b"l=\"")
                        .and_then(|v| parse_u32(v))
                        .unwrap_or(0),
                ),
                right: StPositiveFixedPercentageDecimal::new_clamped(
                    extract_attr_value_in_element(fr_elem, b"r=\"")
                        .and_then(|v| parse_u32(v))
                        .unwrap_or(0),
                ),
            })
        } else {
            None
        };
        fill.fill_mode = Some(FillMode::Stretch { fill_rect });
    } else if let Some(tile_start) = find_tag_simd(xml, b"tile", 0) {
        let tile_elem = &xml[tile_start..];
        let tile_fill = TileFill {
            tx: extract_attr_value_in_element(tile_elem, b"tx=\"")
                .and_then(|v| parse_i64(v))
                .map(StCoordinate::new),
            ty: extract_attr_value_in_element(tile_elem, b"ty=\"")
                .and_then(|v| parse_i64(v))
                .map(StCoordinate::new),
            sx: extract_attr_value_in_element(tile_elem, b"sx=\"")
                .and_then(|v| parse_i32(v))
                .map(StPercentage::new),
            sy: extract_attr_value_in_element(tile_elem, b"sy=\"")
                .and_then(|v| parse_i32(v))
                .map(StPercentage::new),
            flip: extract_attr_value_in_element(tile_elem, b"flip=\"")
                .and_then(|v| std::str::from_utf8(v).ok())
                .map(TileFlipMode::from_ooxml)
                .unwrap_or_default(),
            align: extract_attr_value_in_element(tile_elem, b"algn=\"")
                .and_then(|v| std::str::from_utf8(v).ok())
                .map(RectAlignment::from_ooxml),
        };
        fill.fill_mode = Some(FillMode::Tile(tile_fill));
    }

    fill
}

/// Parse blip child effects from the content between `<a:blip>` and `</a:blip>`.
fn parse_blip_effects(xml: &[u8]) -> Vec<BlipEffect> {
    let mut effects = Vec::new();
    let mut pos = 0;

    while pos < xml.len() {
        // Find next opening '<'
        let lt_pos = match xml[pos..].iter().position(|&b| b == b'<') {
            Some(p) => pos + p,
            None => break,
        };

        // Skip closing tags
        if lt_pos + 1 < xml.len() && xml[lt_pos + 1] == b'/' {
            pos = lt_pos + 2;
            continue;
        }

        // Extract the local tag name (after any namespace prefix).
        let tag_start = lt_pos + 1;
        let mut name_start = tag_start;

        // Scan through to find end of tag name, noting any namespace colon.
        let mut i = tag_start;
        while i < xml.len() && !matches!(xml[i], b'>' | b' ' | b'\t' | b'\n' | b'\r' | b'/') {
            if xml[i] == b':' {
                name_start = i + 1;
            }
            i += 1;
        }
        let name_end = i;

        let local_name = &xml[name_start..name_end];
        let tag_elem = &xml[lt_pos..];

        let effect = match local_name {
            b"alphaModFix" => {
                let amt = extract_attr_value_in_element(tag_elem, b"amt=\"")
                    .and_then(|v| parse_u32(v))
                    .unwrap_or(100_000);
                Some(BlipEffect::AlphaModFix { amt })
            }
            b"lum" => {
                let bright = extract_attr_value_in_element(tag_elem, b"bright=\"")
                    .and_then(|v| parse_i32(v))
                    .unwrap_or(0);
                let contrast = extract_attr_value_in_element(tag_elem, b"contrast=\"")
                    .and_then(|v| parse_i32(v))
                    .unwrap_or(0);
                Some(BlipEffect::Luminance { bright, contrast })
            }
            b"grayscl" => Some(BlipEffect::Grayscale),
            b"biLevel" => {
                let thresh = extract_attr_value_in_element(tag_elem, b"thresh=\"")
                    .and_then(|v| parse_u32(v))
                    .unwrap_or(0);
                Some(BlipEffect::BiLevel { thresh })
            }
            b"alphaBiLevel" => {
                let thresh = extract_attr_value_in_element(tag_elem, b"thresh=\"")
                    .and_then(|v| parse_u32(v))
                    .unwrap_or(0);
                Some(BlipEffect::AlphaBiLevel { thresh })
            }
            b"alphaCeiling" => Some(BlipEffect::AlphaCeiling),
            b"alphaFloor" => Some(BlipEffect::AlphaFloor),
            b"alphaInv" => Some(BlipEffect::AlphaInverse { color: None }),
            b"alphaMod" => Some(BlipEffect::AlphaModulate),
            b"alphaRepl" => {
                let alpha = extract_attr_value_in_element(tag_elem, b"a=\"")
                    .and_then(|v| parse_u32(v))
                    .unwrap_or(0);
                Some(BlipEffect::AlphaReplace { alpha })
            }
            b"blur" => {
                let rad = extract_attr_value_in_element(tag_elem, b"rad=\"")
                    .and_then(|v| parse_i64(v))
                    .unwrap_or(0);
                let grow = extract_attr_value_in_element(tag_elem, b"grow=\"")
                    .map(|v| v == b"1" || v == b"true")
                    .unwrap_or(true);
                Some(BlipEffect::Blur(BlurEffect {
                    rad: StPositiveCoordinate::new_clamped(rad),
                    grow,
                }))
            }
            b"clrChange" => {
                let use_alpha = extract_attr_value_in_element(tag_elem, b"useA=\"")
                    .map(|v| v == b"1" || v == b"true")
                    .unwrap_or(false);
                // Capture inner XML (e.g. <a:clrFrom>, <a:clrTo>) between opening and closing tags
                let raw_xml = tag_elem
                    .iter()
                    .position(|&b| b == b'>')
                    .and_then(|gt_pos| {
                        find_closing_tag(tag_elem, b"clrChange", gt_pos + 1).map(|close_pos| {
                            let inner = &tag_elem[gt_pos + 1..close_pos];
                            let trimmed = inner.trim_ascii();
                            if trimmed.is_empty() {
                                None
                            } else {
                                std::str::from_utf8(trimmed).ok().map(|s| s.to_string())
                            }
                        })
                    })
                    .flatten();
                Some(BlipEffect::ColorChange { use_alpha, raw_xml })
            }
            b"clrRepl" => Some(BlipEffect::ColorReplace { color: None }),
            b"duotone" => Some(BlipEffect::Duotone {
                color1: None,
                color2: None,
            }),
            b"fillOverlay" => {
                let blend = extract_attr_value_in_element(tag_elem, b"blend=\"")
                    .and_then(|v| std::str::from_utf8(v).ok())
                    .map(ooxml_types::drawings::BlendMode::from_ooxml)
                    .unwrap_or_default();
                Some(BlipEffect::FillOverlay(FillOverlayEffect {
                    blend,
                    fill: None,
                }))
            }
            b"hsl" => {
                let hue = extract_attr_value_in_element(tag_elem, b"hue=\"")
                    .and_then(|v| parse_i32(v))
                    .unwrap_or(0);
                let sat = extract_attr_value_in_element(tag_elem, b"sat=\"")
                    .and_then(|v| parse_i32(v))
                    .unwrap_or(0);
                let lum = extract_attr_value_in_element(tag_elem, b"lum=\"")
                    .and_then(|v| parse_i32(v))
                    .unwrap_or(0);
                Some(BlipEffect::Hsl { hue, sat, lum })
            }
            b"tint" => {
                let hue = extract_attr_value_in_element(tag_elem, b"hue=\"")
                    .and_then(|v| parse_i32(v))
                    .unwrap_or(0);
                let amt = extract_attr_value_in_element(tag_elem, b"amt=\"")
                    .and_then(|v| parse_i32(v))
                    .unwrap_or(0);
                Some(BlipEffect::Tint { hue, amt })
            }
            _ => None,
        };

        if let Some(e) = effect {
            effects.push(e);
        }

        // Advance past this tag
        pos = name_end;
    }

    effects
}

/// Parse picture locking properties from `<a:picLocks>` element
pub(crate) fn parse_picture_locking(xml: &[u8]) -> DrawingLocking {
    let parse_bool_attr = |attr: &[u8]| -> bool {
        extract_attr_value_in_element(xml, attr)
            .map(|v| v == b"1" || v == b"true")
            .unwrap_or(false)
    };

    DrawingLocking {
        no_crop: parse_bool_attr(b"noCrop=\""),
        no_change_aspect: parse_bool_attr(b"noChangeAspect=\""),
        no_grp: parse_bool_attr(b"noGrp=\""),
        no_select: parse_bool_attr(b"noSelect=\""),
        no_rot: parse_bool_attr(b"noRot=\""),
        no_move: parse_bool_attr(b"noMove=\""),
        no_resize: parse_bool_attr(b"noResize=\""),
        no_edit_points: parse_bool_attr(b"noEditPoints=\""),
        no_adjust_handles: parse_bool_attr(b"noAdjustHandles=\""),
        no_change_arrowheads: parse_bool_attr(b"noChangeArrowheads=\""),
        no_change_shape_type: parse_bool_attr(b"noChangeShapeType=\""),
        no_text_edit: parse_bool_attr(b"noTextEdit=\""),
        ext_lst: extract_ext_lst_raw(xml),
    }
}

/// Parse compression state, delegating to `CompressionState::from_ooxml()`.
pub fn parse_compression_state(bytes: &[u8]) -> Option<CompressionState> {
    let s = std::str::from_utf8(bytes).ok()?;
    let parsed = CompressionState::from_ooxml(s);
    // from_ooxml defaults to None for unknown inputs; distinguish from valid "none".
    if s == "none" || s == "print" || s == "screen" || s == "email" || s == "hqprint" {
        Some(parsed)
    } else {
        None
    }
}
