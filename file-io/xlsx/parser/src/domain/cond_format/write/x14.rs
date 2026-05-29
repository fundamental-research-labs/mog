//! Worksheet-level x14 conditional-format extension writer.
//!
//! Base `<conditionalFormatting>` elements remain the compatibility owner.
//! Excel 2010+ properties that require worksheet `<extLst>` ownership are
//! emitted here from the same modeled `ConditionalFormat` data.

use domain_types::{
    CFColorScale, CFCustomIcon, CFDataBar, CFIconSet, CFRule, CFValueRef, ConditionalFormat,
};

use super::bridge::{cfvo_ooxml_value, ranges_to_sqref};
use crate::domain::sparklines::write::hex_to_argb;
use crate::write::XmlWriter;

const X14_CF_EXT_URI: &str = "{CCE6A557-97BC-4B89-ADB6-D9C93CAAB3DF}";
const X14_NS: &str = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
const XM_NS: &str = "http://schemas.microsoft.com/office/excel/2006/main";

pub fn x14_conditional_formatting_ext_xml_from_domain(cfs: &[ConditionalFormat]) -> String {
    let mut w = XmlWriter::new();
    let mut wrote_any = false;

    w.start_element("ext")
        .attr("uri", X14_CF_EXT_URI)
        .attr("xmlns:x14", X14_NS)
        .attr("xmlns:xm", XM_NS)
        .end_attrs();
    w.start_element("x14:conditionalFormattings").end_attrs();

    for cf in cfs {
        let sqref = ranges_to_sqref(&cf.ranges);
        let mut wrote_cf = false;
        for rule in &cf.rules {
            if !rule_needs_x14(rule) {
                continue;
            }
            if !wrote_cf {
                w.start_element("x14:conditionalFormatting").end_attrs();
                wrote_cf = true;
                wrote_any = true;
            }
            write_x14_rule(&mut w, rule);
        }
        if wrote_cf {
            w.element_with_text("xm:sqref", &sqref);
            w.end_element("x14:conditionalFormatting");
        }
    }

    w.end_element("x14:conditionalFormattings");
    w.end_element("ext");

    if wrote_any {
        w.finish_string()
    } else {
        String::new()
    }
}

fn rule_needs_x14(rule: &CFRule) -> bool {
    match rule {
        CFRule::DataBar { data_bar, .. } => {
            data_bar.gradient.is_some()
                || data_bar.show_border.is_some()
                || data_bar.direction.is_some()
                || data_bar.match_positive_fill_color.is_some()
                || data_bar.match_positive_border_color.is_some()
                || data_bar.axis_position.is_some()
                || data_bar.negative_border_color.is_some()
                || data_bar.negative_color.is_some()
                || data_bar.border_color.is_some()
                || data_bar.axis_color.is_some()
                || data_bar.min_point.ext_lst_xml.is_some()
                || data_bar.max_point.ext_lst_xml.is_some()
        }
        CFRule::IconSet { icon_set, .. } => {
            !icon_set.custom_icons.is_empty()
                || icon_set.percent.is_some()
                || icon_set
                    .thresholds
                    .iter()
                    .any(|threshold| threshold.ext_lst_xml.is_some())
        }
        CFRule::ColorScale { color_scale, .. } => color_scale_uses_x14_cfvo(color_scale),
        _ => false,
    }
}

fn color_scale_uses_x14_cfvo(color_scale: &CFColorScale) -> bool {
    color_scale
        .ordered_points()
        .iter()
        .any(|point| color_point_uses_x14(&point.value) || point.ext_lst_xml.is_some())
}

fn color_point_uses_x14(value: &CFValueRef) -> bool {
    matches!(value, CFValueRef::AutoMin | CFValueRef::AutoMax)
}

fn write_x14_rule(w: &mut XmlWriter, rule: &CFRule) {
    match rule {
        CFRule::DataBar {
            id,
            priority,
            data_bar,
            ..
        } => {
            w.start_element("x14:cfRule")
                .attr("type", "dataBar")
                .attr_num("priority", *priority)
                .attr("id", data_bar.ext_id.as_deref().unwrap_or(id))
                .end_attrs();
            write_x14_data_bar(w, data_bar);
            w.end_element("x14:cfRule");
        }
        CFRule::IconSet {
            id,
            priority,
            icon_set,
            ..
        } => {
            w.start_element("x14:cfRule")
                .attr("type", "iconSet")
                .attr_num("priority", *priority)
                .attr("id", id)
                .end_attrs();
            write_x14_icon_set(w, icon_set);
            w.end_element("x14:cfRule");
        }
        CFRule::ColorScale {
            id,
            priority,
            color_scale,
            ..
        } => {
            w.start_element("x14:cfRule")
                .attr("type", "colorScale")
                .attr_num("priority", *priority)
                .attr("id", id)
                .end_attrs();
            write_x14_color_scale(w, color_scale);
            w.end_element("x14:cfRule");
        }
        _ => {}
    }
}

fn write_x14_color_scale(w: &mut XmlWriter, color_scale: &CFColorScale) {
    w.start_element("x14:colorScale").end_attrs();
    let points = color_scale.ordered_points();
    for point in &points {
        write_x14_cfvo(w, point);
    }
    for point in &points {
        write_x14_color_point(w, point);
    }
    w.end_element("x14:colorScale");
}

