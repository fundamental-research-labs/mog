//! Unit tests for conditional formatting.

use super::rules::{
    parse_cf_rule, parse_cf_rule_x14, parse_color_scale, parse_conditional_formatting_element,
    parse_conditional_formatting_x14_element, parse_data_bar, parse_icon_set,
};
use super::types::{
    cf_operator_from_bytes, cf_rule_type_from_bytes, cf_time_period_from_bytes,
    cfvo_type_from_bytes, icon_set_type_from_bytes, parse_cf_color, parse_cfvo,
};
use super::*;
use crate::infra::xml::{
    decode_xml_entities_string, parse_bool_attr, parse_f64_attr, parse_string_attr, parse_u32_attr,
};

// -------------------------------------------------------------------------
// CfRuleType tests
// -------------------------------------------------------------------------

#[test]
fn test_cf_rule_type_from_bytes() {
    assert_eq!(
        cf_rule_type_from_bytes(b"expression"),
        CfRuleType::Expression
    );
    assert_eq!(cf_rule_type_from_bytes(b"cellIs"), CfRuleType::CellIs);
    assert_eq!(
        cf_rule_type_from_bytes(b"colorScale"),
        CfRuleType::ColorScale
    );
    assert_eq!(cf_rule_type_from_bytes(b"dataBar"), CfRuleType::DataBar);
    assert_eq!(cf_rule_type_from_bytes(b"iconSet"), CfRuleType::IconSet);
    assert_eq!(cf_rule_type_from_bytes(b"top10"), CfRuleType::Top10);
    assert_eq!(
        cf_rule_type_from_bytes(b"uniqueValues"),
        CfRuleType::UniqueValues
    );
    assert_eq!(
        cf_rule_type_from_bytes(b"duplicateValues"),
        CfRuleType::DuplicateValues
    );
    assert_eq!(
        cf_rule_type_from_bytes(b"containsText"),
        CfRuleType::ContainsText
    );
    assert_eq!(
        cf_rule_type_from_bytes(b"notContainsText"),
        CfRuleType::NotContainsText
    );
    assert_eq!(
        cf_rule_type_from_bytes(b"beginsWith"),
        CfRuleType::BeginsWith
    );
    assert_eq!(cf_rule_type_from_bytes(b"endsWith"), CfRuleType::EndsWith);
    assert_eq!(
        cf_rule_type_from_bytes(b"containsBlanks"),
        CfRuleType::ContainsBlanks
    );
    assert_eq!(
        cf_rule_type_from_bytes(b"notContainsBlanks"),
        CfRuleType::NotContainsBlanks
    );
    assert_eq!(
        cf_rule_type_from_bytes(b"containsErrors"),
        CfRuleType::ContainsErrors
    );
    assert_eq!(
        cf_rule_type_from_bytes(b"notContainsErrors"),
        CfRuleType::NotContainsErrors
    );
    assert_eq!(
        cf_rule_type_from_bytes(b"timePeriod"),
        CfRuleType::TimePeriod
    );
    assert_eq!(
        cf_rule_type_from_bytes(b"aboveAverage"),
        CfRuleType::AboveAverage
    );
    assert_eq!(cf_rule_type_from_bytes(b"unknown"), CfRuleType::Expression);
}

#[test]
fn test_cf_rule_type_to_ooxml() {
    assert_eq!(CfRuleType::Expression.to_ooxml(), "expression");
    assert_eq!(CfRuleType::CellIs.to_ooxml(), "cellIs");
    assert_eq!(CfRuleType::ColorScale.to_ooxml(), "colorScale");
}

// -------------------------------------------------------------------------
// CfOperator tests
// -------------------------------------------------------------------------

#[test]
fn test_cf_operator_from_bytes() {
    assert_eq!(cf_operator_from_bytes(b"lessThan"), CfOperator::LessThan);
    assert_eq!(
        cf_operator_from_bytes(b"lessThanOrEqual"),
        CfOperator::LessThanOrEqual
    );
    assert_eq!(cf_operator_from_bytes(b"equal"), CfOperator::Equal);
    assert_eq!(cf_operator_from_bytes(b"notEqual"), CfOperator::NotEqual);
    assert_eq!(
        cf_operator_from_bytes(b"greaterThanOrEqual"),
        CfOperator::GreaterThanOrEqual
    );
    assert_eq!(
        cf_operator_from_bytes(b"greaterThan"),
        CfOperator::GreaterThan
    );
    assert_eq!(cf_operator_from_bytes(b"between"), CfOperator::Between);
    assert_eq!(
        cf_operator_from_bytes(b"notBetween"),
        CfOperator::NotBetween
    );
    assert_eq!(
        cf_operator_from_bytes(b"containsText"),
        CfOperator::ContainsText
    );
    assert_eq!(
        cf_operator_from_bytes(b"notContains"),
        CfOperator::NotContains
    );
    assert_eq!(
        cf_operator_from_bytes(b"beginsWith"),
        CfOperator::BeginsWith
    );
    assert_eq!(cf_operator_from_bytes(b"endsWith"), CfOperator::EndsWith);
}

