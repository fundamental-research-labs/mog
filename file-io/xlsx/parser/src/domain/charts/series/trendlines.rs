use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
};
use crate::infra::xml::decode_xml_entities;

use super::xml_values::{parse_bool_val, parse_val_attr_u32, parse_val_f64};
use super::{
    parse_chart_ext_lst, LayoutMode, LayoutTarget, ManualLayout, Trendline, TrendlineLabel,
    TrendlineType,
};
use crate::domain::charts::{parse_shape_properties, parse_text_body};
use ooxml_types::charts::NumFmt;

pub fn parse_trendline(xml: &[u8]) -> Trendline {
    let mut trendline = Trendline::default();

    // Parse name
    if let Some(name_start) = find_tag_simd(xml, b"name", 0) {
        let name_content_start = find_gt_simd(xml, name_start).map(|p| p + 1);
        let name_end = find_closing_tag(xml, b"name", name_start);

        if let (Some(start), Some(end)) = (name_content_start, name_end) {
            if start < end {
                trendline.name = Some(String::from_utf8_lossy(&xml[start..end]).to_string());
            }
        }
    }

    // Parse trendline type
    if let Some(type_start) = find_tag_simd(xml, b"trendlineType", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[type_start..], b"val=\"", 0) {
            let value_start = type_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                trendline.trendline_type = TrendlineType::from_ooxml(&val);
            }
        }
    }

    // Parse order → Option<u32>
    if let Some(order_start) = find_tag_simd(xml, b"order", 0) {
        let val = parse_val_attr_u32(&xml[order_start..]);
        if val > 0 {
            trendline.order = Some(val);
        }
    }

    // Parse period → Option<u32>
    if let Some(period_start) = find_tag_simd(xml, b"period", 0) {
        let val = parse_val_attr_u32(&xml[period_start..]);
        if val > 0 {
            trendline.period = Some(val);
        }
    }

    // Parse forward → Option<f64>
    if let Some(fwd_start) = find_tag_simd(xml, b"forward", 0) {
        let val = parse_val_f64(&xml[fwd_start..]);
        if val != 0.0 {
            trendline.forward = Some(val);
        }
    }

    // Parse backward → Option<f64>
    if let Some(bwd_start) = find_tag_simd(xml, b"backward", 0) {
        let val = parse_val_f64(&xml[bwd_start..]);
        if val != 0.0 {
            trendline.backward = Some(val);
        }
    }

    // Parse intercept → Option<f64>
    if let Some(int_start) = find_tag_simd(xml, b"intercept", 0) {
        trendline.intercept = Some(parse_val_f64(&xml[int_start..]));
    }

    // Parse display equation → Option<bool>
    if let Some(eq_start) = find_tag_simd(xml, b"dispEq", 0) {
        if parse_bool_val(&xml[eq_start..]) {
            trendline.disp_eq = Some(true);
        }
    }

    // Parse display R-squared → Option<bool>
    if let Some(rsq_start) = find_tag_simd(xml, b"dispRSqr", 0) {
        if parse_bool_val(&xml[rsq_start..]) {
            trendline.disp_r_sqr = Some(true);
        }
    }

    // Parse spPr
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        trendline.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    // Parse trendlineLbl
    if let Some(lbl_start) = find_tag_simd(xml, b"trendlineLbl", 0) {
        let lbl_end = find_closing_tag(xml, b"trendlineLbl", lbl_start).unwrap_or(xml.len());
        let lbl_xml = &xml[lbl_start..lbl_end];
        trendline.trendline_lbl = Some(parse_trendline_label_element(lbl_xml));
    }

    // Parse extLst
    trendline.extensions = parse_chart_ext_lst(xml);

    trendline
}
/// Parse a trendlineLbl element.
fn parse_trendline_label_element(xml: &[u8]) -> TrendlineLabel {
    let mut label = TrendlineLabel::default();

    // Parse layout > manualLayout
    if let Some(layout_start) = find_tag_simd(xml, b"layout", 0) {
        let layout_end = find_closing_tag(xml, b"layout", layout_start).unwrap_or(xml.len());
        let layout_xml = &xml[layout_start..layout_end];

        if let Some(ml_start) = find_tag_simd(layout_xml, b"manualLayout", 0) {
            let ml_end =
                find_closing_tag(layout_xml, b"manualLayout", ml_start).unwrap_or(layout_xml.len());
            let ml = &layout_xml[ml_start..ml_end];
            let mut manual = ManualLayout::default();

            if let Some(start) = find_tag_simd(ml, b"layoutTarget", 0) {
                if let Some(attr_pos) = find_attr_simd(&ml[start..], b"val=\"", 0) {
                    let value_start = start + attr_pos + 5;
                    if let Some((s, e)) = extract_quoted_value(ml, value_start) {
                        let val = String::from_utf8_lossy(&ml[s..e]);
                        manual.layout_target = Some(LayoutTarget::from_ooxml(&val));
                    }
                }
            }
            if let Some(start) = find_tag_simd(ml, b"xMode", 0) {
                if let Some(attr_pos) = find_attr_simd(&ml[start..], b"val=\"", 0) {
                    let value_start = start + attr_pos + 5;
                    if let Some((s, e)) = extract_quoted_value(ml, value_start) {
                        let val = String::from_utf8_lossy(&ml[s..e]);
                        manual.x_mode = Some(LayoutMode::from_ooxml(&val));
                    }
                }
            }
            if let Some(start) = find_tag_simd(ml, b"yMode", 0) {
                if let Some(attr_pos) = find_attr_simd(&ml[start..], b"val=\"", 0) {
                    let value_start = start + attr_pos + 5;
                    if let Some((s, e)) = extract_quoted_value(ml, value_start) {
                        let val = String::from_utf8_lossy(&ml[s..e]);
                        manual.y_mode = Some(LayoutMode::from_ooxml(&val));
                    }
                }
            }
            // Parse x, y positions
            if let Some(start) = find_tag_simd(ml, b"x", 0) {
                manual.x = Some(parse_val_f64(&ml[start..]));
            }
            if let Some(start) = find_tag_simd(ml, b"y", 0) {
                manual.y = Some(parse_val_f64(&ml[start..]));
            }

            label.layout = Some(manual);
        }
    }

    // Parse numFmt
    if let Some(nf_start) = find_tag_simd(xml, b"numFmt", 0) {
        let mut num_fmt = NumFmt::default();
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

    // Parse text (tx > rich > a:p > a:r > a:t)
    if let Some(tx_start) = find_tag_simd(xml, b"<c:tx", 0) {
        let tx_end = find_closing_tag(xml, b"c:tx", tx_start).unwrap_or(xml.len());
        let tx_xml = &xml[tx_start..tx_end];
        // Extract text from rich text runs
        let mut text_parts = Vec::new();
        let mut pos = 0;
        while let Some(t_start) = find_tag_simd(tx_xml, b"a:t", pos) {
            let t_content_start = find_gt_simd(tx_xml, t_start).map(|p| p + 1);
            let t_end = find_closing_tag(tx_xml, b"a:t", t_start);
            if let (Some(start), Some(end)) = (t_content_start, t_end) {
                if start < end {
                    text_parts.push(String::from_utf8_lossy(&tx_xml[start..end]).to_string());
                }
            }
            pos = t_end.unwrap_or(tx_xml.len());
        }
        if !text_parts.is_empty() {
            let combined_text = text_parts.join("");
            let text_body = ooxml_types::drawings::TextBody {
                paragraphs: vec![ooxml_types::drawings::Paragraph {
                    runs: vec![ooxml_types::drawings::TextRunContent::Run(
                        ooxml_types::drawings::TextRun {
                            text: combined_text,
                            ..Default::default()
                        },
                    )],
                    ..Default::default()
                }],
                ..Default::default()
            };
            label.tx = Some(ooxml_types::charts::ChartText::Rich(text_body));
        }
    }

    // Parse spPr
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        label.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    // Parse txPr
    if let Some(tp_start) = find_tag_simd(xml, b"txPr", 0) {
        let tp_end = find_closing_tag(xml, b"txPr", tp_start).unwrap_or(xml.len());
        label.tx_pr = Some(parse_text_body(&xml[tp_start..tp_end]));
    }

    label
}
