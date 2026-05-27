//! Chart title parsing shared by chart and axis title entrypoints.

use crate::infra::scanner::{find_closing_tag, find_tag_simd};

use super::attrs;
use super::layout;
use super::{Title, TitleText, parse_shape_properties, parse_str_ref, parse_text_body};

pub(super) fn parse_title(xml: &[u8]) -> Title {
    let mut title = Title::default();

    if let Some(rich_start) = find_tag_simd(xml, b"rich", 0) {
        let rich_end = find_closing_tag(xml, b"rich", rich_start).unwrap_or(xml.len());
        let rich_bytes = &xml[rich_start..rich_end];
        title.tx = Some(TitleText::Rich(parse_text_body(rich_bytes)));
    } else if let Some(strref_start) = find_tag_simd(xml, b"strRef", 0) {
        let strref_end = find_closing_tag(xml, b"strRef", strref_start).unwrap_or(xml.len());
        title.tx = Some(TitleText::StrRef(parse_str_ref(
            &xml[strref_start..strref_end],
        )));
    }

    if let Some(overlay_start) = find_tag_simd(xml, b"overlay", 0) {
        let val = attrs::parse_bool_attr(&xml[overlay_start..], b"val=\"");
        title.overlay = Some(val);
    }

    if let Some(layout_start) = find_tag_simd(xml, b"layout", 0) {
        let layout_end = find_closing_tag(xml, b"layout", layout_start).unwrap_or(xml.len());
        title.layout = Some(layout::parse_layout(&xml[layout_start..layout_end]));
    }

    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        title.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    if let Some(txpr_start) = find_tag_simd(xml, b"txPr", 0) {
        let txpr_end = find_closing_tag(xml, b"txPr", txpr_start).unwrap_or(xml.len());
        title.tx_pr = Some(parse_text_body(&xml[txpr_start..txpr_end]));
    }

    title
}
