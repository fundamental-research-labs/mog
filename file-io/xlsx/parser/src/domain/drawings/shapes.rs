//! Shape and connector parsing for drawings.
//!
//! This module handles parsing of shape elements (sp), group shapes (grpSp),
//! and connectors (cxnSp) from drawing XML.

use crate::infra::scanner::{find_closing_tag, find_element_end, find_gt_simd, find_tag_simd};

use super::helpers::{extract_attr_value_in_element, extract_ext_lst_raw, parse_u32};
use super::images::parse_picture;
use super::text::parse_text_body;
use super::transforms::{parse_effect_list, parse_fill, parse_shape_properties, parse_shape_style};
use super::types::{
    BlackWhiteMode, Connection, DrawingContent, DrawingLocking, GraphicFrameNonVisual,
    GroupLocking, GroupShape, GroupTransform2D, Hyperlink, NonVisualProps, ShapePreset,
    SmartArtGraphicFrame, SpreadsheetConnector, SpreadsheetGraphicFrame, SpreadsheetShape,
};
use ooxml_types::drawings::StDrawingElementId;

/// Parse drawing content (pic, sp, grpSp, cxnSp)
pub fn parse_drawing_content(xml: &[u8]) -> DrawingContent {
    // Try to find picture
    if let Some(pic_start) = find_tag_simd(xml, b"pic", 0) {
        if let Some(pic) = parse_picture(xml, pic_start) {
            return DrawingContent::Picture(pic);
        }
    }

    // Try to find group shape BEFORE regular shape (grpSp contains sp elements)
    if let Some(grp_start) = find_tag_simd(xml, b"grpSp", 0) {
        if let Some(group) = parse_group_shape(xml, grp_start) {
            return DrawingContent::GroupShape(group);
        }
    }

    // Try to find mc:AlternateContent wrapping a graphicFrame (e.g., ChartEx).
    // If found, preserve the entire mc:AlternateContent XML verbatim for round-trip.
    // IMPORTANT: This MUST come before the `sp` check below, because mc:Fallback
    // typically contains an `<xdr:sp>` placeholder shape that would be incorrectly
    // matched by find_tag_simd(xml, b"sp", 0), causing the real content (e.g.,
    // ChartEx graphicFrame inside mc:Choice) to be lost.
    if let Some(mc_start) = find_tag_simd(xml, b"AlternateContent", 0) {
        if let Some(mc_end) = find_closing_tag(xml, b"AlternateContent", mc_start) {
            let mc_block = &xml[mc_start..mc_end];
            if find_tag_simd(mc_block, b"graphicFrame", 0).is_some() {
                // Include the full mc:AlternateContent element.
                // find_tag_simd returns the '<' position, so mc_start IS the '<'.
                let mc_gt = find_gt_simd(xml, mc_end).map(|g| g + 1).unwrap_or(mc_end);
                let mc_lt = mc_start;
                if let Ok(raw_xml) = std::str::from_utf8(&xml[mc_lt..mc_gt]) {
                    // Parse nvGraphicFramePr from the graphicFrame inside for metadata
                    let gf_start = find_tag_simd(&xml[mc_lt..mc_gt], b"graphicFrame", 0);
                    let nv = if let Some(gf_s) = gf_start {
                        let gf_abs = mc_lt + gf_s;
                        let gf_end =
                            find_closing_tag(xml, b"graphicFrame", gf_abs).unwrap_or(mc_gt);
                        parse_graphic_frame_nv(&xml[gf_abs..gf_end])
                    } else {
                        Default::default()
                    };
                    let xfrm = if let Some(gf_s) = gf_start {
                        let gf_abs = mc_lt + gf_s;
                        let gf_end =
                            find_closing_tag(xml, b"graphicFrame", gf_abs).unwrap_or(mc_gt);
                        parse_graphic_frame_xfrm(&xml[gf_abs..gf_end])
                    } else {
                        Default::default()
                    };
                    return DrawingContent::GraphicFrame(SpreadsheetGraphicFrame {
                        nv_graphic_frame_pr: nv,
                        xfrm,
                        graphic_xml: Some(raw_xml.to_string()),
                        ..Default::default()
                    });
                }
            }
        }
    }

    // Try to find shape (after grpSp and mc:AlternateContent to avoid matching
    // child shapes in groups or placeholder shapes in mc:Fallback)
    if let Some(sp_start) = find_tag_simd(xml, b"sp", 0) {
        if let Some(shape) = parse_shape(xml, sp_start) {
            return DrawingContent::Shape(shape);
        }
    }

    // Try to find connector
    if let Some(cxn_start) = find_tag_simd(xml, b"cxnSp", 0) {
        if let Some(connector) = parse_connector(xml, cxn_start) {
            return DrawingContent::Connector(connector);
        }
    }

    // Try to find graphicFrame — detect SmartArt vs opaque passthrough
    if let Some(gf_start) = find_tag_simd(xml, b"graphicFrame", 0) {
        if let Some(smartart) = parse_smartart_graphic_frame(xml, gf_start) {
            return DrawingContent::SmartArt(smartart);
        }
        // Not SmartArt — store as opaque graphic frame for roundtrip.
        // Parse nvGraphicFramePr/cNvPr so id, name, and extLst are preserved.
        if let Some(gf_end) = find_closing_tag(xml, b"graphicFrame", gf_start) {
            let element = &xml[gf_start..gf_end];
            // Parse macro attribute from the <xdr:graphicFrame> opening tag.
            // Preserve even empty values (macro="") for round-trip fidelity.
            let macro_name = extract_attr_value_in_element(element, b"macro=\"")
                .map(|v| String::from_utf8_lossy(v).into_owned());
            if let Ok(raw_xml) = std::str::from_utf8(element) {
                return DrawingContent::GraphicFrame(SpreadsheetGraphicFrame {
                    nv_graphic_frame_pr: parse_graphic_frame_nv(element),
                    xfrm: parse_graphic_frame_xfrm(element),
                    graphic_xml: Some(raw_xml.to_string()),
                    macro_name,
                    ..Default::default()
                });
            }
        }
    }

    DrawingContent::Unknown
}

