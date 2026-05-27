//! ChartSpace-level property parsing for standard OOXML charts.

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};

use super::super::*;
use super::attrs;

/// Parse ChartSpace-level properties.
/// Parse ChartSpace-level properties that appear BEFORE `<c:chart>`:
/// date1904, lang, roundedCorners, style, AlternateContent, protection.
pub(super) fn parse_chart_space_pre_chart_props(xml: &[u8], start: usize, chart: &mut Chart) {
    if let Some(d_start) = find_tag_simd(xml, b"date1904", start) {
        chart.date1904 = Some(attrs::parse_bool_attr(&xml[d_start..], b"val=\""));
    }
    if let Some(l_start) = find_tag_simd(xml, b"lang", start) {
        chart.lang = attrs::parse_string_attr(&xml[l_start..], b"val=\"");
    }
    if let Some(rc_start) = find_tag_simd(xml, b"roundedCorners", start) {
        chart.rounded_corners = Some(attrs::parse_bool_attr(&xml[rc_start..], b"val=\""));
    }
    if let Some(s_start) = find_tag_simd(xml, b"style", start) {
        chart.style = attrs::parse_u32_attr(&xml[s_start..], b"val=\"");
    }

    // Detect mc:AlternateContent wrapping the style element for round-trip.
    // Excel writes: <mc:AlternateContent><mc:Choice Requires="c14"><c14:style val="102"/>
    //               </mc:Choice><mc:Fallback><c:style val="2"/></mc:Fallback></mc:AlternateContent>
    if let Some(ac_start) = find_tag_simd(xml, b"AlternateContent", start) {
        // find_tag_simd returns the position of '<', so ac_start is the '<' of <mc:AlternateContent
        let ac_close_lt = find_closing_tag(xml, b"AlternateContent", ac_start);
        if let Some(close_lt) = ac_close_lt {
            // find_closing_tag returns the '<' of </mc:AlternateContent>.
            // Find the '>' that ends the closing tag.
            let close_gt = find_gt_simd(xml, close_lt)
                .map(|p| p + 1)
                .unwrap_or(xml.len());
            if let Ok(raw) = std::str::from_utf8(&xml[ac_start..close_gt]) {
                chart.style_alternate_content = Some(raw.to_string());
            }
        }
    }

    // Parse pivotSource
    if let Some(ps_start) = find_tag_simd(xml, b"pivotSource", start) {
        let ps_end = find_closing_tag(xml, b"pivotSource", ps_start).unwrap_or(xml.len());
        let ps_bytes = &xml[ps_start..ps_end];
        let name = if let Some(n_start) = find_tag_simd(ps_bytes, b"name", 0) {
            let n_end = find_closing_tag(ps_bytes, b"name", n_start).unwrap_or(ps_bytes.len());
            let n_open_end = find_gt_simd(ps_bytes, n_start)
                .map(|p| p + 1)
                .unwrap_or(n_start);
            String::from_utf8_lossy(&ps_bytes[n_open_end..n_end])
                .trim()
                .to_string()
        } else {
            String::new()
        };
        let fmt_id = if let Some(f_start) = find_tag_simd(ps_bytes, b"fmtId", 0) {
            attrs::parse_u32_attr(&ps_bytes[f_start..], b"val=\"").unwrap_or(0)
        } else {
            0
        };
        let extensions = parse_chart_ext_lst(ps_bytes);
        chart.pivot_source = Some(ooxml_types::charts::PivotSource {
            name,
            fmt_id,
            extensions,
        });
    }

    // Parse protection
    if let Some(prot_start) = find_tag_simd(xml, b"protection", start) {
        let prot_end = find_closing_tag(xml, b"protection", prot_start).unwrap_or(xml.len());
        let prot_xml = &xml[prot_start..prot_end];
        let mut prot = ChartProtection::default();
        if let Some(p) = find_tag_simd(prot_xml, b"chartObject", 0) {
            prot.chart_object = Some(attrs::parse_bool_attr(&prot_xml[p..], b"val=\""));
        }
        if let Some(p) = find_tag_simd(prot_xml, b"data", 0) {
            prot.data = Some(attrs::parse_bool_attr(&prot_xml[p..], b"val=\""));
        }
        if let Some(p) = find_tag_simd(prot_xml, b"formatting", 0) {
            prot.formatting = Some(attrs::parse_bool_attr(&prot_xml[p..], b"val=\""));
        }
        if let Some(p) = find_tag_simd(prot_xml, b"selection", 0) {
            prot.selection = Some(attrs::parse_bool_attr(&prot_xml[p..], b"val=\""));
        }
        if let Some(p) = find_tag_simd(prot_xml, b"userInterface", 0) {
            prot.user_interface = Some(attrs::parse_bool_attr(&prot_xml[p..], b"val=\""));
        }
        chart.protection = Some(prot);
    }
}

