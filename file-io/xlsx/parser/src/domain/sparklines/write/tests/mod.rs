use super::constants::SPARKLINE_EXT_URI;
use super::ooxml::{write_sparkline, write_sparkline_group};
use super::*;
use crate::write::xml_writer::XmlWriter;

// -------------------------------------------------------------------------
// SparklineType tests
// -------------------------------------------------------------------------

#[test]
fn test_sparkline_type_as_str() {
    assert_eq!(SparklineType::Line.to_ooxml(), "line");
    assert_eq!(SparklineType::Column.to_ooxml(), "column");
    assert_eq!(SparklineType::WinLoss.to_ooxml(), "stacked");
}

#[test]
fn test_sparkline_type_default() {
    let st: SparklineType = Default::default();
    assert_eq!(st, SparklineType::Line);
}

// -------------------------------------------------------------------------
// SparklineAxisType tests
// -------------------------------------------------------------------------

#[test]
fn test_sparkline_axis_type_as_str() {
    assert_eq!(SparklineAxisType::Individual.to_ooxml(), "individual");
    assert_eq!(SparklineAxisType::Group.to_ooxml(), "group");
    assert_eq!(SparklineAxisType::Custom.to_ooxml(), "custom");
}

#[test]
fn test_sparkline_axis_type_default() {
    let at: SparklineAxisType = Default::default();
    assert_eq!(at, SparklineAxisType::Individual);
}

// -------------------------------------------------------------------------
// DisplayEmptyCellsAs tests
// -------------------------------------------------------------------------

#[test]
fn test_display_empty_cells_as_str() {
    assert_eq!(DisplayEmptyCellsAs::Gap.to_ooxml(), "gap");
    assert_eq!(DisplayEmptyCellsAs::Zero.to_ooxml(), "zero");
    assert_eq!(DisplayEmptyCellsAs::Span.to_ooxml(), "span");
}

#[test]
fn test_display_empty_cells_default() {
    let de: DisplayEmptyCellsAs = Default::default();
    assert_eq!(de, DisplayEmptyCellsAs::Gap);
}

// -------------------------------------------------------------------------
// Sparkline tests
// -------------------------------------------------------------------------

#[test]
fn test_sparkline_new() {
    let sparkline = Sparkline::new("Sheet1!A1:A10", "B1");
    assert_eq!(sparkline.data_range, "Sheet1!A1:A10");
    assert_eq!(sparkline.location, "B1");
}

#[test]
fn test_sparkline_write() {
    let sparkline = Sparkline::new("Sheet1!A1:A10", "B1");
    let mut writer = XmlWriter::new();
    write_sparkline(&sparkline, &mut writer);
    let xml = String::from_utf8(writer.finish()).unwrap();

    assert!(xml.contains("<x14:sparkline>"));
    assert!(xml.contains("<xm:f>Sheet1!A1:A10</xm:f>"));
    assert!(xml.contains("<xm:sqref>B1</xm:sqref>"));
    assert!(xml.contains("</x14:sparkline>"));
}

// -------------------------------------------------------------------------
// SparklineGroupBuilder tests
// -------------------------------------------------------------------------

#[test]
fn test_sparkline_group_new() {
    let group = SparklineGroupBuilder::new(SparklineType::Column).build();
    assert_eq!(group.sparkline_type, SparklineType::Column);
    assert!(group.sparklines.is_empty());
}

#[test]
fn test_sparkline_group_builder() {
    let mut builder = SparklineGroupBuilder::new(SparklineType::Line);
    builder
        .add("Sheet1!A1:A10", "B1")
        .add("Sheet1!A2:A11", "B2")
        .show_markers(true)
        .show_high_point(true)
        .show_low_point(true)
        .show_first_point(true)
        .show_last_point(true)
        .show_negative_points(true)
        .show_x_axis(true)
        .color("FF376092")
        .negative_color("FFD00000")
        .marker_color("FF0000FF");
    let group = builder.build();

    assert_eq!(group.sparklines.len(), 2);
    assert!(group.markers);
    assert!(group.high);
    assert!(group.low);
    assert!(group.first);
    assert!(group.last);
    assert!(group.negative);
    assert!(group.display_x_axis);
    assert_eq!(
        group.color_series.as_ref().unwrap().rgb,
        Some("FF376092".to_string())
    );
    assert_eq!(
        group.color_negative.as_ref().unwrap().rgb,
        Some("FFD00000".to_string())
    );
    assert_eq!(
        group.color_markers.as_ref().unwrap().rgb,
        Some("FF0000FF".to_string())
    );
}

