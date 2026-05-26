//! Conversion from read-side drawing types to write-side drawing types.
//!
//! This module provides conversion functions to map parsed (read-side) connector
//! and picture types into their write-side equivalents for round-trip XLSX preservation.
//!
//! UTF-8 boundary guard: the two `&s[..n]` / `&s[n..]` slices in this file
//! split drawing attribute strings at ASCII-only delimiter positions.
//! Char-boundary by construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use super::types as write;
use crate::domain::drawings as read;
use ooxml_types::drawings as ooxml;

// =============================================================================
// Public API
// =============================================================================

/// Convert a read-side `SpreadsheetPicture` into a write-side `ImageProps`.
pub fn picture_to_image_props(p: &read::SpreadsheetPicture) -> write::ImageProps {
    let xfrm = p.sp_pr.xfrm.as_ref();

    write::ImageProps {
        // Identity
        original_id: Some(p.nv_pic_pr.c_nv_pr.id.value()),
        name: p.nv_pic_pr.c_nv_pr.name.clone(),
        description: p.nv_pic_pr.c_nv_pr.descr.clone(),
        r_id: p.blip_fill.embed_id.clone().unwrap_or_default(),

        // Transform
        rotation: xfrm.and_then(|t| {
            if t.rot().value() != 0 {
                Some(t.rot().value())
            } else {
                None
            }
        }),
        offset_x: xfrm.map_or(0, |t| t.off_x()),
        offset_y: xfrm.map_or(0, |t| t.off_y()),
        extent_cx: xfrm.map_or(0, |t| t.ext_cx() as i64),
        extent_cy: xfrm.map_or(0, |t| t.ext_cy() as i64),
        flip_h: xfrm.map_or(false, |t| t.is_flip_h()),
        flip_v: xfrm.map_or(false, |t| t.is_flip_v()),

        // BlipFill
        source_rect: p.blip_fill.source_rect,
        src_rect_explicit: p.blip_fill.src_rect_explicit,
        blip_effects: p.blip_fill.effects.clone(),
        fill_mode: p.blip_fill.fill_mode.clone(),
        compression: p.blip_fill.compression,
        link_id: p.blip_fill.link_id.clone(),
        dpi: p.blip_fill.dpi,
        rot_with_shape: p.blip_fill.rot_with_shape,
        blip_ext_lst: p.blip_fill.ext_lst.clone(),

        // Locking
        locks: p.nv_pic_pr.locks.clone(),
        has_pic_locks: p.nv_pic_pr.has_pic_locks,
        prefer_relative_resize: p.nv_pic_pr.prefer_relative_resize,

        // NonVisual extras
        title: p.nv_pic_pr.c_nv_pr.title.clone(),
        hidden: p.nv_pic_pr.c_nv_pr.hidden,
        hlink_click: p.nv_pic_pr.c_nv_pr.hlink_click.clone(),
        hlink_hover: p.nv_pic_pr.c_nv_pr.hlink_hover.clone(),
        nv_ext_lst: p.nv_pic_pr.c_nv_pr.ext_lst.clone(),

        // Shape properties — read-side types are now ooxml-types re-exports,
        // so we clone directly without conversion.
        preset_geometry: p.sp_pr.geometry.as_ref().and_then(|g| match g {
            ooxml::ShapeGeometry::Preset(pg) => Some(pg.clone()),
            _ => None,
        }),
        fill: p.sp_pr.fill.clone(),
        outline: p.sp_pr.ln.clone(),
        effects: p.sp_pr.effects.clone(),
        bw_mode: p.sp_pr.bw_mode,
        scene3d: p.sp_pr.scene3d.clone(),
        sp3d: p.sp_pr.sp3d.clone(),
        sp_pr_ext_lst: p.sp_pr.ext_lst.clone(),

        // Style & metadata
        style: p.style.clone(),
        macro_name: p.macro_name.clone(),
    }
}

/// Convert a read-side `TwoCellAnchor` into a write-side `TwoCellAnchor`.
///
/// The anchor structs differ structurally: read-side embeds `DrawingContent`,
/// write-side separates content into `DrawingObject`. Geometry types (`CellAnchor`,
/// `Extent`, `Position`) are now shared re-exports from ooxml-types, so they
/// can be cloned directly.
pub fn convert_two_cell_anchor(a: &read::TwoCellAnchor) -> write::TwoCellAnchor {
    write::TwoCellAnchor {
        from: a.from.clone(),
        to: a.to.clone(),
        edit_as: a.edit_as,
        client_data: a.client_data,
        mc_alternate_content: a.mc_alternate_content.clone(),
    }
}

/// Convert a read-side `OneCellAnchor` into a write-side `OneCellAnchor`.
pub fn convert_one_cell_anchor(a: &read::OneCellAnchor) -> write::OneCellAnchor {
    write::OneCellAnchor {
        from: a.from.clone(),
        extent: a.extent.clone(),
        client_data: a.client_data,
        mc_alternate_content: a.mc_alternate_content.clone(),
    }
}

/// Convert a read-side `AbsoluteAnchor` into a write-side `AbsoluteAnchor`.
pub fn convert_absolute_anchor(a: &read::AbsoluteAnchor) -> write::AbsoluteAnchor {
    write::AbsoluteAnchor {
        pos: a.pos.clone(),
        extent: a.extent.clone(),
        client_data: a.client_data,
    }
}

