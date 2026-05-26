//! SmartArt parsing from drawings.

use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_gt_simd, find_tag_simd};
use crate::zip::XlsxArchive;

use super::xml_parsing::{
    extract_drawing_target, extract_rel_id_target_map_bytes, resolve_relative_path,
};

/// Parse SmartArt diagrams embedded in a sheet's drawing.
///
/// In OOXML, SmartArt appears as graphicFrame elements with a diagram namespace URI.
/// The path is: sheet -> sheet.rels -> drawing -> drawing.rels -> diagram XML parts.
///
/// Returns a vector of `SmartArtParts` for each SmartArt diagram found.
pub fn parse_smartart_for_sheet(
    archive: &XlsxArchive,
    sheet_num: usize,
) -> Vec<crate::domain::drawings::SmartArtParts> {
    use crate::domain::drawings::{Anchor, DrawingContent, SmartArtParts};
    use crate::write::relationships::REL_DIAGRAM_DRAWING;

    let mut diagrams = Vec::new();

    // Step 1: Read sheet .rels to find drawing reference
    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    let rels_xml = match archive.read_file(&rels_path) {
        Ok(xml) => xml,
        Err(_) => return diagrams,
    };

    // Find drawing target in rels
    let drawing_target = match extract_drawing_target(&rels_xml) {
        Some(t) => t,
        None => return diagrams,
    };

    // Step 2: Read the drawing XML
    let drawing_path = resolve_relative_path("xl/worksheets", &drawing_target);
    let drawing_xml = match archive.read_file(&drawing_path) {
        Ok(xml) => xml,
        Err(_) => return diagrams,
    };

    // Step 3: Parse the drawing to detect SmartArt anchors
    let drawing = crate::domain::drawings::parse_drawing(&drawing_xml);

    // Step 4: Read the drawing .rels to resolve SmartArt rIds
    let drawing_filename = drawing_path.rsplit('/').next().unwrap_or(&drawing_path);
    let drawing_rels_path = format!("xl/drawings/_rels/{}.rels", drawing_filename);
    let drawing_rels_xml = archive.read_file(&drawing_rels_path).unwrap_or_default();
    let rels_map = extract_rel_id_target_map_bytes(&drawing_rels_xml);

    // Also build a type->target map for the 5th part (diagram drawing) which uses rel Type
    let diagram_drawing_targets =
        extract_rel_targets_by_type(&drawing_rels_xml, REL_DIAGRAM_DRAWING);

    // Step 5: For each SmartArt anchor, resolve parts and read XML
    for (anchor_idx, anchor) in drawing.anchors.iter().enumerate() {
        let content = match anchor {
            Anchor::TwoCell(a) => &a.content,
            Anchor::OneCell(a) => &a.content,
            Anchor::Absolute(a) => &a.content,
        };

        if let DrawingContent::SmartArt(sa) = content {
            let mut parts = SmartArtParts {
                anchor_index: anchor_idx,
                ..Default::default()
            };

            // Resolve and read each part
            if let Some(target) = rels_map.get(&sa.dm_rel_id) {
                let path = resolve_relative_path("xl/drawings", target);
                if let Ok(xml) = archive.read_file(&path) {
                    parts.data_xml = String::from_utf8(xml).ok();
                }
            }
            if let Some(target) = rels_map.get(&sa.lo_rel_id) {
                let path = resolve_relative_path("xl/drawings", target);
                if let Ok(xml) = archive.read_file(&path) {
                    parts.layout_xml = String::from_utf8(xml).ok();
                }
            }
            if let Some(target) = rels_map.get(&sa.cs_rel_id) {
                let path = resolve_relative_path("xl/drawings", target);
                if let Ok(xml) = archive.read_file(&path) {
                    parts.colors_xml = String::from_utf8(xml).ok();
                }
            }
            if let Some(target) = rels_map.get(&sa.qs_rel_id) {
                let path = resolve_relative_path("xl/drawings", target);
                if let Ok(xml) = archive.read_file(&path) {
                    parts.style_xml = String::from_utf8(xml).ok();
                }
            }

            // 5th part: diagram drawing cache — find by scanning for the rel Type
            // The diagram drawing rel's Target should reference one of the rel IDs
            // associated with this SmartArt. We match by checking if any diagram drawing
            // target is linked from the same rels file.
            // For simplicity, use the first diagram drawing target found (most files have one).
            if let Some(dd_target) = diagram_drawing_targets.first() {
                let path = resolve_relative_path("xl/drawings", dd_target);
                if let Ok(xml) = archive.read_file(&path) {
                    parts.drawing_xml = String::from_utf8(xml).ok();
                }
            }

            diagrams.push(parts);
        }
    }

    diagrams
}

/// Extract all Target values from .rels XML where the Type matches the given type URI.
pub(super) fn extract_rel_targets_by_type(rels_xml: &[u8], rel_type: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let rel_type_bytes = rel_type.as_bytes();
    let mut pos = 0;

    while let Some(rel_start) = find_tag_simd(rels_xml, b"Relationship", pos) {
        let rel_end = find_gt_simd(rels_xml, rel_start)
            .map(|p| p + 1)
            .unwrap_or(rels_xml.len());
        let rel_elem = &rels_xml[rel_start..rel_end];

        // Check if Type matches
        if let Some(type_pos) = find_attr_simd(rel_elem, b"Type=\"", 0) {
            if let Some((ts, te)) = extract_quoted_value(rel_elem, type_pos + 6) {
                if &rel_elem[ts..te] == rel_type_bytes {
                    // Extract Target
                    if let Some(target_pos) = find_attr_simd(rel_elem, b"Target=\"", 0) {
                        if let Some((tgs, tge)) = extract_quoted_value(rel_elem, target_pos + 8) {
                            if let Ok(target) = std::str::from_utf8(&rel_elem[tgs..tge]) {
                                targets.push(target.to_string());
                            }
                        }
                    }
                }
            }
        }

        pos = rel_end;
    }

    targets
}