/// Diagram namespace URI used to identify SmartArt in `<a:graphicData uri="...">`.
const DIAGRAM_URI: &[u8] = b"http://schemas.openxmlformats.org/drawingml/2006/diagram";

/// Parse a SmartArt graphicFrame element.
///
/// Returns `Some(SmartArtGraphicFrame)` when the graphicFrame contains a
/// `<a:graphicData>` with `uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"`
/// and a `<dgm:relIds>` child with `r:dm`, `r:lo`, `r:qs`, `r:cs` attributes.
fn parse_smartart_graphic_frame(xml: &[u8], start: usize) -> Option<SmartArtGraphicFrame> {
    let end = find_closing_tag(xml, b"graphicFrame", start)?;
    let element = &xml[start..end];

    // Check for diagram namespace URI in graphicData
    memchr::memmem::find(element, DIAGRAM_URI)?;

    // Find <dgm:relIds> (may also appear without namespace prefix as <relIds>)
    let rel_ids_start = find_tag_simd(element, b"relIds", 0)?;
    let rel_ids_el = &element[rel_ids_start..];

    // Extract the four relationship IDs
    let dm = extract_attr_value_in_element(rel_ids_el, b"r:dm=\"")
        .or_else(|| extract_attr_value_in_element(rel_ids_el, b"dm=\""))
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(|s| s.to_string())
        .unwrap_or_default();

    let lo = extract_attr_value_in_element(rel_ids_el, b"r:lo=\"")
        .or_else(|| extract_attr_value_in_element(rel_ids_el, b"lo=\""))
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(|s| s.to_string())
        .unwrap_or_default();

    let qs = extract_attr_value_in_element(rel_ids_el, b"r:qs=\"")
        .or_else(|| extract_attr_value_in_element(rel_ids_el, b"qs=\""))
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(|s| s.to_string())
        .unwrap_or_default();

    let cs = extract_attr_value_in_element(rel_ids_el, b"r:cs=\"")
        .or_else(|| extract_attr_value_in_element(rel_ids_el, b"cs=\""))
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(|s| s.to_string())
        .unwrap_or_default();

    // All four relationship IDs are required for a valid SmartArt
    if dm.is_empty() || lo.is_empty() || qs.is_empty() || cs.is_empty() {
        return None;
    }

    Some(SmartArtGraphicFrame {
        dm_rel_id: dm,
        lo_rel_id: lo,
        qs_rel_id: qs,
        cs_rel_id: cs,
    })
}