/// Convert a read-side `GroupShape` into a write-side `GroupShapeProps`.
pub fn group_shape_to_props(g: &read::GroupShape) -> write::GroupShapeProps {
    write::GroupShapeProps {
        // Non-visual identity
        original_id: Some(g.nv_grp_sp_pr.c_nv_pr.id.value()),
        name: g.nv_grp_sp_pr.c_nv_pr.name.clone(),
        description: g.nv_grp_sp_pr.c_nv_pr.descr.clone(),
        title: g.nv_grp_sp_pr.c_nv_pr.title.clone(),
        hidden: g.nv_grp_sp_pr.c_nv_pr.hidden,
        hlink_click: g.nv_grp_sp_pr.c_nv_pr.hlink_click.clone(),
        hlink_hover: g.nv_grp_sp_pr.c_nv_pr.hlink_hover.clone(),

        // Group-specific NV props
        group_locking: g.nv_grp_sp_pr.c_nv_grp_sp_pr.clone(),
        nv_ext_lst: None,

        // Group shape properties
        transform: g.grp_sp_pr.xfrm.clone(),
        fill: g.grp_sp_pr.fill.clone(),
        effects: g.grp_sp_pr.effects.clone(),
        bw_mode: g.grp_sp_pr.bw_mode,
        scene3d: g.grp_sp_pr.scene3d.clone(),
        ext_lst: g.grp_sp_pr.ext_lst.clone(),

        // Recursively convert children — inside groups, graphic frames stay opaque
        // (no chart promotion) so they round-trip as raw XML.
        children: g
            .children
            .iter()
            .filter_map(|c| convert_drawing_content_for_group(c))
            .collect(),
    }
}

/// Convert a read-side `SpreadsheetShape` into a write-side `TextBox`.
///
/// Handles both text boxes (txBox=true) and general shapes with text content.
/// All shape properties are preserved for full round-trip fidelity.
pub fn shape_to_text_box(s: &read::SpreadsheetShape) -> write::TextBox {
    write::TextBox {
        // Non-visual identity (cNvPr)
        original_id: Some(s.nv_sp_pr.c_nv_pr.id.value()),
        name: s.nv_sp_pr.c_nv_pr.name.clone(),
        description: s.nv_sp_pr.c_nv_pr.descr.clone(),
        title: s.nv_sp_pr.c_nv_pr.title.clone(),
        hidden: s.nv_sp_pr.c_nv_pr.hidden,
        hlink_click: s.nv_sp_pr.c_nv_pr.hlink_click.clone(),
        hlink_hover: s.nv_sp_pr.c_nv_pr.hlink_hover.clone(),
        nv_ext_lst: s.nv_sp_pr.c_nv_pr.ext_lst.clone(),

        // Shape-specific NV props (cNvSpPr)
        tx_box: s.nv_sp_pr.tx_box,
        c_nv_sp_pr: s.nv_sp_pr.c_nv_sp_pr.clone(),
        has_sp_locks: s.nv_sp_pr.has_sp_locks,
        no_change_aspect_explicit: s.nv_sp_pr.no_change_aspect_explicit,
        c_nv_sp_pr_ext_lst: s.nv_sp_pr.c_nv_sp_pr_ext_lst.clone(),

        // Shape properties (spPr)
        xfrm: s.sp_pr.xfrm.clone(),
        preset_geometry: s.sp_pr.geometry.as_ref().and_then(|g| match g {
            ooxml::ShapeGeometry::Preset(pg) => Some(pg.clone()),
            _ => None,
        }),
        fill: s.sp_pr.fill.clone(),
        outline: s.sp_pr.ln.clone(),
        effects: s.sp_pr.effects.clone(),
        bw_mode: s.sp_pr.bw_mode,
        scene3d: s.sp_pr.scene3d.clone(),
        sp3d: s.sp_pr.sp3d.clone(),
        sp_pr_ext_lst: s.sp_pr.ext_lst.clone(),

        // Style & content
        style: s.style.clone(),
        text_body: s.tx_body.clone(),
        macro_name: s.macro_name.clone(),
        textlink: s.textlink.clone(),
        f_locks_text: s.f_locks_text,
        f_published: s.f_published,
    }
}

/// Convert a read-side `DrawingContent` to a write-side `DrawingObject` inside a group shape.
///
/// Unlike [`convert_drawing_content`], this keeps `GraphicFrame` elements opaque
/// (no chart promotion) so they survive as raw XML children of the group.
fn convert_drawing_content_for_group(
    content: &read::DrawingContent,
) -> Option<write::DrawingObject> {
    match content {
        read::DrawingContent::GraphicFrame(gf) => {
            // Always keep as opaque GraphicFrame inside groups
            Some(write::DrawingObject::GraphicFrame(
                write::OpaqueGraphicFrame {
                    raw_xml: gf.graphic_xml.clone().unwrap_or_default(),
                },
            ))
        }
        // Delegate everything else to the standard converter
        other => convert_drawing_content(other),
    }
}

/// Convert a read-side `DrawingContent` to a write-side `DrawingObject`.
///
/// Returns `None` for `DrawingContent::Unknown` (cannot be roundtripped).
pub fn convert_drawing_content(content: &read::DrawingContent) -> Option<write::DrawingObject> {
    match content {
        read::DrawingContent::Picture(p) => {
            Some(write::DrawingObject::Picture(picture_to_image_props(p)))
        }
        read::DrawingContent::Shape(s) => Some(write::DrawingObject::TextBox(shape_to_text_box(s))),
        read::DrawingContent::GroupShape(g) => {
            Some(write::DrawingObject::GroupShape(group_shape_to_props(g)))
        }
        read::DrawingContent::Connector(c) => {
            Some(write::DrawingObject::Connector(connector_to_props(c)))
        }
        read::DrawingContent::GraphicFrame(gf) => {
            // Check if this GraphicFrame contains a chart reference
            if let Some(chart_ref) = extract_chart_ref_from_graphic_frame(gf) {
                Some(write::DrawingObject::Chart(chart_ref))
            } else {
                Some(write::DrawingObject::GraphicFrame(
                    write::OpaqueGraphicFrame {
                        raw_xml: gf.graphic_xml.clone().unwrap_or_default(),
                    },
                ))
            }
        }
        read::DrawingContent::SmartArt(sa) => {
            // SmartArt conversion — creates a placeholder SmartArtWriteData with
            // the original relationship IDs preserved. The actual XML parts will be
            // populated by the caller using the drawing's smartart_diagrams vec.
            Some(write::DrawingObject::SmartArt(write::SmartArtWriteData {
                original_id: None,
                name: String::new(), // will be set by caller if needed
                dm_rel_id: sa.dm_rel_id.clone(),
                lo_rel_id: sa.lo_rel_id.clone(),
                qs_rel_id: sa.qs_rel_id.clone(),
                cs_rel_id: sa.cs_rel_id.clone(),
                data_xml: None,
                layout_xml: None,
                colors_xml: None,
                style_xml: None,
                drawing_xml: None,
            }))
        }
        read::DrawingContent::Unknown => None,
    }
}