// -------------------------------------------------------------------------
// CfTimePeriod tests
// -------------------------------------------------------------------------

#[test]
fn test_cf_time_period_from_bytes() {
    assert_eq!(cf_time_period_from_bytes(b"today"), CfTimePeriod::Today);
    assert_eq!(
        cf_time_period_from_bytes(b"yesterday"),
        CfTimePeriod::Yesterday
    );
    assert_eq!(
        cf_time_period_from_bytes(b"tomorrow"),
        CfTimePeriod::Tomorrow
    );
    assert_eq!(
        cf_time_period_from_bytes(b"last7Days"),
        CfTimePeriod::Last7Days
    );
    assert_eq!(
        cf_time_period_from_bytes(b"thisMonth"),
        CfTimePeriod::ThisMonth
    );
    assert_eq!(
        cf_time_period_from_bytes(b"lastMonth"),
        CfTimePeriod::LastMonth
    );
    assert_eq!(
        cf_time_period_from_bytes(b"nextMonth"),
        CfTimePeriod::NextMonth
    );
    assert_eq!(
        cf_time_period_from_bytes(b"thisWeek"),
        CfTimePeriod::ThisWeek
    );
    assert_eq!(
        cf_time_period_from_bytes(b"lastWeek"),
        CfTimePeriod::LastWeek
    );
    assert_eq!(
        cf_time_period_from_bytes(b"nextWeek"),
        CfTimePeriod::NextWeek
    );
}

// -------------------------------------------------------------------------
// CfvoType tests
// -------------------------------------------------------------------------

#[test]
fn test_cfvo_type_from_bytes() {
    assert_eq!(cfvo_type_from_bytes(b"num"), CfvoType::Num);
    assert_eq!(cfvo_type_from_bytes(b"percent"), CfvoType::Percent);
    assert_eq!(cfvo_type_from_bytes(b"max"), CfvoType::Max);
    assert_eq!(cfvo_type_from_bytes(b"min"), CfvoType::Min);
    assert_eq!(cfvo_type_from_bytes(b"formula"), CfvoType::Formula);
    assert_eq!(cfvo_type_from_bytes(b"percentile"), CfvoType::Percentile);
    assert_eq!(cfvo_type_from_bytes(b"autoMin"), CfvoType::AutoMin);
    assert_eq!(cfvo_type_from_bytes(b"autoMax"), CfvoType::AutoMax);
}

// -------------------------------------------------------------------------
// IconSetType tests
// -------------------------------------------------------------------------

#[test]
fn test_icon_set_type_from_bytes() {
    assert_eq!(
        icon_set_type_from_bytes(b"3Arrows"),
        IconSetType::ThreeArrows
    );
    assert_eq!(
        icon_set_type_from_bytes(b"3ArrowsGray"),
        IconSetType::ThreeArrowsGray
    );
    assert_eq!(icon_set_type_from_bytes(b"3Flags"), IconSetType::ThreeFlags);
    assert_eq!(
        icon_set_type_from_bytes(b"3TrafficLights1"),
        IconSetType::ThreeTrafficLights1
    );
    assert_eq!(
        icon_set_type_from_bytes(b"4Arrows"),
        IconSetType::FourArrows
    );
    assert_eq!(
        icon_set_type_from_bytes(b"5Arrows"),
        IconSetType::FiveArrows
    );
    assert_eq!(icon_set_type_from_bytes(b"NoIcons"), IconSetType::NoIcons);
}

// -------------------------------------------------------------------------
// CfColor tests (was ParsedColor)
// -------------------------------------------------------------------------

#[test]
fn test_cf_color_rgb() {
    let xml = b"<color rgb=\"FF00FF00\"/>";
    let color = parse_cf_color(xml);
    assert_eq!(color.rgb, Some("FF00FF00".to_string()));
}

#[test]
fn test_cf_color_theme() {
    let xml = b"<color theme=\"4\" tint=\"0.5\"/>";
    let color = parse_cf_color(xml);
    assert_eq!(color.theme, Some(4));
    assert_eq!(color.tint, Some(0.5));
}