/// Parse a shape element
pub fn parse_shape(xml: &[u8], start: usize) -> Option<SpreadsheetShape> {
    // Find the closing tag - be careful with nested elements
    let end = find_closing_tag(xml, b"sp", start)?;
    let element = &xml[start..end];

    let mut shape = SpreadsheetShape::default();

    // Parse attributes on the <sp> element itself.
    // Preserve empty strings (macro="", textlink="") for round-trip fidelity.
    shape.macro_name = extract_attr_value_in_element(element, b"macro=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(|s| s.to_string());
    shape.textlink = extract_attr_value_in_element(element, b"textlink=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(|s| s.to_string());
    shape.f_locks_text =
        extract_attr_value_in_element(element, b"fLocksText=\"").map(|v| v == b"1" || v == b"true");
    shape.f_published =
        extract_attr_value_in_element(element, b"fPublished=\"").map(|v| v == b"1" || v == b"true");

    // Parse non-visual properties
    if let Some(nv_start) = find_tag_simd(element, b"nvSpPr", 0) {
        shape.nv_sp_pr.c_nv_pr = parse_nv_props(&element[nv_start..]);

        // Parse txBox attribute, spLocks, and extLst from cNvSpPr
        if let Some(cnv_start) = find_tag_simd(&element[nv_start..], b"cNvSpPr", 0) {
            let cnv_abs_start = nv_start + cnv_start;
            // Scope cnv_slice to just the <cNvSpPr> element to avoid capturing
            // extLst or other tags from sibling elements like <spPr>.
            let cnv_slice =
                if let Some(close) = find_closing_tag(element, b"cNvSpPr", cnv_abs_start) {
                    &element[cnv_abs_start..close]
                } else if let Some(tag_end) = find_element_end(element, cnv_abs_start) {
                    &element[cnv_abs_start..=tag_end]
                } else {
                    &element[cnv_abs_start..]
                };
            shape.nv_sp_pr.tx_box = extract_attr_value_in_element(cnv_slice, b"txBox=\"")
                .map(|v| v == b"1" || v == b"true")
                .unwrap_or(false);

            // Parse spLocks element — track presence for round-trip fidelity.
            if let Some(locks_start) = find_tag_simd(cnv_slice, b"spLocks", 0) {
                shape.nv_sp_pr.has_sp_locks = true;
                let locks_scope =
                    if let Some(close) = find_closing_tag(cnv_slice, b"spLocks", locks_start) {
                        &cnv_slice[locks_start..close]
                    } else if let Some(tag_end) = find_element_end(cnv_slice, locks_start) {
                        &cnv_slice[locks_start..=tag_end]
                    } else {
                        &cnv_slice[locks_start..]
                    };
                shape.nv_sp_pr.c_nv_sp_pr = super::images::parse_picture_locking(locks_scope);
                // Track explicit noChangeAspect value for round-trip fidelity.
                // Some(false) preserves `noChangeAspect="0"`.
                shape.nv_sp_pr.no_change_aspect_explicit =
                    extract_attr_value_in_element(locks_scope, b"noChangeAspect=\"")
                        .map(|v| v == b"1" || v == b"true");
            }

            // Capture extLst within cNvSpPr scope
            shape.nv_sp_pr.c_nv_sp_pr_ext_lst = extract_ext_lst_raw(cnv_slice);
        }
    }

    // Parse shape properties — scope to just the spPr element so that
    // find_tag_simd inside parse_shape_properties doesn't pick up tags
    // from sibling elements like txBody (which may contain effectLst in rPr).
    if let Some(sp_start) = find_tag_simd(element, b"spPr", 0) {
        let sp_end = find_closing_tag(element, b"spPr", sp_start).unwrap_or(element.len());
        shape.sp_pr = parse_shape_properties(&element[sp_start..sp_end]);
    }

    // Parse text body
    if let Some(txbody_start) = find_tag_simd(element, b"txBody", 0) {
        shape.tx_body = parse_text_body(&element[txbody_start..]);
    }

    // Parse style
    if let Some(style_start) = find_tag_simd(element, b"style", 0) {
        shape.style = parse_shape_style(&element[style_start..]);
    }

    Some(shape)
}

/// Parse `<xdr:xfrm>` inside a graphicFrame element into a `Transform2D`.
///
/// Extracts `<a:off x= y=>`, `<a:ext cx= cy=>`, and the `rot`, `flipH`, `flipV`
/// attributes from the `<xdr:xfrm>` element itself.
fn parse_graphic_frame_xfrm(element: &[u8]) -> ooxml_types::drawings::Transform2D {
    let mut xfrm = ooxml_types::drawings::Transform2D::default();

    // Find the xfrm element within the graphicFrame
    let Some(xfrm_start) = find_tag_simd(element, b"xfrm", 0) else {
        return xfrm;
    };
    let xfrm_end = find_closing_tag(element, b"xfrm", xfrm_start).unwrap_or(element.len());
    let xfrm_el = &element[xfrm_start..xfrm_end];

    // Parse attributes on <xdr:xfrm>
    xfrm.rotation = extract_attr_value_in_element(xfrm_el, b"rot=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .and_then(|s| s.parse::<i32>().ok())
        .map(ooxml_types::drawings::StAngle::new);
    xfrm.flip_h = extract_attr_value_in_element(xfrm_el, b"flipH=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(|s| s == "1" || s == "true");
    xfrm.flip_v = extract_attr_value_in_element(xfrm_el, b"flipV=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(|s| s == "1" || s == "true");

    // Parse <a:off x= y=>
    if let Some(off_start) = find_tag_simd(xfrm_el, b"off", 0) {
        let off_el = &xfrm_el[off_start..];
        let x = extract_attr_value_in_element(off_el, b"x=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        let y = extract_attr_value_in_element(off_el, b"y=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        xfrm.offset = Some((x, y));
    }

    // Parse <a:ext cx= cy=>
    if let Some(ext_start) = find_tag_simd(xfrm_el, b"ext", 0) {
        let ext_el = &xfrm_el[ext_start..];
        let cx = extract_attr_value_in_element(ext_el, b"cx=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let cy = extract_attr_value_in_element(ext_el, b"cy=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        xfrm.extent = Some((cx, cy));
    }

    xfrm
}

/// Parse a CT_GroupTransform2D element (extends CT_Transform2D with chOff/chExt)
fn parse_group_transform_2d(xml: &[u8]) -> Option<GroupTransform2D> {
    let end = find_closing_tag(xml, b"xfrm", 0)?;
    let element = &xml[..end];

    let mut xfrm = GroupTransform2D::default();

    // Parse attributes
    xfrm.rotation = extract_attr_value_in_element(element, b"rot=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .and_then(|s| s.parse::<i32>().ok())
        .map(ooxml_types::drawings::StAngle::new);
    xfrm.flip_h = extract_attr_value_in_element(element, b"flipH=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(|s| s == "1" || s == "true");
    xfrm.flip_v = extract_attr_value_in_element(element, b"flipV=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(|s| s == "1" || s == "true");

    // Parse off
    if let Some(off_start) = find_tag_simd(element, b"off", 0) {
        let off_el = &element[off_start..];
        let x = extract_attr_value_in_element(off_el, b"x=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        let y = extract_attr_value_in_element(off_el, b"y=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        xfrm.offset = Some((x, y));
    }

    // Parse ext
    if let Some(ext_start) = find_tag_simd(element, b"ext", 0) {
        let ext_el = &element[ext_start..];
        let cx = extract_attr_value_in_element(ext_el, b"cx=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let cy = extract_attr_value_in_element(ext_el, b"cy=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        xfrm.extent = Some((cx, cy));
    }

    // Parse chOff
    if let Some(ch_off_start) = find_tag_simd(element, b"chOff", 0) {
        let ch_el = &element[ch_off_start..];
        let x = extract_attr_value_in_element(ch_el, b"x=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        let y = extract_attr_value_in_element(ch_el, b"y=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        xfrm.child_offset = Some((x, y));
    }

    // Parse chExt
    if let Some(ch_ext_start) = find_tag_simd(element, b"chExt", 0) {
        let ch_el = &element[ch_ext_start..];
        let cx = extract_attr_value_in_element(ch_el, b"cx=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let cy = extract_attr_value_in_element(ch_el, b"cy=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        xfrm.child_extent = Some((cx, cy));
    }

    Some(xfrm)
}

/// Parse CT_GroupLocking attributes from a grpSpLocks element
fn parse_group_locking(xml: &[u8]) -> GroupLocking {
    let mut locks = GroupLocking::default();
    locks.no_grp = extract_attr_value_in_element(xml, b"noGrp=\"")
        .map(|v| v == b"1" || v == b"true")
        .unwrap_or(false);
    locks.no_ungrp = extract_attr_value_in_element(xml, b"noUngrp=\"")
        .map(|v| v == b"1" || v == b"true")
        .unwrap_or(false);
    locks.no_select = extract_attr_value_in_element(xml, b"noSelect=\"")
        .map(|v| v == b"1" || v == b"true")
        .unwrap_or(false);
    locks.no_rot = extract_attr_value_in_element(xml, b"noRot=\"")
        .map(|v| v == b"1" || v == b"true")
        .unwrap_or(false);
    locks.no_change_aspect = extract_attr_value_in_element(xml, b"noChangeAspect=\"")
        .map(|v| v == b"1" || v == b"true")
        .unwrap_or(false);
    locks.no_move = extract_attr_value_in_element(xml, b"noMove=\"")
        .map(|v| v == b"1" || v == b"true")
        .unwrap_or(false);
    locks.no_resize = extract_attr_value_in_element(xml, b"noResize=\"")
        .map(|v| v == b"1" || v == b"true")
        .unwrap_or(false);
    locks
}

/// Parse a group shape element (CT_GroupShape)
pub fn parse_group_shape(xml: &[u8], start: usize) -> Option<GroupShape> {
    let end = find_closing_tag(xml, b"grpSp", start)?;
    let element = &xml[start..end];

    let mut group = GroupShape::default();

    // Parse non-visual properties
    if let Some(nv_start) = find_tag_simd(element, b"nvGrpSpPr", 0) {
        if let Some(nv_end) = find_closing_tag(element, b"nvGrpSpPr", nv_start) {
            let nv_element = &element[nv_start..nv_end];
            group.nv_grp_sp_pr.c_nv_pr = parse_nv_props(nv_element);

            // Parse cNvGrpSpPr
            if let Some(cnv_start) = find_tag_simd(nv_element, b"cNvGrpSpPr", 0) {
                let cnv_el = &nv_element[cnv_start..];
                // Parse grpSpLocks
                if let Some(locks_start) = find_tag_simd(cnv_el, b"grpSpLocks", 0) {
                    group.nv_grp_sp_pr.c_nv_grp_sp_pr =
                        Some(parse_group_locking(&cnv_el[locks_start..]));
                }
            }
        }
    }

    // Parse group shape properties
    if let Some(grp_start) = find_tag_simd(element, b"grpSpPr", 0) {
        if let Some(grp_end) = find_closing_tag(element, b"grpSpPr", grp_start) {
            let grp_element = &element[grp_start..grp_end];

            // Parse bwMode attribute
            group.grp_sp_pr.bw_mode = extract_attr_value_in_element(grp_element, b"bwMode=\"")
                .and_then(|v| std::str::from_utf8(v).ok())
                .map(|s| BlackWhiteMode::from_ooxml(s));

            // Parse group transform (CT_GroupTransform2D with chOff/chExt)
            if let Some(xfrm_start) = find_tag_simd(grp_element, b"xfrm", 0) {
                group.grp_sp_pr.xfrm = parse_group_transform_2d(&grp_element[xfrm_start..]);
            }

            // Parse fill using typed DrawingFill parser (same as shapes)
            group.grp_sp_pr.fill = parse_fill(grp_element);

            // Parse effect list using typed EffectList parser (same as shapes)
            if let Some(eff_start) = find_tag_simd(grp_element, b"effectLst", 0) {
                group.grp_sp_pr.effects = parse_effect_list(&grp_element[eff_start..])
                    .map(ooxml_types::drawings::EffectProperties::EffectList);
            }

            // Parse scene3d into typed struct
            if let Some(s3d_start) = find_tag_simd(grp_element, b"scene3d", 0) {
                if let Some(s3d_end) = find_closing_tag(grp_element, b"scene3d", s3d_start) {
                    group.grp_sp_pr.scene3d =
                        super::three_d::parse_scene3d(&grp_element[s3d_start..s3d_end]);
                }
            }

            // Capture extLst as opaque XML
            if let Some(ext_start) = find_tag_simd(grp_element, b"extLst", 0) {
                if let Some(ext_end) = find_closing_tag(grp_element, b"extLst", ext_start) {
                    group.grp_sp_pr.ext_lst = std::str::from_utf8(&grp_element[ext_start..ext_end])
                        .ok()
                        .map(|s| s.to_string());
                }
            }
        }
    }

    // Parse child elements - skip past grpSpPr to find child elements
    let child_start = find_closing_tag(element, b"grpSpPr", 0).unwrap_or(0);
    let child_element = &element[child_start..];

    // Find all child pictures
    let mut pos = 0;
    while let Some(pic_pos) = find_tag_simd(child_element, b"pic", pos) {
        if let Some(pic) = parse_picture(child_element, pic_pos) {
            group.children.push(DrawingContent::Picture(pic));
        }
        pos = pic_pos + 1;
    }

    // Find all child shapes
    pos = 0;
    while let Some(sp_pos) = find_tag_simd(child_element, b"sp", pos) {
        // Make sure it's not spPr
        if sp_pos + 3 < child_element.len() && child_element[sp_pos + 3] != b'P' {
            if let Some(shape) = parse_shape(child_element, sp_pos) {
                group.children.push(DrawingContent::Shape(shape));
            }
        }
        pos = sp_pos + 1;
    }

    // Find all child connectors
    pos = 0;
    while let Some(cxn_pos) = find_tag_simd(child_element, b"cxnSp", pos) {
        if let Some(connector) = parse_connector(child_element, cxn_pos) {
            group.children.push(DrawingContent::Connector(connector));
        }
        pos = cxn_pos + 1;
    }

    // Find all nested group shapes (recursive)
    pos = 0;
    while let Some(grp_pos) = find_tag_simd(child_element, b"grpSp", pos) {
        if let Some(nested_group) = parse_group_shape(child_element, grp_pos) {
            group
                .children
                .push(DrawingContent::GroupShape(nested_group));
        }
        // Skip past the closing tag to avoid re-matching
        if let Some(grp_end) = find_closing_tag(child_element, b"grpSp", grp_pos) {
            pos = grp_end;
        } else {
            pos = grp_pos + 1;
        }
    }

    // Find all graphic frames (opaque capture)
    pos = 0;
    while let Some(gf_pos) = find_tag_simd(child_element, b"graphicFrame", pos) {
        if let Some(gf_end) = find_closing_tag(child_element, b"graphicFrame", gf_pos) {
            let element = &child_element[gf_pos..gf_end];
            let macro_name = extract_attr_value_in_element(element, b"macro=\"")
                .map(|v| String::from_utf8_lossy(v).into_owned());
            if let Ok(raw_xml) = std::str::from_utf8(element) {
                group
                    .children
                    .push(DrawingContent::GraphicFrame(SpreadsheetGraphicFrame {
                        nv_graphic_frame_pr: parse_graphic_frame_nv(element),
                        xfrm: parse_graphic_frame_xfrm(element),
                        graphic_xml: Some(raw_xml.to_string()),
                        macro_name,
                        ..Default::default()
                    }));
            }
            pos = gf_end;
        } else {
            pos = gf_pos + 1;
        }
    }

    Some(group)
}

/// Parse a connector element
pub fn parse_connector(xml: &[u8], start: usize) -> Option<SpreadsheetConnector> {
    let end = find_closing_tag(xml, b"cxnSp", start)?;
    let element = &xml[start..end];

    let mut connector = SpreadsheetConnector::default();

    // Parse macro attribute from <cxnSp> — preserve empty strings for round-trip (macro="")
    connector.macro_name = extract_attr_value_in_element(element, b"macro=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(|s| s.to_string());

    // Parse fPublished attribute from <cxnSp>
    connector.f_published =
        extract_attr_value_in_element(element, b"fPublished=\"").map(|v| v == b"1" || v == b"true");

    // Parse non-visual properties
    if let Some(nv_start) = find_tag_simd(element, b"nvCxnSpPr", 0) {
        connector.nv_cxn_sp_pr.c_nv_pr = parse_nv_props(&element[nv_start..]);

        // Parse connection info
        let nv_element = &element[nv_start..];
        if let Some(st_start) = find_tag_simd(nv_element, b"stCxn", 0) {
            connector.nv_cxn_sp_pr.st_cxn = parse_connection(&nv_element[st_start..]);
        }
        if let Some(end_start) = find_tag_simd(nv_element, b"endCxn", 0) {
            connector.nv_cxn_sp_pr.end_cxn = parse_connection(&nv_element[end_start..]);
        }

        // Parse cNvCxnSpPr: locking properties, connections, and extLst
        if let Some(cnv_start) = find_tag_simd(nv_element, b"cNvCxnSpPr", 0) {
            let cnv_slice = &nv_element[cnv_start..];
            if let Some(locks_start) = find_tag_simd(cnv_slice, b"cxnSpLocks", 0) {
                connector.nv_cxn_sp_pr.c_nv_cxn_sp_pr =
                    parse_connector_locking(&cnv_slice[locks_start..]);
            }
            // Capture extLst within cNvCxnSpPr scope
            connector.nv_cxn_sp_pr.c_nv_cxn_sp_pr_ext_lst = extract_ext_lst_raw(cnv_slice);
        }
    }

    // Parse shape properties — scope to just the spPr element
    if let Some(sp_start) = find_tag_simd(element, b"spPr", 0) {
        let sp_end = find_closing_tag(element, b"spPr", sp_start).unwrap_or(element.len());
        connector.sp_pr = parse_shape_properties(&element[sp_start..sp_end]);
    }

    // Parse style
    if let Some(style_start) = find_tag_simd(element, b"style", 0) {
        connector.style = parse_shape_style(&element[style_start..]);
    }

    Some(connector)
}

/// Parse non-visual properties
pub fn parse_nv_props(xml: &[u8]) -> NonVisualProps {
    let mut props = NonVisualProps::default();

    // Find cNvPr element
    if let Some(cnv_start) = find_tag_simd(xml, b"cNvPr", 0) {
        let element = &xml[cnv_start..];

        props.id = StDrawingElementId::new(
            extract_attr_value_in_element(element, b"id=\"")
                .and_then(|v| parse_u32(v))
                .unwrap_or(0),
        );

        props.name = extract_attr_value_in_element(element, b"name=\"")
            .map(|v| super::helpers::decode_xml_entities(v))
            .unwrap_or_default();

        props.descr = extract_attr_value_in_element(element, b"descr=\"")
            .map(|v| super::helpers::decode_xml_entities(v));

        props.title = extract_attr_value_in_element(element, b"title=\"")
            .map(|v| super::helpers::decode_xml_entities(v));

        props.hidden = extract_attr_value_in_element(element, b"hidden=\"")
            .map(|v| v == b"1" || v == b"true")
            .unwrap_or(false);

        // Parse hyperlink on click
        if let Some(hlink_start) = find_tag_simd(element, b"hlinkClick", 0) {
            props.hlink_click = Some(parse_hyperlink(&element[hlink_start..]));
        }

        // Parse hyperlink on hover
        if let Some(hlink_start) = find_tag_simd(element, b"hlinkHover", 0) {
            props.hlink_hover = Some(parse_hyperlink(&element[hlink_start..]));
        }

        // Parse extLst within cNvPr scope
        // Determine cNvPr element boundary: either closing tag or self-closing
        if let Some(cnv_end) = find_closing_tag(xml, b"cNvPr", cnv_start) {
            let cnv_scope = &xml[cnv_start..cnv_end];
            props.ext_lst = extract_ext_lst_raw(cnv_scope);
        }
    }

    props
}

/// Parse non-visual properties for a graphic frame (`nvGraphicFramePr`).
///
/// Extracts `cNvPr` (id, name, extLst) and `cNvGraphicFramePr` (graphicFrameLocks
/// attributes + extLst) for round-trip fidelity.
fn parse_graphic_frame_nv(xml: &[u8]) -> GraphicFrameNonVisual {
    let mut result = GraphicFrameNonVisual {
        c_nv_pr: parse_nv_props(xml),
        ..Default::default()
    };

    // Parse <xdr:cNvGraphicFramePr> → <a:graphicFrameLocks .../> + extLst
    if let Some(cnvgfp_start) = find_tag_simd(xml, b"cNvGraphicFramePr", 0) {
        if let Some(cnvgfp_end) = find_closing_tag(xml, b"cNvGraphicFramePr", cnvgfp_start) {
            let scope = &xml[cnvgfp_start..cnvgfp_end];

            // Parse <a:graphicFrameLocks> attributes (CT_GraphicalObjectFrameLocking)
            if let Some(locks_start) = find_tag_simd(scope, b"graphicFrameLocks", 0) {
                result.has_graphic_frame_locks = true;
                let locks_xml = &scope[locks_start..];
                let parse_bool = |attr: &[u8]| -> bool {
                    extract_attr_value_in_element(locks_xml, attr)
                        .map(|v| v == b"1" || v == b"true")
                        .unwrap_or(false)
                };
                // Track noChangeAspect as Option<bool> — Some(false) when explicitly "0",
                // Some(true) when "1", None when absent.
                result.no_change_aspect_explicit =
                    extract_attr_value_in_element(locks_xml, b"noChangeAspect=\"")
                        .map(|v| v == b"1" || v == b"true");
                result.c_nv_graphic_frame_pr = DrawingLocking {
                    no_grp: parse_bool(b"noGrp=\""),
                    no_select: parse_bool(b"noSelect=\""),
                    no_change_aspect: parse_bool(b"noChangeAspect=\""),
                    no_move: parse_bool(b"noMove=\""),
                    no_resize: parse_bool(b"noResize=\""),
                    ext_lst: extract_ext_lst_raw(locks_xml),
                    ..Default::default()
                };
                result.no_drilldown = parse_bool(b"noDrilldown=\"");
            }

            // Parse extLst directly under cNvGraphicFramePr (sibling of graphicFrameLocks)
            // Only capture extLst that is NOT inside graphicFrameLocks
            // The spec places extLst as a child of CT_NonVisualGraphicFrameProperties
            result.c_nv_graphic_frame_pr_ext_lst = extract_ext_lst_raw(scope);
        }
    }

    result
}

/// Parse a hyperlink element (`hlinkClick` or `hlinkHover`)
///
/// `xml` starts at the opening `<` of the hyperlink tag (e.g. `<a:hlinkClick ...`).
/// We must scope the extLst search to just this element — not sibling elements.
fn parse_hyperlink(xml: &[u8]) -> Hyperlink {
    let mut hlink = Hyperlink::default();

    hlink.r_id = extract_attr_value_in_element(xml, b"r:id=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());

    hlink.action = extract_attr_value_in_element(xml, b"action=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());

    hlink.tooltip = extract_attr_value_in_element(xml, b"tooltip=\"")
        .map(|v| super::helpers::decode_xml_entities(v))
        .filter(|s| !s.is_empty());

    // Parse extLst ONLY within the hyperlink element scope.
    // If the element is self-closing (<a:hlinkClick .../>) there are no children.
    // Only search for extLst if there's a closing tag (non-self-closing).
    // Use hlinkClick or hlinkHover as the tag name for scoping.
    let tag_name = if memchr::memmem::find(xml, b"hlinkClick").is_some() {
        b"hlinkClick" as &[u8]
    } else {
        b"hlinkHover" as &[u8]
    };
    if let Some(close_pos) = find_closing_tag(xml, tag_name, 0) {
        // Element has children — scope extLst search to within the element
        let scoped = &xml[..close_pos];
        hlink.ext_lst = extract_ext_lst_raw(scoped);
    }
    // else: self-closing element, no extLst possible

    hlink
}

/// Parse connector locking properties from `<cxnSpLocks>` element
fn parse_connector_locking(xml: &[u8]) -> DrawingLocking {
    let parse_bool_attr = |attr: &[u8]| -> bool {
        extract_attr_value_in_element(xml, attr)
            .map(|v| v == b"1" || v == b"true")
            .unwrap_or(false)
    };

    DrawingLocking {
        no_grp: parse_bool_attr(b"noGrp=\""),
        no_select: parse_bool_attr(b"noSelect=\""),
        no_rot: parse_bool_attr(b"noRot=\""),
        no_change_aspect: parse_bool_attr(b"noChangeAspect=\""),
        no_move: parse_bool_attr(b"noMove=\""),
        no_resize: parse_bool_attr(b"noResize=\""),
        no_edit_points: parse_bool_attr(b"noEditPoints=\""),
        no_adjust_handles: parse_bool_attr(b"noAdjustHandles=\""),
        no_change_arrowheads: parse_bool_attr(b"noChangeArrowheads=\""),
        no_change_shape_type: parse_bool_attr(b"noChangeShapeType=\""),
        ext_lst: extract_ext_lst_raw(xml),
        ..Default::default()
    }
}

/// Parse connection
fn parse_connection(xml: &[u8]) -> Option<Connection> {
    let shape_id = extract_attr_value_in_element(xml, b"id=\"").and_then(|v| parse_u32(v))?;

    let idx = extract_attr_value_in_element(xml, b"idx=\"")
        .and_then(|v| parse_u32(v))
        .unwrap_or(0);

    Some(Connection { shape_id, idx })
}

/// Parse shape preset from string, delegating to `ShapePreset::from_ooxml()`.
pub fn parse_shape_preset(bytes: &[u8]) -> Option<ShapePreset> {
    let s = std::str::from_utf8(bytes).ok()?;
    ShapePreset::from_ooxml(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::scanner::find_tag_simd;
    use ooxml_types::drawings::{
        CompoundLine, LineCap, LineEndSize, LineEndType, LineJoin, StDrawingElementId,
        StStyleMatrixColumnIndex,
    };

    use super::super::types::SpreadsheetConnector;

    /// Helper: wrap XML in a `<cxnSp>...</cxnSp>` element and call `parse_connector`.
    fn connector_from_xml(inner: &str) -> SpreadsheetConnector {
        let xml = format!("<cxnSp>{}</cxnSp>", inner);
        let bytes = xml.as_bytes();
        let start = find_tag_simd(bytes, b"cxnSp", 0).expect("cxnSp tag not found");
        parse_connector(bytes, start).expect("parse_connector returned None")
    }

    #[test]
    fn test_connector_with_locks() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Connector 1"/>
                <cNvCxnSpPr>
                    <a:cxnSpLocks noMove="1" noResize="1" noChangeArrowheads="1"/>
                </cNvCxnSpPr>
            </nvCxnSpPr>
            <spPr/>
            "#,
        );
        assert!(c.nv_cxn_sp_pr.c_nv_cxn_sp_pr.no_move);
        assert!(c.nv_cxn_sp_pr.c_nv_cxn_sp_pr.no_resize);
        assert!(c.nv_cxn_sp_pr.c_nv_cxn_sp_pr.no_change_arrowheads);
        assert!(!c.nv_cxn_sp_pr.c_nv_cxn_sp_pr.no_grp);
        assert!(!c.nv_cxn_sp_pr.c_nv_cxn_sp_pr.no_select);
        assert!(!c.nv_cxn_sp_pr.c_nv_cxn_sp_pr.no_rot);
    }

    #[test]
    fn test_connector_with_arrowheads() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Arrow"/>
                <cNvCxnSpPr/>
            </nvCxnSpPr>
            <spPr>
                <a:ln w="12700">
                    <a:headEnd type="triangle" w="med" len="lg"/>
                    <a:tailEnd type="stealth" w="sm" len="sm"/>
                </a:ln>
            </spPr>"#,
        );
        let outline = c.sp_pr.ln.expect("ln missing");
        let head = outline.head_end.expect("head_end missing");
        assert_eq!(head.end_type, Some(LineEndType::Triangle));
        assert_eq!(head.width, Some(LineEndSize::Medium));
        assert_eq!(head.length, Some(LineEndSize::Large));

        let tail = outline.tail_end.expect("tail_end missing");
        assert_eq!(tail.end_type, Some(LineEndType::Stealth));
        assert_eq!(tail.width, Some(LineEndSize::Small));
        assert_eq!(tail.length, Some(LineEndSize::Small));
    }

    #[test]
    fn test_connector_with_connections() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Cxn"/>
                <cNvCxnSpPr>
                    <a:stCxn id="5" idx="2"/>
                    <a:endCxn id="8" idx="0"/>
                </cNvCxnSpPr>
            </nvCxnSpPr>
            <spPr/>"#,
        );
        let st = c.nv_cxn_sp_pr.st_cxn.expect("st_cxn missing");
        assert_eq!(st.shape_id, 5);
        assert_eq!(st.idx, 2);

        let en = c.nv_cxn_sp_pr.end_cxn.expect("end_cxn missing");
        assert_eq!(en.shape_id, 8);
        assert_eq!(en.idx, 0);
    }

    #[test]
    fn test_connector_with_cap_and_compound() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Line"/>
                <cNvCxnSpPr/>
            </nvCxnSpPr>
            <spPr>
                <a:ln w="25400" cap="rnd" cmpd="dbl">
                    <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
                </a:ln>
            </spPr>"#,
        );
        let outline = c.sp_pr.ln.expect("ln missing");
        assert_eq!(outline.cap, Some(LineCap::Round));
        assert_eq!(outline.compound, Some(CompoundLine::Double));
    }

    #[test]
    fn test_connector_with_miter_join() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Miter"/>
                <cNvCxnSpPr/>
            </nvCxnSpPr>
            <spPr>
                <a:ln w="12700">
                    <a:miter lim="800000"/>
                </a:ln>
            </spPr>"#,
        );
        let outline = c.sp_pr.ln.expect("ln missing");
        match outline.join {
            Some(LineJoin::Miter { limit }) => assert_eq!(limit, Some(800000)),
            other => panic!("Expected Miter join, got {:?}", other),
        }
    }

    #[test]
    fn test_connector_with_title_and_hyperlink() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Flow" title="Flow arrow">
                    <a:hlinkClick r:id="rId1" tooltip="Click me"/>
                </cNvPr>
                <cNvCxnSpPr/>
            </nvCxnSpPr>
            <spPr/>"#,
        );
        assert_eq!(c.nv_cxn_sp_pr.c_nv_pr.title.as_deref(), Some("Flow arrow"));
        let hlink = c
            .nv_cxn_sp_pr
            .c_nv_pr
            .hlink_click
            .as_ref()
            .expect("hlinkClick missing");
        assert_eq!(hlink.r_id.as_deref(), Some("rId1"));
        assert_eq!(hlink.tooltip.as_deref(), Some("Click me"));
    }

    #[test]
    fn test_connector_with_style() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Styled"/>
                <cNvCxnSpPr/>
            </nvCxnSpPr>
            <spPr/>
            <style>
                <a:lnRef idx="2">
                    <a:schemeClr val="accent1"/>
                </a:lnRef>
                <a:fillRef idx="0">
                    <a:schemeClr val="accent1"/>
                </a:fillRef>
                <a:effectRef idx="1">
                    <a:schemeClr val="accent1"/>
                </a:effectRef>
                <a:fontRef idx="0">
                    <a:schemeClr val="dk1"/>
                </a:fontRef>
            </style>"#,
        );
        let style = c.style.expect("style missing");
        assert_eq!(style.line_ref.idx, StStyleMatrixColumnIndex::new(2));
        assert_eq!(style.fill_ref.idx, StStyleMatrixColumnIndex::new(0));
    }

    #[test]
    fn test_connector_with_macro() {
        let c = connector_from_xml(
            r#" macro="ConnectorMacro"><nvCxnSpPr>
                <cNvPr id="10" name="MacroCxn"/>
                <cNvCxnSpPr/>
            </nvCxnSpPr>
            <spPr/>"#,
        );
        assert_eq!(c.macro_name.as_deref(), Some("ConnectorMacro"));
    }

    #[test]
    fn test_minimal_connector() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="1" name="Connector"/>
                <cNvCxnSpPr/>
            </nvCxnSpPr>
            <spPr/>"#,
        );
        assert_eq!(c.nv_cxn_sp_pr.c_nv_pr.id, StDrawingElementId::new(1));
        assert_eq!(c.nv_cxn_sp_pr.c_nv_pr.name, "Connector");
        assert!(c.nv_cxn_sp_pr.st_cxn.is_none());
        assert!(c.nv_cxn_sp_pr.end_cxn.is_none());
        assert!(c.style.is_none());
        assert!(c.macro_name.is_none());
        assert!(!c.nv_cxn_sp_pr.c_nv_cxn_sp_pr.no_move);
        assert!(c.nv_cxn_sp_pr.c_nv_pr.title.is_none());
        assert!(c.nv_cxn_sp_pr.c_nv_pr.hlink_click.is_none());
        assert!(c.sp_pr.ln.is_none());
    }
}
