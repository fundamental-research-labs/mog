//! XML/archive parsing functions for chart reading.
//!
//! UTF-8 boundary guard: the single `&s[n..]` slice in this file strips an
//! ASCII `/` prefix from a relative-path string. Char-boundary by
//! construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use std::collections::HashMap;

use crate::infra::opc::{
    DrawingRelationships, OoxmlRelationshipType, PackageOwner, RelationshipTarget,
    WorksheetRelationships, parse_owned_relationships,
};
use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_gt_simd, find_tag_simd};

/// Info about a chart reference found in a drawing.
pub struct ChartRefInfo {
    /// Resolved file path (relative to drawings dir)
    pub target: String,
    /// Anchor row (from cell)
    pub from_row: u32,
    /// Anchor col (from cell)
    pub from_col: u32,
    /// EMU offset within the from-cell column
    pub from_col_off: i64,
    /// EMU offset within the from-cell row
    pub from_row_off: i64,
    /// Absolute x position in EMUs for `xdr:absoluteAnchor`
    pub absolute_x: Option<i64>,
    /// Absolute y position in EMUs for `xdr:absoluteAnchor`
    pub absolute_y: Option<i64>,
    /// End anchor row (for twoCellAnchor)
    pub to_row: Option<u32>,
    /// End anchor col (for twoCellAnchor)
    pub to_col: Option<u32>,
    /// EMU offset within the to-cell column
    pub to_col_off: Option<i64>,
    /// EMU offset within the to-cell row
    pub to_row_off: Option<i64>,
    /// Extent cx in EMUs (from oneCellAnchor or computed)
    pub cx: i64,
    /// Extent cy in EMUs
    pub cy: i64,
    /// xfrm offset x in EMUs (from graphicFrame transform)
    pub xfrm_off_x: i64,
    /// xfrm offset y in EMUs
    pub xfrm_off_y: i64,
    /// xfrm extent cx in EMUs
    pub xfrm_ext_cx: i64,
    /// xfrm extent cy in EMUs
    pub xfrm_ext_cy: i64,
    /// cNvPr name attribute from the graphicFrame
    pub cnv_pr_name: Option<String>,
    /// cNvPr id attribute from the graphicFrame
    pub cnv_pr_id: Option<u32>,
    /// cNvPr descr attribute (alt text / description) from the graphicFrame
    pub cnv_pr_descr: Option<String>,
    /// cNvPr title attribute from the graphicFrame
    pub cnv_pr_title: Option<String>,
    /// cNvPr hidden attribute from the graphicFrame
    pub cnv_pr_hidden: bool,
    /// Whether noChangeAspect was explicitly set on graphicFrameLocks
    pub no_change_aspect: Option<bool>,
    /// Whether `<a:graphicFrameLocks>` was present (even if empty/no attributes)
    pub has_graphic_frame_locks: bool,
    /// Opaque <a:extLst> XML from cNvPr (for round-trip of creationId etc.)
    pub cnv_pr_ext_lst: Option<String>,
    /// editAs attribute from the drawing anchor ("oneCell", "twoCell", "absolute")
    pub anchor_edit_as: Option<String>,
    /// Macro name from graphicFrame element (@macro attribute).
    /// `Some("")` preserves `macro=""` for round-trip fidelity.
    pub macro_name: Option<String>,
    /// Whether fLocksWithSheet is false on the anchor's clientData.
    pub client_data_locks_with_sheet: Option<bool>,
    /// Whether fPrintsWithSheet is false on the anchor's clientData.
    pub client_data_prints_with_sheet: Option<bool>,
    /// Original index of this anchor within the drawing's anchor list (for ordering fidelity).
    pub anchor_index: Option<usize>,
}

/// Extract drawing relationship target from sheet .rels XML.
#[cfg(test)]
pub(super) fn extract_drawing_target(rels_xml: &[u8]) -> Option<String> {
    let relationships = parse_owned_relationships(
        PackageOwner::Worksheet {
            sheet_index: 0,
            path: "xl/worksheets/sheet1.xml".to_string(),
        },
        rels_xml,
    );
    WorksheetRelationships::new(&relationships)
        .drawing()
        .map(|rel| rel.target.raw().to_string())
}

pub(super) fn extract_drawing_path_for_sheet(sheet_num: usize, rels_xml: &[u8]) -> Option<String> {
    let relationships = parse_owned_relationships(
        PackageOwner::Worksheet {
            sheet_index: sheet_num,
            path: format!("xl/worksheets/sheet{}.xml", sheet_num),
        },
        rels_xml,
    );
    WorksheetRelationships::new(&relationships)
        .drawing()
        .and_then(|rel| rel.target.path().map(ToOwned::to_owned))
}

