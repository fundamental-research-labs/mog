use std::collections::HashMap;

use crate::domain::drawings::{Anchor as DrawingAnchor, ClientData, Drawing, DrawingContent};
use crate::infra::opc::opc_target_to_zip_path;
use crate::output::results::FullParsedSheet;
use domain_types::ChartSpec;
use domain_types::chart::AnchorPosition;
use domain_types::domain::floating_object::ChartDrawingFrameOoxmlProps;

pub(crate) fn chart_frames_by_relationship_target(
    frames: &[(AnchorPosition, ChartDrawingFrameOoxmlProps)],
) -> HashMap<String, &(AnchorPosition, ChartDrawingFrameOoxmlProps)> {
    frames
        .iter()
        .filter_map(|entry| {
            let target = entry.1.relationship_target.as_deref()?;
            Some((normalize_drawing_relationship_target(target), entry))
        })
        .collect()
}

fn normalize_drawing_relationship_target(target: &str) -> String {
    opc_target_to_zip_path(target, "xl/drawings")
}

/// Build a ChartRefInfo from position data in an old ChartSpec.
pub(super) fn build_chart_ref_info_from_spec(
    old_spec: Option<&ChartSpec>,
    _chart: &crate::domain::charts::Chart,
) -> crate::domain::charts::read::ChartRefInfo {
    use crate::domain::charts::read::ChartRefInfo;

    if let Some(spec) = old_spec {
        let (cx, cy) = chart_ref_extent_from_spec(spec);
        ChartRefInfo {
            target: String::new(),
            from_row: spec.position.anchor_row,
            from_col: spec.position.anchor_col,
            from_row_off: spec.position.anchor_row_offset,
            from_col_off: spec.position.anchor_col_offset,
            absolute_x: spec.position.absolute_x,
            absolute_y: spec.position.absolute_y,
            to_row: spec.position.end_row,
            to_col: spec.position.end_col,
            to_row_off: spec.position.end_row_offset,
            to_col_off: spec.position.end_col_offset,
            cx,
            cy,
            xfrm_off_x: spec.xfrm_off_x,
            xfrm_off_y: spec.xfrm_off_y,
            xfrm_ext_cx: spec.xfrm_ext_cx,
            xfrm_ext_cy: spec.xfrm_ext_cy,
            cnv_pr_name: spec.cnv_pr_name.clone(),
            cnv_pr_id: spec.cnv_pr_id,
            cnv_pr_descr: spec.cnv_pr_descr.clone(),
            cnv_pr_title: spec.cnv_pr_title.clone(),
            cnv_pr_hidden: spec.cnv_pr_hidden,
            no_change_aspect: spec.no_change_aspect,
            has_graphic_frame_locks: spec.has_graphic_frame_locks,
            cnv_pr_ext_lst: spec.cnv_pr_ext_lst.clone(),
            anchor_edit_as: spec.anchor_edit_as.clone(),
            macro_name: spec.macro_name.clone(),
            client_data_locks_with_sheet: spec.client_data_locks_with_sheet,
            client_data_prints_with_sheet: spec.client_data_prints_with_sheet,
            anchor_index: spec.anchor_index,
        }
    } else {
        ChartRefInfo {
            target: String::new(),
            from_row: 0,
            from_col: 0,
            from_row_off: 0,
            from_col_off: 0,
            absolute_x: None,
            absolute_y: None,
            to_row: None,
            to_col: None,
            to_row_off: None,
            to_col_off: None,
            cx: 4572000,
            cy: 2743200,
            xfrm_off_x: 0,
            xfrm_off_y: 0,
            xfrm_ext_cx: 0,
            xfrm_ext_cy: 0,
            cnv_pr_name: None,
            cnv_pr_id: None,
            cnv_pr_descr: None,
            cnv_pr_title: None,
            cnv_pr_hidden: false,
            no_change_aspect: None,
            has_graphic_frame_locks: false,
            cnv_pr_ext_lst: None,
            anchor_edit_as: None,
            macro_name: None,
            client_data_locks_with_sheet: None,
            client_data_prints_with_sheet: None,
            anchor_index: None,
        }
    }
}

