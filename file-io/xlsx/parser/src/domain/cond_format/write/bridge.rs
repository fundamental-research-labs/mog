//! Bridge from domain `ConditionalFormat` / `CFRule` to OOXML XML string.
//!
//! This module provides `cf_xml_from_domain`, the single entry-point used by
//! `from_parse_output` to emit `<conditionalFormatting>` elements from domain
//! types.

use compute_parser::SqrefList;
use domain_types::{CFCellRange, CFColorPoint, CFRule, CFStyle, ConditionalFormat};
use formula_types::{CellRef, RangeType};

use crate::domain::sparklines::write::hex_to_argb;
use crate::write::XmlWriter;

/// Write a `<color>` element for a `CFColorPoint`, using the most specific
/// color attribute available (theme > indexed > rgb).
pub(super) fn write_cf_color_point_color(w: &mut XmlWriter, pt: &CFColorPoint) {
    w.start_element("color");
    if let Some(theme) = pt.color_theme {
        w.attr_num("theme", theme);
    } else if let Some(indexed) = pt.color_indexed {
        w.attr_num("indexed", indexed);
    } else if pt.color_auto == Some(true) {
        w.attr("auto", "1");
    } else {
        w.attr("rgb", &hex_to_argb(&pt.color));
    }
    if let Some(tint) = pt.color_tint {
        w.attr("tint", &format!("{}", tint));
    }
    w.self_close();
}

pub(super) fn cfvo_ooxml_value(point: &CFColorPoint) -> Option<String> {
    point
        .value
        .to_ooxml_val()
        .or_else(|| point.ooxml_value.clone())
}

fn write_cfvo_from_color_point(w: &mut XmlWriter, point: &CFColorPoint) {
    w.start_element("cfvo")
        .attr("type", point.value.cfvo_type().to_ooxml());
    if let Some(val) = cfvo_ooxml_value(point) {
        w.attr("val", &val);
    }
    w.self_close();
}

