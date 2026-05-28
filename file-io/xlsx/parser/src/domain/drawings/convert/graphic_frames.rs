#![allow(clippy::string_slice)]

use super::write;
use ooxml_types::drawings as ooxml;

/// Extract a chart reference from a GraphicFrame if it contains a chart URI.
///
/// Detects `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">`
/// and extracts the `r:id` attribute from `<c:chart r:id="..."/>`.
pub fn extract_chart_ref_from_graphic_frame(
    gf: &ooxml::SpreadsheetGraphicFrame,
) -> Option<write::ChartRef> {
    let xml = gf.graphic_xml.as_ref()?;

    const CHART_URI: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";
    if !xml.contains(CHART_URI) {
        return None;
    }

    let r_id = extract_r_id_from_chart_xml(xml)?;
    let name = gf.nv_graphic_frame_pr.c_nv_pr.name.clone();

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
/// The slices split at ASCII-only delimiter positions, so UTF-8 boundaries are
/// preserved by construction.
fn extract_r_id_from_chart_xml(xml: &str) -> Option<String> {
    let r_id_marker = "r:id=\"";
    let start = xml.find(r_id_marker)?;
    let value_start = start + r_id_marker.len();
    let remaining = &xml[value_start..];
    let end = remaining.find('"')?;
    Some(remaining[..end].to_string())
}