#[test]
fn test_sparkline_group_axis_settings() {
    let mut builder = SparklineGroupBuilder::new(SparklineType::Line);
    builder.set_axis_range(-100.0, 100.0);
    let group = builder.build();

    assert_eq!(group.min_axis_type, SparklineAxisType::Custom);
    assert_eq!(group.max_axis_type, SparklineAxisType::Custom);
    assert_eq!(group.manual_min, Some(-100.0));
    assert_eq!(group.manual_max, Some(100.0));
}

#[test]
fn test_sparkline_group_line_weight() {
    let mut builder = SparklineGroupBuilder::new(SparklineType::Line);
    builder.line_weight(0.75);
    let group = builder.build();

    assert_eq!(group.line_weight, Some(0.75));
}

#[test]
fn test_sparkline_group_all_colors() {
    let mut builder = SparklineGroupBuilder::new(SparklineType::Line);
    builder
        .color("FF000001")
        .negative_color("FF000002")
        .axis_color("FF000003")
        .marker_color("FF000004")
        .first_color("FF000005")
        .last_color("FF000006")
        .high_color("FF000007")
        .low_color("FF000008");
    let group = builder.build();

    assert_eq!(
        group.color_series.as_ref().unwrap().rgb,
        Some("FF000001".to_string())
    );
    assert_eq!(
        group.color_negative.as_ref().unwrap().rgb,
        Some("FF000002".to_string())
    );
    assert_eq!(
        group.color_axis.as_ref().unwrap().rgb,
        Some("FF000003".to_string())
    );
    assert_eq!(
        group.color_markers.as_ref().unwrap().rgb,
        Some("FF000004".to_string())
    );
    assert_eq!(
        group.color_first.as_ref().unwrap().rgb,
        Some("FF000005".to_string())
    );
    assert_eq!(
        group.color_last.as_ref().unwrap().rgb,
        Some("FF000006".to_string())
    );
    assert_eq!(
        group.color_high.as_ref().unwrap().rgb,
        Some("FF000007".to_string())
    );
    assert_eq!(
        group.color_low.as_ref().unwrap().rgb,
        Some("FF000008".to_string())
    );
}

#[test]
fn test_sparkline_group_display_options() {
    let mut builder = SparklineGroupBuilder::new(SparklineType::Line);
    builder
        .display_empty_cells_as(DisplayEmptyCellsAs::Zero)
        .show_hidden(true)
        .right_to_left(true);
    let group = builder.build();

    assert_eq!(group.display_empty_cells_as, DisplayEmptyCellsAs::Zero);
    assert!(group.display_hidden);
    assert!(group.right_to_left);
}

#[test]
fn test_sparkline_group_write_line() {
    let mut builder = SparklineGroupBuilder::new(SparklineType::Line);
    builder.add("Sheet1!A1:A10", "B1").color("FF376092");
    let group = builder.build();

    let mut writer = XmlWriter::new();
    write_sparkline_group(&group, &mut writer);
    let xml = String::from_utf8(writer.finish()).unwrap();

    assert!(xml.contains("<x14:sparklineGroup>"));
    // Line is default, so type attribute should be omitted
    assert!(!xml.contains("type=\"line\""));
    assert!(xml.contains("<x14:colorSeries rgb=\"FF376092\"/>"));
    assert!(xml.contains("<x14:sparklines>"));
    assert!(xml.contains("<x14:sparkline>"));
    assert!(xml.contains("</x14:sparklineGroup>"));
}

#[test]
fn test_sparkline_group_write_column() {
    let mut builder = SparklineGroupBuilder::new(SparklineType::Column);
    builder.add("Sheet1!A1:A10", "B1");
    let group = builder.build();

    let mut writer = XmlWriter::new();
    write_sparkline_group(&group, &mut writer);
    let xml = String::from_utf8(writer.finish()).unwrap();

    assert!(xml.contains("type=\"column\""));
}

