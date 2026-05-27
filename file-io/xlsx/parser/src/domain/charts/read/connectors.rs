//! Connector parsing from drawings.

use crate::zip::XlsxArchive;

use super::xml_parsing::extract_drawing_path_for_sheet;

#[derive(Debug, Clone, Copy)]
struct ConnectorAnchor {
    anchor_row: Option<u32>,
    anchor_col: Option<u32>,
    anchor_row_offset: i64,
    anchor_col_offset: i64,
    end_row: Option<u32>,
    end_col: Option<u32>,
    end_row_offset: Option<i64>,
    end_col_offset: Option<i64>,
    width: Option<i64>,
    height: Option<i64>,
}

/// Parse connectors for a given sheet by scanning the drawing XML.
///
/// Connectors are `<cxnSp>` elements within drawing anchors. Unlike charts or
/// SmartArt, they don't require external file resolution -- all data is inline.
pub fn parse_connectors_for_sheet(
    archive: &XlsxArchive,
    sheet_num: usize,
) -> Vec<crate::output::results::ConnectorOutput> {
    use crate::domain::drawings::Anchor;

    let mut connectors = Vec::new();

    // Step 1: Read sheet .rels to find drawing reference
    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    let rels_xml = match archive.read_file(&rels_path) {
        Ok(xml) => xml,
        Err(_) => return connectors,
    };

    let drawing_path = match extract_drawing_path_for_sheet(sheet_num, &rels_xml) {
        Some(path) => path,
        None => return connectors,
    };

    // Step 2: Read the drawing XML
    let drawing_xml = match archive.read_file(&drawing_path) {
        Ok(xml) => xml,
        Err(_) => return connectors,
    };

    // Step 3: Parse the drawing and extract connectors from anchors
    let drawing = crate::domain::drawings::parse_drawing(&drawing_xml);

    for anchor in &drawing.anchors {
        let (content, anchor) = match anchor {
            Anchor::TwoCell(a) => (
                &a.content,
                ConnectorAnchor {
                    anchor_row: Some(a.from.row),
                    anchor_col: Some(a.from.col),
                    anchor_row_offset: a.from.row_off,
                    anchor_col_offset: a.from.col_off,
                    end_row: Some(a.to.row),
                    end_col: Some(a.to.col),
                    end_row_offset: Some(a.to.row_off),
                    end_col_offset: Some(a.to.col_off),
                    width: None,
                    height: None,
                },
            ),
            Anchor::OneCell(a) => (
                &a.content,
                ConnectorAnchor {
                    anchor_row: Some(a.from.row),
                    anchor_col: Some(a.from.col),
                    anchor_row_offset: a.from.row_off,
                    anchor_col_offset: a.from.col_off,
                    end_row: None,
                    end_col: None,
                    end_row_offset: None,
                    end_col_offset: None,
                    width: Some(a.extent.cx),
                    height: Some(a.extent.cy),
                },
            ),
            Anchor::Absolute(a) => (
                &a.content,
                ConnectorAnchor {
                    anchor_row: None,
                    anchor_col: None,
                    anchor_row_offset: 0,
                    anchor_col_offset: 0,
                    end_row: None,
                    end_col: None,
                    end_row_offset: None,
                    end_col_offset: None,
                    width: Some(a.extent.cx),
                    height: Some(a.extent.cy),
                },
            ),
        };

        // Recursively extract connectors from content (handles group shapes too)
        extract_connectors_from_content(content, anchor, &mut connectors);
    }

    connectors
}

/// Recursively extract connectors from drawing content, handling group shapes.
fn extract_connectors_from_content(
    content: &crate::domain::drawings::DrawingContent,
    anchor: ConnectorAnchor,
    out: &mut Vec<crate::output::results::ConnectorOutput>,
) {
    use crate::domain::drawings::DrawingContent;
    use crate::output::results::{ConnectorEndpointOutput, ConnectorOutput};

    match content {
        DrawingContent::Connector(cxn) => {
            let name = Some(cxn.nv_cxn_sp_pr.c_nv_pr.name.clone()).filter(|s| !s.is_empty());

            let start_connection =
                cxn.nv_cxn_sp_pr
                    .st_cxn
                    .as_ref()
                    .map(|c| ConnectorEndpointOutput {
                        shape_id: c.shape_id,
                        idx: c.idx,
                    });

            let end_connection =
                cxn.nv_cxn_sp_pr
                    .end_cxn
                    .as_ref()
                    .map(|c| ConnectorEndpointOutput {
                        shape_id: c.shape_id,
                        idx: c.idx,
                    });

            let preset_geometry = cxn.sp_pr.geometry.as_ref().and_then(|g| match g {
                ooxml_types::drawings::ShapeGeometry::Preset(pg) => {
                    Some(pg.prst.to_ooxml().to_string())
                }
                _ => None,
            });

            // Serialize the full connector for roundtrip fidelity
            let raw_json = serde_json::to_string(cxn).ok();

            out.push(ConnectorOutput {
                name,
                start_connection,
                end_connection,
                preset_geometry,
                anchor_row: anchor.anchor_row,
                anchor_col: anchor.anchor_col,
                anchor_row_offset: anchor.anchor_row_offset,
                anchor_col_offset: anchor.anchor_col_offset,
                end_row: anchor.end_row,
                end_col: anchor.end_col,
                end_row_offset: anchor.end_row_offset,
                end_col_offset: anchor.end_col_offset,
                width: anchor.width,
                height: anchor.height,
                raw_json,
            });
        }
        DrawingContent::GroupShape(group) => {
            // Recurse into group children
            for child in &group.children {
                extract_connectors_from_content(child, anchor, out);
            }
        }
        _ => {}
    }
}