#[test]
fn test_cf_color_indexed() {
    let xml = b"<color indexed=\"64\"/>";
    let color = parse_cf_color(xml);
    assert_eq!(color.indexed, Some(64));
}

#[test]
fn test_cf_color_auto() {
    let xml = b"<color auto=\"1\"/>";
    let color = parse_cf_color(xml);
    assert!(color.auto);
}

// -------------------------------------------------------------------------
// Cfvo tests
// -------------------------------------------------------------------------

#[test]
fn test_cfvo_parse_num() {
    let xml = b"<cfvo type=\"num\" val=\"100\"/>";
    let cfvo = parse_cfvo(xml);
    assert_eq!(cfvo.cfvo_type, CfvoType::Num);
    assert_eq!(cfvo.val, Some("100".to_string()));
    assert!(cfvo.gte); // Default is true
}

#[test]
fn test_cfvo_parse_percent() {
    let xml = b"<cfvo type=\"percent\" val=\"50\"/>";
    let cfvo = parse_cfvo(xml);
    assert_eq!(cfvo.cfvo_type, CfvoType::Percent);
    assert_eq!(cfvo.val, Some("50".to_string()));
}

#[test]
fn test_cfvo_parse_min_max() {
    let xml = b"<cfvo type=\"min\"/>";
    let cfvo = parse_cfvo(xml);
    assert_eq!(cfvo.cfvo_type, CfvoType::Min);
    assert!(cfvo.val.is_none());

    let xml = b"<cfvo type=\"max\"/>";
    let cfvo = parse_cfvo(xml);
    assert_eq!(cfvo.cfvo_type, CfvoType::Max);
}

#[test]
fn test_cfvo_parse_formula() {
    let xml = b"<cfvo type=\"formula\" val=\"$A$1\"/>";
    let cfvo = parse_cfvo(xml);
    assert_eq!(cfvo.cfvo_type, CfvoType::Formula);
    assert_eq!(cfvo.val, Some("$A$1".to_string()));
}

#[test]
fn test_cfvo_parse_x14_child_formula_value() {
    let xml = br#"<x14:cfvo type="num"><xm:f>1</xm:f></x14:cfvo>"#;
    let cfvo = parse_cfvo(xml);
    assert_eq!(cfvo.cfvo_type, CfvoType::Num);
    assert_eq!(cfvo.val, Some("1".to_string()));
}

#[test]
fn test_cfvo_parse_gte_false() {
    let xml = b"<cfvo type=\"num\" val=\"50\" gte=\"0\"/>";
    let cfvo = parse_cfvo(xml);
    assert!(!cfvo.gte);
}

// -------------------------------------------------------------------------
// ColorScale tests
// -------------------------------------------------------------------------

#[test]
fn test_color_scale_two_color() {
    let xml = br#"<colorScale>
        <cfvo type="min"/>
        <cfvo type="max"/>
        <color rgb="FFF8696B"/>
        <color rgb="FF63BE7B"/>
    </colorScale>"#;
    let cs = parse_color_scale(xml);
    assert_eq!(cs.cfvo.len(), 2);
    assert_eq!(cs.cfvo[0].cfvo_type, CfvoType::Min);
    assert_eq!(cs.cfvo[1].cfvo_type, CfvoType::Max);
    assert_eq!(cs.colors.len(), 2);
    assert_eq!(cs.colors[0].rgb, Some("FFF8696B".to_string()));
    assert_eq!(cs.colors[1].rgb, Some("FF63BE7B".to_string()));
}

#[test]
fn test_color_scale_three_color() {
    let xml = br#"<colorScale>
        <cfvo type="min"/>
        <cfvo type="percentile" val="50"/>
        <cfvo type="max"/>
        <color rgb="FFF8696B"/>
        <color rgb="FFFCFCFF"/>
        <color rgb="FF63BE7B"/>
    </colorScale>"#;
    let cs = parse_color_scale(xml);
    assert_eq!(cs.cfvo.len(), 3);
    assert_eq!(cs.cfvo[1].cfvo_type, CfvoType::Percentile);
    assert_eq!(cs.cfvo[1].val, Some("50".to_string()));
    assert_eq!(cs.colors.len(), 3);
}

// -------------------------------------------------------------------------
// DataBar tests
// -------------------------------------------------------------------------

