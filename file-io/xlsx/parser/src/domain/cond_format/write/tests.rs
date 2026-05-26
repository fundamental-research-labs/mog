//! Unit tests for conditional formatting writer.

use super::*;
use crate::write::xml_writer::XmlWriter;

// -------------------------------------------------------------------------
// Cell Value Rule Tests
// -------------------------------------------------------------------------

#[test]
fn test_cell_is_greater_than() {
    let mut cf = CfWriter::new();
    cf.add_cell_is(
        "A1:A10",
        CfOperator::GreaterThan,
        "100",
        CfStyle::with_dxf_id(0),
    );

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("<conditionalFormatting sqref=\"A1:A10\">"));
    assert!(xml.contains("type=\"cellIs\""));
    assert!(xml.contains("dxfId=\"0\""));
    assert!(xml.contains("priority=\"1\""));
    assert!(xml.contains("operator=\"greaterThan\""));
    assert!(xml.contains("<formula>100</formula>"));
    assert!(xml.contains("</cfRule>"));
    assert!(xml.contains("</conditionalFormatting>"));
}

#[test]
fn test_cell_is_less_than() {
    let mut cf = CfWriter::new();
    cf.add_cell_is("B1:B5", CfOperator::LessThan, "50", CfStyle::default());

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("operator=\"lessThan\""));
    assert!(xml.contains("<formula>50</formula>"));
}

#[test]
fn test_cell_is_equal() {
    let mut cf = CfWriter::new();
    cf.add_cell_is("C1:C10", CfOperator::Equal, "\"Yes\"", CfStyle::default());

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("operator=\"equal\""));
    assert!(xml.contains("<formula>\"Yes\"</formula>"));
}

#[test]
fn test_cell_is_not_equal() {
    let mut cf = CfWriter::new();
    cf.add_cell_is("D1:D10", CfOperator::NotEqual, "0", CfStyle::default());

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("operator=\"notEqual\""));
}

#[test]
fn test_cell_is_between() {
    let mut cf = CfWriter::new();
    cf.add_cell_is_between("E1:E10", "10", "20", CfStyle::with_dxf_id(1));

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("operator=\"between\""));
    assert!(xml.contains("<formula>10</formula>"));
    assert!(xml.contains("<formula>20</formula>"));
}

#[test]
fn test_cell_is_greater_than_or_equal() {
    let mut cf = CfWriter::new();
    cf.add_cell_is(
        "F1:F10",
        CfOperator::GreaterThanOrEqual,
        "0",
        CfStyle::default(),
    );

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("operator=\"greaterThanOrEqual\""));
}

#[test]
fn test_cell_is_less_than_or_equal() {
    let mut cf = CfWriter::new();
    cf.add_cell_is(
        "G1:G10",
        CfOperator::LessThanOrEqual,
        "100",
        CfStyle::default(),
    );

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("operator=\"lessThanOrEqual\""));
}

// -------------------------------------------------------------------------
// Color Scale Tests
// -------------------------------------------------------------------------

#[test]
fn test_color_scale_2_color() {
    let mut cf = CfWriter::new();
    cf.add_color_scale_2("A1:A10", "FFF8696B", "FF63BE7B");

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"colorScale\""));
    assert!(xml.contains("<colorScale>"));
    assert!(xml.contains("<cfvo type=\"min\"/>"));
    assert!(xml.contains("<cfvo type=\"max\"/>"));
    assert!(xml.contains("<color rgb=\"FFF8696B\"/>"));
    assert!(xml.contains("<color rgb=\"FF63BE7B\"/>"));
    assert!(xml.contains("</colorScale>"));
}

