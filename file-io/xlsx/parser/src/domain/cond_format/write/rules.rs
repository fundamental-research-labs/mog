//! Rule-specific XML writing logic for conditional formatting.
//!
//! This module contains the XML writing methods for each type of conditional
//! formatting rule (cell value, color scale, data bar, icon set, etc.).

use super::types::*;
use crate::write::xml_writer::XmlWriter;

/// Helper trait for writing conditional formatting rules to XML
pub(crate) trait RuleWriter {
    /// Write a cellIs rule
    fn write_cell_is_rule(
        &self,
        writer: &mut XmlWriter,
        priority: i32,
        stop_if_true: bool,
        rule: &CellIsRule,
    );

    /// Write a colorScale rule
    fn write_color_scale_rule(&self, writer: &mut XmlWriter, priority: i32, rule: &ColorScaleRule);

    /// Write a dataBar rule
    fn write_data_bar_rule(&self, writer: &mut XmlWriter, priority: i32, rule: &DataBarRule);

    /// Write an iconSet rule
    fn write_icon_set_rule(&self, writer: &mut XmlWriter, priority: i32, rule: &IconSetRule);

    /// Write a top10 rule
    fn write_top10_rule(
        &self,
        writer: &mut XmlWriter,
        priority: i32,
        stop_if_true: bool,
        rule: &Top10Rule,
    );

    /// Write an aboveAverage rule
    fn write_above_average_rule(
        &self,
        writer: &mut XmlWriter,
        priority: i32,
        stop_if_true: bool,
        rule: &AboveAverageRule,
    );

    /// Write an expression rule
    fn write_expression_rule(
        &self,
        writer: &mut XmlWriter,
        priority: i32,
        stop_if_true: bool,
        formula: &str,
    );

    /// Write a text-based rule
    fn write_text_rule(
        &self,
        writer: &mut XmlWriter,
        rule_type: &str,
        priority: i32,
        rule: &TextRule,
    );

    /// Write a simple rule (no additional content)
    fn write_simple_rule(&self, writer: &mut XmlWriter, rule_type: &str, priority: i32);

    /// Write a time period rule
    fn write_time_period_rule(&self, writer: &mut XmlWriter, priority: i32, period: CfTimePeriod);

    /// Write a cfvo element
    fn write_cfvo(&self, writer: &mut XmlWriter, value: &CfValueObject);

    /// Write a cfvo element without color (for data bars and icon sets)
    fn write_cfvo_no_color(&self, writer: &mut XmlWriter, value: &CfValueObject);

    /// Write a color element
    fn write_color(&self, writer: &mut XmlWriter, rgb: &str);
}

/// Default implementations for rule writing
pub(crate) struct RuleWriterImpl;

impl RuleWriter for RuleWriterImpl {
    fn write_cell_is_rule(
        &self,
        writer: &mut XmlWriter,
        priority: i32,
        stop_if_true: bool,
        rule: &CellIsRule,
    ) {
        writer.start_element("cfRule").attr("type", "cellIs");

        if let Some(dxf_id) = rule.style.dxf_id {
            writer.attr_num("dxfId", dxf_id);
        }

        writer.attr_num("priority", priority);

        if stop_if_true {
            writer.attr_bool("stopIfTrue", true);
        }

        writer
            .attr("operator", rule.operator.to_ooxml())
            .end_attrs();

        // Write formula(s)
        writer.element_with_text("formula", &rule.value1);

        if let Some(ref value2) = rule.value2 {
            writer.element_with_text("formula", value2);
        }

        writer.end_element("cfRule");
    }

    fn write_color_scale_rule(&self, writer: &mut XmlWriter, priority: i32, rule: &ColorScaleRule) {
        writer
            .start_element("cfRule")
            .attr("type", "colorScale")
            .attr_num("priority", priority)
            .end_attrs();

        writer.start_element("colorScale").end_attrs();

        // Write cfvo elements
        self.write_cfvo(writer, &rule.min);
        if let Some(ref mid) = rule.mid {
            self.write_cfvo(writer, mid);
        }
        self.write_cfvo(writer, &rule.max);

        // Write color elements
        self.write_color(writer, &rule.min.color);
        if let Some(ref mid) = rule.mid {
            self.write_color(writer, &mid.color);
        }
        self.write_color(writer, &rule.max.color);

        writer.end_element("colorScale");
        writer.end_element("cfRule");
    }

    fn write_data_bar_rule(&self, writer: &mut XmlWriter, priority: i32, rule: &DataBarRule) {
        writer
            .start_element("cfRule")
            .attr("type", "dataBar")
            .attr_num("priority", priority)
            .end_attrs();

        writer.start_element("dataBar");

        if !rule.show_value {
            writer.attr_bool("showValue", false);
        }
        if !rule.gradient {
            writer.attr_bool("gradient", false);
        }
        if let Some(axis_position) = rule.axis_position {
            writer.attr("axisPosition", axis_position.to_ooxml());
        }

        writer.end_attrs();

        // Write cfvo elements for min and max
        self.write_cfvo_no_color(writer, &rule.min);
        self.write_cfvo_no_color(writer, &rule.max);

        // Write the color
        self.write_color(writer, &rule.color);
        if let Some(ref color) = rule.border_color {
            writer
                .start_element("borderColor")
                .attr("rgb", color)
                .self_close();
        }
        if let Some(ref color) = rule.negative_color {
            writer
                .start_element("negativeFillColor")
                .attr("rgb", color)
                .self_close();
        }

        writer.end_element("dataBar");
        writer.end_element("cfRule");
    }

