//! Worksheet-level x14 conditional-format extension writer.
//!
//! Base `<conditionalFormatting>` elements remain the compatibility owner.
//! Excel 2010+ properties that require worksheet `<extLst>` ownership are
//! emitted here from the same modeled `ConditionalFormat` data.

use domain_types::{
    CFColorScale, CFCustomIcon, CFDataBar, CFIconSet, CFRule, CFValueRef, ConditionalFormat,
};
use ooxml_types::cond_format::CfvoType;

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
                || color_point_uses_x14(&data_bar.min_point.value)
                || color_point_uses_x14(&data_bar.max_point.value)
        }
        CFRule::IconSet { icon_set, .. } => {
            !icon_set.custom_icons.is_empty()
                || icon_set.percent.is_some()
                || icon_set.thresholds.iter().any(|threshold| {
                    threshold_uses_x14_cfvo(threshold.value_type) || threshold.ext_lst_xml.is_some()
                })
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

fn threshold_uses_x14_cfvo(value_type: CfvoType) -> bool {
    matches!(value_type, CfvoType::AutoMin | CfvoType::AutoMax)
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

#[cfg(test)]
mod tests {
    use super::x14_conditional_formatting_ext_xml_from_domain;
    use domain_types::{
        CFColorPoint, CFColorScale, CFDataBar, CFIconSet, CFIconThreshold, CFRule, CFValueRef,
        ConditionalFormat,
    };
    use ooxml_types::cond_format::{CfvoType, IconSetType};

    fn point(value: CFValueRef, color: &str) -> CFColorPoint {
        CFColorPoint {
            value,
            ooxml_value: None,
            color: color.to_string(),
            color_theme: None,
            color_tint: None,
            color_indexed: None,
            color_auto: None,
            ext_lst_xml: None,
        }
    }

    fn conditional_format(rule: CFRule) -> Vec<ConditionalFormat> {
        vec![ConditionalFormat {
            id: "cf-1".to_string(),
            sheet_id: "sheet-1".to_string(),
            pivot: None,
            ranges: vec![domain_types::CFCellRange::new(0, 0, 4, 0)],
            range_identities: None,
            rules: vec![rule],
        }]
    }

    #[test]
    fn data_bar_auto_cfvo_values_emit_x14_extension() {
        let cfs = conditional_format(CFRule::DataBar {
            id: "rule-1".to_string(),
            priority: 1,
            stop_if_true: None,
            data_bar: CFDataBar {
                min_point: point(CFValueRef::AutoMin, ""),
                max_point: point(CFValueRef::AutoMax, ""),
                min_length: None,
                max_length: None,
                positive_color: "#4472C4".to_string(),
                negative_color: None,
                negative_border_color: None,
                border_color: None,
                show_border: None,
                gradient: None,
                direction: None,
                axis_position: None,
                axis_color: None,
                show_value: None,
                match_positive_fill_color: None,
                match_positive_border_color: None,
                ext_id: None,
            },
        });

        let xml = x14_conditional_formatting_ext_xml_from_domain(&cfs);

        assert!(xml.contains("<x14:dataBar>"));
        assert!(xml.contains("<x14:cfvo type=\"autoMin\"/>"));
        assert!(xml.contains("<x14:cfvo type=\"autoMax\"/>"));
        assert!(xml.contains("<xm:sqref>A1:A5</xm:sqref>"));
    }

    #[test]
    fn color_scale_auto_cfvo_values_emit_x14_extension() {
        let cfs = conditional_format(CFRule::ColorScale {
            id: "rule-1".to_string(),
            priority: 1,
            stop_if_true: None,
            color_scale: CFColorScale {
                points: Vec::new(),
                min_point: point(CFValueRef::AutoMin, "#F8696B"),
                mid_point: None,
                max_point: point(CFValueRef::AutoMax, "#63BE7B"),
            },
        });

        let xml = x14_conditional_formatting_ext_xml_from_domain(&cfs);

        assert!(xml.contains("<x14:colorScale>"));
        assert!(xml.contains("<x14:cfvo type=\"autoMin\"/>"));
        assert!(xml.contains("<x14:cfvo type=\"autoMax\"/>"));
    }

    #[test]
    fn icon_set_auto_cfvo_values_emit_x14_extension() {
        let cfs = conditional_format(CFRule::IconSet {
            id: "rule-1".to_string(),
            priority: 1,
            stop_if_true: None,
            icon_set: CFIconSet {
                icon_set_name: IconSetType::ThreeArrows,
                reverse_order: None,
                show_icon_only: None,
                percent: None,
                thresholds: vec![
                    CFIconThreshold {
                        value_type: CfvoType::AutoMin,
                        value: None,
                        gte: true,
                        ext_lst_xml: None,
                    },
                    CFIconThreshold {
                        value_type: CfvoType::AutoMax,
                        value: None,
                        gte: true,
                        ext_lst_xml: None,
                    },
                ],
                custom_icons: Vec::new(),
            },
        });

        let xml = x14_conditional_formatting_ext_xml_from_domain(&cfs);

        assert!(xml.contains("<x14:iconSet"));
        assert!(xml.contains("<x14:cfvo type=\"autoMin\"/>"));
        assert!(xml.contains("<x14:cfvo type=\"autoMax\"/>"));
    }
}