#[test]
fn test_color_scale_3_color() {
    let mut cf = CfWriter::new();
    cf.add_color_scale_3("B1:B10", "FFF8696B", "FFFFEB84", "FF63BE7B");

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"colorScale\""));
    assert!(xml.contains("<cfvo type=\"min\"/>"));
    assert!(xml.contains("<cfvo type=\"percentile\" val=\"50\"/>"));
    assert!(xml.contains("<cfvo type=\"max\"/>"));
    assert!(xml.contains("<color rgb=\"FFF8696B\"/>"));
    assert!(xml.contains("<color rgb=\"FFFFEB84\"/>"));
    assert!(xml.contains("<color rgb=\"FF63BE7B\"/>"));
}

// -------------------------------------------------------------------------
// Data Bar Tests
// -------------------------------------------------------------------------

#[test]
fn test_data_bar() {
    let mut cf = CfWriter::new();
    cf.add_data_bar("C1:C10", "FF638EC6");

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"dataBar\""));
    assert!(xml.contains("<dataBar>"));
    assert!(xml.contains("<cfvo type=\"min\"/>"));
    assert!(xml.contains("<cfvo type=\"max\"/>"));
    assert!(xml.contains("<color rgb=\"FF638EC6\"/>"));
    assert!(xml.contains("</dataBar>"));
}

// -------------------------------------------------------------------------
// Icon Set Tests
// -------------------------------------------------------------------------

#[test]
fn test_icon_set_arrows3() {
    let mut cf = CfWriter::new();
    cf.add_icon_set("D1:D10", IconSetType::ThreeArrows);

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"iconSet\""));
    assert!(xml.contains("iconSet=\"3Arrows\""));
    assert!(xml.contains("<cfvo type=\"percent\" val=\"0\"/>"));
    assert!(xml.contains("<cfvo type=\"percent\" val=\"33\"/>"));
    assert!(xml.contains("<cfvo type=\"percent\" val=\"66\"/>"));
}

#[test]
fn test_icon_set_traffic_lights() {
    let mut cf = CfWriter::new();
    cf.add_icon_set("E1:E10", IconSetType::ThreeTrafficLights1);

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("iconSet=\"3TrafficLights1\""));
}

#[test]
fn test_icon_set_5_arrows() {
    let mut cf = CfWriter::new();
    cf.add_icon_set("F1:F10", IconSetType::FiveArrows);

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("iconSet=\"5Arrows\""));
    // Should have 5 cfvo elements
    let cfvo_count = xml.matches("<cfvo").count();
    assert_eq!(cfvo_count, 5);
}

// -------------------------------------------------------------------------
// Top/Bottom Rule Tests
// -------------------------------------------------------------------------

#[test]
fn test_top_10() {
    let mut cf = CfWriter::new();
    cf.add_top_n("A1:A100", 10, CfStyle::with_dxf_id(2));

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"top10\""));
    assert!(xml.contains("dxfId=\"2\""));
    assert!(xml.contains("rank=\"10\""));
    assert!(!xml.contains("bottom=\"1\""));
    assert!(!xml.contains("percent=\"1\""));
}

#[test]
fn test_bottom_5() {
    let mut cf = CfWriter::new();
    cf.add_bottom_n("B1:B100", 5, CfStyle::with_dxf_id(3));

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"top10\""));
    assert!(xml.contains("bottom=\"1\""));
    assert!(xml.contains("rank=\"5\""));
}

#[test]
fn test_top_percent() {
    let mut cf = CfWriter::new();
    cf.add_top_percent("C1:C100", 20, CfStyle::default());

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"top10\""));
    assert!(xml.contains("percent=\"1\""));
    assert!(xml.contains("rank=\"20\""));
    assert!(!xml.contains("bottom=\"1\""));
}

#[test]
fn test_bottom_percent() {
    let mut cf = CfWriter::new();
    cf.add_bottom_percent("D1:D100", 10, CfStyle::default());

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("percent=\"1\""));
    assert!(xml.contains("bottom=\"1\""));
    assert!(xml.contains("rank=\"10\""));
}

// -------------------------------------------------------------------------
// Above/Below Average Tests
// -------------------------------------------------------------------------