    fn write_icon_set_rule(&self, writer: &mut XmlWriter, priority: i32, rule: &IconSetRule) {
        writer
            .start_element("cfRule")
            .attr("type", "iconSet")
            .attr_num("priority", priority)
            .end_attrs();

        writer.start_element("iconSet");

        // Always write the iconSet attribute for clarity and interoperability
        writer.attr("iconSet", rule.icon_set.to_ooxml());

        if !rule.show_value {
            writer.attr_bool("showValue", false);
        }

        if rule.reverse {
            writer.attr_bool("reverse", true);
        }

        writer.end_attrs();

        // Write cfvo elements for thresholds
        for threshold in &rule.thresholds {
            self.write_cfvo_no_color(writer, threshold);
        }

        writer.end_element("iconSet");
        writer.end_element("cfRule");
    }

    fn write_top10_rule(
        &self,
        writer: &mut XmlWriter,
        priority: i32,
        stop_if_true: bool,
        rule: &Top10Rule,
    ) {
        writer.start_element("cfRule").attr("type", "top10");

        if let Some(dxf_id) = rule.style.dxf_id {
            writer.attr_num("dxfId", dxf_id);
        }

        writer.attr_num("priority", priority);

        if stop_if_true {
            writer.attr_bool("stopIfTrue", true);
        }

        if rule.percent {
            writer.attr_bool("percent", true);
        }

        if !rule.top {
            writer.attr_bool("bottom", true);
        }

        writer.attr_num("rank", rule.rank);

        writer.self_close();
    }

    fn write_above_average_rule(
        &self,
        writer: &mut XmlWriter,
        priority: i32,
        stop_if_true: bool,
        rule: &AboveAverageRule,
    ) {
        writer.start_element("cfRule").attr("type", "aboveAverage");

        if let Some(dxf_id) = rule.style.dxf_id {
            writer.attr_num("dxfId", dxf_id);
        }

        writer.attr_num("priority", priority);

        if stop_if_true {
            writer.attr_bool("stopIfTrue", true);
        }

        if !rule.above_average {
            writer.attr_bool("aboveAverage", false);
        }

        if rule.equal_average {
            writer.attr_bool("equalAverage", true);
        }

        if let Some(std_dev) = rule.std_dev {
            writer.attr_num("stdDev", std_dev);
        }

        writer.self_close();
    }

    fn write_expression_rule(
        &self,
        writer: &mut XmlWriter,
        priority: i32,
        stop_if_true: bool,
        formula: &str,
    ) {
        writer.start_element("cfRule").attr("type", "expression");

        writer.attr_num("priority", priority);

        if stop_if_true {
            writer.attr_bool("stopIfTrue", true);
        }

        writer.end_attrs();

        writer.element_with_text("formula", formula);

        writer.end_element("cfRule");
    }

    fn write_text_rule(
        &self,
        writer: &mut XmlWriter,
        rule_type: &str,
        priority: i32,
        rule: &TextRule,
    ) {
        writer.start_element("cfRule").attr("type", rule_type);

        if let Some(dxf_id) = rule.style.dxf_id {
            writer.attr_num("dxfId", dxf_id);
        }

        writer.attr_num("priority", priority);
        writer.attr("text", &rule.text);
        writer.end_attrs();

        // Generate formula based on rule type
        let formula = match rule_type {
            "containsText" => format!("NOT(ISERROR(SEARCH(\"{}\",A1)))", rule.text),
            "notContainsText" => format!("ISERROR(SEARCH(\"{}\",A1))", rule.text),
            "beginsWith" => format!("LEFT(A1,{})=\"{}\"", rule.text.len(), rule.text),
            "endsWith" => format!("RIGHT(A1,{})=\"{}\"", rule.text.len(), rule.text),
            _ => String::new(),
        };

        if !formula.is_empty() {
            writer.element_with_text("formula", &formula);
        }

        writer.end_element("cfRule");
    }

    fn write_simple_rule(&self, writer: &mut XmlWriter, rule_type: &str, priority: i32) {
        writer
            .start_element("cfRule")
            .attr("type", rule_type)
            .attr_num("priority", priority)
            .self_close();
    }

    fn write_time_period_rule(&self, writer: &mut XmlWriter, priority: i32, period: CfTimePeriod) {
        writer
            .start_element("cfRule")
            .attr("type", "timePeriod")
            .attr_num("priority", priority)
            .attr("timePeriod", period.to_ooxml())
            .self_close();
    }

    fn write_cfvo(&self, writer: &mut XmlWriter, value: &CfValueObject) {
        writer
            .start_element("cfvo")
            .attr("type", value.value_type.to_ooxml());

        if let Some(ref val) = value.value {
            writer.attr("val", val);
        }

        writer.self_close();
    }

    fn write_cfvo_no_color(&self, writer: &mut XmlWriter, value: &CfValueObject) {
        writer
            .start_element("cfvo")
            .attr("type", value.value_type.to_ooxml());

        if let Some(ref val) = value.value {
            writer.attr("val", val);
        }

        writer.self_close();
    }

    fn write_color(&self, writer: &mut XmlWriter, rgb: &str) {
        if !rgb.is_empty() {
            writer.start_element("color").attr("rgb", rgb).self_close();
        }
    }
}
