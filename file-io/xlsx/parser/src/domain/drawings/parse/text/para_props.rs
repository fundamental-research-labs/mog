use super::super::super::helpers::{extract_attr_value_in_element, parse_i64, parse_u32};
use super::super::super::reader::elements::{direct_child_elements, direct_child_slice};
use super::super::super::types::{
    ParagraphProperties, TextFontAlignType, TextTabAlignType, TextTabStop,
};
use super::bullets::parse_bullet_props;
use super::common::{parse_ext_lst, parse_text_spacing};
use super::enums::parse_text_align;
use super::run_props::parse_run_props;
use ooxml_types::drawings::StTextIndentLevelType;

pub(in crate::domain::drawings::parse) fn parse_para_props(xml: &[u8]) -> ParagraphProperties {
    let mut props = ParagraphProperties::default();

    props.align = extract_attr_value_in_element(xml, b"algn=\"").and_then(|v| parse_text_align(v));

    props.margin_l = extract_attr_value_in_element(xml, b"marL=\"").and_then(|v| parse_i64(v));

    props.margin_r = extract_attr_value_in_element(xml, b"marR=\"").and_then(|v| parse_i64(v));

    props.indent = extract_attr_value_in_element(xml, b"indent=\"").and_then(|v| parse_i64(v));

    props.level = extract_attr_value_in_element(xml, b"lvl=\"")
        .and_then(|v| parse_u32(v))
        .map(StTextIndentLevelType::new_clamped);

    props.rtl = extract_attr_value_in_element(xml, b"rtl=\"").map(|v| v == b"1" || v == b"true");

    props.def_tab_sz =
        extract_attr_value_in_element(xml, b"defTabSz=\"").and_then(|v| parse_i64(v));

    props.ea_ln_brk =
        extract_attr_value_in_element(xml, b"eaLnBrk=\"").map(|v| v == b"1" || v == b"true");

    props.latin_ln_brk =
        extract_attr_value_in_element(xml, b"latinLnBrk=\"").map(|v| v == b"1" || v == b"true");

    props.hanging_punct =
        extract_attr_value_in_element(xml, b"hangingPunct=\"").map(|v| v == b"1" || v == b"true");

    props.font_align = extract_attr_value_in_element(xml, b"fontAlgn=\"").and_then(|v| {
        let s = std::str::from_utf8(v).ok()?;
        let parsed = TextFontAlignType::from_ooxml(s);
        if parsed != TextFontAlignType::Auto || s == "auto" {
            Some(parsed)
        } else {
            None
        }
    });

    if let Some(ln_spc) = direct_child_slice(xml, b"lnSpc") {
        props.line_spacing = parse_text_spacing(ln_spc);
    }

    if let Some(spc_bef) = direct_child_slice(xml, b"spcBef") {
        props.space_before = parse_text_spacing(spc_bef);
    }

    if let Some(spc_aft) = direct_child_slice(xml, b"spcAft") {
        props.space_after = parse_text_spacing(spc_aft);
    }

    props.bullet = parse_bullet_props(xml);

    if let Some(def_rpr) = direct_child_slice(xml, b"defRPr") {
        props.def_run_props = Some(Box::new(parse_run_props(def_rpr)));
    }

    if let Some(tab_lst) = direct_child_slice(xml, b"tabLst") {
        let tabs = direct_child_elements(tab_lst)
            .filter(|child| child.local_name == b"tab")
            .map(|child| {
                let tab_xml = child.full_slice(tab_lst);
                let position =
                    extract_attr_value_in_element(tab_xml, b"pos=\"").and_then(|v| parse_i64(v));
                let align = extract_attr_value_in_element(tab_xml, b"algn=\"").and_then(|v| {
                    let s = std::str::from_utf8(v).ok()?;
                    let parsed = TextTabAlignType::from_ooxml(s);
                    if parsed != TextTabAlignType::Left || s == "l" {
                        Some(parsed)
                    } else {
                        None
                    }
                });
                TextTabStop { position, align }
            })
            .collect();
        // Store tab list even if empty, to preserve <a:tabLst/> for round-trip
        props.tab_list = Some(tabs);
    }

    if let Some(ext_lst) = direct_child_slice(xml, b"extLst") {
        props.ext_lst = parse_ext_lst(ext_lst);
    }

    props
}