#[test]
fn test_above_average() {
    let mut cf = CfWriter::new();
    cf.add_above_average("A1:A50", CfStyle::with_dxf_id(4));

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"aboveAverage\""));
    assert!(xml.contains("dxfId=\"4\""));
    assert!(!xml.contains("aboveAverage=\"0\""));
}

#[test]
fn test_below_average() {
    let mut cf = CfWriter::new();
    cf.add_below_average("B1:B50", CfStyle::with_dxf_id(5));

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"aboveAverage\""));
    assert!(xml.contains("aboveAverage=\"0\""));
}

// -------------------------------------------------------------------------
// Expression/Formula Tests
// -------------------------------------------------------------------------

#[test]
fn test_expression_rule() {
    let mut cf = CfWriter::new();
    cf.add_formula("A1:A10", "A1>B1", CfStyle::default());

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"expression\""));
    // Note: > is escaped to &gt; in XML text content
    assert!(xml.contains("<formula>A1&gt;B1</formula>"));
}

// -------------------------------------------------------------------------
// Text Rule Tests
// -------------------------------------------------------------------------

#[test]
fn test_contains_text() {
    let mut cf = CfWriter::new();
    cf.add_contains_text("A1:A10", "error", CfStyle::with_dxf_id(6));

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"containsText\""));
    assert!(xml.contains("text=\"error\""));
    assert!(xml.contains("<formula>NOT(ISERROR(SEARCH(\"error\",A1)))</formula>"));
}

#[test]
fn test_begins_with() {
    let mut cf = CfWriter::new();
    cf.add_begins_with("B1:B10", "Mr.", CfStyle::default());

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"beginsWith\""));
    assert!(xml.contains("text=\"Mr.\""));
    assert!(xml.contains("<formula>LEFT(A1,3)=\"Mr.\"</formula>"));
}

#[test]
fn test_ends_with() {
    let mut cf = CfWriter::new();
    cf.add_ends_with("C1:C10", ".com", CfStyle::default());

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"endsWith\""));
    assert!(xml.contains("text=\".com\""));
    assert!(xml.contains("<formula>RIGHT(A1,4)=\".com\"</formula>"));
}

// -------------------------------------------------------------------------
// Simple Rule Tests
// -------------------------------------------------------------------------

#[test]
fn test_duplicate_values() {
    let mut cf = CfWriter::new();
    cf.add_duplicate_values("A1:A100", CfStyle::default());

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"duplicateValues\""));
}

#[test]
fn test_unique_values() {
    let mut cf = CfWriter::new();
    cf.add_unique_values("A1:A100", CfStyle::default());

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"uniqueValues\""));
}

#[test]
fn test_contains_blanks() {
    let mut cf = CfWriter::new();
    cf.add_contains_blanks("A1:A100", CfStyle::default());

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"containsBlanks\""));
}

#[test]
fn test_contains_errors() {
    let mut cf = CfWriter::new();
    cf.add_contains_errors("A1:A100", CfStyle::default());

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"containsErrors\""));
}

// -------------------------------------------------------------------------
// Time Period Tests
// -------------------------------------------------------------------------

#[test]
fn test_time_period_today() {
    let mut cf = CfWriter::new();
    cf.add_time_period("A1:A10", CfTimePeriod::Today, CfStyle::default());

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("type=\"timePeriod\""));
    assert!(xml.contains("timePeriod=\"today\""));
}

#[test]
fn test_time_period_last_week() {
    let mut cf = CfWriter::new();
    cf.add_time_period("B1:B10", CfTimePeriod::LastWeek, CfStyle::default());

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    assert!(xml.contains("timePeriod=\"lastWeek\""));
}

// -------------------------------------------------------------------------
// Multiple Rules Tests
// -------------------------------------------------------------------------

