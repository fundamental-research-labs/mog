use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_gt_simd, find_tag_simd};

/// Parse the `<legacyDrawing r:id="..."/>` element from worksheet XML.
pub fn parse_legacy_drawing_r_id(xml: &[u8]) -> Option<String> {
    let tag_start = find_tag_simd(xml, b"legacyDrawing", 0)?;
    let after = tag_start + b"<legacyDrawing".len();
    if after < xml.len() && xml[after] != b' ' && xml[after] != b'/' && xml[after] != b'>' {
        return None;
    }
    let tag_end = find_gt_simd(xml, tag_start)?;
    let element = &xml[tag_start..tag_end + 1];
    let attr_pos = find_attr_simd(element, b"r:id=\"", 0)?;
    let value_start = attr_pos + b"r:id=\"".len();
    let (start, end) = extract_quoted_value(element, value_start)?;
    std::str::from_utf8(&element[start..end])
        .ok()
        .map(|s| s.to_string())
}

/// Parse the `<legacyDrawingHF r:id="..."/>` element from worksheet XML.
pub fn parse_legacy_drawing_hf_r_id(xml: &[u8]) -> Option<String> {
    let tag_start = find_tag_simd(xml, b"legacyDrawingHF", 0)?;
    let tag_end = find_gt_simd(xml, tag_start)?;
    let element = &xml[tag_start..tag_end + 1];
    let attr_pos = find_attr_simd(element, b"r:id=\"", 0)?;
    let value_start = attr_pos + b"r:id=\"".len();
    let (start, end) = extract_quoted_value(element, value_start)?;
    std::str::from_utf8(&element[start..end])
        .ok()
        .map(|s| s.to_string())
}
