//! ActiveX control parsing.

use super::types::ActiveXControl;
use crate::infra::scanner::{find_gt_simd, find_tag_simd};
use crate::infra::xml::parse_string_attr;

// Slices use offsets from ASCII XML tag delimiters.
#[allow(clippy::string_slice)]
pub fn parse_activex(xml: &[u8]) -> Option<ActiveXControl> {
    let start = find_tag_simd(xml, b"ax:ocx", 0).or_else(|| find_tag_simd(xml, b"ocx", 0))?;

    let element_end = find_gt_simd(xml, start).map(|p| p + 1).unwrap_or(xml.len());
    let element = &xml[start..element_end];

    let class_id = parse_string_attr(element, b"ax:classid=\"")
        .or_else(|| parse_string_attr(element, b"classid=\""))
        .unwrap_or_default();

    let persistence = parse_string_attr(element, b"r:id=\"").unwrap_or_default();

    Some(ActiveXControl::new(class_id, persistence))
}