#[test]
fn test_multiple_rules_same_range() {
    let mut cf = CfWriter::new();
    cf.add_cell_is(
        "A1:A10",
        CfOperator::GreaterThan,
        "100",
        CfStyle::with_dxf_id(0),
    );
    cf.add_cell_is("A1:A10", CfOperator::LessThan, "0", CfStyle::with_dxf_id(1));

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    // Should have only one conditionalFormatting block
    let cf_count = xml.matches("<conditionalFormatting").count();
    assert_eq!(cf_count, 1);

    // But two cfRule elements
    let rule_count = xml.matches("<cfRule").count();
    assert_eq!(rule_count, 2);

    // With different priorities
    assert!(xml.contains("priority=\"1\""));
    assert!(xml.contains("priority=\"2\""));
}

#[test]
fn test_multiple_ranges() {
    let mut cf = CfWriter::new();
    cf.add_color_scale_2("A1:A10", "FFF8696B", "FF63BE7B");
    cf.add_data_bar("B1:B10", "FF638EC6");
    cf.add_icon_set("C1:C10", IconSetType::ThreeArrows);

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    // Should have three conditionalFormatting blocks
    let cf_count = xml.matches("<conditionalFormatting").count();
    assert_eq!(cf_count, 3);

    assert!(xml.contains("sqref=\"A1:A10\""));
    assert!(xml.contains("sqref=\"B1:B10\""));
    assert!(xml.contains("sqref=\"C1:C10\""));
}

// -------------------------------------------------------------------------
// Priority Tests
// -------------------------------------------------------------------------

#[test]
fn test_priority_ordering() {
    let mut cf = CfWriter::new();
    cf.add_cell_is("A1:A10", CfOperator::GreaterThan, "100", CfStyle::default());
    cf.add_cell_is("B1:B10", CfOperator::LessThan, "0", CfStyle::default());
    cf.add_cell_is("C1:C10", CfOperator::Equal, "50", CfStyle::default());

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    // Priorities should be 1, 2, 3 in order
    let p1_pos = xml.find("priority=\"1\"").unwrap();
    let p2_pos = xml.find("priority=\"2\"").unwrap();
    let p3_pos = xml.find("priority=\"3\"").unwrap();

    assert!(p1_pos < p2_pos);
    assert!(p2_pos < p3_pos);
}

// -------------------------------------------------------------------------
// Utility Method Tests
// -------------------------------------------------------------------------

#[test]
fn test_is_empty() {
    let cf = CfWriter::new();
    assert!(cf.is_empty());

    let mut cf2 = CfWriter::new();
    cf2.add_cell_is("A1:A10", CfOperator::GreaterThan, "0", CfStyle::default());
    assert!(!cf2.is_empty());
}

#[test]
fn test_len() {
    let mut cf = CfWriter::new();
    assert_eq!(cf.len(), 0);

    cf.add_cell_is("A1:A10", CfOperator::GreaterThan, "0", CfStyle::default());
    assert_eq!(cf.len(), 1);

    cf.add_data_bar("B1:B10", "FF0000");
    assert_eq!(cf.len(), 2);
}

#[test]
fn test_rule_count() {
    let mut cf = CfWriter::new();
    assert_eq!(cf.rule_count(), 0);

    cf.add_cell_is("A1:A10", CfOperator::GreaterThan, "0", CfStyle::default());
    cf.add_cell_is("A1:A10", CfOperator::LessThan, "100", CfStyle::default());
    assert_eq!(cf.rule_count(), 2);
    assert_eq!(cf.len(), 1); // Still one block

    cf.add_data_bar("B1:B10", "FF0000");
    assert_eq!(cf.rule_count(), 3);
    assert_eq!(cf.len(), 2); // Two blocks now
}

// -------------------------------------------------------------------------
// CfStyle Tests
// -------------------------------------------------------------------------

#[test]
fn test_cf_style_with_dxf_id() {
    let style = CfStyle::with_dxf_id(5);
    assert_eq!(style.dxf_id, Some(5));
}

#[test]
fn test_cf_style_with_fill() {
    let style = CfStyle::with_fill("FFFF0000");
    assert_eq!(style.fill_color, Some("FFFF0000".to_string()));
    assert_eq!(style.fill_pattern, Some("solid".to_string()));
}

