use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_gt_simd, find_tag_simd};
use crate::output::results::MergeRange;

use super::read_support::section_slice;

/// Parse merge cells from worksheet XML.
pub fn parse_merge_cells(xml: &[u8]) -> Vec<MergeRange> {
    let mut merges = Vec::new();
    let Some(section) = section_slice(xml, b"mergeCells") else {
        return merges;
    };

    let mut pos = 0;
    while let Some(mc_start) = find_tag_simd(section, b"mergeCell", pos) {
        let element_end = find_gt_simd(section, mc_start)
            .map(|p| p + 1)
            .unwrap_or(section.len());
        let element = &section[mc_start..element_end];

        if let Some(ref_pos) = find_attr_simd(element, b"ref=\"", 0) {
            let value_start = ref_pos + b"ref=\"".len();
            if let Some((start, end)) = extract_quoted_value(element, value_start) {
                if let Ok(ref_str) = std::str::from_utf8(&element[start..end]) {
                    merges.push(MergeRange::from_ref(ref_str));
                }
            }
        }

        pos = mc_start + 1;
    }

    merges
}