/// Parse ChartSpace-level properties that appear AFTER `</c:chart>`:
/// spPr, txPr, externalData, printSettings, and mc:AlternateContent (style).
pub(super) fn parse_chart_space_post_chart_props(xml: &[u8], start: usize, chart: &mut Chart) {
    // Some producers (e.g., Google Sheets) place mc:AlternateContent (wrapping
    // c14:style) AFTER </c:chart> instead of before it. If we didn't already
    // capture it in the pre-chart pass, look for it here.
    if chart.style_alternate_content.is_none() {
        if let Some(ac_start) = find_tag_simd(xml, b"AlternateContent", start) {
            let ac_close_lt = find_closing_tag(xml, b"AlternateContent", ac_start);
            if let Some(close_lt) = ac_close_lt {
                let close_gt = find_gt_simd(xml, close_lt)
                    .map(|p| p + 1)
                    .unwrap_or(xml.len());
                if let Ok(raw) = std::str::from_utf8(&xml[ac_start..close_gt]) {
                    chart.style_alternate_content = Some(raw.to_string());
                    chart.style_after_chart = true;
                }
            }
        }
    }

    // Parse externalData
    if let Some(ext_start) = find_tag_simd(xml, b"externalData", start) {
        let ext_end = find_closing_tag(xml, b"externalData", ext_start).unwrap_or(xml.len());
        let ext_xml = &xml[ext_start..ext_end];
        let r_id = attrs::parse_string_attr(ext_xml, b"r:id=\"").unwrap_or_default();
        let auto_update = find_tag_simd(ext_xml, b"autoUpdate", 0)
            .map(|p| attrs::parse_bool_attr(&ext_xml[p..], b"val=\""));
        chart.external_data = Some(ExternalData { r_id, auto_update });
    }

    // Parse printSettings
    if let Some(ps_start) = find_tag_simd(xml, b"printSettings", start) {
        let ps_end = find_closing_tag(xml, b"printSettings", ps_start).unwrap_or(xml.len());
        let ps_xml = &xml[ps_start..ps_end];
        let mut ps = PrintSettings::default();

        // Parse headerFooter (CT_HeaderFooter)
        if let Some(hf_start) = find_tag_simd(ps_xml, b"headerFooter", 0) {
            let mut hf = ooxml_types::print::HeaderFooter::default();
            // Check if it has children (non-self-closing)
            if let Some(hf_end) = find_closing_tag(ps_xml, b"headerFooter", hf_start) {
                let hf_xml = &ps_xml[hf_start..hf_end];
                if let Some(p) = find_tag_simd(hf_xml, b"oddHeader", 0) {
                    hf.odd_header = attrs::parse_element_text(&hf_xml[p..], b"oddHeader");
                }
                if let Some(p) = find_tag_simd(hf_xml, b"oddFooter", 0) {
                    hf.odd_footer = attrs::parse_element_text(&hf_xml[p..], b"oddFooter");
                }
                if let Some(p) = find_tag_simd(hf_xml, b"evenHeader", 0) {
                    hf.even_header = attrs::parse_element_text(&hf_xml[p..], b"evenHeader");
                }
                if let Some(p) = find_tag_simd(hf_xml, b"evenFooter", 0) {
                    hf.even_footer = attrs::parse_element_text(&hf_xml[p..], b"evenFooter");
                }
                if let Some(p) = find_tag_simd(hf_xml, b"firstHeader", 0) {
                    hf.first_header = attrs::parse_element_text(&hf_xml[p..], b"firstHeader");
                }
                if let Some(p) = find_tag_simd(hf_xml, b"firstFooter", 0) {
                    hf.first_footer = attrs::parse_element_text(&hf_xml[p..], b"firstFooter");
                }
                // Parse attributes
                if let Some(v) =
                    attrs::parse_string_attr(&ps_xml[hf_start..], b"differentOddEven=\"")
                {
                    hf.different_odd_even = v == "1" || v == "true";
                }
                if let Some(v) = attrs::parse_string_attr(&ps_xml[hf_start..], b"differentFirst=\"")
                {
                    hf.different_first = v == "1" || v == "true";
                }
            }
            ps.header_footer = Some(hf);
        }

        // Parse pageMargins
        if let Some(pm_start) = find_tag_simd(ps_xml, b"pageMargins", 0) {
            let pm_xml = &ps_xml[pm_start..];
            let mut margins = PageMargins::default();
            if let Some(v) = attrs::parse_f64_attr(pm_xml, b"b=\"") {
                margins.bottom = v;
            }
            if let Some(v) = attrs::parse_f64_attr(pm_xml, b"l=\"") {
                margins.left = v;
            }
            if let Some(v) = attrs::parse_f64_attr(pm_xml, b"r=\"") {
                margins.right = v;
            }
            if let Some(v) = attrs::parse_f64_attr(pm_xml, b"t=\"") {
                margins.top = v;
            }
            if let Some(v) = attrs::parse_f64_attr(pm_xml, b"header=\"") {
                margins.header = v;
            }
            if let Some(v) = attrs::parse_f64_attr(pm_xml, b"footer=\"") {
                margins.footer = v;
            }
            ps.page_margins = Some(margins);
        }

        // Parse pageSetup (CT_PageSetup, §21.2.2.135 — all 11 attributes)
        if let Some(psu_start) = find_tag_simd(ps_xml, b"pageSetup", 0) {
            let psu_xml = &ps_xml[psu_start..];
            let mut setup = PageSetup::default();
            setup.paper_size = attrs::parse_u32_attr(psu_xml, b"paperSize=\"");
            setup.paper_height = attrs::parse_string_attr(psu_xml, b"paperHeight=\"");
            setup.paper_width = attrs::parse_string_attr(psu_xml, b"paperWidth=\"");
            setup.first_page_number = attrs::parse_u32_attr(psu_xml, b"firstPageNumber=\"");
            setup.orientation = attrs::parse_string_attr(psu_xml, b"orientation=\"")
                .map(|s| ooxml_types::charts::PageOrientation::from_ooxml(&s));
            setup.black_and_white = attrs::parse_string_attr(psu_xml, b"blackAndWhite=\"")
                .map(|s| s == "1" || s == "true");
            setup.draft =
                attrs::parse_string_attr(psu_xml, b"draft=\"").map(|s| s == "1" || s == "true");
            setup.use_first_page_number =
                attrs::parse_string_attr(psu_xml, b"useFirstPageNumber=\"")
                    .map(|s| s == "1" || s == "true");
            setup.horizontal_dpi =
                attrs::parse_u32_attr(psu_xml, b"horizontalDpi=\"").map(|v| v as i32);
            setup.vertical_dpi =
                attrs::parse_u32_attr(psu_xml, b"verticalDpi=\"").map(|v| v as i32);
            setup.copies = attrs::parse_u32_attr(psu_xml, b"copies=\"");
            ps.page_setup = Some(setup);
        }

        chart.print_settings = Some(ps);
    }

    // Parse userShapes (c:userShapes r:id="...")
    if let Some(us_start) = find_tag_simd(xml, b"userShapes", start) {
        chart.user_shapes = attrs::parse_string_attr(&xml[us_start..], b"r:id=\"");
    }

    // Parse chartSpace-level spPr (after </c:chart>)
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", start) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        chart.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    // Parse chartSpace-level txPr (after </c:chart>)
    if let Some(tp_start) = find_tag_simd(xml, b"txPr", start) {
        let tp_end = find_closing_tag(xml, b"txPr", tp_start).unwrap_or(xml.len());
        chart.tx_pr = Some(parse_text_body(&xml[tp_start..tp_end]));
    }
}