#[test]
fn test_data_bar_basic() {
    let xml = br#"<dataBar>
        <cfvo type="min"/>
        <cfvo type="max"/>
        <color rgb="FF638EC6"/>
    </dataBar>"#;
    let db = parse_data_bar(xml);
    assert_eq!(db.min_length, 10); // Default
    assert_eq!(db.max_length, 90); // Default
    assert!(db.show_value); // Default
    assert!(!db.min_length_attr_present);
    assert!(!db.max_length_attr_present);
    assert!(!db.show_value_attr_present);
    assert!(!db.gradient_attr_present);
    assert!(!db.direction_attr_present);
    assert!(!db.axis_position_attr_present);
    assert_eq!(db.cfvo.len(), 2);
    assert_eq!(db.color.rgb, Some("FF638EC6".to_string()));
}

#[test]
fn test_data_bar_with_lengths() {
    let xml = br#"<dataBar minLength="5" maxLength="95" showValue="0">
        <cfvo type="num" val="0"/>
        <cfvo type="num" val="100"/>
        <color rgb="FF638EC6"/>
    </dataBar>"#;
    let db = parse_data_bar(xml);
    assert_eq!(db.min_length, 5);
    assert_eq!(db.max_length, 95);
    assert!(!db.show_value);
    assert!(db.min_length_attr_present);
    assert!(db.max_length_attr_present);
    assert!(db.show_value_attr_present);
    assert_eq!(db.cfvo[0].val, Some("0".to_string()));
    assert_eq!(db.cfvo[1].val, Some("100".to_string()));
}

#[test]
fn test_data_bar_x14_extensions() {
    let xml = br#"<dataBar gradient="0" border="1" direction="leftToRight" negativeBarColorSameAsPositive="0" negativeBarBorderColorSameAsPositive="1" axisPosition="middle">
        <cfvo type="min"/>
        <cfvo type="max"/>
        <color rgb="FF638EC6"/>
        <borderColor rgb="FF000000"/>
        <negativeFillColor rgb="FFFF0000"/>
        <axisColor rgb="FF000000"/>
    </dataBar>"#;
    let db = parse_data_bar(xml);
    assert!(!db.gradient);
    assert!(db.border);
    assert_eq!(db.direction, DataBarDirection::LeftToRight);
    assert!(!db.negative_bar_color_same_as_positive);
    assert!(db.negative_bar_border_color_same_as_positive);
    assert_eq!(db.axis_position, DataBarAxisPosition::Middle);
    assert!(db.gradient_attr_present);
    assert!(db.border_attr_present);
    assert!(db.direction_attr_present);
    assert!(db.negative_bar_color_same_as_positive_attr_present);
    assert!(db.negative_bar_border_color_same_as_positive_attr_present);
    assert!(db.axis_position_attr_present);
    assert!(db.border_color.is_some());
    assert!(db.negative_fill_color.is_some());
    assert!(db.axis_color.is_some());
}

#[test]
fn test_data_bar_x14_cfvo_child_formula_values() {
    let xml = br#"<x14:dataBar gradient="0">
        <x14:cfvo type="num"><xm:f>0</xm:f></x14:cfvo>
        <x14:cfvo type="num"><xm:f>1</xm:f></x14:cfvo>
        <x14:negativeFillColor rgb="FFFF0000"/>
        <x14:axisColor rgb="FF000000"/>
    </x14:dataBar>"#;
    let db = parse_data_bar(xml);
    assert_eq!(db.cfvo.len(), 2);
    assert_eq!(db.cfvo[0].cfvo_type, CfvoType::Num);
    assert_eq!(db.cfvo[0].val.as_deref(), Some("0"));
    assert_eq!(db.cfvo[1].cfvo_type, CfvoType::Num);
    assert_eq!(db.cfvo[1].val.as_deref(), Some("1"));
}

// -------------------------------------------------------------------------
// IconSet tests
// -------------------------------------------------------------------------

#[test]
fn test_icon_set_basic() {
    let xml = br#"<iconSet iconSet="3Arrows">
        <cfvo type="percent" val="0"/>
        <cfvo type="percent" val="33"/>
        <cfvo type="percent" val="67"/>
    </iconSet>"#;
    let is = parse_icon_set(xml);
    assert_eq!(is.icon_set, IconSetType::ThreeArrows);
    assert!(is.show_value);
    assert!(is.percent);
    assert!(!is.reverse);
    assert_eq!(is.cfvo.len(), 3);
}

#[test]
fn test_icon_set_with_options() {
    let xml = br#"<iconSet iconSet="5Rating" showValue="0" percent="0" reverse="1">
        <cfvo type="num" val="1"/>
        <cfvo type="num" val="2"/>
        <cfvo type="num" val="3"/>
        <cfvo type="num" val="4"/>
        <cfvo type="num" val="5"/>
    </iconSet>"#;
    let is = parse_icon_set(xml);
    assert_eq!(is.icon_set, IconSetType::FiveRating);
    assert!(!is.show_value);
    assert!(!is.percent);
    assert!(is.reverse);
    assert_eq!(is.cfvo.len(), 5);
}