#[test]
fn test_sparkline_group_write_winloss() {
    let mut builder = SparklineGroupBuilder::new(SparklineType::WinLoss);
    builder.add("Sheet1!A1:A10", "B1");
    let group = builder.build();

    let mut writer = XmlWriter::new();
    write_sparkline_group(&group, &mut writer);
    let xml = String::from_utf8(writer.finish()).unwrap();

    assert!(xml.contains("type=\"stacked\""));
}

#[test]
fn test_sparkline_group_write_markers() {
    let mut builder = SparklineGroupBuilder::new(SparklineType::Line);
    builder
        .add("Sheet1!A1:A10", "B1")
        .show_markers(true)
        .show_high_point(true)
        .show_low_point(true)
        .show_first_point(true)
        .show_last_point(true)
        .show_negative_points(true);
    let group = builder.build();

    let mut writer = XmlWriter::new();
    write_sparkline_group(&group, &mut writer);
    let xml = String::from_utf8(writer.finish()).unwrap();

    assert!(xml.contains("markers=\"1\""));
    assert!(xml.contains("high=\"1\""));
    assert!(xml.contains("low=\"1\""));
    assert!(xml.contains("first=\"1\""));
    assert!(xml.contains("last=\"1\""));
    assert!(xml.contains("negative=\"1\""));
}

#[test]
fn test_sparkline_group_write_display_options() {
    let mut builder = SparklineGroupBuilder::new(SparklineType::Line);
    builder
        .add("Sheet1!A1:A10", "B1")
        .display_empty_cells_as(DisplayEmptyCellsAs::Zero)
        .show_x_axis(true)
        .show_hidden(true)
        .right_to_left(true);
    let group = builder.build();

    let mut writer = XmlWriter::new();
    write_sparkline_group(&group, &mut writer);
    let xml = String::from_utf8(writer.finish()).unwrap();

    assert!(xml.contains("displayEmptyCellsAs=\"zero\""));
    assert!(xml.contains("displayXAxis=\"1\""));
    assert!(xml.contains("displayHidden=\"1\""));
    assert!(xml.contains("rightToLeft=\"1\""));
}

#[test]
fn test_sparkline_group_write_axis_settings() {
    let mut builder = SparklineGroupBuilder::new(SparklineType::Line);
    builder
        .add("Sheet1!A1:A10", "B1")
        .set_axis_range(-50.5, 100.5);
    let group = builder.build();

    let mut writer = XmlWriter::new();
    write_sparkline_group(&group, &mut writer);
    let xml = String::from_utf8(writer.finish()).unwrap();

    assert!(xml.contains("minAxisType=\"custom\""));
    assert!(xml.contains("maxAxisType=\"custom\""));
    assert!(xml.contains("manualMin=\"-50.5\""));
    assert!(xml.contains("manualMax=\"100.5\""));
}

#[test]
fn test_sparkline_group_write_line_weight() {
    let mut builder = SparklineGroupBuilder::new(SparklineType::Line);
    builder.add("Sheet1!A1:A10", "B1").line_weight(0.75);
    let group = builder.build();

    let mut writer = XmlWriter::new();
    write_sparkline_group(&group, &mut writer);
    let xml = String::from_utf8(writer.finish()).unwrap();

    assert!(xml.contains("lineWeight=\"0.75\""));
}

#[test]
fn test_sparkline_group_write_all_colors() {
    let mut builder = SparklineGroupBuilder::new(SparklineType::Line);
    builder
        .add("Sheet1!A1:A10", "B1")
        .color("FF000001")
        .negative_color("FF000002")
        .axis_color("FF000003")
        .marker_color("FF000004")
        .first_color("FF000005")
        .last_color("FF000006")
        .high_color("FF000007")
        .low_color("FF000008");
    let group = builder.build();

    let mut writer = XmlWriter::new();
    write_sparkline_group(&group, &mut writer);
    let xml = String::from_utf8(writer.finish()).unwrap();

    assert!(xml.contains("<x14:colorSeries rgb=\"FF000001\"/>"));
    assert!(xml.contains("<x14:colorNegative rgb=\"FF000002\"/>"));
    assert!(xml.contains("<x14:colorAxis rgb=\"FF000003\"/>"));
    assert!(xml.contains("<x14:colorMarkers rgb=\"FF000004\"/>"));
    assert!(xml.contains("<x14:colorFirst rgb=\"FF000005\"/>"));
    assert!(xml.contains("<x14:colorLast rgb=\"FF000006\"/>"));
    assert!(xml.contains("<x14:colorHigh rgb=\"FF000007\"/>"));
    assert!(xml.contains("<x14:colorLow rgb=\"FF000008\"/>"));
}

