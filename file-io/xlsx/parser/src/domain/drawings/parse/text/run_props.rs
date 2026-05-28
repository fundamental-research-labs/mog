use super::super::super::helpers::{extract_attr_value_in_element, parse_i32, parse_u32};
use super::super::super::reader::elements::direct_child_slice;
use super::super::super::types::{
    DrawingColor, Fill, Hyperlink, RunProperties, TextCapsType, TextFont, TextStrikeType,
    TextUnderlineType, UnderlineFill, UnderlineLine,
};
use super::super::styling::{parse_color, parse_effect_list, parse_outline};
use super::common::{parse_direct_fill_choice, parse_ext_lst};
use ooxml_types::drawings::{
    StPercentage, StPitchFamily, StTextFontSize, StTextNonNegativePoint, StTextPoint,
};

pub(in crate::domain::drawings::parse) fn parse_run_props(xml: &[u8]) -> RunProperties {
    let mut props = RunProperties::default();

    props.size = extract_attr_value_in_element(xml, b"sz=\"")
        .and_then(|v| parse_u32(v))
        .map(StTextFontSize::new_clamped);

    props.bold = extract_attr_value_in_element(xml, b"b=\"").map(|v| v == b"1" || v == b"true");

    props.italic = extract_attr_value_in_element(xml, b"i=\"").map(|v| v == b"1" || v == b"true");

    props.underline = extract_attr_value_in_element(xml, b"u=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(TextUnderlineType::from_ooxml);

    props.strike = extract_attr_value_in_element(xml, b"strike=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(TextStrikeType::from_ooxml);

    props.kern = extract_attr_value_in_element(xml, b"kern=\"")
        .and_then(|v| parse_u32(v))
        .map(StTextNonNegativePoint::new_clamped);

    props.cap = extract_attr_value_in_element(xml, b"cap=\"").and_then(|v| {
        let s = std::str::from_utf8(v).ok()?;
        let parsed = TextCapsType::from_ooxml(s);
        if parsed != TextCapsType::None || s == "none" {
            Some(parsed)
        } else {
            None
        }
    });

    props.spacing = extract_attr_value_in_element(xml, b"spc=\"")
        .and_then(|v| parse_i32(v))
        .map(StTextPoint::new);

    props.baseline = extract_attr_value_in_element(xml, b"baseline=\"")
        .and_then(|v| parse_i32(v))
        .map(StPercentage::new);

    props.lang = extract_attr_value_in_element(xml, b"lang=\"")
        .map(|v| String::from_utf8_lossy(v).into_owned());

    props.alt_lang = extract_attr_value_in_element(xml, b"altLang=\"")
        .map(|v| String::from_utf8_lossy(v).into_owned());

    props.kumimoji =
        extract_attr_value_in_element(xml, b"kumimoji=\"").map(|v| v == b"1" || v == b"true");

    props.normalize_h =
        extract_attr_value_in_element(xml, b"normalizeH=\"").map(|v| v == b"1" || v == b"true");

    props.no_proof =
        extract_attr_value_in_element(xml, b"noProof=\"").map(|v| v == b"1" || v == b"true");

    props.dirty =
        extract_attr_value_in_element(xml, b"dirty=\"").map(|v| v == b"1" || v == b"true");

    props.err = extract_attr_value_in_element(xml, b"err=\"").map(|v| v == b"1" || v == b"true");

    props.smt_clean =
        extract_attr_value_in_element(xml, b"smtClean=\"").map(|v| v == b"1" || v == b"true");

    props.smt_id = extract_attr_value_in_element(xml, b"smtId=\"").and_then(|v| parse_u32(v));

    props.bmk = extract_attr_value_in_element(xml, b"bmk=\"")
        .map(|v| String::from_utf8_lossy(v).into_owned());

    props.latin = parse_text_font(xml, b"latin");
    props.ea = parse_text_font(xml, b"ea");
    props.cs = parse_text_font(xml, b"cs");
    props.sym = parse_text_font(xml, b"sym");

    if let Some(effect_lst) = direct_child_slice(xml, b"effectLst") {
        props.effects =
            parse_effect_list(effect_lst).map(ooxml_types::drawings::EffectProperties::EffectList);
    }

    if let Some(highlight) = direct_child_slice(xml, b"highlight") {
        let c = parse_color(highlight);
        // Only set highlight if the parsed color has meaningful data (not empty default)
        let is_empty = matches!(&c, DrawingColor::SrgbClr { val, .. } if val.is_empty());
        if !is_empty {
            props.highlight = Some(c);
        }
    }

    if let Some(hlink_click) = direct_child_slice(xml, b"hlinkClick") {
        props.hlink_click = Some(parse_hyperlink(hlink_click));
    }

    if let Some(hlink_mouse_over) = direct_child_slice(xml, b"hlinkMouseOver") {
        props.hlink_mouse_over = Some(parse_hyperlink(hlink_mouse_over));
    }

    if let Some(ln) = direct_child_slice(xml, b"ln") {
        if let Some(outline) = parse_outline(ln) {
            props.text_outline = Some(outline);
        }
    }

    if let Some(fill) = parse_direct_fill_choice(xml) {
        if let Fill::Solid(solid) = &fill {
            props.color = Some(solid.color.clone());
        }
        props.text_fill = Some(fill);
    }

    if direct_child_slice(xml, b"uLnTx").is_some() {
        props.underline_line = Some(UnderlineLine::FollowText);
    } else if let Some(u_ln) = direct_child_slice(xml, b"uLn") {
        if let Some(outline) = parse_outline(u_ln) {
            props.underline_line = Some(UnderlineLine::Custom(outline));
        }
    }

    if direct_child_slice(xml, b"uFillTx").is_some() {
        props.underline_fill = Some(UnderlineFill::FollowText);
    } else if let Some(u_fill) = direct_child_slice(xml, b"uFill") {
        if let Some(fill) = parse_direct_fill_choice(u_fill) {
            props.underline_fill = Some(UnderlineFill::Custom(fill));
        }
    }

    if let Some(rtl) = direct_child_slice(xml, b"rtl") {
        props.rtl = extract_attr_value_in_element(rtl, b"val=\"")
            .map(|v| v == b"1" || v == b"true")
            .or(Some(true)); // presence without val= implies true
    }

    if let Some(ext_lst) = direct_child_slice(xml, b"extLst") {
        props.ext_lst = parse_ext_lst(ext_lst);
    }

    props
}

// =========================================================================
// Helper functions
// =========================================================================

/// Parse a TextFont from a tag like `<a:latin>`, `<a:ea>`, `<a:cs>`, `<a:sym>`.
fn parse_text_font(xml: &[u8], tag: &[u8]) -> Option<TextFont> {
    let font = direct_child_slice(xml, tag)?;
    let typeface = extract_attr_value_in_element(font, b"typeface=\"")
        .map(|v| String::from_utf8_lossy(v).into_owned())?;
    let panose = extract_attr_value_in_element(font, b"panose=\"")
        .map(|v| String::from_utf8_lossy(v).into_owned());
    let pitch_family = extract_attr_value_in_element(font, b"pitchFamily=\"")
        .and_then(|v| std::str::from_utf8(v).ok()?.parse::<u8>().ok())
        .map(StPitchFamily::new);
    let charset = extract_attr_value_in_element(font, b"charset=\"")
        .and_then(|v| std::str::from_utf8(v).ok()?.parse().ok());
    Some(TextFont {
        typeface,
        panose,
        pitch_family,
        charset,
    })
}

/// Parse hyperlink info from an `<a:hlinkClick>` or `<a:hlinkMouseOver>` element.
fn parse_hyperlink(xml: &[u8]) -> Hyperlink {
    Hyperlink {
        r_id: extract_attr_value_in_element(xml, b"r:id=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned()),
        tooltip: extract_attr_value_in_element(xml, b"tooltip=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned()),
        action: extract_attr_value_in_element(xml, b"action=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned()),
        ..Default::default() // url and other CT_Hyperlink fields resolved later
    }
}