pub(super) fn build_chart_ref_info_from_frame(
    position: &AnchorPosition,
    frame: &ChartDrawingFrameOoxmlProps,
) -> crate::domain::charts::read::ChartRefInfo {
    use crate::domain::charts::read::ChartRefInfo;

    let gf = &frame.graphic_frame;
    let nv = &gf.nv_graphic_frame_pr;
    let cnv = &nv.c_nv_pr;
    let (cx, cy) = if position.end_row.is_none() && position.end_col.is_none() {
        (
            position
                .extent_cx
                .unwrap_or_else(|| gf.xfrm.ext_cx() as i64),
            position
                .extent_cy
                .unwrap_or_else(|| gf.xfrm.ext_cy() as i64),
        )
    } else {
        (gf.xfrm.ext_cx() as i64, gf.xfrm.ext_cy() as i64)
    };

    ChartRefInfo {
        target: frame
            .relationship_target
            .as_deref()
            .map(normalize_drawing_relationship_target)
            .unwrap_or_default(),
        from_row: position.anchor_row,
        from_col: position.anchor_col,
        from_row_off: position.anchor_row_offset,
        from_col_off: position.anchor_col_offset,
        absolute_x: position.absolute_x,
        absolute_y: position.absolute_y,
        to_row: position.end_row,
        to_col: position.end_col,
        to_row_off: position.end_row_offset,
        to_col_off: position.end_col_offset,
        cx,
        cy,
        xfrm_off_x: gf.xfrm.off_x(),
        xfrm_off_y: gf.xfrm.off_y(),
        xfrm_ext_cx: gf.xfrm.ext_cx() as i64,
        xfrm_ext_cy: gf.xfrm.ext_cy() as i64,
        cnv_pr_name: (!cnv.name.is_empty()).then(|| cnv.name.clone()),
        cnv_pr_id: (cnv.id.value() != 0).then_some(cnv.id.value()),
        cnv_pr_descr: cnv.descr.clone(),
        cnv_pr_title: cnv.title.clone(),
        cnv_pr_hidden: cnv.hidden,
        no_change_aspect: nv
            .no_change_aspect_explicit
            .or_else(|| nv.c_nv_graphic_frame_pr.no_change_aspect.then_some(true)),
        has_graphic_frame_locks: nv.has_graphic_frame_locks,
        cnv_pr_ext_lst: cnv.ext_lst.clone(),
        anchor_edit_as: frame.edit_as.clone(),
        macro_name: gf.macro_name.clone(),
        client_data_locks_with_sheet: frame.client_data_locks_with_sheet,
        client_data_prints_with_sheet: frame.client_data_prints_with_sheet,
        anchor_index: frame.anchor_index.and_then(|idx| usize::try_from(idx).ok()),
    }
}

/// Choose dimensions from the drawing anchor instead of the inner graphicFrame
/// transform. For one-cell anchors the real size lives on `xdr:oneCellAnchor/xdr:ext`.
pub(crate) fn chart_ref_extent_from_spec(spec: &ChartSpec) -> (i64, i64) {
    if spec.position.end_row.is_none() && spec.position.end_col.is_none() {
        (
            spec.position.extent_cx.unwrap_or(spec.xfrm_ext_cx),
            spec.position.extent_cy.unwrap_or(spec.xfrm_ext_cy),
        )
    } else {
        (spec.xfrm_ext_cx, spec.xfrm_ext_cy)
    }
}

pub(super) fn chart_drawing_frames(
    sheet: &FullParsedSheet,
    chart_ex: bool,
) -> Vec<(AnchorPosition, ChartDrawingFrameOoxmlProps)> {
    let Some(drawing) = sheet.parsed_drawing.as_ref() else {
        return Vec::new();
    };

    let mut frames = Vec::new();
    for (idx, anchor) in drawing.anchors.iter().enumerate() {
        append_chart_drawing_frames_from_anchor(drawing, anchor, idx, chart_ex, &mut frames);
    }
    frames
}