#[test]
fn test_sparkline_group_multiple_sparklines() {
    let mut builder = SparklineGroupBuilder::new(SparklineType::Column);
    builder
        .add("Sheet1!A1:A10", "B1")
        .add("Sheet1!A2:A11", "B2")
        .add("Sheet1!A3:A12", "B3");
    let group = builder.build();

    let mut writer = XmlWriter::new();
    write_sparkline_group(&group, &mut writer);
    let xml = String::from_utf8(writer.finish()).unwrap();

    assert_eq!(xml.matches("<x14:sparkline>").count(), 3);
    assert!(xml.contains("<xm:sqref>B1</xm:sqref>"));
    assert!(xml.contains("<xm:sqref>B2</xm:sqref>"));
    assert!(xml.contains("<xm:sqref>B3</xm:sqref>"));
}

// -------------------------------------------------------------------------
// SparklinesWriter tests
// -------------------------------------------------------------------------

#[test]
fn test_sparklines_writer_new() {
    let writer = SparklinesWriter::new();
    assert!(writer.is_empty());
    assert_eq!(writer.len(), 0);
}

#[test]
fn test_sparklines_writer_add_line() {
    let mut writer = SparklinesWriter::new();
    writer.add_line("Sheet1!A1:A10", "B1");

    assert_eq!(writer.len(), 1);
    assert!(!writer.is_empty());
    assert_eq!(writer.groups()[0].sparkline_type, SparklineType::Line);
}

#[test]
fn test_sparklines_writer_add_column() {
    let mut writer = SparklinesWriter::new();
    writer.add_column("Sheet1!A1:A10", "B1");

    assert_eq!(writer.len(), 1);
    assert_eq!(writer.groups()[0].sparkline_type, SparklineType::Column);
}

#[test]
fn test_sparklines_writer_add_winloss() {
    let mut writer = SparklinesWriter::new();
    writer.add_winloss("Sheet1!A1:A10", "B1");

    assert_eq!(writer.len(), 1);
    assert_eq!(writer.groups()[0].sparkline_type, SparklineType::WinLoss);
}

#[test]
fn test_sparklines_writer_add_group() {
    let mut writer = SparklinesWriter::new();

    let mut builder = SparklineGroupBuilder::new(SparklineType::Line);
    builder.add("Sheet1!A1:A10", "B1").show_markers(true);

    writer.add_group(builder.build());

    assert_eq!(writer.len(), 1);
    assert!(writer.groups()[0].markers);
}

#[test]
fn test_sparklines_writer_empty_produces_no_output() {
    let writer = SparklinesWriter::new();
    let xml = writer.to_xml();
    assert!(xml.is_empty());
}

#[test]
fn test_sparklines_writer_write_structure() {
    let mut writer = SparklinesWriter::new();
    writer.add_line("Sheet1!A1:A10", "B1");

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    // Check structure
    assert!(xml.contains("<extLst>"));
    assert!(xml.contains("<ext xmlns:x14="));
    assert!(xml.contains(&format!("uri=\"{}\"", SPARKLINE_EXT_URI)));
    assert!(xml.contains("<x14:sparklineGroups xmlns:xm="));
    assert!(xml.contains("</x14:sparklineGroups>"));
    assert!(xml.contains("</ext>"));
    assert!(xml.contains("</extLst>"));
}

#[test]
fn test_sparklines_writer_multiple_groups() {
    let mut writer = SparklinesWriter::new();
    writer
        .add_line("Sheet1!A1:A10", "B1")
        .add_column("Sheet1!C1:C10", "D1")
        .add_winloss("Sheet1!E1:E10", "F1");

    assert_eq!(writer.len(), 3);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    // Check all types are present
    assert!(xml.contains("type=\"column\""));
    assert!(xml.contains("type=\"stacked\""));
    // Line is default, so no explicit type attribute
    // Count opening tags only (not sparklineGroups)
    assert_eq!(
        xml.matches("<x14:sparklineGroup>").count() + xml.matches("<x14:sparklineGroup ").count(),
        3
    );
}