/// Extract a chart reference from a GraphicFrame if it contains a chart URI.
///
/// Detects `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">`
/// and extracts the `r:id` attribute from `<c:chart r:id="..."/>`.
pub fn extract_chart_ref_from_graphic_frame(
    gf: &ooxml::SpreadsheetGraphicFrame,
) -> Option<write::ChartRef> {
    let xml = gf.graphic_xml.as_ref()?;

    // Check for chart namespace URI in graphicData
    const CHART_URI: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";
    if !xml.contains(CHART_URI) {
        return None;
    }

    // Extract r:id from <c:chart r:id="rIdN"/> or similar
    let r_id = extract_r_id_from_chart_xml(xml)?;
    let name = gf.nv_graphic_frame_pr.c_nv_pr.name.clone();

    // Extract transform for round-trip fidelity
    let (off_x, off_y) = gf.xfrm.offset.unwrap_or((0, 0));
    let (ext_cx, ext_cy) = gf
        .xfrm
        .extent
        .map_or((0i64, 0i64), |e| (e.0 as i64, e.1 as i64));

    Some(write::ChartRef {
        original_id: Some(gf.nv_graphic_frame_pr.c_nv_pr.id.value()),
        name,
        descr: gf.nv_graphic_frame_pr.c_nv_pr.descr.clone(),
        title: gf.nv_graphic_frame_pr.c_nv_pr.title.clone(),
        hidden: gf.nv_graphic_frame_pr.c_nv_pr.hidden,
        hlink_click: gf.nv_graphic_frame_pr.c_nv_pr.hlink_click.clone(),
        hlink_hover: gf.nv_graphic_frame_pr.c_nv_pr.hlink_hover.clone(),
        r_id,
        macro_name: gf.macro_name.clone(),
        nv_ext_lst: gf.nv_graphic_frame_pr.c_nv_pr.ext_lst.clone(),
        graphic_frame_locks: gf.nv_graphic_frame_pr.c_nv_graphic_frame_pr.clone(),
        has_graphic_frame_locks: gf.nv_graphic_frame_pr.has_graphic_frame_locks,
        no_change_aspect_explicit: gf.nv_graphic_frame_pr.no_change_aspect_explicit,
        no_drilldown: gf.nv_graphic_frame_pr.no_drilldown,
        c_nv_graphic_frame_pr_ext_lst: gf.nv_graphic_frame_pr.c_nv_graphic_frame_pr_ext_lst.clone(),
        xfrm_off_x: off_x,
        xfrm_off_y: off_y,
        xfrm_ext_cx: ext_cx,
        xfrm_ext_cy: ext_cy,
    })
}

/// Extract the `r:id` value from chart graphic XML.
///
/// Looks for patterns like `r:id="rId1"` within the graphic XML content.
fn extract_r_id_from_chart_xml(xml: &str) -> Option<String> {
    // Look for r:id="..." pattern
    let r_id_marker = "r:id=\"";
    let start = xml.find(r_id_marker)?;
    let value_start = start + r_id_marker.len();
    let remaining = &xml[value_start..];
    let end = remaining.find('"')?;
    Some(remaining[..end].to_string())
}

/// Populate a write-side `SmartArtWriteData` with raw XML parts from a read-side `SmartArtParts`.
///
/// Matches by anchor index. Returns `true` if parts were found and populated.
pub fn populate_smartart_parts(
    write_data: &mut write::SmartArtWriteData,
    parts: &read::SmartArtParts,
) {
    write_data.data_xml = parts.data_xml.clone();
    write_data.layout_xml = parts.layout_xml.clone();
    write_data.colors_xml = parts.colors_xml.clone();
    write_data.style_xml = parts.style_xml.clone();
    write_data.drawing_xml = parts.drawing_xml.clone();
}