fn append_chart_drawing_frames_from_anchor(
    drawing: &Drawing,
    anchor: &DrawingAnchor,
    anchor_index: usize,
    chart_ex: bool,
    frames: &mut Vec<(AnchorPosition, ChartDrawingFrameOoxmlProps)>,
) {
    let (position, content, extent_emu, edit_as, client_data, raw_alternate_content) = match anchor
    {
        DrawingAnchor::TwoCell(tc) => (
            AnchorPosition {
                anchor_row: tc.from.row,
                anchor_col: tc.from.col,
                anchor_row_offset: tc.from.row_off,
                anchor_col_offset: tc.from.col_off,
                absolute_x: None,
                absolute_y: None,
                end_row: Some(tc.to.row),
                end_col: Some(tc.to.col),
                end_row_offset: Some(tc.to.row_off),
                end_col_offset: Some(tc.to.col_off),
                extent_cx: None,
                extent_cy: None,
            },
            &tc.content,
            None,
            tc.edit_as.as_ref().map(|e| e.to_ooxml().to_string()),
            &tc.client_data,
            tc.mc_alternate_content
                .as_ref()
                .map(|mc| mc.raw_xml.clone()),
        ),
        DrawingAnchor::OneCell(oc) => (
            AnchorPosition {
                anchor_row: oc.from.row,
                anchor_col: oc.from.col,
                anchor_row_offset: oc.from.row_off,
                anchor_col_offset: oc.from.col_off,
                absolute_x: None,
                absolute_y: None,
                end_row: None,
                end_col: None,
                end_row_offset: None,
                end_col_offset: None,
                extent_cx: Some(oc.extent.cx),
                extent_cy: Some(oc.extent.cy),
            },
            &oc.content,
            Some((oc.extent.cx, oc.extent.cy)),
            None,
            &oc.client_data,
            oc.mc_alternate_content
                .as_ref()
                .map(|mc| mc.raw_xml.clone()),
        ),
        DrawingAnchor::Absolute(abs) => (
            AnchorPosition {
                anchor_row: 0,
                anchor_col: 0,
                anchor_row_offset: 0,
                anchor_col_offset: 0,
                absolute_x: Some(abs.pos.x),
                absolute_y: Some(abs.pos.y),
                end_row: None,
                end_col: None,
                end_row_offset: None,
                end_col_offset: None,
                extent_cx: Some(abs.extent.cx),
                extent_cy: Some(abs.extent.cy),
            },
            &abs.content,
            Some((abs.extent.cx, abs.extent.cy)),
            Some("absolute".to_string()),
            &abs.client_data,
            None,
        ),
    };

    append_chart_drawing_frames_from_content(
        drawing,
        content,
        &position,
        extent_emu,
        edit_as.as_deref(),
        client_data,
        raw_alternate_content.as_deref(),
        anchor_index,
        chart_ex,
        frames,
    );
}

#[allow(clippy::too_many_arguments)]
fn append_chart_drawing_frames_from_content(
    drawing: &Drawing,
    content: &DrawingContent,
    position: &AnchorPosition,
    extent_emu: Option<(i64, i64)>,
    edit_as: Option<&str>,
    client_data: &ClientData,
    raw_alternate_content: Option<&str>,
    anchor_index: usize,
    chart_ex: bool,
    frames: &mut Vec<(AnchorPosition, ChartDrawingFrameOoxmlProps)>,
) {
    match content {
        DrawingContent::GraphicFrame(gf) => {
            if let Some(frame) = chart_drawing_frame_from_graphic_frame(
                drawing,
                gf,
                position,
                extent_emu,
                edit_as,
                client_data,
                raw_alternate_content,
                anchor_index,
                chart_ex,
            ) {
                frames.push(frame);
            }
        }
        DrawingContent::GroupShape(group) => {
            for child in &group.children {
                append_chart_drawing_frames_from_content(
                    drawing,
                    child,
                    position,
                    extent_emu,
                    edit_as,
                    client_data,
                    raw_alternate_content,
                    anchor_index,
                    chart_ex,
                    frames,
                );
            }
        }
        _ => {}
    }
}

