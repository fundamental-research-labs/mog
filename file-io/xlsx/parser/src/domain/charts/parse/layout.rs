//! Manual layout parsing for chart, legend, plot area, title, and labels.

use crate::infra::scanner::{find_closing_tag, find_tag_simd};

use super::attrs;
use super::{LayoutMode, LayoutTarget, ManualLayout};

pub(super) fn parse_layout(xml: &[u8]) -> ManualLayout {
    let mut layout = ManualLayout::default();

    if let Some(ml_start) = find_tag_simd(xml, b"manualLayout", 0) {
        let ml_end = find_closing_tag(xml, b"manualLayout", ml_start).unwrap_or(xml.len());
        let ml = &xml[ml_start..ml_end];

        if let Some(start) = find_tag_simd(ml, b"layoutTarget", 0) {
            if let Some(val) = attrs::parse_string_attr(&ml[start..], b"val=\"") {
                layout.layout_target = Some(LayoutTarget::from_ooxml(&val));
            }
        }
        if let Some(start) = find_tag_simd(ml, b"xMode", 0) {
            if let Some(val) = attrs::parse_string_attr(&ml[start..], b"val=\"") {
                layout.x_mode = Some(LayoutMode::from_ooxml(&val));
            }
        }
        if let Some(start) = find_tag_simd(ml, b"yMode", 0) {
            if let Some(val) = attrs::parse_string_attr(&ml[start..], b"val=\"") {
                layout.y_mode = Some(LayoutMode::from_ooxml(&val));
            }
        }
        if let Some(start) = find_tag_simd(ml, b"wMode", 0) {
            if let Some(val) = attrs::parse_string_attr(&ml[start..], b"val=\"") {
                layout.w_mode = Some(LayoutMode::from_ooxml(&val));
            }
        }
        if let Some(start) = find_tag_simd(ml, b"hMode", 0) {
            if let Some(val) = attrs::parse_string_attr(&ml[start..], b"val=\"") {
                layout.h_mode = Some(LayoutMode::from_ooxml(&val));
            }
        }
        if let Some(start) = find_tag_simd(ml, b"x", 0) {
            layout.x = attrs::parse_f64_attr(&ml[start..], b"val=\"");
        }
        if let Some(start) = find_tag_simd(ml, b"y", 0) {
            layout.y = attrs::parse_f64_attr(&ml[start..], b"val=\"");
        }
        if let Some(start) = find_tag_simd(ml, b"w", 0) {
            layout.w = attrs::parse_f64_attr(&ml[start..], b"val=\"");
        }
        if let Some(start) = find_tag_simd(ml, b"h", 0) {
            layout.h = attrs::parse_f64_attr(&ml[start..], b"val=\"");
        }
    }

    layout
}
