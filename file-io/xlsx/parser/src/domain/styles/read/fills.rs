use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_f64_attr, parse_string_attr};

use super::super::types::*;
use super::support::{parse_color_ref, parse_named_color_ref};

/// Parse the <fills> section
pub(super) fn parse_fills(out: &mut Vec<FillDef>, xml: &[u8]) {
    let mut pos = 0;

    // Find each <fill> element
    while let Some(fill_start) = find_tag_simd(xml, b"fill", pos) {
        let fill_end = find_closing_tag(xml, b"fill", fill_start).unwrap_or(xml.len());

        let open_end = find_gt_simd(xml, fill_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());

        let is_self_closing = open_end >= 2 && xml[open_end - 2] == b'/';

        if is_self_closing {
            out.push(FillDef::None);
            pos = open_end;
            continue;
        }

        out.push(parse_fill_content(&xml[open_end..fill_end]));

        let close_end = find_gt_simd(xml, fill_end)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        pos = close_end;
    }
}

/// Parse a single <fill>...</fill> block into a FillDef (for use inside <dxf>).
pub(super) fn parse_single_fill(xml: &[u8]) -> FillDef {
    parse_fill_content(xml)
}

fn parse_fill_content(xml: &[u8]) -> FillDef {
    // Try <patternFill> first
    if let Some(pf_start) = find_tag_simd(xml, b"patternFill", 0) {
        let pf_open_end = find_gt_simd(xml, pf_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let pf_el = &xml[pf_start..pf_open_end];

        let pattern_type_opt = parse_string_attr(pf_el, b"patternType=\"").and_then(|val| {
            PatternType::from_ooxml_token(&val).or_else(|| {
                tracing::warn!(token = %val, "unknown PatternType OOXML token in XLSX; treating attribute as absent");
                None
            })
        });
        let pattern_type = pattern_type_opt.unwrap_or(PatternType::None);

        let pf_close = find_closing_tag(xml, b"patternFill", pf_start).unwrap_or(xml.len());
        let pf_content = &xml[pf_open_end..pf_close];

        let fg_color = parse_named_color_ref(pf_content, b"fgColor");
        let bg_color = parse_named_color_ref(pf_content, b"bgColor");

        return match pattern_type {
            PatternType::None if fg_color.is_none() && bg_color.is_none() => FillDef::None,
            PatternType::Solid => match (fg_color, bg_color) {
                (Some(fg), None) => FillDef::Solid { fg_color: fg },
                (fg_color, bg_color) => FillDef::Pattern {
                    pattern_type: Some(PatternType::Solid),
                    fg_color,
                    bg_color,
                },
            },
            _ => FillDef::Pattern {
                pattern_type: pattern_type_opt,
                fg_color,
                bg_color,
            },
        };
    }

    if let Some(gf_start) = find_tag_simd(xml, b"gradientFill", 0) {
        let gf_open_end = find_gt_simd(xml, gf_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let gf_el = &xml[gf_start..gf_open_end];

        let gradient_type = match parse_string_attr(gf_el, b"type=\"") {
            Some(val) => GradientType::from_ooxml(&val),
            None => GradientType::Linear,
        };
        let degree = parse_f64_attr(gf_el, b"degree=\"");
        let left = parse_f64_attr(gf_el, b"left=\"");
        let right = parse_f64_attr(gf_el, b"right=\"");
        let top = parse_f64_attr(gf_el, b"top=\"");
        let bottom = parse_f64_attr(gf_el, b"bottom=\"");

        let gf_close = find_closing_tag(xml, b"gradientFill", gf_start).unwrap_or(xml.len());
        let gf_content = &xml[gf_open_end..gf_close];

        let mut stops = Vec::new();
        let mut stop_pos = 0;
        while let Some(stop_start) = find_tag_simd(gf_content, b"stop", stop_pos) {
            let stop_open_end = find_gt_simd(gf_content, stop_start)
                .map(|p| p + 1)
                .unwrap_or(gf_content.len());
            let stop_el = &gf_content[stop_start..stop_open_end];
            let position = parse_f64_attr(stop_el, b"position=\"").unwrap_or(0.0);

            let stop_close =
                find_closing_tag(gf_content, b"stop", stop_start).unwrap_or(gf_content.len());
            let stop_content = &gf_content[stop_open_end..stop_close];

            if let Some(color) = parse_color_ref(stop_content) {
                stops.push(GradientStop { position, color });
            }

            let close_end = find_gt_simd(gf_content, stop_close)
                .map(|p| p + 1)
                .unwrap_or(gf_content.len());
            stop_pos = close_end;
        }

        return FillDef::Gradient {
            gradient_type,
            degree,
            stops,
            left,
            right,
            top,
            bottom,
        };
    }

    FillDef::None
}