#[test]
fn test_icon_set_custom() {
    let xml = br#"<iconSet custom="1">
        <cfvo type="percent" val="0"/>
        <cfvo type="percent" val="50"/>
        <cfIcon iconSet="3Flags" iconId="0"/>
        <cfIcon iconSet="3Flags" iconId="1"/>
    </iconSet>"#;
    let is = parse_icon_set(xml);
    assert!(is.custom);
    assert_eq!(is.cf_icon.len(), 2);
    assert_eq!(is.cf_icon[0].icon_set, IconSetType::ThreeFlags);
    assert_eq!(is.cf_icon[0].icon_id, 0);
}

// -------------------------------------------------------------------------
// CfRule tests
// -------------------------------------------------------------------------

#[test]
fn test_cf_rule_cell_is() {
    let xml = br#"<cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan">
        <formula>100</formula>
    </cfRule>"#;
    let rule = parse_cf_rule(xml);
    assert_eq!(rule.rule_type, CfRuleType::CellIs);
    assert_eq!(rule.priority, 1);
    assert_eq!(rule.dxf_id, Some(0));
    assert_eq!(rule.operator, Some(CfOperator::GreaterThan));
    assert_eq!(rule.formulas.len(), 1);
    assert_eq!(rule.formulas[0], "100");
}

#[test]
fn test_cf_rule_between() {
    let xml = br#"<cfRule type="cellIs" dxfId="1" priority="2" operator="between">
        <formula>10</formula>
        <formula>20</formula>
    </cfRule>"#;
    let rule = parse_cf_rule(xml);
    assert_eq!(rule.operator, Some(CfOperator::Between));
    assert_eq!(rule.formulas.len(), 2);
    assert_eq!(rule.formulas[0], "10");
    assert_eq!(rule.formulas[1], "20");
}

#[test]
fn test_cf_rule_expression() {
    let xml = br#"<cfRule type="expression" dxfId="2" priority="3">
        <formula>$A1&gt;100</formula>
    </cfRule>"#;
    let rule = parse_cf_rule(xml);
    assert_eq!(rule.rule_type, CfRuleType::Expression);
    assert_eq!(rule.formulas.len(), 1);
    assert_eq!(rule.formulas[0], "$A1>100"); // XML entity decoded
}

#[test]
fn test_cf_rule_top10() {
    let xml = br#"<cfRule type="top10" dxfId="3" priority="4" rank="10" percent="1" bottom="1"/>"#;
    let rule = parse_cf_rule(xml);
    assert_eq!(rule.rule_type, CfRuleType::Top10);
    assert_eq!(rule.rank, Some(10));
    assert!(rule.percent);
    assert!(rule.bottom);
}

#[test]
fn test_cf_rule_above_average() {
    let xml =
        br#"<cfRule type="aboveAverage" dxfId="4" priority="5" aboveAverage="0" stdDev="1"/>"#;
    let rule = parse_cf_rule(xml);
    assert_eq!(rule.rule_type, CfRuleType::AboveAverage);
    assert!(!rule.above_average);
    assert_eq!(rule.std_dev, Some(1));
}

#[test]
fn test_cf_rule_contains_text() {
    let xml = br#"<cfRule type="containsText" dxfId="5" priority="6" text="error" operator="containsText">
        <formula>NOT(ISERROR(SEARCH("error",A1)))</formula>
    </cfRule>"#;
    let rule = parse_cf_rule(xml);
    assert_eq!(rule.rule_type, CfRuleType::ContainsText);
    assert_eq!(rule.text, Some("error".to_string()));
    assert_eq!(rule.operator, Some(CfOperator::ContainsText));
}

#[test]
fn test_cf_rule_time_period() {
    let xml = br#"<cfRule type="timePeriod" dxfId="6" priority="7" timePeriod="last7Days"/>"#;
    let rule = parse_cf_rule(xml);
    assert_eq!(rule.rule_type, CfRuleType::TimePeriod);
    assert_eq!(rule.time_period, Some(CfTimePeriod::Last7Days));
}

#[test]
fn test_cf_rule_color_scale() {
    let xml = br#"<cfRule type="colorScale" priority="8">
        <colorScale>
            <cfvo type="min"/>
            <cfvo type="max"/>
            <color rgb="FFF8696B"/>
            <color rgb="FF63BE7B"/>
        </colorScale>
    </cfRule>"#;
    let rule = parse_cf_rule(xml);
    assert_eq!(rule.rule_type, CfRuleType::ColorScale);
    assert!(rule.color_scale.is_some());
    let cs = rule.color_scale.unwrap();
    assert_eq!(cs.cfvo.len(), 2);
    assert_eq!(cs.colors.len(), 2);
}