#[allow(clippy::too_many_arguments)]
fn chart_drawing_frame_from_graphic_frame(
    drawing: &Drawing,
    gf: &ooxml_types::drawings::SpreadsheetGraphicFrame,
    position: &AnchorPosition,
    extent_emu: Option<(i64, i64)>,
    edit_as: Option<&str>,
    client_data: &ClientData,
    raw_alternate_content: Option<&str>,
    anchor_index: usize,
    chart_ex: bool,
) -> Option<(AnchorPosition, ChartDrawingFrameOoxmlProps)> {
    let graphic_xml = gf.graphic_xml.as_deref().unwrap_or_default();
    let is_chart_ex = graphic_xml.contains("2014/chartex") || graphic_xml.contains("chartEx");
    let is_standard_chart = graphic_xml.contains("schemas.openxmlformats.org/drawingml/2006/chart");
    if chart_ex != is_chart_ex || (!chart_ex && !is_standard_chart) {
        return None;
    }

    let relationship_id = extract_chart_relationship_id(graphic_xml);
    let relationship_target = relationship_id.as_ref().and_then(|rid| {
        drawing
            .opc_rels
            .iter()
            .find(|rel| rel.id == *rid)
            .map(|rel| rel.target.clone())
    });
    let client_data_locks_with_sheet = (!client_data.locks_with_sheet).then_some(false);
    let client_data_prints_with_sheet = (!client_data.prints_with_sheet).then_some(false);

    Some((
        position.clone(),
        ChartDrawingFrameOoxmlProps {
            graphic_frame: gf.clone(),
            anchor_index: i32::try_from(anchor_index).ok(),
            extent_emu_cx: extent_emu.map(|(cx, _)| cx),
            extent_emu_cy: extent_emu.map(|(_, cy)| cy),
            edit_as: edit_as.map(ToOwned::to_owned),
            client_data_locks_with_sheet,
            client_data_prints_with_sheet,
            relationship_id,
            relationship_target,
            raw_alternate_content: raw_alternate_content.map(ToOwned::to_owned),
        },
    ))
}

fn extract_chart_relationship_id(graphic_xml: &str) -> Option<String> {
    let chart_pos = graphic_xml
        .find("<c:chart")
        .or_else(|| graphic_xml.find("<chart"))
        .or_else(|| graphic_xml.find("<cx:chart"))?;
    let tag = &graphic_xml[chart_pos..];
    let tag = tag.split_once('>').map(|(t, _)| t).unwrap_or(tag);
    extract_xml_attr(tag, "r:id").or_else(|| extract_xml_attr(tag, "id"))
}