// -------------------------------------------------------------------------
// Integration tests
// -------------------------------------------------------------------------

#[test]
fn test_complete_sparkline_xml() {
    let mut writer = SparklinesWriter::new();

    // Create a line sparkline group with all options
    let mut line_builder = SparklineGroupBuilder::new(SparklineType::Line);
    line_builder
        .add("Sheet1!A1:A10", "B1")
        .add("Sheet1!A2:A11", "B2")
        .show_markers(true)
        .show_high_point(true)
        .show_low_point(true)
        .show_first_point(true)
        .show_last_point(true)
        .show_negative_points(true)
        .show_x_axis(true)
        .display_empty_cells_as(DisplayEmptyCellsAs::Gap)
        .line_weight(0.75)
        .color("FF376092")
        .negative_color("FFD00000")
        .axis_color("FF000000")
        .marker_color("FFD00000")
        .first_color("FFD00000")
        .last_color("FFD00000")
        .high_color("FFD00000")
        .low_color("FFD00000");
    writer.add_group(line_builder.build());

    // Add a column sparkline
    let mut column_builder = SparklineGroupBuilder::new(SparklineType::Column);
    column_builder
        .add("Sheet1!C1:C10", "D1")
        .display_empty_cells_as(DisplayEmptyCellsAs::Zero)
        .color("FF638EC6")
        .negative_color("FFD00000");
    writer.add_group(column_builder.build());

    // Add a win/loss sparkline
    let mut winloss_builder = SparklineGroupBuilder::new(SparklineType::WinLoss);
    winloss_builder
        .add("Sheet1!E1:E10", "F1")
        .display_empty_cells_as(DisplayEmptyCellsAs::Span);
    writer.add_group(winloss_builder.build());

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    // Verify structure
    assert!(xml.contains("<extLst>"));
    assert!(xml.contains("<x14:sparklineGroups"));
    // Count opening tags only (not sparklineGroups)
    assert_eq!(
        xml.matches("<x14:sparklineGroup>").count() + xml.matches("<x14:sparklineGroup ").count(),
        3
    );

    // Verify line group
    assert!(xml.contains("markers=\"1\""));
    assert!(xml.contains("high=\"1\""));
    assert!(xml.contains("low=\"1\""));
    assert!(xml.contains("lineWeight=\"0.75\""));
    assert!(xml.contains("<x14:colorSeries rgb=\"FF376092\"/>"));

    // Verify column group
    assert!(xml.contains("type=\"column\""));
    assert!(xml.contains("displayEmptyCellsAs=\"zero\""));

    // Verify win/loss group
    assert!(xml.contains("type=\"stacked\""));
    assert!(xml.contains("displayEmptyCellsAs=\"span\""));
}

#[test]
fn test_sparklines_writer_axis_range() {
    let mut writer = SparklinesWriter::new();

    let mut builder = SparklineGroupBuilder::new(SparklineType::Line);
    builder
        .add("Sheet1!A1:A10", "B1")
        .set_axis_range(-100.0, 100.0);
    writer.add_group(builder.build());

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("minAxisType=\"custom\""));
    assert!(xml.contains("maxAxisType=\"custom\""));
    assert!(xml.contains("manualMin=\"-100\""));
    assert!(xml.contains("manualMax=\"100\""));
}

#[test]
fn test_sparklines_default_attributes_omitted() {
    let mut writer = SparklinesWriter::new();

    // Create minimal group with defaults
    let mut builder = SparklineGroupBuilder::new(SparklineType::Line);
    builder.add("Sheet1!A1:A10", "B1");
    writer.add_group(builder.build());

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    // These should NOT be present (defaults)
    assert!(!xml.contains("type=\"line\"")); // Line is default
    assert!(!xml.contains("displayEmptyCellsAs=\"gap\"")); // Gap is default
    assert!(!xml.contains("minAxisType=\"individual\"")); // Individual is default
    assert!(!xml.contains("maxAxisType=\"individual\"")); // Individual is default
    assert!(!xml.contains("markers=\"0\"")); // False booleans not written
    assert!(!xml.contains("high=\"0\""));
}