#[test]
fn test_cf_rule_data_bar() {
    let xml = br#"<cfRule type="dataBar" priority="9">
        <dataBar>
            <cfvo type="min"/>
            <cfvo type="max"/>
            <color rgb="FF638EC6"/>
        </dataBar>
    </cfRule>"#;
    let rule = parse_cf_rule(xml);
    assert_eq!(rule.rule_type, CfRuleType::DataBar);
    assert!(rule.data_bar.is_some());
}

#[test]
fn test_cf_rule_icon_set() {
    let xml = br#"<cfRule type="iconSet" priority="10">
        <iconSet iconSet="3TrafficLights1">
            <cfvo type="percent" val="0"/>
            <cfvo type="percent" val="33"/>
            <cfvo type="percent" val="67"/>
        </iconSet>
    </cfRule>"#;
    let rule = parse_cf_rule(xml);
    assert_eq!(rule.rule_type, CfRuleType::IconSet);
    assert!(rule.icon_set.is_some());
}

#[test]
fn test_cf_rule_stop_if_true() {
    let xml = br#"<cfRule type="cellIs" priority="1" stopIfTrue="1" operator="equal">
        <formula>0</formula>
    </cfRule>"#;
    let rule = parse_cf_rule(xml);
    assert!(rule.stop_if_true);
}

// -------------------------------------------------------------------------
// ConditionalFormatting tests
// -------------------------------------------------------------------------

#[test]
fn test_conditional_formatting_single_rule() {
    let xml = br#"<conditionalFormatting sqref="A1:A10">
        <cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan">
            <formula>100</formula>
        </cfRule>
    </conditionalFormatting>"#;
    let cf = parse_conditional_formatting_element(xml);
    assert_eq!(cf.sqref, "A1:A10");
    assert!(!cf.pivot);
    assert_eq!(cf.rules.len(), 1);
}

#[test]
fn test_conditional_formatting_multiple_rules() {
    let xml = br#"<conditionalFormatting sqref="B1:B20">
        <cfRule type="cellIs" dxfId="0" priority="1" operator="lessThan">
            <formula>0</formula>
        </cfRule>
        <cfRule type="cellIs" dxfId="1" priority="2" operator="greaterThan">
            <formula>100</formula>
        </cfRule>
    </conditionalFormatting>"#;
    let cf = parse_conditional_formatting_element(xml);
    assert_eq!(cf.rules.len(), 2);
    assert_eq!(cf.rules[0].priority, 1);
    assert_eq!(cf.rules[1].priority, 2);
}

#[test]
fn test_conditional_formatting_pivot() {
    let xml = br#"<conditionalFormatting sqref="A1:D10" pivot="1">
        <cfRule type="expression" priority="1">
            <formula>TRUE</formula>
        </cfRule>
    </conditionalFormatting>"#;
    let cf = parse_conditional_formatting_element(xml);
    assert!(cf.pivot);
}

#[test]
fn test_conditional_formatting_multiple_sqref() {
    let xml = br#"<conditionalFormatting sqref="A1:A10 C1:C10 E1:E10">
        <cfRule type="colorScale" priority="1">
            <colorScale>
                <cfvo type="min"/>
                <cfvo type="max"/>
                <color rgb="FFF8696B"/>
                <color rgb="FF63BE7B"/>
            </colorScale>
        </cfRule>
    </conditionalFormatting>"#;
    let cf = parse_conditional_formatting_element(xml);
    assert_eq!(cf.sqref, "A1:A10 C1:C10 E1:E10");
}

// -------------------------------------------------------------------------
// parse_conditional_formatting tests
// -------------------------------------------------------------------------

#[test]
fn test_parse_conditional_formatting_multiple() {
    let xml = br#"<?xml version="1.0"?>
<worksheet>
    <sheetData/>
    <conditionalFormatting sqref="A1:A10">
        <cfRule type="cellIs" priority="1" operator="greaterThan">
            <formula>50</formula>
        </cfRule>
    </conditionalFormatting>
    <conditionalFormatting sqref="B1:B10">
        <cfRule type="colorScale" priority="2">
            <colorScale>
                <cfvo type="min"/>
                <cfvo type="max"/>
                <color rgb="FFF8696B"/>
                <color rgb="FF63BE7B"/>
            </colorScale>
        </cfRule>
    </conditionalFormatting>
</worksheet>"#;
    let cfs = parse_conditional_formatting(xml);
    assert_eq!(cfs.len(), 2);
    assert_eq!(cfs[0].sqref, "A1:A10");
    assert_eq!(cfs[1].sqref, "B1:B10");
}