pub(super) fn typed_drawing_relationships(
    drawing_path: &str,
    rels_xml: &[u8],
) -> Vec<crate::infra::opc::OwnedRelationship> {
    parse_owned_relationships(
        PackageOwner::Drawing {
            path: drawing_path.to_string(),
        },
        rels_xml,
    )
}

pub(super) fn chart_rel_id_target_map(
    drawing_relationships: &[crate::infra::opc::OwnedRelationship],
) -> HashMap<String, String> {
    DrawingRelationships::new(drawing_relationships)
        .typed_target_map(&[OoxmlRelationshipType::Chart])
}

pub(super) fn internal_target_path(rel: &crate::infra::opc::OwnedRelationship) -> Option<String> {
    match &rel.target {
        RelationshipTarget::Internal { path, .. } => Some(path.clone()),
        _ => None,
    }
}

/// Build a map of rId -> target from a .rels XML file.
pub(super) fn extract_rel_id_target_map_bytes(rels_xml: &[u8]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut pos = 0;
    while let Some(rel_start) = find_tag_simd(rels_xml, b"Relationship", pos) {
        let rel_end = find_gt_simd(rels_xml, rel_start)
            .map(|p| p + 1)
            .unwrap_or(rels_xml.len());
        let rel_elem = &rels_xml[rel_start..rel_end];

        let id_opt = find_attr_simd(rel_elem, b"Id=\"", 0).and_then(|p| {
            extract_quoted_value(rel_elem, p + 4) // len of 'Id="'
        });
        let target_opt = find_attr_simd(rel_elem, b"Target=\"", 0).and_then(|p| {
            extract_quoted_value(rel_elem, p + 8) // len of 'Target="'
        });

        if let (Some((is, ie)), Some((ts, te))) = (id_opt, target_opt) {
            if let (Ok(id), Ok(target)) = (
                std::str::from_utf8(&rel_elem[is..ie]),
                std::str::from_utf8(&rel_elem[ts..te]),
            ) {
                map.insert(id.to_string(), target.to_string());
            }
        }
        pos = rel_end;
    }
    map
}

