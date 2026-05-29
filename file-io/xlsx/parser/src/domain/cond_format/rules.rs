//! Rule-specific parsing functions for conditional formatting.
//!
//! This module contains parse functions for the complex rule types like
//! ColorScale, DataBar, IconSet, and the main CfRule struct.
//! All types are re-exported from ooxml-types; only the parse logic lives here.

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
};
use crate::infra::xml::{
    decode_xml_entities_string, parse_bool_attr, parse_bool_attr_opt, parse_bytes_attr,
    parse_i32_attr, parse_string_attr, parse_u32_attr,
};

use super::types::{
    CfIcon, CfRule, CfRuleX14, ColorScale, ConditionalFormatting, ConditionalFormattingX14,
    DataBar, IconSet, IconSetType, axis_position_from_bytes, cf_operator_from_bytes,
    cf_rule_type_from_bytes, cf_time_period_from_bytes, data_bar_direction_from_bytes,
    icon_set_type_from_bytes, parse_cf_color, parse_cfvo,
};

// =============================================================================
// Color Scale parsing
// =============================================================================

/// Parse a [`ColorScale`] from XML element bytes.
pub fn parse_color_scale(xml: &[u8]) -> ColorScale {
    let mut cfvos = Vec::new();
    let mut colors = Vec::new();
    let mut pos = 0;

    // Parse all cfvo elements. Use the full element so x14 thresholds that
    // carry their value as a child <xm:f> can be preserved.
    while let Some(cfvo_start) = find_tag_simd(xml, b"cfvo", pos) {
        let cfvo_end = cfvo_element_end(xml, cfvo_start);
        let cfvo_xml = &xml[cfvo_start..cfvo_end];
        cfvos.push(parse_cfvo(cfvo_xml));
        pos = cfvo_end;
    }

    // Parse all color elements
    pos = 0;
    while let Some(color_start) = find_tag_simd(xml, b"color", pos) {
        let color_end = find_gt_simd(xml, color_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let color_xml = &xml[color_start..color_end];
        colors.push(parse_cf_color(color_xml));
        pos = color_end;
    }

    ColorScale {
        cfvo: cfvos,
        colors,
    }
}

// =============================================================================
// Data Bar parsing
// =============================================================================

/// Parse a [`DataBar`] from XML element bytes.
pub fn parse_data_bar(xml: &[u8]) -> DataBar {
    let mut data_bar = DataBar {
        min_length: 10,
        max_length: 90,
        show_value: true,
        gradient: true,
        negative_bar_color_same_as_positive: true,
        negative_bar_border_color_same_as_positive: true,
        ..Default::default()
    };

    // Parse minLength
    if let Some(min) = parse_u32_attr(xml, b"minLength=\"") {
        data_bar.min_length_attr_present = true;
        data_bar.min_length = min;
    }

    // Parse maxLength
    if let Some(max) = parse_u32_attr(xml, b"maxLength=\"") {
        data_bar.max_length_attr_present = true;
        data_bar.max_length = max;
    }

    // Parse showValue
    if let Some(show_value) = parse_bool_attr_opt(xml, b"showValue=\"") {
        data_bar.show_value_attr_present = true;
        data_bar.show_value = show_value;
    }

    // Parse gradient (x14 extension)
    if let Some(gradient) = parse_bool_attr_opt(xml, b"gradient=\"") {
        data_bar.gradient_attr_present = true;
        data_bar.gradient = gradient;
    }

    // Parse x14 boolean data bar attributes.
    if let Some(border) = parse_bool_attr_opt(xml, b"border=\"") {
        data_bar.border_attr_present = true;
        data_bar.border = border;
    }
    if let Some(same) = parse_bool_attr_opt(xml, b"negativeBarColorSameAsPositive=\"") {
        data_bar.negative_bar_color_same_as_positive_attr_present = true;
        data_bar.negative_bar_color_same_as_positive = same;
    }
    if let Some(same) = parse_bool_attr_opt(xml, b"negativeBarBorderColorSameAsPositive=\"") {
        data_bar.negative_bar_border_color_same_as_positive_attr_present = true;
        data_bar.negative_bar_border_color_same_as_positive = same;
    }

    // Parse direction (x14 extension). The wrapper logs + defaults on
    // unknown tokens.
    if let Some(dir) = parse_bytes_attr(xml, b"direction=\"") {
        data_bar.direction_attr_present = true;
        data_bar.direction = data_bar_direction_from_bytes(dir);
    }

    // Parse axisPosition (x14 extension).
    if let Some(axis) = parse_bytes_attr(xml, b"axisPosition=\"") {
        data_bar.axis_position_attr_present = true;
        data_bar.axis_position = axis_position_from_bytes(axis);
    }

    // Parse CFVO elements. Use the full element so x14 thresholds that carry
    // their value as a child <xm:f> can be preserved.
    let mut pos = 0;
    while let Some(cfvo_start) = find_tag_simd(xml, b"cfvo", pos) {
        let cfvo_end = cfvo_element_end(xml, cfvo_start);
        let cfvo_xml = &xml[cfvo_start..cfvo_end];
        data_bar.cfvo.push(parse_cfvo(cfvo_xml));
        pos = cfvo_end;
    }

    // Parse color element
    if let Some(color_start) = find_tag_simd(xml, b"color", 0) {
        let color_end = find_gt_simd(xml, color_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let color_xml = &xml[color_start..color_end];
        data_bar.color = parse_cf_color(color_xml);
    }

    // Parse borderColor (x14 extension)
    if let Some(border_start) = find_tag_simd(xml, b"borderColor", 0) {
        let border_end = find_gt_simd(xml, border_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let border_xml = &xml[border_start..border_end];
        data_bar.border_color = Some(parse_cf_color(border_xml));
    }

    // Parse negativeFillColor (x14 extension)
    if let Some(neg_fill_start) = find_tag_simd(xml, b"negativeFillColor", 0) {
        let neg_fill_end = find_gt_simd(xml, neg_fill_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let neg_fill_xml = &xml[neg_fill_start..neg_fill_end];
        data_bar.negative_fill_color = Some(parse_cf_color(neg_fill_xml));
    }

    // Parse negativeBorderColor (x14 extension)
    if let Some(neg_border_start) = find_tag_simd(xml, b"negativeBorderColor", 0) {
        let neg_border_end = find_gt_simd(xml, neg_border_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let neg_border_xml = &xml[neg_border_start..neg_border_end];
        data_bar.negative_border_color = Some(parse_cf_color(neg_border_xml));
    }

    // Parse axisColor (x14 extension)
    if let Some(axis_start) = find_tag_simd(xml, b"axisColor", 0) {
        let axis_end = find_gt_simd(xml, axis_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let axis_xml = &xml[axis_start..axis_end];
        data_bar.axis_color = Some(parse_cf_color(axis_xml));
    }

    data_bar
}

// =============================================================================
// Icon Set parsing
// =============================================================================

/// Parse a [`CfIcon`] from XML element bytes.
pub fn parse_cf_icon(xml: &[u8]) -> CfIcon {
    let mut cf_icon = CfIcon::default();

    if let Some(icon_set) = parse_bytes_attr(xml, b"iconSet=\"") {
        cf_icon.icon_set = icon_set_type_from_bytes(icon_set);
    }

    if let Some(icon_id) = parse_u32_attr(xml, b"iconId=\"") {
        cf_icon.icon_id = icon_id;
    }

    cf_icon
}

/// Parse an [`IconSet`] from XML element bytes.
pub fn parse_icon_set(xml: &[u8]) -> IconSet {
    let mut icon_set = IconSet {
        icon_set: IconSetType::ThreeTrafficLights1,
        show_value: true,
        percent: true,
        reverse: false,
        custom: false,
        ..Default::default()
    };

    // Parse iconSet attribute.
    if let Some(set_type) = parse_bytes_attr(xml, b"iconSet=\"") {
        icon_set.icon_set = icon_set_type_from_bytes(set_type);
    }

    // Parse showValue
    if let Some(sv_pos) = find_attr_simd(xml, b"showValue=\"", 0) {
        let value_start = sv_pos + 11;
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            let val = &xml[start..end];
            icon_set.show_value = val != b"0" && val != b"false";
        }
    }

    // Parse percent
    if let Some(p_pos) = find_attr_simd(xml, b"percent=\"", 0) {
        icon_set.percent_attr_present = true;
        let value_start = p_pos + 9;
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            let val = &xml[start..end];
            icon_set.percent = val != b"0" && val != b"false";
        }
    }

    // Parse reverse
    if parse_bool_attr(xml, b"reverse=\"") {
        icon_set.reverse = true;
    }

    // Parse custom (x14 extension)
    if parse_bool_attr(xml, b"custom=\"") {
        icon_set.custom = true;
    }

    // Parse CFVO elements. Use the full element so x14 thresholds that carry
    // their value as a child <xm:f> can be preserved.
    let mut pos = 0;
    while let Some(cfvo_start) = find_tag_simd(xml, b"cfvo", pos) {
        let cfvo_end = cfvo_element_end(xml, cfvo_start);
        let cfvo_xml = &xml[cfvo_start..cfvo_end];
        icon_set.cfvo.push(parse_cfvo(cfvo_xml));
        pos = cfvo_end;
    }

    // Parse cfIcon elements (x14 extension)
    pos = 0;
    while let Some(icon_start) = find_tag_simd(xml, b"cfIcon", pos) {
        let icon_end = find_gt_simd(xml, icon_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let icon_xml = &xml[icon_start..icon_end];
        icon_set.cf_icon.push(parse_cf_icon(icon_xml));
        pos = icon_end;
    }

    icon_set
}

fn cfvo_element_end(xml: &[u8], cfvo_start: usize) -> usize {
    let Some(open_end) = find_gt_simd(xml, cfvo_start) else {
        return xml.len();
    };
    if open_end > cfvo_start && xml.get(open_end.saturating_sub(1)) == Some(&b'/') {
        return open_end + 1;
    }
    find_closing_tag(xml, b"cfvo", open_end)
        .and_then(|close_start| find_gt_simd(xml, close_start).map(|end| end + 1))
        .unwrap_or(open_end + 1)
}

// =============================================================================
// CF Rule parsing
// =============================================================================

/// Parse a [`CfRule`] from XML element bytes.
pub fn parse_cf_rule(xml: &[u8]) -> CfRule {
    let mut rule = CfRule {
        above_average: true, // Default for aboveAverage type
        ..Default::default()
    };

    // Parse type attribute
    if let Some(type_val) = parse_bytes_attr(xml, b"type=\"") {
        rule.rule_type = cf_rule_type_from_bytes(type_val);
    }

    // Parse priority attribute
    if let Some(priority) = parse_i32_attr(xml, b"priority=\"") {
        rule.priority = priority;
    }

    // Parse dxfId attribute
    if let Some(dxf_id) = parse_u32_attr(xml, b"dxfId=\"") {
        rule.dxf_id = Some(dxf_id);
    }

    // Parse stopIfTrue attribute
    rule.stop_if_true = parse_bool_attr(xml, b"stopIfTrue=\"");

    // Parse operator attribute.
    if let Some(op) = parse_bytes_attr(xml, b"operator=\"") {
        rule.operator = Some(cf_operator_from_bytes(op));
    }

    // Parse text attribute
    if let Some(text) = parse_string_attr(xml, b"text=\"") {
        rule.text = Some(text);
    }

    // Parse timePeriod attribute.
    if let Some(period) = parse_bytes_attr(xml, b"timePeriod=\"") {
        rule.time_period = Some(cf_time_period_from_bytes(period));
    }

    // Parse rank attribute
    if let Some(rank) = parse_u32_attr(xml, b"rank=\"") {
        rule.rank = Some(rank);
    }

    // Parse percent attribute
    rule.percent = parse_bool_attr(xml, b"percent=\"");

    // Parse bottom attribute
    rule.bottom = parse_bool_attr(xml, b"bottom=\"");

    // Parse aboveAverage attribute (default true)
    if let Some(aa_pos) = find_attr_simd(xml, b"aboveAverage=\"", 0) {
        let value_start = aa_pos + 14;
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            let val = &xml[start..end];
            rule.above_average = val != b"0" && val != b"false";
        }
    }

    // Parse stdDev attribute
    if let Some(std_dev) = parse_i32_attr(xml, b"stdDev=\"") {
        rule.std_dev = Some(std_dev);
    }

    // Parse equalAverage attribute
    rule.equal_average = parse_bool_attr(xml, b"equalAverage=\"");

    // Parse formula elements
    let mut pos = 0;
    while let Some(formula_start) = find_tag_simd(xml, b"formula", pos) {
        let content_start = find_gt_simd(xml, formula_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        if let Some(formula_end) = find_closing_tag(xml, b"formula", content_start) {
            if content_start < formula_end {
                let formula_content = &xml[content_start..formula_end];
                if let Ok(formula) = std::str::from_utf8(formula_content) {
                    rule.formulas.push(decode_xml_entities_string(formula));
                }
            }
            pos = formula_end + 10; // Skip past </formula>
        } else {
            break;
        }
    }

    // Parse colorScale element
    if let Some(cs_start) = find_tag_simd(xml, b"colorScale", 0) {
        let cs_end = find_closing_tag(xml, b"colorScale", cs_start).unwrap_or(xml.len());
        let cs_xml = &xml[cs_start..cs_end];
        rule.color_scale = Some(parse_color_scale(cs_xml));
    }

    // Parse dataBar element
    if let Some(db_start) = find_tag_simd(xml, b"dataBar", 0) {
        let db_end = find_closing_tag(xml, b"dataBar", db_start).unwrap_or(xml.len());
        let db_xml = &xml[db_start..db_end];
        rule.data_bar = Some(parse_data_bar(db_xml));
    }

    // Parse iconSet element
    if let Some(is_start) = find_tag_simd(xml, b"iconSet", 0) {
        let is_end = find_closing_tag(xml, b"iconSet", is_start).unwrap_or(xml.len());
        let is_xml = &xml[is_start..is_end];
        rule.icon_set = Some(parse_icon_set(is_xml));
    }

    // Parse x14:id from <extLst> inside cfRule (links standard databar to extended version)
    if let Some(ext_start) = find_tag_simd(xml, b"extLst", 0) {
        if let Some(id_start) = find_tag_simd(xml, b"x14:id", ext_start) {
            let id_gt = find_gt_simd(xml, id_start).unwrap_or(xml.len());
            let text_start = id_gt + 1;
            if let Some(end_tag) = find_closing_tag(xml, b"x14:id", id_start) {
                let id_text = &xml[text_start..end_tag];
                if let Ok(s) = std::str::from_utf8(id_text) {
                    rule.ext_id = Some(s.to_string());
                }
            }
        }
    }

    rule
}

// =============================================================================
// Conditional Formatting (Main Type) parsing
// =============================================================================

/// Parse a [`ConditionalFormatting`] from XML element bytes.
pub fn parse_conditional_formatting_element(xml: &[u8]) -> ConditionalFormatting {
    let mut cf = ConditionalFormatting::default();

    // Parse sqref attribute
    if let Some(sqref) = parse_string_attr(xml, b"sqref=\"") {
        cf.sqref = sqref;
    }

    // Parse pivot attribute
    cf.pivot = parse_bool_attr(xml, b"pivot=\"");

    // Parse cfRule elements
    let mut pos = 0;
    while let Some(rule_start) = find_tag_simd(xml, b"cfRule", pos) {
        // First, find the end of the opening tag to check if it's self-closing.
        let opening_gt = find_gt_simd(xml, rule_start).unwrap_or(xml.len());
        let is_self_closing = opening_gt > 0 && xml[opening_gt - 1] == b'/';

        let rule_end = if is_self_closing {
            // Self-closing <cfRule ... /> — the element ends at the `>`.
            opening_gt + 1
        } else {
            // Non-self-closing — find the matching </cfRule>.
            find_closing_tag(xml, b"cfRule", opening_gt + 1)
                .map(|end| find_gt_simd(xml, end).unwrap_or(xml.len()) + 1)
                .unwrap_or(opening_gt + 1)
        };

        let rule_xml = &xml[rule_start..rule_end];
        cf.rules.push(parse_cf_rule(rule_xml));
        pos = rule_end;
    }

    cf
}

// =============================================================================
// X14 Extensions (Excel 2010+) parsing
// =============================================================================

/// Parse a [`CfRuleX14`] from XML element bytes.
pub fn parse_cf_rule_x14(xml: &[u8]) -> CfRuleX14 {
    let mut rule = CfRuleX14::default();

    // Parse type attribute
    if let Some(type_val) = parse_bytes_attr(xml, b"type=\"") {
        rule.rule_type = cf_rule_type_from_bytes(type_val);
    }

    // Parse priority attribute
    if let Some(priority) = parse_i32_attr(xml, b"priority=\"") {
        rule.priority = priority;
    }

    // Parse dxfId attribute
    if let Some(dxf_id) = parse_u32_attr(xml, b"dxfId=\"") {
        rule.dxf_id = Some(dxf_id);
    }

    // Parse id attribute
    if let Some(id) = parse_string_attr(xml, b"id=\"") {
        rule.id = id;
    }

    // Parse colorScale element
    if let Some(cs_start) = find_tag_simd(xml, b"colorScale", 0) {
        let cs_end = find_closing_tag(xml, b"colorScale", cs_start).unwrap_or(xml.len());
        let cs_xml = &xml[cs_start..cs_end];
        rule.color_scale = Some(parse_color_scale(cs_xml));
    }

    // Parse dataBar element
    if let Some(db_start) = find_tag_simd(xml, b"dataBar", 0) {
        let db_end = find_closing_tag(xml, b"dataBar", db_start).unwrap_or(xml.len());
        let db_xml = &xml[db_start..db_end];
        rule.data_bar = Some(parse_data_bar(db_xml));
    }

    // Parse iconSet element
    if let Some(is_start) = find_tag_simd(xml, b"iconSet", 0) {
        let is_end = find_closing_tag(xml, b"iconSet", is_start).unwrap_or(xml.len());
        let is_xml = &xml[is_start..is_end];
        rule.icon_set = Some(parse_icon_set(is_xml));
    }

    rule
}

/// Parse a [`ConditionalFormattingX14`] from XML element bytes.
pub fn parse_conditional_formatting_x14_element(xml: &[u8]) -> ConditionalFormattingX14 {
    let mut cf = ConditionalFormattingX14::default();

    // Parse sqref - might be in x14:sqref element
    if let Some(sqref_start) = find_tag_simd(xml, b"sqref", 0) {
        let content_start = find_gt_simd(xml, sqref_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        if let Some(sqref_end) = find_closing_tag(xml, b"sqref", content_start) {
            if content_start < sqref_end {
                if let Ok(sqref) = std::str::from_utf8(&xml[content_start..sqref_end]) {
                    cf.sqref = sqref.to_string();
                }
            }
        }
    }

    // Parse cfRule elements
    let mut pos = 0;
    while let Some(rule_start) = find_tag_simd(xml, b"cfRule", pos) {
        let rule_end = find_closing_tag(xml, b"cfRule", rule_start)
            .map(|end| find_gt_simd(xml, end).unwrap_or(xml.len()) + 1)
            .unwrap_or_else(|| {
                find_gt_simd(xml, rule_start)
                    .map(|p| p + 1)
                    .unwrap_or(xml.len())
            });

        let rule_xml = &xml[rule_start..rule_end];
        cf.rules.push(parse_cf_rule_x14(rule_xml));
        pos = rule_end;
    }

    cf
}
