use super::super::super::helpers::{
    extract_attr_value_in_element, parse_i32, parse_i64, parse_u32,
};
use super::super::super::reader::elements::{direct_child_elements, direct_child_slice};
use super::super::super::types::{
    TextAutofit, TextBodyProperties, TextHorzOverflow, TextVertOverflow, TextVerticalType,
};
use super::common::parse_ext_lst;
use super::enums::{parse_text_anchor, parse_text_wrap};
use ooxml_types::drawings::StAngle;

pub(in crate::domain::drawings::parse) fn parse_body_props(xml: &[u8]) -> TextBodyProperties {
    let mut props = TextBodyProperties::default();

    props.rot = extract_attr_value_in_element(xml, b"rot=\"")
        .and_then(|v| parse_i32(v))
        .map(StAngle::new);

    props.anchor =
        extract_attr_value_in_element(xml, b"anchor=\"").and_then(|v| parse_text_anchor(v));

    props.wrap = extract_attr_value_in_element(xml, b"wrap=\"").and_then(|v| parse_text_wrap(v));

    props.l_ins = extract_attr_value_in_element(xml, b"lIns=\"").and_then(|v| parse_i64(v));

    props.t_ins = extract_attr_value_in_element(xml, b"tIns=\"").and_then(|v| parse_i64(v));

    props.r_ins = extract_attr_value_in_element(xml, b"rIns=\"").and_then(|v| parse_i64(v));

    props.b_ins = extract_attr_value_in_element(xml, b"bIns=\"").and_then(|v| parse_i64(v));

    // New attributes
    props.vert = extract_attr_value_in_element(xml, b"vert=\"").and_then(|v| {
        let s = std::str::from_utf8(v).ok()?;
        let parsed = TextVerticalType::from_ooxml(s);
        if parsed != TextVerticalType::Horizontal || s == "horz" {
            Some(parsed)
        } else {
            None
        }
    });

    props.vert_overflow = extract_attr_value_in_element(xml, b"vertOverflow=\"").and_then(|v| {
        let s = std::str::from_utf8(v).ok()?;
        let parsed = TextVertOverflow::from_ooxml(s);
        if parsed != TextVertOverflow::Overflow || s == "overflow" {
            Some(parsed)
        } else {
            None
        }
    });

    props.horz_overflow = extract_attr_value_in_element(xml, b"horzOverflow=\"").and_then(|v| {
        let s = std::str::from_utf8(v).ok()?;
        let parsed = TextHorzOverflow::from_ooxml(s);
        if parsed != TextHorzOverflow::Overflow || s == "overflow" {
            Some(parsed)
        } else {
            None
        }
    });

    props.anchor_ctr =
        extract_attr_value_in_element(xml, b"anchorCtr=\"").map(|v| v == b"1" || v == b"true");

    props.rtl_col =
        extract_attr_value_in_element(xml, b"rtlCol=\"").map(|v| v == b"1" || v == b"true");

    props.spc_first_last_para = extract_attr_value_in_element(xml, b"spcFirstLastPara=\"")
        .map(|v| v == b"1" || v == b"true");

    props.num_col = extract_attr_value_in_element(xml, b"numCol=\"").and_then(|v| parse_u32(v));

    props.spc_col = extract_attr_value_in_element(xml, b"spcCol=\"").and_then(|v| parse_i64(v));

    props.upright =
        extract_attr_value_in_element(xml, b"upright=\"").map(|v| v == b"1" || v == b"true");

    props.compat_ln_spc =
        extract_attr_value_in_element(xml, b"compatLnSpc=\"").map(|v| v == b"1" || v == b"true");

    props.force_aa =
        extract_attr_value_in_element(xml, b"forceAA=\"").map(|v| v == b"1" || v == b"true");

    props.from_word_art =
        extract_attr_value_in_element(xml, b"fromWordArt=\"").map(|v| v == b"1" || v == b"true");

    // Parse autofit child elements
    if direct_child_slice(xml, b"spAutoFit").is_some() {
        props.autofit = Some(TextAutofit::ShapeAutofit);
    } else if let Some(norm_xml) = direct_child_slice(xml, b"normAutofit") {
        let font_scale =
            extract_attr_value_in_element(norm_xml, b"fontScale=\"").and_then(|v| parse_u32(v));
        let line_space_reduction = extract_attr_value_in_element(norm_xml, b"lnSpcReduction=\"")
            .and_then(|v| parse_u32(v));
        props.autofit = Some(TextAutofit::NormalAutofit {
            font_scale,
            line_space_reduction,
        });
    } else if direct_child_slice(xml, b"noAutofit").is_some() {
        props.autofit = Some(TextAutofit::NoAutofit);
    }

    // Parse prstTxWarp child element
    if let Some(warp_xml) = direct_child_slice(xml, b"prstTxWarp") {
        if let Some(prst_val) = extract_attr_value_in_element(warp_xml, b"prst=\"") {
            if let Some(preset) = ooxml_types::drawings::TextWarpPreset::from_ooxml(
                std::str::from_utf8(prst_val).unwrap_or(""),
            ) {
                let mut adjust_values = Vec::new();
                if let Some(avlst_xml) = direct_child_slice(warp_xml, b"avLst") {
                    for gd_xml in direct_child_elements(avlst_xml)
                        .filter(|child| child.local_name == b"gd")
                        .map(|child| child.full_slice(avlst_xml))
                    {
                        if let (Some(name_val), Some(fmla_val)) = (
                            extract_attr_value_in_element(gd_xml, b"name=\""),
                            extract_attr_value_in_element(gd_xml, b"fmla=\""),
                        ) {
                            adjust_values.push(ooxml_types::drawings::GeomGuide {
                                name: String::from_utf8_lossy(name_val).into_owned(),
                                fmla: String::from_utf8_lossy(fmla_val).into_owned(),
                            });
                        }
                    }
                }
                props.prst_tx_warp = Some(ooxml_types::drawings::PresetTextWarp {
                    preset,
                    adjust_values,
                });
            }
        }
    }

    // Parse extLst (opaque XML capture)
    if let Some(ext_lst) = direct_child_slice(xml, b"extLst") {
        props.ext_lst = parse_ext_lst(ext_lst);
    }

    props
}