/// Extract chart references from drawing XML by finding graphicFrame elements.
///
/// In OOXML, charts appear as:
/// ```xml
/// <xdr:twoCellAnchor>
///   <xdr:from><xdr:col>0</xdr:col><xdr:row>0</xdr:row>...</xdr:from>
///   <xdr:to><xdr:col>8</xdr:col><xdr:row>15</xdr:row>...</xdr:to>
///   <xdr:graphicFrame>
///     <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
///       <c:chart r:id="rId1"/>
///     </a:graphicData></a:graphic>
///   </xdr:graphicFrame>
/// </xdr:twoCellAnchor>
/// ```
pub(super) fn extract_chart_refs_from_drawing(
    drawing_xml: &[u8],
    rels_map: &HashMap<String, String>,
) -> Vec<ChartRefInfo> {
    let mut refs = Vec::new();
    let mut pos = 0;
    let mut anchor_index: usize = 0; // Track overall anchor index across all types

    while let Some(anchor) = next_chart_anchor(drawing_xml, pos) {
        let anchor_bytes = &drawing_xml[anchor.start..anchor.end];
        append_chart_refs_for_anchor(anchor_bytes, anchor.kind, anchor_index, rels_map, &mut refs);
        anchor_index += 1;
        pos = anchor.end;
    }

    refs
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChartAnchorKind {
    TwoCell,
    OneCell,
    Absolute,
}

struct RawChartAnchor {
    kind: ChartAnchorKind,
    start: usize,
    end: usize,
}

fn next_chart_anchor(drawing_xml: &[u8], pos: usize) -> Option<RawChartAnchor> {
    use crate::infra::scanner::find_closing_tag;

    let candidates = [
        (ChartAnchorKind::TwoCell, b"twoCellAnchor".as_slice()),
        (ChartAnchorKind::OneCell, b"oneCellAnchor".as_slice()),
        (ChartAnchorKind::Absolute, b"absoluteAnchor".as_slice()),
    ];
    let (kind, tag, start) = candidates
        .into_iter()
        .filter_map(|(kind, tag)| {
            find_tag_simd(drawing_xml, tag, pos).map(|start| (kind, tag, start))
        })
        .min_by_key(|(_, _, start)| *start)?;
    let end = find_closing_tag(drawing_xml, tag, start).unwrap_or(drawing_xml.len());
    Some(RawChartAnchor { kind, start, end })
}

fn append_chart_refs_for_anchor(
    anchor_bytes: &[u8],
    kind: ChartAnchorKind,
    anchor_index: usize,
    rels_map: &HashMap<String, String>,
    refs: &mut Vec<ChartRefInfo>,
) {
    for (chart_ref, frame_bytes) in extract_chart_rids_from_anchor(anchor_bytes) {
        let Some(target) = rels_map.get(&chart_ref) else {
            continue;
        };

        let (from_row, from_col, from_col_off, from_row_off) =
            if matches!(kind, ChartAnchorKind::Absolute) {
                (0, 0, 0, 0)
            } else {
                parse_anchor_from(anchor_bytes)
            };
        let (absolute_x, absolute_y) = if matches!(kind, ChartAnchorKind::Absolute) {
            let (x, y) = parse_anchor_position(anchor_bytes);
            (Some(x), Some(y))
        } else {
            (None, None)
        };
        let (to_row, to_col, to_col_off, to_row_off) = if matches!(kind, ChartAnchorKind::TwoCell) {
            let (to_row, to_col, to_col_off, to_row_off) = parse_anchor_to(anchor_bytes);
            (
                Some(to_row),
                Some(to_col),
                Some(to_col_off),
                Some(to_row_off),
            )
        } else {
            (None, None, None, None)
        };
        let (anchor_cx, anchor_cy) =
            if matches!(kind, ChartAnchorKind::OneCell | ChartAnchorKind::Absolute) {
                parse_anchor_extent(anchor_bytes)
            } else {
                (0, 0)
            };
        let (xfrm_off_x, xfrm_off_y, xfrm_ext_cx, xfrm_ext_cy) =
            parse_graphicframe_xfrm(frame_bytes);
        let cnv_pr = parse_graphicframe_cnvpr(frame_bytes);
        let (has_graphic_frame_locks, no_change_aspect) = parse_graphicframe_locks(frame_bytes);
        let anchor_edit_as = if matches!(kind, ChartAnchorKind::TwoCell) {
            extract_edit_as_attr(anchor_bytes)
        } else if matches!(kind, ChartAnchorKind::Absolute) {
            Some("absolute".to_string())
        } else {
            None
        };
        let macro_name = parse_graphicframe_macro(frame_bytes);
        let (client_data_locks_with_sheet, client_data_prints_with_sheet) =
            parse_client_data_attrs(anchor_bytes);

        refs.push(ChartRefInfo {
            target: target.clone(),
            from_row,
            from_col,
            from_col_off,
            from_row_off,
            absolute_x,
            absolute_y,
            to_row,
            to_col,
            to_col_off,
            to_row_off,
            cx: if anchor_cx > 0 {
                anchor_cx
            } else {
                xfrm_ext_cx
            },
            cy: if anchor_cy > 0 {
                anchor_cy
            } else {
                xfrm_ext_cy
            },
            xfrm_off_x,
            xfrm_off_y,
            xfrm_ext_cx,
            xfrm_ext_cy,
            cnv_pr_name: cnv_pr.name,
            cnv_pr_id: cnv_pr.id,
            cnv_pr_descr: cnv_pr.descr,
            cnv_pr_title: cnv_pr.title,
            cnv_pr_hidden: cnv_pr.hidden,
            no_change_aspect,
            has_graphic_frame_locks,
            cnv_pr_ext_lst: cnv_pr.ext_lst,
            anchor_edit_as,
            macro_name,
            client_data_locks_with_sheet,
            client_data_prints_with_sheet,
            anchor_index: Some(anchor_index),
        });
    }
}

/// Extract all chart relationship IDs from an anchor element.
///
/// Grouped chart dashboards can contain multiple `<xdr:graphicFrame>` chart
/// children inside one anchor; each one is a distinct chart object.
fn extract_chart_rids_from_anchor(anchor_xml: &[u8]) -> Vec<(String, &[u8])> {
    use crate::infra::scanner::find_closing_tag;

    // Find the chart namespace URI to confirm this is a chart graphic
    let chart_uri = b"http://schemas.openxmlformats.org/drawingml/2006/chart";
    if memchr::memmem::find(anchor_xml, chart_uri).is_none() {
        return Vec::new();
    }

    let mut refs = Vec::new();
    let mut pos = 0;
    while let Some(frame_start) = find_tag_simd(anchor_xml, b"graphicFrame", pos) {
        let frame_end =
            find_closing_tag(anchor_xml, b"graphicFrame", frame_start).unwrap_or(anchor_xml.len());
        let frame_bytes = &anchor_xml[frame_start..frame_end];
        if let Some(rid) = extract_chart_rid_from_graphic_frame(frame_bytes) {
            refs.push((rid, frame_bytes));
        }
        pos = frame_end;
    }

    refs
}

/// Extract chart relationship ID from a graphic frame element.
/// Looks for `<c:chart r:id="rIdN"/>` inside a `<a:graphicData>` element.
fn extract_chart_rid_from_graphic_frame(frame_xml: &[u8]) -> Option<String> {
    // Find the chart namespace URI to confirm this is a chart graphic
    let chart_uri = b"http://schemas.openxmlformats.org/drawingml/2006/chart";
    memchr::memmem::find(frame_xml, chart_uri)?;

    // Find chart element and extract r:id
    if let Some(chart_start) = find_tag_simd(frame_xml, b"chart", 0) {
        let chart_end = find_gt_simd(frame_xml, chart_start)
            .map(|p| p + 1)
            .unwrap_or(frame_xml.len());
        let chart_elem = &frame_xml[chart_start..chart_end];

        // Try r:id first
        if let Some(rid_pos) = find_attr_simd(chart_elem, b"r:id=\"", 0) {
            let val_start = rid_pos + 6; // len of 'r:id="'
            if let Some((rs, re)) = extract_quoted_value(chart_elem, val_start) {
                if let Ok(rid) = std::str::from_utf8(&chart_elem[rs..re]) {
                    return Some(rid.to_string());
                }
            }
        }
        // Also try without namespace prefix
        if let Some(rid_pos) = find_attr_simd(chart_elem, b"id=\"", 0) {
            let val_start = rid_pos + 4; // len of 'id="'
            if let Some((rs, re)) = extract_quoted_value(chart_elem, val_start) {
                if let Ok(rid) = std::str::from_utf8(&chart_elem[rs..re]) {
                    return Some(rid.to_string());
                }
            }
        }
    }
    None
}

/// Parse <xdr:from> element for row, col, colOff, rowOff.
pub(super) fn parse_anchor_from(xml: &[u8]) -> (u32, u32, i64, i64) {
    use crate::infra::scanner::find_closing_tag;

    let from_start = match find_tag_simd(xml, b"from", 0) {
        Some(p) => p,
        None => return (0, 0, 0, 0),
    };
    let from_end = find_closing_tag(xml, b"from", from_start).unwrap_or(xml.len());
    let from_bytes = &xml[from_start..from_end];

    let col = parse_element_text_u32(from_bytes, b"col");
    let row = parse_element_text_u32(from_bytes, b"row");
    let col_off = parse_element_text_i64(from_bytes, b"colOff");
    let row_off = parse_element_text_i64(from_bytes, b"rowOff");
    (row, col, col_off, row_off)
}

/// Parse <xdr:to> element for row, col, colOff, rowOff.
pub(super) fn parse_anchor_to(xml: &[u8]) -> (u32, u32, i64, i64) {
    use crate::infra::scanner::find_closing_tag;

    let to_start = match find_tag_simd(xml, b"to", 0) {
        Some(p) => p,
        None => return (0, 0, 0, 0),
    };
    let to_end = find_closing_tag(xml, b"to", to_start).unwrap_or(xml.len());
    let to_bytes = &xml[to_start..to_end];

    let col = parse_element_text_u32(to_bytes, b"col");
    let row = parse_element_text_u32(to_bytes, b"row");
    let col_off = parse_element_text_i64(to_bytes, b"colOff");
    let row_off = parse_element_text_i64(to_bytes, b"rowOff");
    (row, col, col_off, row_off)
}

/// Parse <xdr:pos x="..." y="..."/> for absolute anchors.
fn parse_anchor_position(xml: &[u8]) -> (i64, i64) {
    if let Some(pos_start) = find_tag_simd(xml, b"pos", 0) {
        let pos_end = find_gt_simd(xml, pos_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let pos_elem = &xml[pos_start..pos_end];

        let x = find_attr_simd(pos_elem, b"x=\"", 0)
            .and_then(|p| extract_quoted_value(pos_elem, p + 3))
            .and_then(|(s, e)| {
                std::str::from_utf8(&pos_elem[s..e])
                    .ok()?
                    .parse::<i64>()
                    .ok()
            })
            .unwrap_or(0);
        let y = find_attr_simd(pos_elem, b"y=\"", 0)
            .and_then(|p| extract_quoted_value(pos_elem, p + 3))
            .and_then(|(s, e)| {
                std::str::from_utf8(&pos_elem[s..e])
                    .ok()?
                    .parse::<i64>()
                    .ok()
            })
            .unwrap_or(0);
        (x, y)
    } else {
        (0, 0)
    }
}

/// Parse xfrm (transform) from a graphicFrame element.
/// Returns (off_x, off_y, ext_cx, ext_cy).
fn parse_graphicframe_xfrm(xml: &[u8]) -> (i64, i64, i64, i64) {
    use crate::infra::scanner::find_closing_tag;

    // Find the xfrm element within graphicFrame
    let xfrm_start = match find_tag_simd(xml, b"xfrm", 0) {
        Some(p) => p,
        None => return (0, 0, 4572000, 2743200),
    };
    let xfrm_end = find_closing_tag(xml, b"xfrm", xfrm_start).unwrap_or(xml.len());
    let xfrm_bytes = &xml[xfrm_start..xfrm_end];

    // Parse <a:off x="..." y="..."/>
    let (off_x, off_y) = if let Some(off_start) = find_tag_simd(xfrm_bytes, b"off", 0) {
        let off_end = find_gt_simd(xfrm_bytes, off_start)
            .map(|p| p + 1)
            .unwrap_or(xfrm_bytes.len());
        let off_elem = &xfrm_bytes[off_start..off_end];

        let x = find_attr_simd(off_elem, b"x=\"", 0)
            .and_then(|p| extract_quoted_value(off_elem, p + 3))
            .and_then(|(s, e)| {
                std::str::from_utf8(&off_elem[s..e])
                    .ok()?
                    .parse::<i64>()
                    .ok()
            })
            .unwrap_or(0);
        let y = find_attr_simd(off_elem, b"y=\"", 0)
            .and_then(|p| extract_quoted_value(off_elem, p + 3))
            .and_then(|(s, e)| {
                std::str::from_utf8(&off_elem[s..e])
                    .ok()?
                    .parse::<i64>()
                    .ok()
            })
            .unwrap_or(0);
        (x, y)
    } else {
        (0, 0)
    };

    // Parse <a:ext cx="..." cy="..."/>
    let (ext_cx, ext_cy) = if let Some(ext_start) = find_tag_simd(xfrm_bytes, b"ext", 0) {
        let ext_end = find_gt_simd(xfrm_bytes, ext_start)
            .map(|p| p + 1)
            .unwrap_or(xfrm_bytes.len());
        let ext_elem = &xfrm_bytes[ext_start..ext_end];

        let cx = find_attr_simd(ext_elem, b"cx=\"", 0)
            .and_then(|p| extract_quoted_value(ext_elem, p + 4))
            .and_then(|(s, e)| {
                std::str::from_utf8(&ext_elem[s..e])
                    .ok()?
                    .parse::<i64>()
                    .ok()
            })
            .unwrap_or(4572000);
        let cy = find_attr_simd(ext_elem, b"cy=\"", 0)
            .and_then(|p| extract_quoted_value(ext_elem, p + 4))
            .and_then(|(s, e)| {
                std::str::from_utf8(&ext_elem[s..e])
                    .ok()?
                    .parse::<i64>()
                    .ok()
            })
            .unwrap_or(2743200);
        (cx, cy)
    } else {
        (4572000, 2743200)
    };

    (off_x, off_y, ext_cx, ext_cy)
}

/// Parse cNvPr attributes (name, id) and child extLst from a graphicFrame element.
/// Parsed cNvPr attributes from a graphicFrame element.
struct GraphicFrameCnvPr {
    name: Option<String>,
    id: Option<u32>,
    ext_lst: Option<String>,
    descr: Option<String>,
    title: Option<String>,
    hidden: bool,
}

fn parse_graphicframe_cnvpr(xml: &[u8]) -> GraphicFrameCnvPr {
    use crate::infra::scanner::find_closing_tag;

    // Find cNvPr element within the graphicFrame
    let cnvpr_start = match find_tag_simd(xml, b"cNvPr", 0) {
        Some(p) => p,
        None => {
            return GraphicFrameCnvPr {
                name: None,
                id: None,
                ext_lst: None,
                descr: None,
                title: None,
                hidden: false,
            };
        }
    };
    let cnvpr_end = find_gt_simd(xml, cnvpr_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let cnvpr_elem = &xml[cnvpr_start..cnvpr_end];

    let name = find_attr_simd(cnvpr_elem, b"name=\"", 0)
        .and_then(|p| extract_quoted_value(cnvpr_elem, p + 6))
        .map(|(s, e)| crate::infra::xml::decode_xml_entities(&cnvpr_elem[s..e]));

    let id = find_attr_simd(cnvpr_elem, b"id=\"", 0)
        .and_then(|p| extract_quoted_value(cnvpr_elem, p + 4))
        .and_then(|(s, e)| {
            std::str::from_utf8(&cnvpr_elem[s..e])
                .ok()?
                .parse::<u32>()
                .ok()
        });

    let descr = find_attr_simd(cnvpr_elem, b"descr=\"", 0)
        .and_then(|p| extract_quoted_value(cnvpr_elem, p + 7))
        .map(|(s, e)| crate::infra::xml::decode_xml_entities(&cnvpr_elem[s..e]));

    let title = find_attr_simd(cnvpr_elem, b"title=\"", 0)
        .and_then(|p| extract_quoted_value(cnvpr_elem, p + 7))
        .map(|(s, e)| crate::infra::xml::decode_xml_entities(&cnvpr_elem[s..e]));

    let hidden = find_attr_simd(cnvpr_elem, b"hidden=\"", 0)
        .and_then(|p| extract_quoted_value(cnvpr_elem, p + 8))
        .map(|(s, e)| &cnvpr_elem[s..e] == b"1" || &cnvpr_elem[s..e] == b"true")
        .unwrap_or(false);

    // Extract <a:extLst>...</a:extLst> child if present (opaque passthrough for round-trip).
    let ext_lst = find_tag_simd(xml, b"a:extLst", cnvpr_start).and_then(|ext_start| {
        let ext_close = find_closing_tag(xml, b"a:extLst", ext_start)?;
        // Include the closing tag itself
        let tag_end = find_gt_simd(xml, ext_close).map(|p| p + 1)?;
        std::str::from_utf8(&xml[ext_start..tag_end])
            .ok()
            .map(|s| s.to_string())
    });

    GraphicFrameCnvPr {
        name,
        id,
        ext_lst,
        descr,
        title,
        hidden,
    }
}

/// Parse the `macro` attribute from the `<xdr:graphicFrame>` opening tag.
///
/// Returns `Some("")` when `macro=""` is present (preserving for round-trip fidelity),
/// `Some("name")` for non-empty macro names, `None` when the attribute is absent.
fn parse_graphicframe_macro(xml: &[u8]) -> Option<String> {
    let gf_start = find_tag_simd(xml, b"graphicFrame", 0)?;
    let gf_end = find_gt_simd(xml, gf_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let gf_elem = &xml[gf_start..gf_end];

    find_attr_simd(gf_elem, b"macro=\"", 0)
        .and_then(|p| extract_quoted_value(gf_elem, p + 7))
        .map(|(s, e)| crate::infra::xml::decode_xml_entities(&gf_elem[s..e]))
}

/// Parse noChangeAspect attribute from graphicFrameLocks.
/// Returns `(has_element, no_change_aspect)`.
/// `has_element` is true if `<a:graphicFrameLocks>` was present (even empty).
fn parse_graphicframe_locks(xml: &[u8]) -> (bool, Option<bool>) {
    let Some(locks_start) = find_tag_simd(xml, b"graphicFrameLocks", 0) else {
        return (false, None);
    };
    let locks_end = find_gt_simd(xml, locks_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let locks_elem = &xml[locks_start..locks_end];

    let nca = find_attr_simd(locks_elem, b"noChangeAspect=\"", 0)
        .and_then(|p| extract_quoted_value(locks_elem, p + 16))
        .and_then(|(s, e)| {
            let val = std::str::from_utf8(&locks_elem[s..e]).ok()?;
            Some(val == "1" || val == "true")
        });
    (true, nca)
}

/// Parse <xdr:ext cx="..." cy="..."/> extent element.
fn parse_anchor_extent(xml: &[u8]) -> (i64, i64) {
    if let Some(ext_start) = find_tag_simd(xml, b"ext", 0) {
        let ext_end = find_gt_simd(xml, ext_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let ext_elem = &xml[ext_start..ext_end];

        let cx = find_attr_simd(ext_elem, b"cx=\"", 0)
            .and_then(|p| extract_quoted_value(ext_elem, p + 4))
            .and_then(|(s, e)| {
                std::str::from_utf8(&ext_elem[s..e])
                    .ok()?
                    .parse::<i64>()
                    .ok()
            })
            .unwrap_or(4572000);
        let cy = find_attr_simd(ext_elem, b"cy=\"", 0)
            .and_then(|p| extract_quoted_value(ext_elem, p + 4))
            .and_then(|(s, e)| {
                std::str::from_utf8(&ext_elem[s..e])
                    .ok()?
                    .parse::<i64>()
                    .ok()
            })
            .unwrap_or(2743200);
        (cx, cy)
    } else {
        (4572000, 2743200) // Default ~480x288 px
    }
}

/// Parse integer text content of a simple XML element like `<col>5</col>`.
fn parse_element_text_u32(xml: &[u8], tag: &[u8]) -> u32 {
    use crate::infra::scanner::find_closing_tag;

    if let Some(start) = find_tag_simd(xml, tag, 0) {
        let content_start = find_gt_simd(xml, start).map(|p| p + 1);
        let content_end = find_closing_tag(xml, tag, start);
        if let (Some(cs), Some(ce)) = (content_start, content_end) {
            if cs < ce {
                return String::from_utf8_lossy(&xml[cs..ce])
                    .trim()
                    .parse::<u32>()
                    .unwrap_or(0);
            }
        }
    }
    0
}

/// Parse integer text content of a simple XML element like `<colOff>123</colOff>` as i64.
fn parse_element_text_i64(xml: &[u8], tag: &[u8]) -> i64 {
    use crate::infra::scanner::find_closing_tag;

    if let Some(start) = find_tag_simd(xml, tag, 0) {
        let content_start = find_gt_simd(xml, start).map(|p| p + 1);
        let content_end = find_closing_tag(xml, tag, start);
        if let (Some(cs), Some(ce)) = (content_start, content_end) {
            if cs < ce {
                return String::from_utf8_lossy(&xml[cs..ce])
                    .trim()
                    .parse::<i64>()
                    .unwrap_or(0);
            }
        }
    }
    0
}

/// Resolve a relative path from a base directory.
/// E.g., ("xl/worksheets", "../drawings/drawing1.xml") -> "xl/drawings/drawing1.xml"
pub(super) fn resolve_relative_path(base_dir: &str, relative: &str) -> String {
    if !relative.starts_with("..") {
        // Absolute-ish path or same-directory reference
        if let Some(stripped) = relative.strip_prefix('/') {
            return stripped.to_string();
        }
        return format!("{}/{}", base_dir, relative);
    }

    let mut parts: Vec<&str> = base_dir.split('/').collect();
    for segment in relative.split('/') {
        if segment == ".." {
            parts.pop();
        } else {
            parts.push(segment);
        }
    }
    parts.join("/")
}

/// Extract the editAs attribute from a twoCellAnchor element.
fn extract_edit_as_attr(anchor_bytes: &[u8]) -> Option<String> {
    use crate::infra::scanner::extract_quoted_value;
    let needle = b"editAs=\"";
    let pos = memchr::memmem::find(anchor_bytes, needle)?;
    // Only look within the opening tag (before the first '>' after the match)
    let value_start = pos + needle.len();
    let (start, end) = extract_quoted_value(anchor_bytes, value_start)?;
    std::str::from_utf8(&anchor_bytes[start..end])
        .ok()
        .map(|s| s.to_string())
}

/// Parse `fLocksWithSheet` and `fPrintsWithSheet` from the `<xdr:clientData>` element.
///
/// Returns `(locks_with_sheet, prints_with_sheet)` -- `None` means use default (true),
/// `Some(false)` means the attribute was explicitly set to "0".
fn parse_client_data_attrs(anchor_bytes: &[u8]) -> (Option<bool>, Option<bool>) {
    use crate::infra::scanner::{extract_quoted_value, find_attr_simd};
    let cd_needle = b"clientData";
    let cd_pos = match memchr::memmem::find(anchor_bytes, cd_needle) {
        Some(p) => p,
        None => return (None, None),
    };
    let el = &anchor_bytes[cd_pos..];

    let extract_attr = |bytes: &[u8], attr: &[u8]| -> Option<bool> {
        let attr_pos = find_attr_simd(bytes, attr, 0)?;
        let value_start = attr_pos + attr.len();
        let (start, end) = extract_quoted_value(bytes, value_start)?;
        let val = &bytes[start..end];
        Some(val != b"0" && val != b"false")
    };

    let locks = extract_attr(el, b"fLocksWithSheet=\"");
    let prints = extract_attr(el, b"fPrintsWithSheet=\"");
    (locks, prints)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{extract_chart_refs_from_drawing, extract_drawing_target};

    #[test]
    fn extract_drawing_target_matches_only_drawing_relationship() {
        let rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>"#;

        assert_eq!(
            extract_drawing_target(rels).as_deref(),
            Some("../drawings/drawing1.xml")
        );
    }

    #[test]
    fn extract_drawing_target_does_not_match_vml_drawing_relationship() {
        let rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments3.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>"#;

        assert_eq!(extract_drawing_target(rels), None);
    }

    #[test]
    fn extract_chart_refs_emits_all_grouped_chart_frames_in_one_anchor() {
        let drawing = br#"
        <xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
                  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                  xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <xdr:twoCellAnchor editAs="oneCell">
            <xdr:from><xdr:col>3</xdr:col><xdr:row>4</xdr:row></xdr:from>
            <xdr:to><xdr:col>9</xdr:col><xdr:row>20</xdr:row></xdr:to>
            <xdr:grpSp>
              <xdr:graphicFrame macro="">
                <xdr:nvGraphicFramePr><xdr:cNvPr id="25" name="Chart 25"/><xdr:cNvGraphicFramePr><a:graphicFrameLocks/></xdr:cNvGraphicFramePr></xdr:nvGraphicFramePr>
                <xdr:xfrm><a:off x="10" y="20"/><a:ext cx="300" cy="400"/></xdr:xfrm>
                <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId6"/></a:graphicData></a:graphic>
              </xdr:graphicFrame>
              <xdr:graphicFrame macro="">
                <xdr:nvGraphicFramePr><xdr:cNvPr id="26" name="Chart 26"/><xdr:cNvGraphicFramePr><a:graphicFrameLocks/></xdr:cNvGraphicFramePr></xdr:nvGraphicFramePr>
                <xdr:xfrm><a:off x="30" y="40"/><a:ext cx="500" cy="600"/></xdr:xfrm>
                <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId7"/></a:graphicData></a:graphic>
              </xdr:graphicFrame>
            </xdr:grpSp>
            <xdr:clientData/>
          </xdr:twoCellAnchor>
        </xdr:wsDr>
        "#;
        let rels_map = HashMap::from([
            ("rId6".to_string(), "xl/charts/chart6.xml".to_string()),
            ("rId7".to_string(), "xl/charts/chart7.xml".to_string()),
        ]);

        let refs = extract_chart_refs_from_drawing(drawing, &rels_map);

        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].target, "xl/charts/chart6.xml");
        assert_eq!(refs[0].cnv_pr_name.as_deref(), Some("Chart 25"));
        assert_eq!(refs[0].xfrm_ext_cx, 300);
        assert_eq!(refs[0].anchor_index, Some(0));
        assert_eq!(refs[1].target, "xl/charts/chart7.xml");
        assert_eq!(refs[1].cnv_pr_name.as_deref(), Some("Chart 26"));
        assert_eq!(refs[1].xfrm_ext_cx, 500);
        assert_eq!(refs[1].anchor_index, Some(0));
    }

    #[test]
    fn extract_chart_refs_preserves_document_order_across_anchor_kinds() {
        let drawing = br#"
        <xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
                  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                  xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <xdr:oneCellAnchor>
            <xdr:from><xdr:col>1</xdr:col><xdr:row>2</xdr:row></xdr:from>
            <xdr:ext cx="700" cy="800"/>
            <xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="1" name="First"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame>
            <xdr:clientData/>
          </xdr:oneCellAnchor>
          <xdr:twoCellAnchor>
            <xdr:from><xdr:col>3</xdr:col><xdr:row>4</xdr:row></xdr:from>
            <xdr:to><xdr:col>5</xdr:col><xdr:row>6</xdr:row></xdr:to>
            <xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Second"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId2"/></a:graphicData></a:graphic></xdr:graphicFrame>
            <xdr:clientData/>
          </xdr:twoCellAnchor>
        </xdr:wsDr>
        "#;
        let rels_map = HashMap::from([
            ("rId1".to_string(), "xl/charts/chart1.xml".to_string()),
            ("rId2".to_string(), "xl/charts/chart2.xml".to_string()),
        ]);

        let refs = extract_chart_refs_from_drawing(drawing, &rels_map);

        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].target, "xl/charts/chart1.xml");
        assert_eq!(refs[0].anchor_index, Some(0));
        assert_eq!(refs[0].to_row, None);
        assert_eq!(refs[1].target, "xl/charts/chart2.xml");
        assert_eq!(refs[1].anchor_index, Some(1));
        assert_eq!(refs[1].to_row, Some(6));
    }
}
