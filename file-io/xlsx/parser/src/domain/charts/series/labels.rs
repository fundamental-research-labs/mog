use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
};
use crate::infra::xml::decode_xml_entities;

use super::xml_values::{parse_bool_val, parse_val_attr_u32};
use super::{DataLabelOptions, DataLabelPosition, parse_chart_ext_lst};
use crate::domain::charts::{parse_shape_properties, parse_text_body};

pub fn parse_data_labels(xml: &[u8]) -> DataLabelOptions {
    let mut labels = DataLabelOptions::default();

    // ---------------------------------------------------------------
    // Step 1: parse individual <c:dLbl> overrides FIRST and track
    // where they end.  In the OOXML schema for CT_DLbls, dLbl children
    // come before the choice (delete | group-content) and extLst.
    // We must search for dLbls-level elements only AFTER the last dLbl,
    // otherwise find_tag_simd matches elements INSIDE dLbl children
    // (e.g. <c:delete> or <c:showVal> within a child dLbl would be
    // incorrectly attributed to the parent dLbls).
    // ---------------------------------------------------------------
    let mut dlbl_pos = 0;
    let mut group_content_start = 0usize;
    while let Some(dlbl_start) = find_tag_simd(xml, b"dLbl", dlbl_pos) {
        // find_tag_simd already disambiguates: it won't match <c:dLblPos>
        // or <c:dLbls>.  But it DOES match closing tags </c:dLbl>, so skip those.
        if dlbl_start + 1 < xml.len() && xml[dlbl_start + 1] == b'/' {
            dlbl_pos = dlbl_start + 1;
            continue;
        }
        let dlbl_end = find_closing_tag(xml, b"dLbl", dlbl_start).unwrap_or(xml.len());
        labels
            .d_lbl
            .push(parse_individual_data_label(&xml[dlbl_start..dlbl_end]));
        // Move past </c:dLbl> closing tag
        let close_gt = find_gt_simd(xml, dlbl_end)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        group_content_start = close_gt;
        dlbl_pos = dlbl_end;
    }

    // ---------------------------------------------------------------
    // Step 2: parse dLbls-level content from the region AFTER all
    // dLbl children.  This is the choice (delete | group) + extLst.
    //
    // IMPORTANT: Restrict child element parsing to BEFORE the extLst.
    // Extensions like {CE6537A1} can contain <c15:showLeaderLines>
    // and <c15:leaderLines> which find_tag_simd would otherwise match
    // as top-level elements, causing duplicate emission on round-trip.
    // ---------------------------------------------------------------
    let tail = &xml[group_content_start..];

    // Find the dLbls-level extLst position within tail
    let tail_ext_pos = find_tag_simd(tail, b"extLst", 0);
    let tail_child_end = tail_ext_pos.unwrap_or(tail.len());
    let tail_children = &tail[..tail_child_end];

    // Parse show flags — only before extLst
    if let Some(start) = find_tag_simd(tail_children, b"showLegendKey", 0) {
        labels.show_legend_key = parse_bool_val(&tail[start..]);
    }
    if let Some(start) = find_tag_simd(tail_children, b"showVal", 0) {
        labels.show_value = parse_bool_val(&tail[start..]);
    }
    if let Some(start) = find_tag_simd(tail_children, b"showCatName", 0) {
        labels.show_category = parse_bool_val(&tail[start..]);
    }
    if let Some(start) = find_tag_simd(tail_children, b"showSerName", 0) {
        labels.show_series_name = parse_bool_val(&tail[start..]);
    }
    if let Some(start) = find_tag_simd(tail_children, b"showPercent", 0) {
        labels.show_percent = parse_bool_val(&tail[start..]);
    }
    if let Some(start) = find_tag_simd(tail_children, b"showBubbleSize", 0) {
        labels.show_bubble_size = parse_bool_val(&tail[start..]);
    }
    if let Some(start) = find_tag_simd(tail_children, b"showLeaderLines", 0) {
        labels.show_leader_lines = Some(parse_bool_val(&tail[start..]));
    }

    // Parse leaderLines element (CT_ChartLines — contains optional spPr)
    if let Some(ll_start) = find_tag_simd(tail_children, b"leaderLines", 0) {
        let ll_end = find_closing_tag(tail, b"leaderLines", ll_start).unwrap_or(tail_child_end);
        let ll_xml = &tail[ll_start..ll_end];
        let sp_pr = if let Some(sp_start) = find_tag_simd(ll_xml, b"spPr", 0) {
            let sp_end = find_closing_tag(ll_xml, b"spPr", sp_start).unwrap_or(ll_xml.len());
            Some(parse_shape_properties(&ll_xml[sp_start..sp_end]))
        } else {
            None
        };
        labels.leader_lines = Some(ooxml_types::charts::ChartLines { sp_pr });
    }

    // Parse position
    if let Some(pos_start) = find_tag_simd(tail_children, b"dLblPos", 0) {
        if let Some(attr_pos) = find_attr_simd(&tail[pos_start..], b"val=\"", 0) {
            let value_start = pos_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(tail, value_start) {
                let val = String::from_utf8_lossy(&tail[start..end]);
                labels.position = DataLabelPosition::from_ooxml(&val);
            }
        }
    }

    // Parse separator
    if let Some(sep_start) = find_tag_simd(tail_children, b"separator", 0) {
        let sep_content_start = find_gt_simd(tail, sep_start).map(|p| p + 1);
        let sep_end = find_closing_tag(tail, b"separator", sep_start);

        if let (Some(start), Some(end)) = (sep_content_start, sep_end) {
            if start < end {
                labels.separator = Some(String::from_utf8_lossy(&tail[start..end]).to_string());
            }
        }
    }

    // Parse number format into structured NumFmt (preserves sourceLinked attribute)
    if let Some(numfmt_start) = find_tag_simd(tail_children, b"numFmt", 0) {
        if let Some(attr_pos) = find_attr_simd(&tail[numfmt_start..], b"formatCode=\"", 0) {
            let value_start = numfmt_start + attr_pos + 12;
            if let Some((start, end)) = extract_quoted_value(tail, value_start) {
                let format_code = decode_xml_entities(&tail[start..end]);
                let source_linked = if let Some(sl_pos) =
                    find_attr_simd(&tail[numfmt_start..], b"sourceLinked=\"", 0)
                {
                    let sl_start = numfmt_start + sl_pos + 14;
                    if let Some((s, e)) = extract_quoted_value(tail, sl_start) {
                        let val = &tail[s..e];
                        Some(val == b"1" || val == b"true")
                    } else {
                        None
                    }
                } else {
                    None
                };
                labels.num_fmt_obj = Some(ooxml_types::charts::NumFmt {
                    format_code: format_code.clone(),
                    source_linked,
                });
                // Also set legacy field for backward compatibility
                labels.num_fmt = Some(format_code);
            }
        }
    }

    // Parse spPr — only before extLst
    if let Some(sp_start) = find_tag_simd(tail_children, b"spPr", 0) {
        let sp_end = find_closing_tag(tail, b"spPr", sp_start).unwrap_or(tail_child_end);
        labels.sp_pr = Some(parse_shape_properties(&tail[sp_start..sp_end]));
    }

    // Parse txPr — only before extLst
    if let Some(txpr_start) = find_tag_simd(tail_children, b"txPr", 0) {
        let txpr_end = find_closing_tag(tail, b"txPr", txpr_start).unwrap_or(tail_child_end);
        labels.tx_pr = Some(parse_text_body(&tail[txpr_start..txpr_end]));
    }

    // Parse delete flag (CT_DLbls choice: delete OR group content)
    if let Some(del_start) = find_tag_simd(tail_children, b"delete", 0) {
        labels.delete = Some(parse_bool_val(&tail[del_start..]));
    }

    // Parse extLst
    labels.extensions = parse_chart_ext_lst(tail);

    labels
}