fn write_x14_color_point(w: &mut XmlWriter, point: &domain_types::CFColorPoint) {
    w.start_element("x14:color");
    if let Some(theme) = point.color_theme {
        w.attr_num("theme", theme);
    } else if let Some(indexed) = point.color_indexed {
        w.attr_num("indexed", indexed);
    } else if point.color_auto == Some(true) {
        w.attr("auto", "1");
    } else {
        w.attr("rgb", &hex_to_argb(&point.color));
    }
    if let Some(tint) = point.color_tint {
        w.attr("tint", &format!("{}", tint));
    }
    w.self_close();
}

fn write_x14_data_bar(w: &mut XmlWriter, data_bar: &CFDataBar) {
    w.start_element("x14:dataBar");
    if let Some(min_length) = data_bar.min_length {
        w.attr_num("minLength", min_length);
    }
    if let Some(max_length) = data_bar.max_length {
        w.attr_num("maxLength", max_length);
    }
    if let Some(show_value) = data_bar.show_value {
        w.attr("showValue", if show_value { "1" } else { "0" });
    }
    if let Some(gradient) = data_bar.gradient {
        w.attr("gradient", if gradient { "1" } else { "0" });
    }
    if let Some(show_border) = data_bar.show_border {
        w.attr("border", if show_border { "1" } else { "0" });
    }
    if let Some(direction) = data_bar.direction {
        w.attr("direction", direction.to_ooxml());
    }
    if let Some(match_positive) = data_bar.match_positive_fill_color {
        w.attr(
            "negativeBarColorSameAsPositive",
            if match_positive { "1" } else { "0" },
        );
    }
    if let Some(match_positive) = data_bar.match_positive_border_color {
        w.attr(
            "negativeBarBorderColorSameAsPositive",
            if match_positive { "1" } else { "0" },
        );
    }
    if let Some(axis_position) = data_bar.axis_position {
        w.attr("axisPosition", axis_position.to_ooxml());
    }
    w.end_attrs();

    write_x14_cfvo(w, &data_bar.min_point);
    write_x14_cfvo(w, &data_bar.max_point);
    write_x14_color(w, "x14:color", &data_bar.positive_color);
    if let Some(color) = &data_bar.border_color {
        write_x14_color(w, "x14:borderColor", color);
    }
    if let Some(color) = &data_bar.negative_color {
        write_x14_color(w, "x14:negativeFillColor", color);
    }
    if let Some(color) = &data_bar.negative_border_color {
        write_x14_color(w, "x14:negativeBorderColor", color);
    }
    if let Some(color) = &data_bar.axis_color {
        write_x14_color(w, "x14:axisColor", color);
    }
    w.end_element("x14:dataBar");
}

fn write_x14_cfvo(w: &mut XmlWriter, point: &domain_types::CFColorPoint) {
    w.start_element("x14:cfvo")
        .attr("type", point.value.cfvo_type().to_ooxml());
    if let Some(val) = cfvo_ooxml_value(point) {
        w.attr("val", &val);
    }
    if let Some(ext_lst_xml) = &point.ext_lst_xml {
        w.end_attrs();
        w.raw_str(ext_lst_xml);
        w.end_element("x14:cfvo");
    } else {
        w.self_close();
    }
}

fn write_x14_color(w: &mut XmlWriter, element: &str, color: &str) {
    w.start_element(element)
        .attr("rgb", &hex_to_argb(color))
        .self_close();
}

fn write_x14_icon_set(w: &mut XmlWriter, icon_set: &CFIconSet) {
    w.start_element("x14:iconSet")
        .attr("iconSet", icon_set.icon_set_name.to_ooxml());
    if icon_set.show_icon_only == Some(true) {
        w.attr("showValue", "0");
    }
    if icon_set.reverse_order == Some(true) {
        w.attr("reverse", "1");
    }
    if let Some(percent) = icon_set.percent {
        w.attr("percent", if percent { "1" } else { "0" });
    }
    if !icon_set.custom_icons.is_empty() {
        w.attr("custom", "1");
    }
    w.end_attrs();
    for threshold in &icon_set.thresholds {
        w.start_element("x14:cfvo")
            .attr("type", threshold.value_type.to_ooxml());
        if let Some(value) = &threshold.value {
            w.attr("val", value);
        }
        if !threshold.gte {
            w.attr("gte", "0");
        }
        if let Some(ext_lst_xml) = &threshold.ext_lst_xml {
            w.end_attrs();
            w.raw_str(ext_lst_xml);
            w.end_element("x14:cfvo");
        } else {
            w.self_close();
        }
    }
    for icon in &icon_set.custom_icons {
        write_x14_cf_icon(w, icon.as_ref());
    }
    w.end_element("x14:iconSet");
}

fn write_x14_cf_icon(w: &mut XmlWriter, icon: Option<&CFCustomIcon>) {
    w.start_element("x14:cfIcon");
    if let Some(icon) = icon {
        w.attr("iconSet", &icon.icon_set)
            .attr_num("iconId", icon.icon_id);
    } else {
        w.attr("iconSet", "NoIcons").attr_num("iconId", 0);
    }
    w.self_close();
}