#[test]
fn test_parse_conditional_formatting_empty() {
    let xml = br#"<?xml version="1.0"?>
<worksheet>
    <sheetData/>
</worksheet>"#;
    let cfs = parse_conditional_formatting(xml);
    assert_eq!(cfs.len(), 0);
}

// -------------------------------------------------------------------------
// X14 Extension tests
// -------------------------------------------------------------------------

#[test]
fn test_cf_rule_x14_data_bar() {
    let xml = br#"<cfRule type="dataBar" id="{00000000-0000-0000-0000-000000000001}">
        <dataBar gradient="1" direction="leftToRight" axisPosition="automatic">
            <cfvo type="autoMin"/>
            <cfvo type="autoMax"/>
            <borderColor rgb="FF638EC6"/>
            <negativeFillColor rgb="FFFF0000"/>
            <axisColor rgb="FF000000"/>
        </dataBar>
    </cfRule>"#;
    let rule = parse_cf_rule_x14(xml);
    assert_eq!(rule.rule_type, CfRuleType::DataBar);
    assert_eq!(rule.id, "{00000000-0000-0000-0000-000000000001}");
    assert!(rule.data_bar.is_some());
    let db = rule.data_bar.unwrap();
    assert!(db.gradient);
    assert_eq!(db.direction, DataBarDirection::LeftToRight);
}

#[test]
fn test_conditional_formatting_x14() {
    let xml = br#"<x14:conditionalFormatting xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">
        <xm:sqref>A1:A10</xm:sqref>
        <x14:cfRule type="dataBar" id="{GUID}">
            <x14:dataBar gradient="1">
                <x14:cfvo type="min"/>
                <x14:cfvo type="max"/>
            </x14:dataBar>
        </x14:cfRule>
    </x14:conditionalFormatting>"#;
    let cf = parse_conditional_formatting_x14_element(xml);
    assert_eq!(cf.sqref, "A1:A10");
    assert_eq!(cf.rules.len(), 1);
}

// -------------------------------------------------------------------------
// Helper function tests
// -------------------------------------------------------------------------

#[test]
fn test_parse_u32_attr() {
    let xml = b"<tag value=\"123\"/>";
    assert_eq!(parse_u32_attr(xml, b"value=\""), Some(123));
}

#[test]
fn test_parse_string_attr() {
    let xml = b"<tag name=\"test\"/>";
    assert_eq!(parse_string_attr(xml, b"name=\""), Some("test".to_string()));
}

#[test]
fn test_parse_bool_attr() {
    let xml = b"<tag enabled=\"1\"/>";
    assert!(parse_bool_attr(xml, b"enabled=\""));

    let xml = b"<tag enabled=\"true\"/>";
    assert!(parse_bool_attr(xml, b"enabled=\""));

    let xml = b"<tag enabled=\"0\"/>";
    assert!(!parse_bool_attr(xml, b"enabled=\""));

    let xml = b"<tag enabled=\"false\"/>";
    assert!(!parse_bool_attr(xml, b"enabled=\""));
}

#[test]
fn test_parse_f64_attr() {
    let xml = b"<tag tint=\"0.5\"/>";
    assert_eq!(parse_f64_attr(xml, b"tint=\""), Some(0.5));

    let xml = b"<tag tint=\"-0.25\"/>";
    assert_eq!(parse_f64_attr(xml, b"tint=\""), Some(-0.25));
}

#[test]
fn test_decode_xml_entities() {
    assert_eq!(decode_xml_entities_string("hello"), "hello");
    assert_eq!(decode_xml_entities_string("&lt;tag&gt;"), "<tag>");
    assert_eq!(decode_xml_entities_string("&amp;"), "&");
    assert_eq!(decode_xml_entities_string("&quot;text&quot;"), "\"text\"");
    assert_eq!(decode_xml_entities_string("&apos;"), "'");
    assert_eq!(
        decode_xml_entities_string("a &lt; b &amp;&amp; c &gt; d"),
        "a < b && c > d"
    );
}

// -------------------------------------------------------------------------
// Malformed input tests
// -------------------------------------------------------------------------

#[test]
fn test_malformed_empty_xml() {
    let xml = b"";
    let cfs = parse_conditional_formatting(xml);
    assert_eq!(cfs.len(), 0);
}