/// Convert a read-side `SpreadsheetConnector` into a write-side `ConnectorProps`.
pub fn connector_to_props(c: &read::SpreadsheetConnector) -> write::ConnectorProps {
    write::ConnectorProps {
        // Non-visual properties
        original_id: Some(c.nv_cxn_sp_pr.c_nv_pr.id.value()),
        name: c.nv_cxn_sp_pr.c_nv_pr.name.clone(),
        description: c.nv_cxn_sp_pr.c_nv_pr.descr.clone(),
        title: c.nv_cxn_sp_pr.c_nv_pr.title.clone(),
        hidden: c.nv_cxn_sp_pr.c_nv_pr.hidden,
        hlink_click: c.nv_cxn_sp_pr.c_nv_pr.hlink_click.clone(),
        hlink_hover: c.nv_cxn_sp_pr.c_nv_pr.hlink_hover.clone(),
        nv_ext_lst: c.nv_cxn_sp_pr.c_nv_pr.ext_lst.clone(),

        // Connection endpoints (types are now shared from ooxml-types)
        start_connection: c.nv_cxn_sp_pr.st_cxn.clone(),
        end_connection: c.nv_cxn_sp_pr.end_cxn.clone(),

        // Locking
        locks: c.nv_cxn_sp_pr.c_nv_cxn_sp_pr.clone(),

        // Shape properties (Transform2D is now shared from ooxml-types)
        transform: c.sp_pr.xfrm.clone().unwrap_or_default(),
        preset_geometry: c.sp_pr.geometry.as_ref().and_then(|g| match g {
            ooxml::ShapeGeometry::Preset(pg) => Some(pg.clone()),
            _ => None,
        }),
        fill: c.sp_pr.fill.clone(),
        outline: c.sp_pr.ln.clone(),

        // Style & metadata
        style: c.style.clone(),
        macro_name: c.macro_name.clone(),
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::drawings::{
        Connection as ReadConnection, ConnectorNonVisual, DrawingColor, Fill, NonVisualProps,
        Outline, PresetGeometry, ShapeGeometry, ShapeProperties, ShapeStyle, SolidFill,
        SpreadsheetConnector, StyleRef as ReadStyleRef, Transform2D as ReadXf,
    };
    use ooxml_types::drawings::{
        DashStyle, DrawingLocking, FontCollectionIndex, FontReference, Hyperlink, LineCap,
        LineDash, LineEndProperties, LineEndSize, LineEndType, LineFill, LineJoin, ShapePreset,
    };
    use ooxml_types::drawings::{
        StAngle, StDrawingElementId, StPositiveFixedPercentageDecimal, StStyleMatrixColumnIndex,
    };

    /// Helper: build a fully-populated read-side `SpreadsheetConnector` for testing.
    fn full_connector() -> SpreadsheetConnector {
        SpreadsheetConnector {
            nv_cxn_sp_pr: ConnectorNonVisual {
                c_nv_pr: NonVisualProps {
                    id: StDrawingElementId::new(5),
                    name: "My Connector".into(),
                    descr: Some("A test connector".into()),
                    hidden: true,
                    title: Some("Title".into()),
                    hlink_click: Some(Hyperlink {
                        r_id: Some("rId1".into()),
                        tooltip: Some("Click me".into()),
                        ..Default::default()
                    }),
                    hlink_hover: Some(Hyperlink {
                        r_id: Some("rId2".into()),
                        ..Default::default()
                    }),
                    ext_lst: None,
                },
                c_nv_cxn_sp_pr: DrawingLocking {
                    no_grp: true,
                    no_select: false,
                    no_rot: true,
                    no_change_aspect: false,
                    no_move: true,
                    no_resize: false,
                    no_edit_points: true,
                    no_adjust_handles: false,
                    no_change_arrowheads: true,
                    no_change_shape_type: false,
                    ..Default::default()
                },
                st_cxn: Some(ReadConnection {
                    shape_id: 10,
                    idx: 0,
                }),
                end_cxn: Some(ReadConnection {
                    shape_id: 20,
                    idx: 3,
                }),
                c_nv_cxn_sp_pr_ext_lst: None,
            },
            sp_pr: ShapeProperties {
                xfrm: Some(ReadXf {
                    offset: Some((100, 200)),
                    extent: Some((300, 400)),
                    rotation: Some(StAngle::new(5400000)),
                    flip_h: Some(true),
                    flip_v: Some(false),
                }),
                fill: Some(Fill::Solid(SolidFill {
                    color: DrawingColor::SrgbClr {
                        val: "FF0000".into(),
                        transforms: vec![],
                    },
                })),
                ln: Some(Outline {
                    width: Some(12700),
                    fill: Some(LineFill::Solid(SolidFill {
                        color: DrawingColor::SrgbClr {
                            val: "00FF00".into(),
                            transforms: vec![],
                        },
                    })),
                    dash: Some(LineDash::Preset(DashStyle::Dash)),
                    compound: None,
                    cap: Some(LineCap::Round),
                    head_end: Some(LineEndProperties {
                        end_type: Some(LineEndType::Triangle),
                        width: Some(LineEndSize::Medium),
                        length: Some(LineEndSize::Medium),
                    }),
                    tail_end: Some(LineEndProperties {
                        end_type: Some(LineEndType::Arrow),
                        width: Some(LineEndSize::Large),
                        length: Some(LineEndSize::Small),
                    }),
                    join: Some(LineJoin::Round),
                    align: None,
                }),
                geometry: Some(ShapeGeometry::Preset(PresetGeometry {
                    prst: ShapePreset::StraightConnector1,
                    av_list: vec![],
                })),
                ..Default::default()
            },
            style: Some(ShapeStyle {
                line_ref: ReadStyleRef {
                    idx: StStyleMatrixColumnIndex::new(1),
                    color: Some(DrawingColor::SrgbClr {
                        val: "AABBCC".into(),
                        transforms: vec![],
                    }),
                },
                fill_ref: ReadStyleRef {
                    idx: StStyleMatrixColumnIndex::new(0),
                    color: None,
                },
                effect_ref: ReadStyleRef {
                    idx: StStyleMatrixColumnIndex::new(0),
                    color: None,
                },
                font_ref: FontReference {
                    idx: FontCollectionIndex::Minor,
                    color: Some(DrawingColor::SchemeClr {
                        val: ooxml::SchemeColor::Lt1,
                        transforms: vec![],
                    }),
                },
            }),
            macro_name: Some("MyMacro".into()),
            f_published: None,
        }
    }

    /// Helper: build a minimal read-side `SpreadsheetConnector` (defaults only).
    fn minimal_connector() -> SpreadsheetConnector {
        SpreadsheetConnector::default()
    }

    #[test]
    fn test_full_conversion() {
        let c = full_connector();
        let props = connector_to_props(&c);

        // Non-visual properties
        assert_eq!(props.name, "My Connector");
        assert_eq!(props.description.as_deref(), Some("A test connector"));
        assert_eq!(props.title.as_deref(), Some("Title"));
        assert!(props.hidden);
        assert!(props.hlink_click.is_some());
        assert_eq!(
            props.hlink_click.as_ref().unwrap().r_id.as_deref(),
            Some("rId1")
        );
        assert_eq!(
            props.hlink_click.as_ref().unwrap().tooltip.as_deref(),
            Some("Click me")
        );
        assert!(props.hlink_hover.is_some());

        // Connections
        let start = props.start_connection.as_ref().unwrap();
        assert_eq!(start.shape_id, 10);
        assert_eq!(start.idx, 0);
        let end = props.end_connection.as_ref().unwrap();
        assert_eq!(end.shape_id, 20);
        assert_eq!(end.idx, 3);

        // Locks
        assert!(props.locks.no_grp);
        assert!(!props.locks.no_select);
        assert!(props.locks.no_rot);
        assert!(props.locks.no_move);
        assert!(props.locks.no_edit_points);
        assert!(props.locks.no_change_arrowheads);

        // Transform
        assert_eq!(props.transform.off_x(), 100);
        assert_eq!(props.transform.off_y(), 200);
        assert_eq!(props.transform.ext_cx(), 300);
        assert_eq!(props.transform.ext_cy(), 400);
        assert_eq!(props.transform.rot(), StAngle::new(5400000));
        assert!(props.transform.is_flip_h());
        assert!(!props.transform.is_flip_v());

        // Preset geometry
        assert_eq!(
            props.preset_geometry.as_ref().map(|pg| pg.prst),
            Some(ShapePreset::StraightConnector1)
        );

        // Fill (now cloned directly — full fidelity)
        match props.fill.as_ref().unwrap() {
            write::DrawingFill::Solid(sf) => match &sf.color {
                write::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
                other => panic!("expected SrgbClr, got {:?}", other),
            },
            other => panic!("expected Solid fill, got {:?}", other),
        }

        // Outline (now cloned directly — full DrawingColor fidelity)
        let outline = props.outline.as_ref().unwrap();
        assert_eq!(outline.width, Some(12700));
        match outline.fill.as_ref().unwrap() {
            LineFill::Solid(sf) => match &sf.color {
                write::DrawingColor::SrgbClr { val, .. } => assert_eq!(val.as_str(), "00FF00"),
                other => panic!("expected SrgbClr, got {:?}", other),
            },
            other => panic!("expected Solid line fill, got {:?}", other),
        }
        assert_eq!(outline.dash, Some(LineDash::Preset(DashStyle::Dash)));
        assert_eq!(outline.cap, Some(LineCap::Round));
        assert!(outline.head_end.is_some());
        assert!(outline.tail_end.is_some());
        assert_eq!(outline.join, Some(LineJoin::Round));

        // Style (now cloned directly — full DrawingColor fidelity)
        let style = props.style.as_ref().unwrap();
        assert_eq!(style.line_ref.idx, StStyleMatrixColumnIndex::new(1));
        match style.line_ref.color.as_ref().unwrap() {
            write::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "AABBCC"),
            other => panic!("expected SrgbClr, got {:?}", other),
        }
        assert_eq!(style.fill_ref.idx, StStyleMatrixColumnIndex::new(0));
        assert!(style.fill_ref.color.is_none());
        assert_eq!(style.effect_ref.idx, StStyleMatrixColumnIndex::new(0));
        assert!(style.effect_ref.color.is_none());
        // Font reference — now FontReference type with FontCollectionIndex
        assert!(style.font_ref.color.is_some());
        match style.font_ref.color.as_ref().unwrap() {
            write::DrawingColor::SchemeClr { val, .. } => assert_eq!(*val, ooxml::SchemeColor::Lt1),
            other => panic!("expected SchemeClr, got {:?}", other),
        }

        // Macro
        assert_eq!(props.macro_name.as_deref(), Some("MyMacro"));
    }

    #[test]
    fn test_minimal_conversion() {
        let c = minimal_connector();
        let props = connector_to_props(&c);

        // Name falls back to empty string
        assert_eq!(props.name, "");
        assert!(props.description.is_none());
        assert!(props.title.is_none());
        assert!(!props.hidden);
        assert!(props.hlink_click.is_none());
        assert!(props.hlink_hover.is_none());

        // No connections
        assert!(props.start_connection.is_none());
        assert!(props.end_connection.is_none());

        // Default locks (all false)
        assert!(!props.locks.no_grp);

        // Default transform
        assert_eq!(props.transform.off_x(), 0);
        assert_eq!(props.transform.ext_cx(), 0);
        assert_eq!(props.transform.rot(), StAngle::new(0));
        assert!(!props.transform.is_flip_h());

        // No fill, outline, style, preset, macro
        assert!(props.fill.is_none());
        assert!(props.outline.is_none());
        assert!(props.preset_geometry.is_none());
        assert!(props.style.is_none());
        assert!(props.macro_name.is_none());
    }

    #[test]
    fn test_gradient_fill_preserved() {
        let mut c = minimal_connector();
        c.sp_pr.fill = Some(Fill::Gradient(crate::domain::drawings::GradientFill {
            stops: vec![],
            lin_ang: Some(StAngle::new(5_400_000)),
            ..Default::default()
        }));
        let props = connector_to_props(&c);
        // Gradient fills are now preserved (no longer downgraded to NoFill)
        match props.fill.as_ref().unwrap() {
            write::DrawingFill::Gradient(gf) => {
                assert!(gf.stops.is_empty());
                assert_eq!(gf.lin_ang, Some(StAngle::new(5_400_000)));
            }
            other => panic!("expected Gradient fill, got {:?}", other),
        }
    }

    #[test]
    fn test_no_fill_roundtrip() {
        let mut c = minimal_connector();
        c.sp_pr.fill = Some(Fill::NoFill);
        let props = connector_to_props(&c);
        match props.fill.as_ref().unwrap() {
            write::DrawingFill::NoFill => {} // expected
            other => panic!("expected NoFill, got {:?}", other),
        }
    }

    // =========================================================================
    // Picture → ImageProps tests
    // =========================================================================

    use crate::domain::drawings::{
        BlipFill as ReadBlipFill, GradientFill as ReadGradientFill,
        GradientStop as ReadGradientStop, PictureNonVisual, SpreadsheetPicture,
    };
    use ooxml_types::drawings::{
        BlackWhiteMode, BlipEffect, CompressionState, FillMode, SourceRect,
    };

    /// Helper: build a fully-populated read-side `SpreadsheetPicture` for testing.
    fn full_picture() -> SpreadsheetPicture {
        SpreadsheetPicture {
            nv_pic_pr: PictureNonVisual {
                c_nv_pr: NonVisualProps {
                    id: StDrawingElementId::new(10),
                    name: "My Image".into(),
                    descr: Some("NV description".into()),
                    hidden: true,
                    title: Some("Image Title".into()),
                    hlink_click: Some(Hyperlink {
                        r_id: Some("rId10".into()),
                        tooltip: Some("Click image".into()),
                        ..Default::default()
                    }),
                    hlink_hover: Some(Hyperlink {
                        r_id: Some("rId11".into()),
                        ..Default::default()
                    }),
                    ext_lst: None,
                },
                locks: DrawingLocking {
                    no_change_aspect: true,
                    no_grp: true,
                    no_select: false,
                    no_rot: false,
                    no_move: false,
                    no_resize: false,
                    no_crop: true,
                    no_text_edit: false,
                    no_edit_points: false,
                    no_adjust_handles: false,
                    no_change_arrowheads: false,
                    no_change_shape_type: false,
                    ext_lst: None,
                },
                prefer_relative_resize: Some(false),
                c_nv_pic_pr_ext_lst: None,
                has_pic_locks: true,
            },
            blip_fill: ReadBlipFill {
                embed_id: Some("rId5".into()),
                link_id: Some("rId6".into()),
                compression: Some(CompressionState::Print),
                source_rect: Some(SourceRect {
                    top: StPositiveFixedPercentageDecimal::new_unchecked(10000),
                    bottom: StPositiveFixedPercentageDecimal::new_unchecked(20000),
                    left: StPositiveFixedPercentageDecimal::new_unchecked(5000),
                    right: StPositiveFixedPercentageDecimal::new_unchecked(5000),
                }),
                effects: vec![BlipEffect::Grayscale],
                fill_mode: Some(FillMode::Stretch { fill_rect: None }),
                dpi: Some(300),
                rot_with_shape: Some(true),
                ext_lst: None,
                src_rect_explicit: 0xF, // all four attributes present
            },
            sp_pr: ShapeProperties {
                xfrm: Some(ReadXf {
                    offset: Some((1000, 2000)),
                    extent: Some((5000000, 3000000)),
                    rotation: Some(StAngle::new(5400000)),
                    flip_h: Some(false),
                    flip_v: Some(true),
                }),
                fill: Some(Fill::Solid(SolidFill {
                    color: DrawingColor::SrgbClr {
                        val: "0000FF".into(),
                        transforms: vec![],
                    },
                })),
                ln: Some(Outline {
                    width: Some(25400),
                    fill: Some(LineFill::Solid(SolidFill {
                        color: DrawingColor::SrgbClr {
                            val: "FF00FF".into(),
                            transforms: vec![
                                ooxml::ColorTransform::LumMod { val: 75000 },
                                ooxml::ColorTransform::LumOff { val: 25000 },
                                ooxml::ColorTransform::Tint { val: 50000 },
                            ],
                        },
                    })),
                    dash: Some(LineDash::Preset(DashStyle::DashDot)),
                    compound: None,
                    cap: Some(LineCap::Flat),
                    head_end: None,
                    tail_end: None,
                    join: Some(LineJoin::Miter { limit: None }),
                    align: None,
                }),
                geometry: Some(ShapeGeometry::Preset(PresetGeometry {
                    prst: ShapePreset::Rect,
                    av_list: vec![],
                })),
                effects: None,
                bw_mode: Some(BlackWhiteMode::Auto),
                scene3d: None,
                sp3d: None,
                ext_lst: None,
            },
            style: Some(ShapeStyle {
                line_ref: ReadStyleRef {
                    idx: StStyleMatrixColumnIndex::new(2),
                    color: Some(DrawingColor::SrgbClr {
                        val: "112233".into(),
                        transforms: vec![],
                    }),
                },
                fill_ref: ReadStyleRef {
                    idx: StStyleMatrixColumnIndex::new(1),
                    color: None,
                },
                effect_ref: ReadStyleRef::default(),
                font_ref: FontReference::default(),
            }),
            macro_name: Some("PicMacro".into()),
            f_published: None,
        }
    }

    #[test]
    fn test_full_picture_conversion() {
        let p = full_picture();
        let props = picture_to_image_props(&p);

        // Identity — nv_props.name takes priority
        assert_eq!(props.name, "My Image");
        // nv_props.descr takes priority over element-level description
        assert_eq!(props.description.as_deref(), Some("NV description"));
        assert_eq!(props.r_id, "rId5");

        // Transform
        assert_eq!(props.rotation, Some(5400000));
        assert_eq!(props.offset_x, 1000);
        assert_eq!(props.offset_y, 2000);
        assert_eq!(props.extent_cx, 5000000);
        assert_eq!(props.extent_cy, 3000000);
        assert!(!props.flip_h);
        assert!(props.flip_v);

        // BlipFill
        assert!(props.source_rect.is_some());
        let sr = props.source_rect.as_ref().unwrap();
        assert_eq!(
            sr.top,
            StPositiveFixedPercentageDecimal::new_unchecked(10000)
        );
        assert_eq!(
            sr.bottom,
            StPositiveFixedPercentageDecimal::new_unchecked(20000)
        );
        assert_eq!(props.blip_effects.len(), 1);
        assert!(matches!(props.blip_effects[0], BlipEffect::Grayscale));
        assert!(props.fill_mode.is_some());
        assert_eq!(props.compression, Some(CompressionState::Print));
        assert_eq!(props.link_id.as_deref(), Some("rId6"));
        assert_eq!(props.dpi, Some(300));
        assert_eq!(props.rot_with_shape, Some(true));

        // Locking
        assert!(props.locks.no_change_aspect);
        assert!(props.locks.no_grp);
        assert!(props.locks.no_crop);
        assert!(!props.locks.no_select);
        assert_eq!(props.prefer_relative_resize, Some(false));

        // NonVisual extras
        assert_eq!(props.title.as_deref(), Some("Image Title"));
        assert!(props.hidden);
        assert!(props.hlink_click.is_some());
        assert_eq!(
            props.hlink_click.as_ref().unwrap().tooltip.as_deref(),
            Some("Click image")
        );
        assert!(props.hlink_hover.is_some());

        // Shape properties
        assert_eq!(
            props.preset_geometry.as_ref().map(|pg| pg.prst),
            Some(ShapePreset::Rect)
        );
        assert!(props.fill.is_some());
        // Solid fill converted to ooxml
        match props.fill.as_ref().unwrap() {
            write::DrawingFill::Solid(sf) => match &sf.color {
                write::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "0000FF"),
                other => panic!("expected SrgbClr, got {:?}", other),
            },
            other => panic!("expected Solid ooxml fill, got {:?}", other),
        }
        // Outline converted to ooxml
        let outline = props.outline.as_ref().unwrap();
        assert_eq!(outline.width, Some(25400));
        match outline.fill.as_ref().unwrap() {
            LineFill::Solid(sf) => match &sf.color {
                write::DrawingColor::SrgbClr { val, transforms } => {
                    assert_eq!(val, "FF00FF");
                    assert_eq!(transforms.len(), 3);
                }
                other => panic!("expected SrgbClr, got {:?}", other),
            },
            other => panic!("expected Solid line fill, got {:?}", other),
        }
        assert_eq!(outline.dash, Some(LineDash::Preset(DashStyle::DashDot)));
        assert_eq!(outline.join, Some(LineJoin::Miter { limit: None }));
        assert_eq!(props.bw_mode, Some(BlackWhiteMode::Auto));

        // Style
        let style = props.style.as_ref().unwrap();
        assert_eq!(style.line_ref.idx, StStyleMatrixColumnIndex::new(2));
        match style.line_ref.color.as_ref().unwrap() {
            write::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "112233"),
            other => panic!("expected SrgbClr, got {:?}", other),
        }
        assert_eq!(style.fill_ref.idx, StStyleMatrixColumnIndex::new(1));
        assert!(style.fill_ref.color.is_none());
        // effect_ref and font_ref are default (idx=0, no color)
        assert_eq!(style.effect_ref.idx, StStyleMatrixColumnIndex::new(0));
        assert!(style.effect_ref.color.is_none());

        // Macro
        assert_eq!(props.macro_name.as_deref(), Some("PicMacro"));
    }

    #[test]
    fn test_minimal_picture_conversion() {
        let p = SpreadsheetPicture::default();
        let props = picture_to_image_props(&p);

        // All names fall back to empty
        assert_eq!(props.name, "");
        assert!(props.description.is_none());
        assert_eq!(props.r_id, "");

        // Transform defaults
        assert!(props.rotation.is_none()); // rot=0 maps to None
        assert_eq!(props.offset_x, 0);
        assert_eq!(props.offset_y, 0);
        assert_eq!(props.extent_cx, 0);
        assert_eq!(props.extent_cy, 0);
        assert!(!props.flip_h);
        assert!(!props.flip_v);

        // BlipFill defaults
        assert!(props.source_rect.is_none());
        assert!(props.blip_effects.is_empty());
        assert!(props.fill_mode.is_none());
        assert!(props.compression.is_none());
        assert!(props.link_id.is_none());
        assert!(props.dpi.is_none());
        assert!(props.rot_with_shape.is_none());

        // Locking defaults
        assert!(!props.locks.no_change_aspect);
        assert!(props.prefer_relative_resize.is_none());

        // NonVisual defaults
        assert!(props.title.is_none());
        assert!(!props.hidden);
        assert!(props.hlink_click.is_none());
        assert!(props.hlink_hover.is_none());

        // Shape property defaults
        assert!(props.preset_geometry.is_none());
        assert!(props.fill.is_none());
        assert!(props.outline.is_none());
        assert!(props.effects.is_none());
        assert!(props.bw_mode.is_none());

        // Style & metadata defaults
        assert!(props.style.is_none());
        assert!(props.macro_name.is_none());
    }

    #[test]
    fn test_picture_with_effects() {
        let mut p = SpreadsheetPicture::default();
        p.blip_fill.embed_id = Some("rId1".into());
        p.blip_fill.effects = vec![
            BlipEffect::Grayscale,
            BlipEffect::AlphaModFix { amt: 50000 },
            BlipEffect::Luminance {
                bright: 20000,
                contrast: -10000,
            },
        ];

        let props = picture_to_image_props(&p);

        assert_eq!(props.blip_effects.len(), 3);
        assert!(matches!(props.blip_effects[0], BlipEffect::Grayscale));
        assert!(matches!(
            props.blip_effects[1],
            BlipEffect::AlphaModFix { amt: 50000 }
        ));
        match &props.blip_effects[2] {
            BlipEffect::Luminance { bright, contrast } => {
                assert_eq!(*bright, 20000);
                assert_eq!(*contrast, -10000);
            }
            other => panic!("expected Luminance effect, got {:?}", other),
        }
    }

    #[test]
    fn test_picture_gradient_fill_preserved() {
        let mut p = SpreadsheetPicture::default();
        p.sp_pr.fill = Some(Fill::Gradient(ReadGradientFill {
            stops: vec![
                ReadGradientStop {
                    position: StPositiveFixedPercentageDecimal::new_unchecked(0),
                    color: DrawingColor::SrgbClr {
                        val: "FF0000".into(),
                        transforms: vec![],
                    },
                },
                ReadGradientStop {
                    position: StPositiveFixedPercentageDecimal::new_unchecked(100000),
                    color: DrawingColor::SrgbClr {
                        val: "0000FF".into(),
                        transforms: vec![],
                    },
                },
            ],
            lin_ang: Some(StAngle::new(2_700_000)),
            ..Default::default()
        }));

        let props = picture_to_image_props(&p);
        match props.fill.as_ref().unwrap() {
            write::DrawingFill::Gradient(gf) => {
                assert_eq!(gf.stops.len(), 2);
                assert_eq!(
                    gf.stops[0].position,
                    StPositiveFixedPercentageDecimal::new_unchecked(0)
                );
                match &gf.stops[0].color {
                    write::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
                    other => panic!("expected SrgbClr, got {:?}", other),
                }
                assert_eq!(
                    gf.stops[1].position,
                    StPositiveFixedPercentageDecimal::new_unchecked(100000)
                );
                match &gf.stops[1].color {
                    write::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "0000FF"),
                    other => panic!("expected SrgbClr, got {:?}", other),
                }
                assert_eq!(gf.lin_ang, Some(StAngle::new(2_700_000)));
            }
            other => panic!("expected Gradient ooxml fill, got {:?}", other),
        }
    }

    #[test]
    fn test_picture_name_fallback() {
        // Name comes from nv_pic_pr.c_nv_pr.name
        let mut p = SpreadsheetPicture::default();
        p.nv_pic_pr.c_nv_pr.name = "My Name".into();
        let props = picture_to_image_props(&p);
        assert_eq!(props.name, "My Name");

        // When empty, stays empty
        p.nv_pic_pr.c_nv_pr.name = String::new();
        let props2 = picture_to_image_props(&p);
        assert_eq!(props2.name, "");
    }

    #[test]
    fn test_picture_description_fallback() {
        // Description comes from nv_pic_pr.c_nv_pr.descr
        let mut p = SpreadsheetPicture::default();
        p.nv_pic_pr.c_nv_pr.descr = Some("NV desc".into());
        let props = picture_to_image_props(&p);
        assert_eq!(props.description.as_deref(), Some("NV desc"));

        // When None, description is None
        p.nv_pic_pr.c_nv_pr.descr = None;
        let props2 = picture_to_image_props(&p);
        assert!(props2.description.is_none());
    }

    // =========================================================================
    // GroupShape → GroupShapeProps tests
    // =========================================================================

    use crate::domain::drawings::{
        DrawingContent, GroupShape, GroupShapeNonVisual, GroupShapeProperties as ReadGrpProps,
        SpreadsheetGraphicFrame as ReadGF,
    };
    use ooxml_types::drawings::{GroupLocking, GroupTransform2D};

    #[test]
    fn test_full_group_shape_conversion() {
        let g = GroupShape {
            nv_grp_sp_pr: GroupShapeNonVisual {
                c_nv_pr: NonVisualProps {
                    id: StDrawingElementId::new(1),
                    name: "Group 1".into(),
                    descr: Some("Test group".into()),
                    hidden: false,
                    title: Some("Title".into()),
                    hlink_click: None,
                    hlink_hover: None,
                    ext_lst: None,
                },
                c_nv_grp_sp_pr: Some(GroupLocking {
                    no_grp: true,
                    no_ungrp: true,
                    no_select: false,
                    no_rot: false,
                    no_change_aspect: true,
                    no_move: false,
                    no_resize: false,
                    ext_lst: None,
                }),
                ..Default::default()
            },
            grp_sp_pr: ReadGrpProps {
                xfrm: Some(GroupTransform2D {
                    offset: Some((100, 200)),
                    extent: Some((5000, 3000)),
                    child_offset: Some((0, 0)),
                    child_extent: Some((5000, 3000)),
                    rotation: Some(StAngle::new(5400000)),
                    flip_h: Some(true),
                    flip_v: None,
                }),
                fill: Some(Fill::Solid(SolidFill {
                    color: DrawingColor::SrgbClr {
                        val: "FF0000".into(),
                        transforms: vec![],
                    },
                })),
                effects: None,
                bw_mode: Some(BlackWhiteMode::Auto),
                scene3d: None,
                ext_lst: None,
            },
            children: vec![],
        };
        let props = group_shape_to_props(&g);
        assert_eq!(props.name, "Group 1");
        assert_eq!(props.description.as_deref(), Some("Test group"));
        assert_eq!(props.title.as_deref(), Some("Title"));
        assert!(!props.hidden);
        let locks = props.group_locking.as_ref().unwrap();
        assert!(locks.no_grp);
        assert!(locks.no_ungrp);
        assert!(locks.no_change_aspect);
        assert!(!locks.no_select);
        let xfrm = props.transform.as_ref().unwrap();
        assert_eq!(xfrm.offset, Some((100, 200)));
        assert_eq!(xfrm.extent, Some((5000, 3000)));
        assert_eq!(xfrm.child_offset, Some((0, 0)));
        assert_eq!(xfrm.rotation, Some(StAngle::new(5400000)));
        assert_eq!(xfrm.flip_h, Some(true));
        assert_eq!(xfrm.flip_v, None);
        assert!(props.fill.is_some());
        assert_eq!(props.bw_mode, Some(BlackWhiteMode::Auto));
        assert!(props.children.is_empty());
    }

    #[test]
    fn test_minimal_group_shape_conversion() {
        let g = GroupShape::default();
        let props = group_shape_to_props(&g);
        assert_eq!(props.name, "");
        assert!(props.description.is_none());
        assert!(!props.hidden);
        assert!(props.group_locking.is_none());
        assert!(props.transform.is_none());
        assert!(props.fill.is_none());
        assert!(props.children.is_empty());
    }

    #[test]
    fn test_group_shape_with_nested_children() {
        let inner_connector = SpreadsheetConnector {
            nv_cxn_sp_pr: ConnectorNonVisual {
                c_nv_pr: NonVisualProps {
                    id: StDrawingElementId::new(3),
                    name: "Inner Conn".into(),
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };
        let inner_picture = SpreadsheetPicture {
            nv_pic_pr: PictureNonVisual {
                c_nv_pr: NonVisualProps {
                    id: StDrawingElementId::new(4),
                    name: "Inner Pic".into(),
                    ..Default::default()
                },
                ..Default::default()
            },
            blip_fill: ReadBlipFill {
                embed_id: Some("rId1".into()),
                ..Default::default()
            },
            ..Default::default()
        };
        let graphic_frame = ReadGF {
            graphic_xml: Some("<xdr:graphicFrame>test</xdr:graphicFrame>".into()),
            ..Default::default()
        };

        let g = GroupShape {
            nv_grp_sp_pr: GroupShapeNonVisual {
                c_nv_pr: NonVisualProps {
                    id: StDrawingElementId::new(2),
                    name: "Group with children".into(),
                    ..Default::default()
                },
                ..Default::default()
            },
            children: vec![
                DrawingContent::Connector(inner_connector),
                DrawingContent::Picture(inner_picture),
                DrawingContent::GraphicFrame(graphic_frame),
                DrawingContent::Unknown, // should be filtered out
            ],
            ..Default::default()
        };
        let props = group_shape_to_props(&g);
        assert_eq!(props.name, "Group with children");
        // Unknown is filtered out, so 3 children
        assert_eq!(props.children.len(), 3);
        assert!(matches!(
            props.children[0],
            write::DrawingObject::Connector(_)
        ));
        assert!(matches!(
            props.children[1],
            write::DrawingObject::Picture(_)
        ));
        assert!(matches!(
            props.children[2],
            write::DrawingObject::GraphicFrame(_)
        ));
    }

    #[test]
    fn test_convert_drawing_content_unknown_returns_none() {
        assert!(convert_drawing_content(&DrawingContent::Unknown).is_none());
    }

    #[test]
    fn test_convert_drawing_content_shape_returns_text_box() {
        use crate::domain::drawings::SpreadsheetShape;
        let s = SpreadsheetShape::default();
        let result = convert_drawing_content(&DrawingContent::Shape(s));
        assert!(result.is_some());
        match result.unwrap() {
            super::write::DrawingObject::TextBox(_) => {} // expected
            other => panic!("Expected TextBox, got {:?}", other),
        }
    }
}
