use std::collections::HashMap;

use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_gt_simd, find_tag_simd};

/// Build a mapping from relationship Id (e.g. "rId3") to raw Target path.
pub fn build_rel_id_map(rels_xml: &[u8]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut pos = 0;

    while let Some(rel_start) = find_tag_simd(rels_xml, b"Relationship", pos) {
        let rel_end = find_gt_simd(rels_xml, rel_start)
            .map(|p| p + 1)
            .unwrap_or(rels_xml.len());
        let rel_elem = &rels_xml[rel_start..rel_end];

        if let Some(id_pos) = find_attr_simd(rel_elem, b"Id=\"", 0) {
            if let Some((is, ie)) = extract_quoted_value(rel_elem, id_pos + 4) {
                if let Ok(id) = std::str::from_utf8(&rel_elem[is..ie]) {
                    if let Some(target_pos) = find_attr_simd(rel_elem, b"Target=\"", 0) {
                        if let Some((ts, te)) = extract_quoted_value(rel_elem, target_pos + 8) {
                            if let Ok(target) = std::str::from_utf8(&rel_elem[ts..te]) {
                                map.insert(id.to_string(), target.to_string());
                            }
                        }
                    }
                }
            }
        }

        pos = rel_end;
    }

    map
}

#[cfg(test)]
fn extract_drawing_target_for_test(rels_xml: &[u8]) -> Option<String> {
    let mut pos = 0;
    while let Some(rel_start) = find_tag_simd(rels_xml, b"Relationship", pos) {
        let rel_end = find_gt_simd(rels_xml, rel_start)
            .map(|p| p + 1)
            .unwrap_or(rels_xml.len());
        let rel_elem = &rels_xml[rel_start..rel_end];

        if let Some(type_pos) = find_attr_simd(rel_elem, b"Type=\"", 0) {
            let value_start = type_pos + 6;
            if let Some((ts, te)) = extract_quoted_value(rel_elem, value_start) {
                let type_str = &rel_elem[ts..te];
                if type_str == crate::infra::opc::REL_DRAWING.as_bytes() {
                    if let Some(target_pos) = find_attr_simd(rel_elem, b"Target=\"", 0) {
                        let tgt_start = target_pos + 8;
                        if let Some((tgs, tge)) = extract_quoted_value(rel_elem, tgt_start) {
                            if let Ok(target) = std::str::from_utf8(&rel_elem[tgs..tge]) {
                                return Some(target.to_string());
                            }
                        }
                    }
                }
            }
        }
        pos = rel_end;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drawing_target_helper_ignores_vml_drawing_relationship() {
        let rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments3.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>"#;

        assert_eq!(extract_drawing_target_for_test(rels), None);
    }

    #[test]
    fn drawing_target_helper_matches_drawing_relationship() {
        let rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>"#;

        assert_eq!(
            extract_drawing_target_for_test(rels).as_deref(),
            Some("../drawings/drawing1.xml")
        );
    }

    #[test]
    fn rel_id_map_preserves_raw_targets() {
        let rels = br#"<Relationships><Relationship Id="rId1" Target="/xl/slicers/slicer1.xml"/><Relationship Id="rId2" Target="../slicerCaches/slicerCache1.xml"/></Relationships>"#;
        let map = build_rel_id_map(rels);

        assert_eq!(
            map.get("rId1").map(String::as_str),
            Some("/xl/slicers/slicer1.xml")
        );
        assert_eq!(
            map.get("rId2").map(String::as_str),
            Some("../slicerCaches/slicerCache1.xml")
        );
    }
}
