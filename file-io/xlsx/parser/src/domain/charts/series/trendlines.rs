use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
};

use super::xml_values::{parse_bool_val, parse_val_attr_u32, parse_val_f64};
use super::{
    Trendline, TrendlineLabel, TrendlineType, find_top_level_ext_lst, parse_chart_ext_lst_at,
};
use crate::domain::charts::{parse_shape_properties, parse_str_ref, parse_text_body};
use ooxml_types::charts::ChartText;
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

    // Parse direct-child extLst
    if let Some(ext_start) = find_top_level_ext_lst(xml) {
        trendline.extensions = parse_chart_ext_lst_at(xml, ext_start);
    }

    trendline
}
/// Parse a trendlineLbl element.
fn parse_trendline_label_element(xml: &[u8]) -> TrendlineLabel {
    let mut label = TrendlineLabel::default();

    // Parse layout > manualLayout
    if let Some(layout_start) = find_tag_simd(xml, b"layout", 0) {
        let layout_end = find_closing_tag(xml, b"layout", layout_start).unwrap_or(xml.len());
        label.layout = Some(crate::domain::charts::Chart::parse_layout(
            &xml[layout_start..layout_end],
        ));
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

    // Parse text (tx > rich or strRef)
    if let Some(tx_start) = find_tag_simd(xml, b"tx", 0) {
        let tx_end = find_closing_tag(xml, b"tx", tx_start).unwrap_or(xml.len());
        let tx_xml = &xml[tx_start..tx_end];
        if let Some(rich_start) = find_tag_simd(tx_xml, b"rich", 0) {
            let rich_end = find_closing_tag(tx_xml, b"rich", rich_start).unwrap_or(tx_xml.len());
            label.tx = Some(ChartText::Rich(parse_text_body(
                &tx_xml[rich_start..rich_end],
            )));
        } else if let Some(strref_start) = find_tag_simd(tx_xml, b"strRef", 0) {
            let strref_end =
                find_closing_tag(tx_xml, b"strRef", strref_start).unwrap_or(tx_xml.len());
            label.tx = Some(ChartText::StrRef(parse_str_ref(
                &tx_xml[strref_start..strref_end],
            )));
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

    if let Some(ext_start) = find_top_level_ext_lst(xml) {
        label.extensions = parse_chart_ext_lst_at(xml, ext_start);
    }

    label
}
