//! Image/picture parsing for drawings.
//!
//! This module handles parsing of picture elements (pic) and blip fills
//! from drawing XML.

use super::super::helpers::{extract_attr_value_in_element, parse_i32, parse_i64, parse_u32};
use super::super::reader::attrs::{attr_value, parse_bool};
use super::super::reader::elements::{
    direct_child_elements, direct_child_slice, document_element, document_element_slice,
};
use super::super::reader::raw::extract_ext_lst_raw;
use super::super::types::{
    BlipEffect, BlipFill, CompressionState, DrawingLocking, FillMode, RectAlignment, SourceRect,
    SpreadsheetPicture, TileFill, TileFlipMode,
};
use super::non_visual::parse_nv_props;
use super::styling::{parse_shape_properties, parse_shape_style};
use ooxml_types::drawings::{
    BlurEffect, FillOverlayEffect, StCoordinate, StPercentage, StPositiveCoordinate,
    StPositiveFixedPercentageDecimal,
};

/// Parse a picture element
pub fn parse_picture(xml: &[u8], start: usize) -> Option<SpreadsheetPicture> {
    let element = document_element_slice(&xml[start..])?;

    let mut pic = SpreadsheetPicture::default();

    // Parse macro attribute from the <xdr:pic> opening tag
    pic.macro_name = attr_value(element, b"macro=\"")
        .filter(|v| !v.is_empty())
        .map(|v| String::from_utf8_lossy(v).into_owned());

    // Parse fPublished attribute from the <xdr:pic> opening tag
    pic.f_published = attr_value(element, b"fPublished=\"").and_then(parse_bool);

    // Parse non-visual properties
    if let Some(nv_element) = direct_child_slice(element, b"nvPicPr") {
        pic.nv_pic_pr.c_nv_pr = parse_nv_props(nv_element);

        // Parse cNvPicPr for picture-specific non-visual properties
        if let Some(cnv_pic_element) = direct_child_slice(nv_element, b"cNvPicPr") {
            // Parse preferRelativeResize attribute
            pic.nv_pic_pr.prefer_relative_resize =
                attr_value(cnv_pic_element, b"preferRelativeResize=\"").and_then(parse_bool);

            // Parse picLocks element — track presence for round-trip fidelity.
            // Scope to picLocks boundary to avoid capturing sibling extLst.
            if let Some(locks_scope) = direct_child_slice(cnv_pic_element, b"picLocks") {
                pic.nv_pic_pr.has_pic_locks = true;
                pic.nv_pic_pr.locks = parse_picture_locking(locks_scope);
            }

            // Capture extLst within cNvPicPr scope
            pic.nv_pic_pr.c_nv_pic_pr_ext_lst = extract_ext_lst_raw(cnv_pic_element);
        }
    }

    // Parse blip fill
    if let Some(blip_fill) = direct_child_slice(element, b"blipFill") {
        pic.blip_fill = parse_blip_fill(blip_fill);
    }

    // Parse shape properties — scope to just the spPr element
    if let Some(sp_pr) = direct_child_slice(element, b"spPr") {
        pic.sp_pr = parse_shape_properties(sp_pr);
    }

    // Parse shape style (can appear as <xdr:style> or <a:style>)
    if let Some(style) = direct_child_slice(element, b"style") {
        pic.style = parse_shape_style(style);
    }

    Some(pic)
}