#[test]
fn test_cf_style_with_font_color() {
    let style = CfStyle::with_font_color("FF0000FF");
    assert_eq!(style.font_color, Some("FF0000FF".to_string()));
}

// -------------------------------------------------------------------------
// CfValueObject Tests
// -------------------------------------------------------------------------

#[test]
fn test_cf_value_object_min() {
    let vo = CfValueObject::min("FFFF0000");
    assert_eq!(vo.value_type, CfvoType::Min);
    assert!(vo.value.is_none());
    assert_eq!(vo.color, "FFFF0000");
}

#[test]
fn test_cf_value_object_max() {
    let vo = CfValueObject::max("FF00FF00");
    assert_eq!(vo.value_type, CfvoType::Max);
    assert!(vo.value.is_none());
    assert_eq!(vo.color, "FF00FF00");
}

#[test]
fn test_cf_value_object_percent() {
    let vo = CfValueObject::percent(50, "FFFFFF00");
    assert_eq!(vo.value_type, CfvoType::Percent);
    assert_eq!(vo.value, Some("50".to_string()));
    assert_eq!(vo.color, "FFFFFF00");
}

#[test]
fn test_cf_value_object_num() {
    let vo = CfValueObject::num("100", "FF0000FF");
    assert_eq!(vo.value_type, CfvoType::Num);
    assert_eq!(vo.value, Some("100".to_string()));
    assert_eq!(vo.color, "FF0000FF");
}

// -------------------------------------------------------------------------
// IconSetType Tests
// -------------------------------------------------------------------------

#[test]
fn test_icon_set_num_icons() {
    assert_eq!(IconSetType::ThreeArrows.num_icons(), 3);
    assert_eq!(IconSetType::FourArrows.num_icons(), 4);
    assert_eq!(IconSetType::FiveArrows.num_icons(), 5);
    assert_eq!(IconSetType::ThreeTrafficLights1.num_icons(), 3);
    assert_eq!(IconSetType::FourRating.num_icons(), 4);
    assert_eq!(IconSetType::FiveQuarters.num_icons(), 5);
}

// -------------------------------------------------------------------------
// Integration Test
// -------------------------------------------------------------------------

#[test]
fn test_comprehensive_conditional_formatting() {
    let mut cf = CfWriter::new();

    // Add various rule types
    cf.add_cell_is(
        "A1:A10",
        CfOperator::GreaterThan,
        "100",
        CfStyle::with_dxf_id(0),
    );
    cf.add_color_scale_3("B1:B10", "FFF8696B", "FFFFEB84", "FF63BE7B");
    cf.add_data_bar("C1:C10", "FF638EC6");
    cf.add_icon_set("D1:D10", IconSetType::ThreeArrows);
    cf.add_top_n("E1:E100", 10, CfStyle::with_dxf_id(1));
    cf.add_above_average("F1:F50", CfStyle::with_dxf_id(2));
    cf.add_contains_text("G1:G10", "error", CfStyle::with_dxf_id(3));
    cf.add_duplicate_values("H1:H100", CfStyle::default());
    cf.add_time_period("I1:I10", CfTimePeriod::Today, CfStyle::default());

    let mut writer = XmlWriter::new();
    cf.write_to(&mut writer);
    let xml = writer.finish_string();

    // Verify all rule types are present
    assert!(xml.contains("type=\"cellIs\""));
    assert!(xml.contains("type=\"colorScale\""));
    assert!(xml.contains("type=\"dataBar\""));
    assert!(xml.contains("type=\"iconSet\""));
    assert!(xml.contains("type=\"top10\""));
    assert!(xml.contains("type=\"aboveAverage\""));
    assert!(xml.contains("type=\"containsText\""));
    assert!(xml.contains("type=\"duplicateValues\""));
    assert!(xml.contains("type=\"timePeriod\""));

    // Verify structure
    assert_eq!(cf.len(), 9);
    assert_eq!(cf.rule_count(), 9);
}