fn data_bar_has_x14_payload(data_bar: &domain_types::CFDataBar) -> bool {
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

/// Build `<conditionalFormatting>` XML string from domain `ConditionalFormat` list.
pub fn cf_xml_from_domain(cfs: &[ConditionalFormat]) -> String {
    let mut w = XmlWriter::new();

    for cf in cfs {
        let sqref = ranges_to_sqref(&cf.ranges);
        w.start_element("conditionalFormatting")
            .attr("sqref", &sqref);
        if cf.pivot == Some(true) {
            w.attr("pivot", "1");
        }
        w.end_attrs();

        let first_cell = first_cell_from_range(cf.ranges.first());
        for rule in &cf.rules {
            write_cf_rule(&mut w, rule, &first_cell);
        }

        w.end_element("conditionalFormatting");
    }

    String::from_utf8(w.finish()).unwrap_or_default()
}

/// Convert structured ranges to a space-separated sqref string.
///
/// # Typed sqref boundary:
///
/// Routes through [`compute_parser::SqrefList::to_a1_string`] — the typed
/// sqref emitter — rather than the per-range `range_to_a1` path. The
/// typed emitter applies the sqref-specific 1×1 elision rule (`A1` not
/// `A1:A1`) so the byte form matches Excel's output on round-trip.
///
/// An empty `ranges` slice yields the empty string, matching the old
/// `join(" ")` behaviour; the caller (`cf_xml_from_domain`) emits the
/// `sqref=""` attribute verbatim in that case.
pub(super) fn ranges_to_sqref(ranges: &[CFCellRange]) -> String {
    let sheet = cell_types::SheetId::from_raw(0);
    let ref_list: Vec<compute_parser::RangeRef> = ranges
        .iter()
        .map(|r| cf_range_to_range_ref(r, sheet))
        .collect();
    SqrefList(ref_list).to_a1_string()
}

/// Lift a position-keyed `CFCellRange` into the `compute_parser::RangeRef`
/// form that [`SqrefList`] consumes. `sheet` is an arbitrary placeholder
/// — `SqrefList::to_a1_string` for `CellRange` emits only the row/col
/// tokens, so the sheet component never reaches the output string.
fn cf_range_to_range_ref(r: &CFCellRange, sheet: cell_types::SheetId) -> compute_parser::RangeRef {
    compute_parser::RangeRef::new(
        CellRef::positional(sheet, r.start_row(), r.start_col()),
        CellRef::positional(sheet, r.end_row(), r.end_col()),
        RangeType::CellRange,
    )
}

/// Extract the first cell reference (A1 style) from the first range.
fn first_cell_from_range(range: Option<&CFCellRange>) -> String {
    match range {
        Some(r) => {
            let mut col_str = String::new();
            let mut c = r.start_col();
            loop {
                col_str.insert(0, (b'A' + (c % 26) as u8) as char);
                if c < 26 {
                    break;
                }
                c = c / 26 - 1;
            }
            format!("{}{}", col_str, r.start_row() + 1)
        }
        None => "A1".to_string(),
    }
}

/// Generate the formula for a timePeriod CF rule.
///
/// These formulas are required by the OOXML spec — without them Excel silently
/// drops the rule.  The formulas match what Excel itself generates.
fn time_period_formula(period: &str, cell: &str) -> String {
    match period {
        "today" => format!("FLOOR({cell},1)=TODAY()"),
        "yesterday" => format!("FLOOR({cell},1)=TODAY()-1"),
        "tomorrow" => format!("FLOOR({cell},1)=TODAY()+1"),
        "last7Days" => format!("AND(TODAY()-FLOOR({cell},1)<=6,FLOOR({cell},1)<=TODAY())"),
        "thisWeek" => format!(
            "AND(TODAY()-ROUNDDOWN({cell},0)<=WEEKDAY(TODAY())-1,ROUNDDOWN({cell},0)-TODAY()<=7-WEEKDAY(TODAY()))"
        ),
        "lastWeek" => format!(
            "AND(TODAY()-ROUNDDOWN({cell},0)>=(WEEKDAY(TODAY())),TODAY()-ROUNDDOWN({cell},0)<(WEEKDAY(TODAY())+7))"
        ),
        "nextWeek" => format!(
            "AND(ROUNDDOWN({cell},0)-TODAY()>(7-WEEKDAY(TODAY())),ROUNDDOWN({cell},0)-TODAY()<(15-WEEKDAY(TODAY())))"
        ),
        "thisMonth" => format!("AND(MONTH({cell})=MONTH(TODAY()),YEAR({cell})=YEAR(TODAY()))"),
        "lastMonth" => format!(
            "AND(MONTH({cell})=MONTH(EDATE(TODAY(),0-1)),YEAR({cell})=YEAR(EDATE(TODAY(),0-1)))"
        ),
        "nextMonth" => format!(
            "AND(MONTH({cell})=MONTH(EDATE(TODAY(),0+1)),YEAR({cell})=YEAR(EDATE(TODAY(),0+1)))"
        ),
        // Fallback: emit a today formula so the rule isn't silently dropped.
        _ => format!("FLOOR({cell},1)=TODAY()"),
    }
}

/// Write a `<formula>` element, adding `xml:space="preserve"` when the text
/// has leading or trailing whitespace (required by OOXML to keep those spaces).
fn write_formula_element(w: &mut XmlWriter, text: &str) {
    let needs_preserve = text.starts_with(' ')
        || text.ends_with(' ')
        || text.starts_with('\t')
        || text.ends_with('\t')
        || text.contains('\n');
    if needs_preserve {
        w.start_element("formula")
            .attr("xml:space", "preserve")
            .end_attrs()
            .text(text)
            .end_element("formula");
    } else {
        w.element_with_text("formula", text);
    }
}

/// Extract a string from a serde_json::Value for use in formula elements.
fn json_value_to_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => {
            if *b {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Emit the `dxfId` attribute from a `CFStyle`, if present.
fn write_dxf_id(w: &mut XmlWriter, style: &CFStyle) {
    if let Some(dxf_id) = style.dxf_id {
        w.attr_num("dxfId", dxf_id);
    }
}

/// Write a single `<cfRule>` element.
fn write_cf_rule(w: &mut XmlWriter, rule: &CFRule, first_cell: &str) {
    w.start_element("cfRule");

    match rule {
        CFRule::CellValue {
            operator,
            value1,
            value2,
            style,
            priority,
            stop_if_true,
            text,
            ..
        } => {
            w.attr("type", "cellIs");
            w.attr_num("priority", *priority);
            w.attr("operator", operator.to_ooxml());
            if let Some(text) = text {
                w.attr("text", text);
            }
            write_dxf_id(w, style);
            if let Some(true) = stop_if_true {
                w.attr("stopIfTrue", "1");
            }
            w.end_attrs();
            if !value1.is_null() {
                write_formula_element(w, &json_value_to_string(value1));
            }
            if let Some(v2) = value2 {
                write_formula_element(w, &json_value_to_string(v2));
            }
        }
        CFRule::Formula {
            formula,
            style,
            priority,
            stop_if_true,
            text,
            ..
        } => {
            w.attr("type", "expression");
            w.attr_num("priority", *priority);
            if let Some(text) = text {
                w.attr("text", text);
            }
            write_dxf_id(w, style);
            if let Some(true) = stop_if_true {
                w.attr("stopIfTrue", "1");
            }
            w.end_attrs();
            write_formula_element(w, formula);
        }
        CFRule::ColorScale {
            color_scale,
            priority,
            stop_if_true,
            ..
        } => {
            w.attr("type", "colorScale");
            w.attr_num("priority", *priority);
            if let Some(true) = stop_if_true {
                w.attr("stopIfTrue", "1");
            }
            w.end_attrs();
            w.start_element("colorScale").end_attrs();

            let points = color_scale.ordered_points();

            // Write cfvo elements first, then color elements (OOXML order).
            for pt in &points {
                write_cfvo_from_color_point(w, pt);
            }
            for pt in &points {
                write_cf_color_point_color(w, pt);
            }
            w.end_element("colorScale");
        }
        CFRule::DataBar {
            id,
            data_bar,
            priority,
            stop_if_true,
        } => {
            w.attr("type", "dataBar");
            w.attr_num("priority", *priority);
            if let Some(true) = stop_if_true {
                w.attr("stopIfTrue", "1");
            }
            w.end_attrs();
            w.start_element("dataBar");
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
            write_cfvo_from_color_point(w, &data_bar.min_point);
            write_cfvo_from_color_point(w, &data_bar.max_point);
            // color
            w.start_element("color")
                .attr("rgb", &hex_to_argb(&data_bar.positive_color))
                .self_close();
            if let Some(color) = &data_bar.border_color {
                w.start_element("borderColor")
                    .attr("rgb", &hex_to_argb(color))
                    .self_close();
            }
            if let Some(color) = &data_bar.negative_color {
                w.start_element("negativeFillColor")
                    .attr("rgb", &hex_to_argb(color))
                    .self_close();
            }
            if let Some(color) = &data_bar.negative_border_color {
                w.start_element("negativeBorderColor")
                    .attr("rgb", &hex_to_argb(color))
                    .self_close();
            }
            if let Some(color) = &data_bar.axis_color {
                w.start_element("axisColor")
                    .attr("rgb", &hex_to_argb(color))
                    .self_close();
            }
            w.end_element("dataBar");
            // Write x14:id extension linking to extended databar properties
            if data_bar_has_x14_payload(data_bar) {
                let ext_id = data_bar.ext_id.as_deref().unwrap_or(id);
                w.start_element("extLst").end_attrs();
                w.start_element("ext")
                    .attr(
                        "xmlns:x14",
                        "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main",
                    )
                    .attr("uri", "{B025F937-C7B1-47D3-B67F-A62EFF666E3E}")
                    .end_attrs();
                w.element_with_text("x14:id", ext_id);
                w.end_element("ext");
                w.end_element("extLst");
            }
        }
        CFRule::IconSet {
            icon_set,
            priority,
            stop_if_true,
            ..
        } => {
            w.attr("type", "iconSet");
            w.attr_num("priority", *priority);
            if let Some(true) = stop_if_true {
                w.attr("stopIfTrue", "1");
            }
            w.end_attrs();
            w.start_element("iconSet");
            // Only write iconSet attribute when it differs from OOXML default (3TrafficLights1)
            use ooxml_types::cond_format::IconSetType;
            if icon_set.icon_set_name != IconSetType::ThreeTrafficLights1 {
                w.attr("iconSet", icon_set.icon_set_name.to_ooxml());
            }
            if icon_set.reverse_order == Some(true) {
                w.attr("reverse", "1");
            }
            if icon_set.show_icon_only == Some(true) {
                w.attr("showValue", "0");
            }
            if let Some(percent) = icon_set.percent {
                w.attr("percent", if percent { "1" } else { "0" });
            }
            w.end_attrs();
            for threshold in &icon_set.thresholds {
                w.start_element("cfvo")
                    .attr("type", threshold.value_type.to_ooxml());
                if let Some(ref val) = threshold.value {
                    w.attr("val", val);
                }
                if !threshold.gte {
                    w.attr("gte", "0");
                }
                w.self_close();
            }
            w.end_element("iconSet");
        }
        CFRule::Top10 {
            rank,
            percent,
            bottom,
            style,
            priority,
            stop_if_true,
            ..
        } => {
            w.attr("type", "top10");
            w.attr_num("priority", *priority);
            w.attr_num("rank", *rank);
            if *percent == Some(true) {
                w.attr("percent", "1");
            }
            if *bottom == Some(true) {
                w.attr("bottom", "1");
            }
            write_dxf_id(w, style);
            if let Some(true) = stop_if_true {
                w.attr("stopIfTrue", "1");
            }
            w.self_close();
            return;
        }
        CFRule::DuplicateValues {
            unique,
            style,
            priority,
            stop_if_true,
            ..
        } => {
            let rule_type = if *unique == Some(true) {
                "uniqueValues"
            } else {
                "duplicateValues"
            };
            w.attr("type", rule_type);
            w.attr_num("priority", *priority);
            write_dxf_id(w, style);
            if let Some(true) = stop_if_true {
                w.attr("stopIfTrue", "1");
            }
            w.self_close();
            return;
        }
        CFRule::ContainsText {
            operator,
            text,
            style,
            priority,
            stop_if_true,
            formula,
            ..
        } => {
            // The operator field is the OOXML operator enum (ContainsText,
            // NotContains, BeginsWith, EndsWith). The cfRule `type` attribute
            // uses the OOXML *rule type* name, which differs for NotContains:
            //   operator="notContains" -> type="notContainsText"
            // All others match: containsText, beginsWith, endsWith.
            use ooxml_types::cond_format::CfOperator;
            let op_token = operator.to_ooxml();
            let rule_type = match operator {
                CfOperator::NotContains => "notContainsText",
                _ => op_token,
            };
            w.attr("type", rule_type);
            w.attr_num("priority", *priority);
            w.attr("operator", op_token);
            w.attr("text", text);
            write_dxf_id(w, style);
            if let Some(true) = stop_if_true {
                w.attr("stopIfTrue", "1");
            }
            w.end_attrs();
            // Use preserved formula if available; otherwise regenerate.
            let generated;
            let formula_str = if let Some(f) = formula {
                f.as_str()
            } else {
                generated = match operator {
                    CfOperator::ContainsText => {
                        format!("NOT(ISERROR(SEARCH(\"{}\",{})))", text, first_cell)
                    }
                    CfOperator::NotContains => {
                        format!("ISERROR(SEARCH(\"{}\",{}))", text, first_cell)
                    }
                    CfOperator::BeginsWith => {
                        format!("LEFT({},{})=\"{}\"", first_cell, text.len(), text)
                    }
                    CfOperator::EndsWith => {
                        format!("RIGHT({},{})=\"{}\"", first_cell, text.len(), text)
                    }
                    _ => format!("NOT(ISERROR(SEARCH(\"{}\",{})))", text, first_cell),
                };
                generated.as_str()
            };
            write_formula_element(w, formula_str);
        }
        CFRule::ContainsBlanks {
            blanks,
            style,
            priority,
            stop_if_true,
            formula,
            ..
        } => {
            let rule_type = if *blanks {
                "containsBlanks"
            } else {
                "notContainsBlanks"
            };
            w.attr("type", rule_type);
            w.attr_num("priority", *priority);
            write_dxf_id(w, style);
            if let Some(true) = stop_if_true {
                w.attr("stopIfTrue", "1");
            }
            w.end_attrs();
            let fallback = if *blanks {
                format!("LEN(TRIM({}))=0", first_cell)
            } else {
                format!("LEN(TRIM({}))>0", first_cell)
            };
            write_formula_element(w, formula.as_deref().unwrap_or(&fallback));
        }
        CFRule::ContainsErrors {
            errors,
            style,
            priority,
            stop_if_true,
            formula,
            ..
        } => {
            let rule_type = if *errors {
                "containsErrors"
            } else {
                "notContainsErrors"
            };
            w.attr("type", rule_type);
            w.attr_num("priority", *priority);
            write_dxf_id(w, style);
            if let Some(true) = stop_if_true {
                w.attr("stopIfTrue", "1");
            }
            w.end_attrs();
            let fallback = if *errors {
                format!("ISERROR({})", first_cell)
            } else {
                format!("NOT(ISERROR({}))", first_cell)
            };
            write_formula_element(w, formula.as_deref().unwrap_or(&fallback));
        }
        CFRule::TimePeriod {
            time_period,
            style,
            priority,
            stop_if_true,
            formula,
            ..
        } => {
            w.attr("type", "timePeriod");
            w.attr_num("priority", *priority);
            w.attr("timePeriod", time_period.to_ooxml());
            write_dxf_id(w, style);
            if let Some(true) = stop_if_true {
                w.attr("stopIfTrue", "1");
            }
            w.end_attrs();
            let fallback = time_period_formula(time_period.to_ooxml(), first_cell);
            write_formula_element(w, formula.as_deref().unwrap_or(&fallback));
        }
        CFRule::AboveAverage {
            above_average,
            equal_average,
            std_dev,
            style,
            priority,
            stop_if_true,
            formula,
            ..
        } => {
            w.attr("type", "aboveAverage");
            w.attr_num("priority", *priority);
            if !above_average {
                w.attr("aboveAverage", "0");
            }
            if *equal_average == Some(true) {
                w.attr("equalAverage", "1");
            }
            if let Some(sd) = std_dev {
                w.attr_num("stdDev", *sd);
            }
            write_dxf_id(w, style);
            if let Some(true) = stop_if_true {
                w.attr("stopIfTrue", "1");
            }
            if let Some(f) = formula {
                w.end_attrs();
                write_formula_element(w, f);
            } else {
                w.self_close();
                return;
            }
        }
    }

    w.end_element("cfRule");
}

#[cfg(test)]
mod tests {
    use super::cf_xml_from_domain;
    use domain_types::{CFColorPoint, CFDataBar, CFRule, CFValueRef, ConditionalFormat};
    use ooxml_types::cond_format::{DataBarAxisPosition, DataBarDirection};

    fn data_bar_point(value: CFValueRef) -> CFColorPoint {
        CFColorPoint {
            value,
            ooxml_value: None,
            color: String::new(),
            color_theme: None,
            color_tint: None,
            color_indexed: None,
            color_auto: None,
            ext_lst_xml: None,
        }
    }

    #[test]
    fn data_bar_domain_writer_preserves_extended_properties() {
        let cfs = vec![ConditionalFormat {
            id: "cf-1".to_string(),
            sheet_id: "sheet-1".to_string(),
            pivot: None,
            ranges: vec![domain_types::CFCellRange::new(0, 0, 4, 0)],
            range_identities: None,
            rules: vec![CFRule::DataBar {
                id: "rule-1".to_string(),
                priority: 1,
                stop_if_true: None,
                data_bar: CFDataBar {
                    min_point: data_bar_point(CFValueRef::Min),
                    max_point: data_bar_point(CFValueRef::Max),
                    min_length: None,
                    max_length: None,
                    positive_color: "#4472C4".to_string(),
                    negative_color: Some("#FF0000".to_string()),
                    negative_border_color: None,
                    border_color: Some("#222222".to_string()),
                    show_border: Some(true),
                    gradient: Some(false),
                    direction: Some(DataBarDirection::LeftToRight),
                    axis_position: Some(DataBarAxisPosition::None),
                    axis_color: Some("#000000".to_string()),
                    show_value: Some(false),
                    match_positive_fill_color: Some(false),
                    match_positive_border_color: Some(true),
                    ext_id: None,
                },
            }],
        }];

        let xml = cf_xml_from_domain(&cfs);

        assert!(xml.contains("<conditionalFormatting sqref=\"A1:A5\">"));
        assert!(xml.contains("type=\"dataBar\""));
        assert!(xml.contains("showValue=\"0\""));
        assert!(xml.contains("gradient=\"0\""));
        assert!(xml.contains("border=\"1\""));
        assert!(xml.contains("direction=\"leftToRight\""));
        assert!(xml.contains("negativeBarColorSameAsPositive=\"0\""));
        assert!(xml.contains("negativeBarBorderColorSameAsPositive=\"1\""));
        assert!(xml.contains("axisPosition=\"none\""));
        assert!(xml.contains("<cfvo type=\"min\"/>"));
        assert!(xml.contains("<cfvo type=\"max\"/>"));
        assert!(xml.contains("<color rgb=\"FF4472C4\"/>"));
        assert!(xml.contains("<borderColor rgb=\"FF222222\"/>"));
        assert!(xml.contains("<negativeFillColor rgb=\"FFFF0000\"/>"));
        assert!(xml.contains("<axisColor rgb=\"FF000000\"/>"));
        assert!(xml.contains("<x14:id>rule-1</x14:id>"));
    }

    #[test]
    fn data_bar_domain_writer_omits_absent_default_attributes() {
        let cfs = vec![ConditionalFormat {
            id: "cf-1".to_string(),
            sheet_id: "sheet-1".to_string(),
            pivot: None,
            ranges: vec![domain_types::CFCellRange::new(0, 0, 4, 0)],
            range_identities: None,
            rules: vec![CFRule::DataBar {
                id: "rule-1".to_string(),
                priority: 1,
                stop_if_true: None,
                data_bar: CFDataBar {
                    min_point: data_bar_point(CFValueRef::Min),
                    max_point: data_bar_point(CFValueRef::Max),
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
            }],
        }];

        let xml = cf_xml_from_domain(&cfs);

        assert!(xml.contains("<dataBar>"));
        assert!(!xml.contains("minLength="));
        assert!(!xml.contains("maxLength="));
        assert!(!xml.contains("showValue="));
        assert!(!xml.contains("gradient="));
        assert!(!xml.contains("border="));
        assert!(!xml.contains("direction="));
        assert!(!xml.contains("negativeBarColorSameAsPositive="));
        assert!(!xml.contains("negativeBarBorderColorSameAsPositive="));
        assert!(!xml.contains("axisPosition="));
    }

    #[test]
    fn data_bar_domain_writer_preserves_payloadless_cfvo_val() {
        let mut min_point = data_bar_point(CFValueRef::Min);
        min_point.ooxml_value = Some("0".to_string());
        let mut max_point = data_bar_point(CFValueRef::Max);
        max_point.ooxml_value = Some("0".to_string());
        let cfs = vec![ConditionalFormat {
            id: "cf-1".to_string(),
            sheet_id: "sheet-1".to_string(),
            pivot: None,
            ranges: vec![domain_types::CFCellRange::new(0, 0, 4, 0)],
            range_identities: None,
            rules: vec![CFRule::DataBar {
                id: "rule-1".to_string(),
                priority: 1,
                stop_if_true: None,
                data_bar: CFDataBar {
                    min_point,
                    max_point,
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
            }],
        }];

        let xml = cf_xml_from_domain(&cfs);

        assert!(xml.contains("<cfvo type=\"min\" val=\"0\"/>"));
        assert!(xml.contains("<cfvo type=\"max\" val=\"0\"/>"));
    }

    #[test]
    fn data_bar_domain_writer_preserves_explicit_default_attributes() {
        let cfs = vec![ConditionalFormat {
            id: "cf-1".to_string(),
            sheet_id: "sheet-1".to_string(),
            pivot: None,
            ranges: vec![domain_types::CFCellRange::new(0, 0, 4, 0)],
            range_identities: None,
            rules: vec![CFRule::DataBar {
                id: "rule-1".to_string(),
                priority: 1,
                stop_if_true: None,
                data_bar: CFDataBar {
                    min_point: data_bar_point(CFValueRef::Min),
                    max_point: data_bar_point(CFValueRef::Max),
                    min_length: Some(10),
                    max_length: Some(90),
                    positive_color: "#4472C4".to_string(),
                    negative_color: None,
                    negative_border_color: None,
                    border_color: None,
                    show_border: Some(false),
                    gradient: Some(true),
                    direction: Some(DataBarDirection::Context),
                    axis_position: Some(DataBarAxisPosition::Automatic),
                    axis_color: None,
                    show_value: Some(true),
                    match_positive_fill_color: Some(true),
                    match_positive_border_color: Some(false),
                    ext_id: None,
                },
            }],
        }];

        let xml = cf_xml_from_domain(&cfs);

        assert!(xml.contains("minLength=\"10\""));
        assert!(xml.contains("maxLength=\"90\""));
        assert!(xml.contains("showValue=\"1\""));
        assert!(xml.contains("gradient=\"1\""));
        assert!(xml.contains("border=\"0\""));
        assert!(xml.contains("direction=\"context\""));
        assert!(xml.contains("negativeBarColorSameAsPositive=\"1\""));
        assert!(xml.contains("negativeBarBorderColorSameAsPositive=\"0\""));
        assert!(xml.contains("axisPosition=\"automatic\""));
    }
}