fn extract_xml_attr(tag: &str, attr: &str) -> Option<String> {
    let needle = format!("{attr}=\"");
    let start = tag.find(&needle)? + needle.len();
    let rest = &tag[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

pub(super) fn apply_chart_frame_to_spec(spec: &mut ChartSpec, frame: &ChartDrawingFrameOoxmlProps) {
    let gf = &frame.graphic_frame;
    let nv = &gf.nv_graphic_frame_pr;
    let cnv = &nv.c_nv_pr;

    spec.chart_frame = Some(frame.clone());
    spec.cnv_pr_name = (!cnv.name.is_empty()).then(|| cnv.name.clone());
    spec.cnv_pr_id = (cnv.id.value() != 0).then_some(cnv.id.value());
    spec.cnv_pr_descr = cnv.descr.clone();
    spec.cnv_pr_title = cnv.title.clone();
    spec.cnv_pr_hidden = cnv.hidden;
    spec.no_change_aspect = nv
        .no_change_aspect_explicit
        .or_else(|| nv.c_nv_graphic_frame_pr.no_change_aspect.then_some(true));
    spec.has_graphic_frame_locks = nv.has_graphic_frame_locks;
    spec.xfrm_off_x = gf.xfrm.off_x();
    spec.xfrm_off_y = gf.xfrm.off_y();
    spec.xfrm_ext_cx = gf.xfrm.ext_cx() as i64;
    spec.xfrm_ext_cy = gf.xfrm.ext_cy() as i64;
    spec.cnv_pr_ext_lst = cnv.ext_lst.clone();
    spec.anchor_edit_as = frame.edit_as.clone();
    spec.macro_name = gf.macro_name.clone();
    spec.client_data_locks_with_sheet = frame.client_data_locks_with_sheet;
    spec.client_data_prints_with_sheet = frame.client_data_prints_with_sheet;
    spec.anchor_index = frame.anchor_index.and_then(|idx| usize::try_from(idx).ok());
}

#[cfg(test)]
pub(crate) fn chart_ex_anchor_position(anchor: &DrawingAnchor) -> Option<AnchorPosition> {
    let content = match anchor {
        DrawingAnchor::TwoCell(tc) => &tc.content,
        DrawingAnchor::OneCell(oc) => &oc.content,
        DrawingAnchor::Absolute(_) => return None,
    };

    let DrawingContent::GraphicFrame(gf) = content else {
        return None;
    };
    let is_chartex = gf
        .graphic_xml
        .as_ref()
        .map(|xml| xml.contains("2014/chartex") || xml.contains("chartEx"))
        .unwrap_or(false);
    if !is_chartex {
        return None;
    }

    match anchor {
        DrawingAnchor::TwoCell(tc) => Some(AnchorPosition {
            anchor_row: tc.from.row,
            anchor_col: tc.from.col,
            anchor_row_offset: tc.from.row_off,
            anchor_col_offset: tc.from.col_off,
            absolute_x: None,
            absolute_y: None,
            end_row: Some(tc.to.row),
            end_col: Some(tc.to.col),
            end_row_offset: Some(tc.to.row_off),
            end_col_offset: Some(tc.to.col_off),
            extent_cx: None,
            extent_cy: None,
        }),
        DrawingAnchor::OneCell(oc) => Some(AnchorPosition {
            anchor_row: oc.from.row,
            anchor_col: oc.from.col,
            anchor_row_offset: oc.from.row_off,
            anchor_col_offset: oc.from.col_off,
            absolute_x: None,
            absolute_y: None,
            end_row: None,
            end_col: None,
            end_row_offset: None,
            end_col_offset: None,
            extent_cx: Some(oc.extent.cx),
            extent_cy: Some(oc.extent.cy),
        }),
        DrawingAnchor::Absolute(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::drawings::{CellAnchor, ClientData, TwoCellAnchor};
    use domain_types::domain::drawings::GroupShapeData;
    use ooxml_types::shared::OpcRelationship;

    fn chart_graphic_frame(r_id: &str) -> DrawingContent {
        DrawingContent::GraphicFrame(ooxml_types::drawings::SpreadsheetGraphicFrame {
            graphic_xml: Some(format!(
                r#"<xdr:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="{r_id}"/></a:graphicData></a:graphic></xdr:graphicFrame>"#
            )),
            ..Default::default()
        })
    }

    fn chart_relationship(id: &str, target: &str) -> OpcRelationship {
        OpcRelationship {
            id: id.to_string(),
            rel_type: crate::infra::opc::REL_CHART.to_string(),
            target: target.to_string(),
            target_mode: None,
        }
    }

    #[test]
    fn chart_drawing_frames_include_graphic_frames_nested_in_groups() {
        let drawing = Drawing {
            anchors: vec![DrawingAnchor::TwoCell(TwoCellAnchor {
                from: CellAnchor {
                    col: 1,
                    row: 2,
                    col_off: 3,
                    row_off: 4,
                },
                to: CellAnchor {
                    col: 8,
                    row: 9,
                    col_off: 10,
                    row_off: 11,
                },
                content: DrawingContent::GroupShape(GroupShapeData {
                    children: vec![
                        chart_graphic_frame("rId8"),
                        DrawingContent::GroupShape(GroupShapeData {
                            children: vec![chart_graphic_frame("rId9")],
                            ..Default::default()
                        }),
                    ],
                    ..Default::default()
                }),
                edit_as: None,
                client_data: ClientData::default(),
                mc_alternate_content: None,
            })],
            opc_rels: vec![
                chart_relationship("rId8", "../charts/chart8.xml"),
                chart_relationship("rId9", "../charts/chart9.xml"),
            ],
            ..Default::default()
        };
        let sheet = FullParsedSheet {
            parsed_drawing: Some(drawing),
            ..Default::default()
        };

        let frames = chart_drawing_frames(&sheet, false);

        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].0.anchor_row, 2);
        assert_eq!(frames[1].0.end_col, Some(8));
        assert_eq!(frames[0].1.relationship_id.as_deref(), Some("rId8"));
        assert_eq!(
            frames[1].1.relationship_target.as_deref(),
            Some("../charts/chart9.xml")
        );
        assert!(
            frames
                .iter()
                .all(|(_, frame)| frame.anchor_index == Some(0))
        );

        let by_target = chart_frames_by_relationship_target(&frames);
        assert!(by_target.contains_key("xl/charts/chart8.xml"));
        assert!(by_target.contains_key("xl/charts/chart9.xml"));
    }
}