/// Parse blip fill
pub fn parse_blip_fill(xml: &[u8]) -> BlipFill {
    let Some(root) = document_element(xml) else {
        return BlipFill::default();
    };
    let xml = if root.local_name == b"blipFill" {
        root.full_slice(xml)
    } else if let Some(blip_fill) = direct_child_slice(root.full_slice(xml), b"blipFill") {
        blip_fill
    } else {
        root.full_slice(xml)
    };

    let mut fill = BlipFill::default();

    // 1. Parse attributes on the blipFill element itself (dpi, rotWithShape).
    //    The xml slice starts at the '<' of the blipFill opening tag.
    fill.dpi = extract_attr_value_in_element(xml, b"dpi=\"").and_then(|v| parse_u32(v));
    fill.rot_with_shape =
        extract_attr_value_in_element(xml, b"rotWithShape=\"").map(|v| v == b"1" || v == b"true");

    // 2. Parse <a:blip> element — embed, link, cstate, and child effects.
    if let Some(blip) = direct_child_slice(xml, b"blip") {
        fill.embed_id = extract_attr_value_in_element(blip, b"embed=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned());

        fill.link_id = extract_attr_value_in_element(blip, b"link=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned());

        // Also check for r:embed and r:link (namespaced)
        if fill.embed_id.is_none() {
            fill.embed_id = extract_attr_value_in_element(blip, b"r:embed=\"")
                .map(|v| String::from_utf8_lossy(v).into_owned());
        }
        if fill.link_id.is_none() {
            fill.link_id = extract_attr_value_in_element(blip, b"r:link=\"")
                .map(|v| String::from_utf8_lossy(v).into_owned());
        }

        fill.compression = extract_attr_value_in_element(blip, b"cstate=\"")
            .and_then(|v| parse_compression_state(v));

        fill.effects = parse_blip_effects(blip);
        fill.ext_lst = extract_ext_lst_raw(blip);
    }

    // 3. Parse <a:srcRect> for source cropping rectangle.
    if let Some(src_rect) = direct_child_slice(xml, b"srcRect") {
        let (source_rect, explicit) = parse_source_rect(src_rect);
        fill.source_rect = Some(source_rect);
        fill.src_rect_explicit = explicit;
    }

    // 4. Parse fill mode — <a:stretch> or <a:tile>.
    if let Some(stretch) = direct_child_slice(xml, b"stretch") {
        let fill_rect = direct_child_slice(stretch, b"fillRect")
            .map(|fill_rect| parse_source_rect(fill_rect).0);
        fill.fill_mode = Some(FillMode::Stretch { fill_rect });
    } else if let Some(tile) = direct_child_slice(xml, b"tile") {
        let tile_fill = TileFill {
            tx: extract_attr_value_in_element(tile, b"tx=\"")
                .and_then(|v| parse_i64(v))
                .map(StCoordinate::new),
            ty: extract_attr_value_in_element(tile, b"ty=\"")
                .and_then(|v| parse_i64(v))
                .map(StCoordinate::new),
            sx: extract_attr_value_in_element(tile, b"sx=\"")
                .and_then(|v| parse_i32(v))
                .map(StPercentage::new),
            sy: extract_attr_value_in_element(tile, b"sy=\"")
                .and_then(|v| parse_i32(v))
                .map(StPercentage::new),
            flip: extract_attr_value_in_element(tile, b"flip=\"")
                .and_then(|v| std::str::from_utf8(v).ok())
                .map(TileFlipMode::from_ooxml)
                .unwrap_or_default(),
            align: extract_attr_value_in_element(tile, b"algn=\"")
                .and_then(|v| std::str::from_utf8(v).ok())
                .map(RectAlignment::from_ooxml),
        };
        fill.fill_mode = Some(FillMode::Tile(tile_fill));
    }

    fill
}

fn parse_source_rect(xml: &[u8]) -> (SourceRect, u8) {
    let l_val = extract_attr_value_in_element(xml, b"l=\"");
    let t_val = extract_attr_value_in_element(xml, b"t=\"");
    let r_val = extract_attr_value_in_element(xml, b"r=\"");
    let b_val = extract_attr_value_in_element(xml, b"b=\"");

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

    (
        SourceRect {
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
        },
        explicit,
    )
}

/// Parse direct blip child effects from a scoped `<a:blip>` element.
fn parse_blip_effects(xml: &[u8]) -> Vec<BlipEffect> {
    let mut effects = Vec::new();
    for child in direct_child_elements(xml) {
        let tag_elem = child.full_slice(xml);

        let effect = match child.local_name {
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
                let raw_xml = inner_xml_string(tag_elem);
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
    }

    effects
}

fn inner_xml_string(xml: &[u8]) -> Option<String> {
    let element = document_element(xml)?;
    if element.self_closing {
        return None;
    }

    let close_start = xml[..element.end].windows(2).rposition(|w| w == b"</")?;
    let inner = &xml[element.open_end + 1..close_start];
    let trimmed = inner.trim_ascii();
    if trimmed.is_empty() {
        None
    } else {
        std::str::from_utf8(trimmed).ok().map(ToOwned::to_owned)
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picture_does_not_read_sibling_blip_fill() {
        let xml = br#"<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Picture"/><xdr:cNvPicPr/></xdr:nvPicPr></xdr:pic><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill>"#;
        let picture = parse_picture(xml, 0).unwrap();

        assert_eq!(picture.blip_fill.embed_id, None);
    }

    #[test]
    fn picture_reads_direct_blip_fill() {
        let xml = br#"<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Picture"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic>"#;
        let picture = parse_picture(xml, 0).unwrap();

        assert_eq!(picture.blip_fill.embed_id, Some("rId1".to_string()));
    }

    #[test]
    fn blip_fill_reads_direct_children_only() {
        let xml = br#"<xdr:blipFill dpi="96">
            <a:extLst>
                <a:ext>
                    <a:blip r:embed="nested"/>
                    <a:srcRect l="9000"/>
                    <a:tile sx="9000"/>
                </a:ext>
            </a:extLst>
            <a:blip r:embed="direct" cstate="print">
                <a:extLst><a:ext><a:grayscl/></a:ext></a:extLst>
                <a:lum bright="1000" contrast="2000"/>
            </a:blip>
            <a:srcRect l="1000" t="2000"/>
            <a:stretch>
                <a:extLst><a:ext><a:fillRect l="9000"/></a:ext></a:extLst>
                <a:fillRect l="3000" r="4000"/>
            </a:stretch>
        </xdr:blipFill>"#;

        let fill = parse_blip_fill(xml);

        assert_eq!(fill.dpi, Some(96));
        assert_eq!(fill.embed_id, Some("direct".to_string()));
        assert_eq!(fill.compression, Some(CompressionState::Print));
        assert_eq!(fill.effects.len(), 1);
        assert!(matches!(
            fill.effects[0],
            BlipEffect::Luminance {
                bright: 1000,
                contrast: 2000
            }
        ));
        assert_eq!(fill.src_rect_explicit, 0b0011);
        let src = fill.source_rect.as_ref().unwrap();
        assert_eq!(
            src.left,
            StPositiveFixedPercentageDecimal::new_unchecked(1000)
        );
        assert_eq!(
            src.top,
            StPositiveFixedPercentageDecimal::new_unchecked(2000)
        );
        match fill.fill_mode {
            Some(FillMode::Stretch {
                fill_rect: Some(rect),
            }) => {
                assert_eq!(
                    rect.left,
                    StPositiveFixedPercentageDecimal::new_unchecked(3000)
                );
                assert_eq!(
                    rect.right,
                    StPositiveFixedPercentageDecimal::new_unchecked(4000)
                );
            }
            other => panic!("expected direct stretch fill rect, got {other:?}"),
        }
    }

    #[test]
    fn blip_effects_capture_direct_color_change_inner_xml() {
        let xml = br#"<a:blip>
            <a:clrChange useA="1"><a:clrFrom><a:srgbClr val="000000"/></a:clrFrom><a:clrTo><a:srgbClr val="FFFFFF"/></a:clrTo></a:clrChange>
        </a:blip>"#;

        let effects = parse_blip_effects(xml);

        assert_eq!(effects.len(), 1);
        let BlipEffect::ColorChange {
            use_alpha,
            raw_xml: Some(raw_xml),
        } = &effects[0]
        else {
            panic!("expected color change effect");
        };
        assert!(*use_alpha);
        assert!(raw_xml.contains("<a:clrFrom>"));
        assert!(raw_xml.contains("<a:clrTo>"));
    }
}