#[test]
fn test_malformed_incomplete_tag() {
    let xml = b"<conditionalFormatting sqref=\"A1";
    let cfs = parse_conditional_formatting(xml);
    assert_eq!(cfs.len(), 1);
    // xml_utils::parse_string_attr extracts partial value when closing quote is missing
    assert_eq!(cfs[0].sqref, "A1");
}

#[test]
fn test_malformed_missing_closing_tag() {
    let xml = b"<conditionalFormatting sqref=\"A1:A10\"><cfRule type=\"cellIs\" priority=\"1\">";
    let cfs = parse_conditional_formatting(xml);
    assert_eq!(cfs.len(), 1);
    // Parser should still extract what it can
}

#[test]
fn test_malformed_invalid_attribute_value() {
    let xml = b"<cfvo type=\"invalid_type\" val=\"abc\"/>";
    let cfvo = parse_cfvo(xml);
    // Should default to Num for unknown type
    assert_eq!(cfvo.cfvo_type, CfvoType::Num);
}

#[test]
fn test_malformed_missing_required_attrs() {
    let xml = b"<cfRule><formula>test</formula></cfRule>";
    let rule = parse_cf_rule(xml);
    // Should use defaults
    assert_eq!(rule.rule_type, CfRuleType::Expression); // Default
    assert_eq!(rule.priority, 0); // Default
}

// -------------------------------------------------------------------------
// Integration tests
// -------------------------------------------------------------------------

#[test]
fn test_full_worksheet_parsing() {
    let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <sheetData>
        <row r="1">
            <c r="A1"><v>50</v></c>
            <c r="B1"><v>75</v></c>
            <c r="C1"><v>100</v></c>
        </row>
    </sheetData>
    <conditionalFormatting sqref="A1:C10">
        <cfRule type="colorScale" priority="1">
            <colorScale>
                <cfvo type="min"/>
                <cfvo type="percentile" val="50"/>
                <cfvo type="max"/>
                <color rgb="FFF8696B"/>
                <color rgb="FFFCFCFF"/>
                <color rgb="FF63BE7B"/>
            </colorScale>
        </cfRule>
    </conditionalFormatting>
    <conditionalFormatting sqref="D1:D10">
        <cfRule type="dataBar" priority="2">
            <dataBar minLength="10" maxLength="90">
                <cfvo type="min"/>
                <cfvo type="max"/>
                <color rgb="FF638EC6"/>
            </dataBar>
        </cfRule>
    </conditionalFormatting>
    <conditionalFormatting sqref="E1:E10">
        <cfRule type="iconSet" priority="3">
            <iconSet iconSet="3Arrows">
                <cfvo type="percent" val="0"/>
                <cfvo type="percent" val="33"/>
                <cfvo type="percent" val="67"/>
            </iconSet>
        </cfRule>
    </conditionalFormatting>
</worksheet>"#;

    let cfs = parse_conditional_formatting(xml);
    assert_eq!(cfs.len(), 3);

    // First CF: Color scale
    assert_eq!(cfs[0].sqref, "A1:C10");
    assert_eq!(cfs[0].rules[0].rule_type, CfRuleType::ColorScale);
    let cs = cfs[0].rules[0].color_scale.as_ref().unwrap();
    assert_eq!(cs.cfvo.len(), 3);
    assert_eq!(cs.colors.len(), 3);

    // Second CF: Data bar
    assert_eq!(cfs[1].sqref, "D1:D10");
    assert_eq!(cfs[1].rules[0].rule_type, CfRuleType::DataBar);
    let db = cfs[1].rules[0].data_bar.as_ref().unwrap();
    assert_eq!(db.min_length, 10);
    assert_eq!(db.max_length, 90);

    // Third CF: Icon set
    assert_eq!(cfs[2].sqref, "E1:E10");
    assert_eq!(cfs[2].rules[0].rule_type, CfRuleType::IconSet);
    let is = cfs[2].rules[0].icon_set.as_ref().unwrap();
    assert_eq!(is.icon_set, IconSetType::ThreeArrows);
}

#[test]
fn test_xml_scanner_integration() {
    use crate::infra::scanner::XmlScanner;

    let xml = br#"<worksheet>
        <sheetData/>
        <conditionalFormatting sqref="A1:A10">
            <cfRule type="cellIs" priority="1" operator="equal">
                <formula>100</formula>
            </cfRule>
        </conditionalFormatting>
    </worksheet>"#;

    let mut scanner = XmlScanner::new(xml);
    let cfs = parse_conditional_formatting_with_scanner(&mut scanner);
    assert_eq!(cfs.len(), 1);
    assert_eq!(cfs[0].rules[0].operator, Some(CfOperator::Equal));
}
