use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_string_attr, parse_u32_attr};

use super::super::types::*;
use super::{
    borders::parse_single_border,
    cell_formats::{parse_single_alignment, parse_single_protection},
    fills::parse_single_fill,
    fonts::parse_single_font,
    support::extract_direct_child_element_xml,
};

/// Parse the <dxfs> section
pub(super) fn parse_dxfs(xml: &[u8]) -> Vec<DxfDef> {
    let mut dxfs = Vec::new();
    let mut pos = 0;

    while let Some(dxf_start) = find_tag_simd(xml, b"dxf", pos) {
        let open_end = find_gt_simd(xml, dxf_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let is_self_closing = open_end >= 2 && xml[open_end - 2] == b'/';

        if is_self_closing {
            dxfs.push(DxfDef::default());
            pos = open_end;
            continue;
        }

        let dxf_end = find_closing_tag(xml, b"dxf", dxf_start).unwrap_or(xml.len());
        let dxf_content = &xml[open_end..dxf_end];

        let mut dxf = DxfDef::default();

        // Parse optional font
        if let Some(font_start) = find_tag_simd(dxf_content, b"font", 0) {
            let font_end =
                find_closing_tag(dxf_content, b"font", font_start).unwrap_or(dxf_content.len());
            let font_open_end = find_gt_simd(dxf_content, font_start)
                .map(|p| p + 1)
                .unwrap_or(dxf_content.len());
            dxf.font = Some(parse_single_font(&dxf_content[font_open_end..font_end]));
        }

        // Parse optional numFmt
        if let Some(nf_start) = find_tag_simd(dxf_content, b"numFmt", 0) {
            let nf_end = find_gt_simd(dxf_content, nf_start)
                .map(|p| p + 1)
                .unwrap_or(dxf_content.len());
            let tag = &dxf_content[nf_start..nf_end];
            if let (Some(id), Some(code)) = (
                parse_u32_attr(tag, b"numFmtId=\""),
                parse_string_attr(tag, b"formatCode=\""),
            ) {
                dxf.num_fmt = Some(NumberFormatDef {
                    id,
                    format_code: code,
                });
            }
        }

        // Parse optional fill
        if let Some(fill_start) = find_tag_simd(dxf_content, b"fill", 0) {
            let fill_end =
                find_closing_tag(dxf_content, b"fill", fill_start).unwrap_or(dxf_content.len());
            let fill_open_end = find_gt_simd(dxf_content, fill_start)
                .map(|p| p + 1)
                .unwrap_or(dxf_content.len());
            let fill = parse_single_fill(&dxf_content[fill_open_end..fill_end]);
            // In DXFs, even a "none" fill is meaningful — it means "explicitly no fill"
            // which differs from the fill being absent (not specified). Preserve it.
            dxf.fill = Some(fill);
        }

        // Parse optional border
        if let Some(border_start) = find_tag_simd(dxf_content, b"border", 0) {
            let border_end =
                find_closing_tag(dxf_content, b"border", border_start).unwrap_or(dxf_content.len());
            dxf.border = Some(parse_single_border(&dxf_content[border_start..border_end]));
        }

        // Parse optional alignment
        if find_tag_simd(dxf_content, b"alignment", 0).is_some() {
            dxf.alignment = Some(parse_single_alignment(dxf_content));
        }

        // Parse optional protection
        if find_tag_simd(dxf_content, b"protection", 0).is_some() {
            dxf.protection = Some(parse_single_protection(dxf_content));
        }

        if let Some(raw_xml) = extract_direct_child_element_xml(dxf_content, b"extLst") {
            dxf.ext_lst = Some(ooxml_types::ExtensionList {
                raw_xml: Some(raw_xml),
            });
        }

        dxfs.push(dxf);

        let close_end = find_gt_simd(xml, dxf_end)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        pos = close_end;
    }
    dxfs
}
