use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::parse_string_attr;

use super::super::types::*;
use super::support::parse_color;

/// Parse the <colors> section
pub(super) fn parse_colors(xml: &[u8]) -> ColorsDef {
    let mut colors = ColorsDef::default();

    // Parse <indexedColors>
    if let Some(ic_start) = find_tag_simd(xml, b"indexedColors", 0) {
        let ic_end = find_closing_tag(xml, b"indexedColors", ic_start).unwrap_or(xml.len());
        let ic_open_end = find_gt_simd(xml, ic_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let ic_content = &xml[ic_open_end..ic_end];
        let mut pos = 0;
        while let Some(start) = find_tag_simd(ic_content, b"rgbColor", pos) {
            let end = find_gt_simd(ic_content, start)
                .map(|p| p + 1)
                .unwrap_or(ic_content.len());
            let tag = &ic_content[start..end];
            if let Some(rgb) = parse_string_attr(tag, b"rgb=\"") {
                colors.indexed_colors.push(rgb);
            }
            pos = end;
        }
    }

    // Parse <mruColors>
    if let Some(mru_start) = find_tag_simd(xml, b"mruColors", 0) {
        let mru_end = find_closing_tag(xml, b"mruColors", mru_start).unwrap_or(xml.len());
        let mru_open_end = find_gt_simd(xml, mru_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let mru_content = &xml[mru_open_end..mru_end];
        let mut pos = 0;
        while let Some(start) = find_tag_simd(mru_content, b"color", pos) {
            let end = find_gt_simd(mru_content, start)
                .map(|p| p + 1)
                .unwrap_or(mru_content.len());
            let tag = &mru_content[start..end];
            if let Some(color) = parse_color(tag) {
                colors.mru_colors.push(color);
            }
            pos = end;
        }
    }

    colors
}
