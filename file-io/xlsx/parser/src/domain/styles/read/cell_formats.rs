use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};

use super::super::types::*;
use super::raw::{RawAlignment, RawCellStyle, RawCellXfAttrs, RawProtection};
use super::support::extract_direct_child_element_xml;

/// Parse the <cellXfs> section
pub(super) fn parse_cell_xfs(out: &mut Vec<CellXfDef>, xml: &[u8]) {
    let mut pos = 0;

    while let Some(xf_start) = find_tag_simd(xml, b"xf", pos) {
        // Find the end of the opening tag
        let open_end = find_gt_simd(xml, xf_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());

        // Check if self-closing (<xf .../>)
        let is_self_closing = open_end >= 2 && xml[open_end - 2] == b'/';

        // Parse attributes from the opening tag via derive
        let raw_attrs = RawCellXfAttrs::xml_parse(&xml[xf_start..open_end]);
        let mut xf = if let Some(r) = raw_attrs {
            CellXfDef {
                num_fmt_id: r.num_fmt_id,
                font_id: r.font_id,
                fill_id: r.fill_id,
                border_id: r.border_id,
                apply_number_format: r.apply_number_format,
                apply_font: r.apply_font,
                apply_fill: r.apply_fill,
                apply_border: r.apply_border,
                xf_id: r.xf_id,
                apply_alignment: r.apply_alignment,
                alignment: None,
                apply_protection: r.apply_protection,
                protection: None,
                quote_prefix: r.quote_prefix.unwrap_or(false),
                pivot_button: r.pivot_button.unwrap_or(false),
                ext_lst: None,
            }
        } else {
            CellXfDef::default()
        };

        if is_self_closing {
            out.push(xf);
            pos = open_end;
            continue;
        }

        // Container element — find closing </xf>
        let xf_end = find_closing_tag(xml, b"xf", xf_start).unwrap_or(xml.len());
        let content = &xml[open_end..xf_end];

        // Parse <alignment .../> child via derive
        if let Some(align_start) = find_tag_simd(content, b"alignment", 0) {
            let align_end = find_gt_simd(content, align_start)
                .map(|p| p + 1)
                .unwrap_or(content.len());
            if let Some(raw) = RawAlignment::xml_parse(&content[align_start..align_end]) {
                xf.alignment = Some(raw.into());
            }
        }

        // Parse <protection .../> child via derive
        if let Some(prot_start) = find_tag_simd(content, b"protection", 0) {
            let prot_end = find_gt_simd(content, prot_start)
                .map(|p| p + 1)
                .unwrap_or(content.len());
            if let Some(raw) = RawProtection::xml_parse(&content[prot_start..prot_end]) {
                xf.protection = Some(raw.into());
            }
        }

        // Parse <extLst>...</extLst> as raw XML passthrough
        if let Some(ext_start) = find_tag_simd(content, b"extLst", 0) {
            let ext_close =
                find_closing_tag(content, b"extLst", ext_start).unwrap_or(content.len());
            let ext_close_end = find_gt_simd(content, ext_close)
                .map(|p| p + 1)
                .unwrap_or(content.len());
            let raw = &content[ext_start..ext_close_end];
            xf.ext_lst = Some(ooxml_types::ExtensionList {
                raw_xml: Some(String::from_utf8_lossy(raw).into_owned()),
            });
        }

        out.push(xf);

        // Advance past closing </xf>
        let close_end = find_gt_simd(xml, xf_end)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        pos = close_end;
    }
}

/// Parse the <cellStyles> section
pub(super) fn parse_cell_styles(xml: &[u8]) -> Vec<CellStyleDef> {
    let mut styles = Vec::new();
    let mut pos = 0;

    while let Some(start) = find_tag_simd(xml, b"cellStyle", pos) {
        let open_end = find_gt_simd(xml, start).map(|p| p + 1).unwrap_or(xml.len());

        if let Some(raw) = RawCellStyle::xml_parse(&xml[start..open_end]) {
            let mut style: CellStyleDef = raw.into();

            let is_self_closing = open_end >= 2 && xml[open_end - 2] == b'/';
            if !is_self_closing {
                let cell_style_end =
                    find_closing_tag(xml, b"cellStyle", start).unwrap_or(xml.len());
                let content = &xml[open_end..cell_style_end];
                if let Some(raw_xml) = extract_direct_child_element_xml(content, b"extLst") {
                    style.ext_lst = Some(ooxml_types::ExtensionList {
                        raw_xml: Some(raw_xml),
                    });
                }
                let close_end = find_gt_simd(xml, cell_style_end)
                    .map(|p| p + 1)
                    .unwrap_or(xml.len());
                styles.push(style);
                pos = close_end;
                continue;
            }

            styles.push(style);
        }
        pos = open_end;
    }
    styles
}

/// Parse an <alignment .../> element into an AlignmentDef.
pub(super) fn parse_single_alignment(xml: &[u8]) -> AlignmentDef {
    if let Some(align_start) = find_tag_simd(xml, b"alignment", 0) {
        let align_end = find_gt_simd(xml, align_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        RawAlignment::xml_parse(&xml[align_start..align_end])
            .map(AlignmentDef::from)
            .unwrap_or_default()
    } else {
        AlignmentDef::default()
    }
}

/// Parse a <protection .../> element into a ProtectionDef.
pub(super) fn parse_single_protection(xml: &[u8]) -> ProtectionDef {
    if let Some(prot_start) = find_tag_simd(xml, b"protection", 0) {
        let prot_end = find_gt_simd(xml, prot_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        RawProtection::xml_parse(&xml[prot_start..prot_end])
            .map(ProtectionDef::from)
            .unwrap_or_default()
    } else {
        ProtectionDef::default()
    }
}