/// Parse an individual data label override (CT_DLbl).
pub(crate) fn parse_individual_data_label(xml: &[u8]) -> ooxml_types::charts::DataLabel {
    let mut label = ooxml_types::charts::DataLabel::default();

    // Parse idx
    if let Some(idx_start) = find_tag_simd(xml, b"idx", 0) {
        label.idx = parse_val_attr_u32(&xml[idx_start..]);
    }

    // Parse delete
    if let Some(del_start) = find_tag_simd(xml, b"delete", 0) {
        label.delete = Some(parse_bool_val(&xml[del_start..]));
    }

    // Parse numFmt
    if let Some(nf_start) = find_tag_simd(xml, b"numFmt", 0) {
        let mut num_fmt = ooxml_types::charts::NumFmt::default();
        if let Some(attr_pos) = find_attr_simd(&xml[nf_start..], b"formatCode=\"", 0) {
            let value_start = nf_start + attr_pos + 12;
            if let Some((s, e)) = extract_quoted_value(xml, value_start) {
                num_fmt.format_code = crate::infra::xml::decode_xml_entities(&xml[s..e]);
            }
        }
        if let Some(attr_pos) = find_attr_simd(&xml[nf_start..], b"sourceLinked=\"", 0) {
            let value_start = nf_start + attr_pos + 14;
            if let Some((s, e)) = extract_quoted_value(xml, value_start) {
                let val = &xml[s..e];
                num_fmt.source_linked = Some(val == b"1" || val == b"true");
            }
        }
        label.num_fmt = Some(num_fmt);
    }

    // Parse show flags
    if let Some(start) = find_tag_simd(xml, b"showVal", 0) {
        label.show_value = Some(parse_bool_val(&xml[start..]));
    }
    if let Some(start) = find_tag_simd(xml, b"showCatName", 0) {
        label.show_category = Some(parse_bool_val(&xml[start..]));
    }
    if let Some(start) = find_tag_simd(xml, b"showSerName", 0) {
        label.show_series_name = Some(parse_bool_val(&xml[start..]));
    }
    if let Some(start) = find_tag_simd(xml, b"showPercent", 0) {
        label.show_percent = Some(parse_bool_val(&xml[start..]));
    }
    if let Some(start) = find_tag_simd(xml, b"showLegendKey", 0) {
        label.show_legend_key = Some(parse_bool_val(&xml[start..]));
    }
    if let Some(start) = find_tag_simd(xml, b"showBubbleSize", 0) {
        label.show_bubble_size = Some(parse_bool_val(&xml[start..]));
    }

    // Parse position
    if let Some(pos_start) = find_tag_simd(xml, b"dLblPos", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[pos_start..], b"val=\"", 0) {
            let value_start = pos_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                label.position = Some(ooxml_types::charts::DataLabelPosition::from_ooxml(&val));
            }
        }
    }

    // Parse separator
    if let Some(sep_start) = find_tag_simd(xml, b"separator", 0) {
        let sep_content_start = find_gt_simd(xml, sep_start).map(|p| p + 1);
        let sep_end = find_closing_tag(xml, b"separator", sep_start);
        if let (Some(start), Some(end)) = (sep_content_start, sep_end) {
            if start < end {
                label.separator = Some(String::from_utf8_lossy(&xml[start..end]).to_string());
            }
        }
    }

    // Parse layout
    if let Some(layout_start) = find_tag_simd(xml, b"layout", 0) {
        let gt_pos = find_gt_simd(xml, layout_start).unwrap_or(xml.len());
        let is_self_closing = gt_pos > 0 && xml[gt_pos - 1] == b'/';
        if !is_self_closing {
            let layout_end = find_closing_tag(xml, b"layout", layout_start).unwrap_or(xml.len());
            label.layout = Some(crate::domain::charts::Chart::parse_layout(
                &xml[layout_start..layout_end],
            ));
        }
    }

    // Parse spPr
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        label.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    // Parse txPr
    if let Some(txpr_start) = find_tag_simd(xml, b"txPr", 0) {
        let txpr_end = find_closing_tag(xml, b"txPr", txpr_start).unwrap_or(xml.len());
        label.tx_pr = Some(parse_text_body(&xml[txpr_start..txpr_end]));
    }

    // Parse extLst
    label.extensions = parse_chart_ext_lst(xml);

    label
}

// =============================================================================
// Error Bars (parsing into ooxml_types::charts::ErrorBars)
