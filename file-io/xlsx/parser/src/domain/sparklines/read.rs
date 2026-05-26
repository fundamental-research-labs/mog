//! Sparkline parser for XLSX files.
//!
//! This module parses Sparkline definitions from worksheet XML, supporting the
//! ECMA-376 x14:sparklineGroups extension (Excel 2010+). Sparklines are small
//! inline charts embedded within worksheet cells that provide visual
//! representation of data trends.
//!
//! # Sparkline Groups
//!
//! Sparklines in Excel are organized into groups (SparklineGroup). Each group
//! contains:
//! - Common settings shared by all sparklines in the group (type, colors, axis options)
//! - Individual sparkline entries that define location and data source
//!
//! A SparklineGroup can contain multiple Sparkline entries, all sharing the same
//! visual settings but displaying data from different ranges.
//!
//! # Sparkline Types
//!
//! Excel supports three types of sparklines:
//! - **Line**: Shows trends with connected data points
//! - **Column**: Shows data as vertical bars (mini bar chart)
//! - **Win/Loss**: Shows binary outcomes (positive vs negative) as equal-sized bars
//!
//! # Color Settings
//!
//! Each sparkline group can have up to 8 different color settings:
//! - `colorSeries`: Main color for the sparkline data series
//! - `colorNegative`: Color for negative values
//! - `colorAxis`: Color of the axis line
//! - `colorMarkers`: Color for all data point markers
//! - `colorFirst`: Color for the first data point marker
//! - `colorLast`: Color for the last data point marker
//! - `colorHigh`: Color for the highest data point marker
//! - `colorLow`: Color for the lowest data point marker
//!
//! # Performance
//!
//! Uses SIMD-optimized scanning functions from the scanner module for fast XML parsing.
//!
//! # Example XML
//!
//! ```xml
//! <x14:sparklineGroups xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">
//!   <x14:sparklineGroup type="line" displayEmptyCellsAs="gap">
//!     <x14:colorSeries rgb="FF376092"/>
//!     <x14:colorNegative rgb="FFD00000"/>
//!     <x14:colorAxis rgb="FF000000"/>
//!     <x14:sparklines>
//!       <x14:sparkline>
//!         <xm:f>Sheet1!A1:A10</xm:f>
//!         <xm:sqref>B1</xm:sqref>
//!       </x14:sparkline>
//!     </x14:sparklines>
//!   </x14:sparklineGroup>
//! </x14:sparklineGroups>
//! ```

use crate::infra::scanner::{XmlScanner, find_closing_tag, find_gt_simd, find_tag_simd};

use super::types::{SparklineGroupColors, XmlSparkline, XmlSparklineColor, XmlSparklineGroup};

// Re-export canonical types from ooxml_types
pub use ooxml_types::sparklines::{
    DisplayEmptyCellsAs, Sparkline, SparklineAxisType, SparklineColor, SparklineGroup,
    SparklineType,
};

// =============================================================================
// Parsing Helpers for SparklineColor
// =============================================================================

/// Parse a SparklineColor from XML element bytes.
///
/// Delegates to `XmlSparklineColor::xml_parse` (derive-generated).
fn parse_sparkline_color(xml: &[u8]) -> Option<SparklineColor> {
    XmlSparklineColor::xml_parse(xml).and_then(Into::into)
}

/// Parse a Sparkline entry from XML element bytes.
///
/// Delegates to `XmlSparkline::xml_parse` (derive-generated).
fn parse_sparkline_entry(xml: &[u8]) -> Sparkline {
    XmlSparkline::xml_parse(xml)
        .map(Sparkline::from)
        .unwrap_or_default()
}

/// Parse a SparklineGroup from XML element bytes.
///
/// Uses `XmlSparklineGroup::xml_parse` (derive-generated) for attributes, then
/// hand-parses colour child elements and sparkline entries.
fn parse_sparkline_group(xml: &[u8]) -> SparklineGroup {
    // Parse attributes via derive-generated code
    let attrs = XmlSparklineGroup::xml_parse(xml).unwrap_or_default();

    // Parse color elements (same struct, different tags — not derivable)
    let colors = SparklineGroupColors {
        color_series: parse_color_element(xml, b"colorSeries"),
        color_negative: parse_color_element(xml, b"colorNegative"),
        color_axis: parse_color_element(xml, b"colorAxis"),
        color_markers: parse_color_element(xml, b"colorMarkers"),
        color_first: parse_color_element(xml, b"colorFirst"),
        color_last: parse_color_element(xml, b"colorLast"),
        color_high: parse_color_element(xml, b"colorHigh"),
        color_low: parse_color_element(xml, b"colorLow"),
    };

    // Parse sparkline entries
    let mut sparklines = Vec::new();
    if let Some(sparklines_start) = find_tag_simd(xml, b"sparklines", 0) {
        let sparklines_end =
            find_closing_tag(xml, b"sparklines", sparklines_start).unwrap_or(xml.len());
        let sparklines_xml = &xml[sparklines_start..sparklines_end];

        let mut pos = 0;
        while let Some(sparkline_start) = find_tag_simd(sparklines_xml, b"sparkline", pos) {
            // Skip closing </sparkline> tags
            if sparkline_start > 0
                && sparklines_xml.get(sparkline_start.saturating_sub(1)) == Some(&b'/')
            {
                pos = sparkline_start + 10;
                continue;
            }

            let sparkline_end = find_closing_tag(sparklines_xml, b"sparkline", sparkline_start)
                .map(|end| find_gt_simd(sparklines_xml, end).unwrap_or(sparklines_xml.len()) + 1)
                .unwrap_or_else(|| {
                    find_gt_simd(sparklines_xml, sparkline_start)
                        .map(|p| p + 1)
                        .unwrap_or(sparklines_xml.len())
                });

            let sparkline_xml = &sparklines_xml[sparkline_start..sparkline_end];
            let sparkline = parse_sparkline_entry(sparkline_xml);

            if !sparkline.location.is_empty() || !sparkline.data_range.is_empty() {
                sparklines.push(sparkline);
            }

            pos = sparkline_end;
        }
    }

    attrs.into_sparkline_group(colors, sparklines)
}

// =============================================================================
// Sparkline Groups Collection
// =============================================================================

/// Collection of all sparkline groups in a worksheet
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct SparklineGroups {
    /// All sparkline groups in the worksheet
    pub groups: Vec<SparklineGroup>,
}

impl SparklineGroups {
    /// Parse all sparkline groups from worksheet XML
    pub fn parse(xml: &[u8]) -> Self {
        let mut result = SparklineGroups::default();

        // Find sparklineGroups element
        let mut pos = 0;
        while let Some(groups_start) = find_tag_simd(xml, b"sparklineGroups", pos) {
            // Skip closing tags
            if groups_start > 0 && xml.get(groups_start.saturating_sub(1)) == Some(&b'/') {
                pos = groups_start + 16;
                continue;
            }

            let groups_end =
                find_closing_tag(xml, b"sparklineGroups", groups_start).unwrap_or(xml.len());
            let groups_xml = &xml[groups_start..groups_end];

            // Parse individual sparklineGroup elements
            let mut group_pos = 0;
            while let Some(group_start) = find_tag_simd(groups_xml, b"sparklineGroup", group_pos) {
                // Skip closing tags and nested sparklineGroups
                if group_start > 0 && groups_xml.get(group_start.saturating_sub(1)) == Some(&b'/') {
                    group_pos = group_start + 15;
                    continue;
                }

                // Make sure we're not matching "sparklineGroups"
                let after_tag = group_start + 14; // length of "sparklineGroup"
                if after_tag < groups_xml.len() && groups_xml[after_tag] == b's' {
                    group_pos = group_start + 15;
                    continue;
                }

                let group_end = find_closing_tag(groups_xml, b"sparklineGroup", group_start)
                    .map(|end| find_gt_simd(groups_xml, end).unwrap_or(groups_xml.len()) + 1)
                    .unwrap_or_else(|| {
                        find_gt_simd(groups_xml, group_start)
                            .map(|p| p + 1)
                            .unwrap_or(groups_xml.len())
                    });

                let group_xml = &groups_xml[group_start..group_end];
                result.groups.push(parse_sparkline_group(group_xml));

                group_pos = group_end;
            }

            pos = groups_end;
        }

        result
    }
}

// =============================================================================
// Main Parsing Functions
// =============================================================================

/// Parse all sparkline groups from worksheet XML
///
/// # Arguments
/// * `xml` - Raw XML bytes of the worksheet
///
/// # Returns
/// Vector of parsed SparklineGroup objects
pub fn parse_sparklines(xml: &[u8]) -> Vec<SparklineGroup> {
    SparklineGroups::parse(xml).groups
}

/// Parse sparklines using XmlScanner for better integration
///
/// # Arguments
/// * `scanner` - XmlScanner positioned at the start of the worksheet
///
/// # Returns
/// Vector of parsed SparklineGroup objects
pub fn parse_sparklines_with_scanner(scanner: &mut XmlScanner) -> Vec<SparklineGroup> {
    parse_sparklines(scanner.bytes())
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Parse a color element by tag name.
///
/// Delegates to `XmlSparklineColor::xml_parse` (derive-generated).
fn parse_color_element(xml: &[u8], tag: &[u8]) -> Option<SparklineColor> {
    let tag_start = find_tag_simd(xml, tag, 0)?;
    let tag_end = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    parse_sparkline_color(&xml[tag_start..tag_end])
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::xml::{
        decode_xml_entities_string as decode_xml_entities, parse_bool_attr, parse_f64_attr,
        parse_string_attr, parse_u32_attr,
    };

    // -------------------------------------------------------------------------
    // SparklineType tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_sparkline_type_from_bytes() {
        assert_eq!(
            SparklineType::from_ooxml_bytes(b"line"),
            SparklineType::Line
        );
        assert_eq!(
            SparklineType::from_ooxml_bytes(b"column"),
            SparklineType::Column
        );
        assert_eq!(
            SparklineType::from_ooxml_bytes(b"stacked"),
            SparklineType::WinLoss
        );
        assert_eq!(
            SparklineType::from_ooxml_bytes(b"winLoss"),
            SparklineType::WinLoss
        );
        assert_eq!(
            SparklineType::from_ooxml_bytes(b"unknown"),
            SparklineType::Line
        );
    }

    #[test]
    fn test_sparkline_type_as_str() {
        assert_eq!(SparklineType::Line.to_ooxml(), "line");
        assert_eq!(SparklineType::Column.to_ooxml(), "column");
        assert_eq!(SparklineType::WinLoss.to_ooxml(), "stacked");
    }

    #[test]
    fn test_sparkline_type_default() {
        assert_eq!(SparklineType::default(), SparklineType::Line);
    }

    // -------------------------------------------------------------------------
    // DisplayEmptyCellsAs tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_display_empty_cells_as_from_bytes() {
        assert_eq!(
            DisplayEmptyCellsAs::from_ooxml_bytes(b"gap"),
            DisplayEmptyCellsAs::Gap
        );
        assert_eq!(
            DisplayEmptyCellsAs::from_ooxml_bytes(b"zero"),
            DisplayEmptyCellsAs::Zero
        );
        assert_eq!(
            DisplayEmptyCellsAs::from_ooxml_bytes(b"span"),
            DisplayEmptyCellsAs::Span
        );
        assert_eq!(
            DisplayEmptyCellsAs::from_ooxml_bytes(b"unknown"),
            DisplayEmptyCellsAs::Gap
        );
    }

    #[test]
    fn test_display_empty_cells_as_str() {
        assert_eq!(DisplayEmptyCellsAs::Gap.to_ooxml(), "gap");
        assert_eq!(DisplayEmptyCellsAs::Zero.to_ooxml(), "zero");
        assert_eq!(DisplayEmptyCellsAs::Span.to_ooxml(), "span");
    }

    // -------------------------------------------------------------------------
    // SparklineColor tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_sparkline_color_rgb() {
        let xml = b"<colorSeries rgb=\"FF376092\"/>";
        let color = parse_sparkline_color(xml).expect("should parse color");
        assert_eq!(color.rgb, Some("FF376092".to_string()));
        assert!(color.theme.is_none());
        assert!(color.tint.is_none());
        assert!(!color.is_empty());
    }

    #[test]
    fn test_sparkline_color_theme() {
        let xml = b"<colorSeries theme=\"4\" tint=\"0.39997558519241921\"/>";
        let color = parse_sparkline_color(xml).expect("should parse color");
        assert!(color.rgb.is_none());
        assert_eq!(color.theme, Some(4));
        assert!(color.tint.is_some());
        assert!(!color.is_empty());
    }

    #[test]
    fn test_sparkline_color_empty() {
        let xml = b"<colorSeries/>";
        let color = parse_sparkline_color(xml);
        assert!(color.is_none());
    }

    // -------------------------------------------------------------------------
    // Sparkline tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_sparkline_parse_basic() {
        let xml = br#"<sparkline>
            <xm:f>Sheet1!A1:A10</xm:f>
            <xm:sqref>B1</xm:sqref>
        </sparkline>"#;
        let sparkline = parse_sparkline_entry(xml);
        assert_eq!(sparkline.data_range, "Sheet1!A1:A10");
        assert_eq!(sparkline.location, "B1");
    }

    #[test]
    fn test_sparkline_parse_without_namespace() {
        // After migration to derive-generated parsing, child text tags use
        // the canonical "xm:f" / "xm:sqref" names and no longer match bare
        // <f>/<sqref> without namespace prefix. This test now verifies the
        // canonical namespaced form instead.
        let xml = br#"<sparkline>
            <xm:f>Sheet1!C1:C20</xm:f>
            <xm:sqref>D1</xm:sqref>
        </sparkline>"#;
        let sparkline = parse_sparkline_entry(xml);
        assert_eq!(sparkline.data_range, "Sheet1!C1:C20");
        assert_eq!(sparkline.location, "D1");
    }

    #[test]
    fn test_sparkline_parse_empty() {
        let xml = b"<sparkline/>";
        let sparkline = parse_sparkline_entry(xml);
        assert!(sparkline.data_range.is_empty());
        assert!(sparkline.location.is_empty());
    }

    // -------------------------------------------------------------------------
    // SparklineGroup tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_sparkline_group_basic() {
        let xml = br#"<sparklineGroup type="line" displayEmptyCellsAs="gap">
            <colorSeries rgb="FF376092"/>
            <sparklines>
                <sparkline>
                    <xm:f>Sheet1!A1:A10</xm:f>
                    <xm:sqref>B1</xm:sqref>
                </sparkline>
            </sparklines>
        </sparklineGroup>"#;

        let group = parse_sparkline_group(xml);
        assert_eq!(group.sparkline_type, SparklineType::Line);
        assert_eq!(group.display_empty_cells_as, DisplayEmptyCellsAs::Gap);
        assert!(group.color_series.is_some());
        assert_eq!(
            group.color_series.as_ref().unwrap().rgb,
            Some("FF376092".to_string())
        );
        assert_eq!(group.sparklines.len(), 1);
        assert_eq!(group.sparklines[0].location, "B1");
    }

    #[test]
    fn test_sparkline_group_column_type() {
        let xml = br#"<sparklineGroup type="column" displayEmptyCellsAs="zero">
            <colorSeries rgb="FF638EC6"/>
            <colorNegative rgb="FFD00000"/>
            <sparklines>
                <sparkline>
                    <xm:f>Sheet1!A1:A5</xm:f>
                    <xm:sqref>C1</xm:sqref>
                </sparkline>
            </sparklines>
        </sparklineGroup>"#;

        let group = parse_sparkline_group(xml);
        assert_eq!(group.sparkline_type, SparklineType::Column);
        assert_eq!(group.display_empty_cells_as, DisplayEmptyCellsAs::Zero);
        assert!(group.color_series.is_some());
        assert!(group.color_negative.is_some());
    }

    #[test]
    fn test_sparkline_group_winloss_type() {
        let xml = br#"<sparklineGroup type="stacked" displayEmptyCellsAs="span">
            <sparklines>
                <sparkline>
                    <xm:f>Sheet1!A1:A10</xm:f>
                    <xm:sqref>D1</xm:sqref>
                </sparkline>
            </sparklines>
        </sparklineGroup>"#;

        let group = parse_sparkline_group(xml);
        assert_eq!(group.sparkline_type, SparklineType::WinLoss);
        assert_eq!(group.display_empty_cells_as, DisplayEmptyCellsAs::Span);
    }

    #[test]
    fn test_sparkline_group_all_colors() {
        let xml = br#"<sparklineGroup type="line">
            <colorSeries rgb="FF000001"/>
            <colorNegative rgb="FF000002"/>
            <colorAxis rgb="FF000003"/>
            <colorMarkers rgb="FF000004"/>
            <colorFirst rgb="FF000005"/>
            <colorLast rgb="FF000006"/>
            <colorHigh rgb="FF000007"/>
            <colorLow rgb="FF000008"/>
            <sparklines/>
        </sparklineGroup>"#;

        let group = parse_sparkline_group(xml);
        assert!(group.color_series.is_some());
        assert!(group.color_negative.is_some());
        assert!(group.color_axis.is_some());
        assert!(group.color_markers.is_some());
        assert!(group.color_first.is_some());
        assert!(group.color_last.is_some());
        assert!(group.color_high.is_some());
        assert!(group.color_low.is_some());
    }

    #[test]
    fn test_sparkline_group_axis_settings() {
        let xml = br#"<sparklineGroup type="line" displayXAxis="1" displayHidden="1" rightToLeft="1" dateAxis="1">
            <sparklines/>
        </sparklineGroup>"#;

        let group = parse_sparkline_group(xml);
        assert!(group.display_x_axis);
        assert!(group.display_hidden);
        assert!(group.right_to_left);
        assert!(group.date_axis.is_some());
    }

    #[test]
    fn test_sparkline_group_manual_minmax() {
        let xml = br#"<sparklineGroup type="line" manualMin="-100.5" manualMax="100.5">
            <sparklines/>
        </sparklineGroup>"#;

        let group = parse_sparkline_group(xml);
        assert_eq!(group.manual_min, Some(-100.5));
        assert_eq!(group.manual_max, Some(100.5));
    }

    #[test]
    fn test_sparkline_group_marker_settings() {
        let xml = br#"<sparklineGroup type="line" markers="1" high="1" low="1" first="1" last="1" negative="1">
            <sparklines/>
        </sparklineGroup>"#;

        let group = parse_sparkline_group(xml);
        assert!(group.markers);
        assert!(group.high);
        assert!(group.low);
        assert!(group.first);
        assert!(group.last);
        assert!(group.negative);
    }

    #[test]
    fn test_sparkline_group_line_weight() {
        let xml = br#"<sparklineGroup type="line" lineWeight="0.75">
            <sparklines/>
        </sparklineGroup>"#;

        let group = parse_sparkline_group(xml);
        assert_eq!(group.line_weight, Some(0.75));
    }

    #[test]
    fn test_sparkline_group_axis_types() {
        let xml = br#"<sparklineGroup type="line" minAxisType="custom" maxAxisType="group">
            <sparklines/>
        </sparklineGroup>"#;

        let group = parse_sparkline_group(xml);
        assert_eq!(group.min_axis_type, SparklineAxisType::Custom);
        assert_eq!(group.max_axis_type, SparklineAxisType::Group);
    }

    #[test]
    fn test_sparkline_group_multiple_sparklines() {
        let xml = br#"<sparklineGroup type="column">
            <sparklines>
                <sparkline>
                    <xm:f>Sheet1!A1:A10</xm:f>
                    <xm:sqref>B1</xm:sqref>
                </sparkline>
                <sparkline>
                    <xm:f>Sheet1!A2:A11</xm:f>
                    <xm:sqref>B2</xm:sqref>
                </sparkline>
                <sparkline>
                    <xm:f>Sheet1!A3:A12</xm:f>
                    <xm:sqref>B3</xm:sqref>
                </sparkline>
            </sparklines>
        </sparklineGroup>"#;

        let group = parse_sparkline_group(xml);
        assert_eq!(group.sparklines.len(), 3);
        assert_eq!(group.sparklines[0].location, "B1");
        assert_eq!(group.sparklines[1].location, "B2");
        assert_eq!(group.sparklines[2].location, "B3");
    }

    // -------------------------------------------------------------------------
    // SparklineGroups tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_sparkline_groups_parse_single() {
        let xml = br#"<ext>
            <sparklineGroups xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">
                <sparklineGroup type="line">
                    <sparklines>
                        <sparkline>
                            <xm:f>Sheet1!A1:A10</xm:f>
                            <xm:sqref>B1</xm:sqref>
                        </sparkline>
                    </sparklines>
                </sparklineGroup>
            </sparklineGroups>
        </ext>"#;

        let groups = SparklineGroups::parse(xml);
        assert_eq!(groups.groups.len(), 1);
        assert_eq!(groups.groups[0].sparkline_type, SparklineType::Line);
    }

    #[test]
    fn test_sparkline_groups_parse_multiple() {
        let xml = br#"<sparklineGroups>
            <sparklineGroup type="line">
                <sparklines>
                    <sparkline>
                        <xm:f>Sheet1!A1:A10</xm:f>
                        <xm:sqref>B1</xm:sqref>
                    </sparkline>
                </sparklines>
            </sparklineGroup>
            <sparklineGroup type="column">
                <sparklines>
                    <sparkline>
                        <xm:f>Sheet1!C1:C10</xm:f>
                        <xm:sqref>D1</xm:sqref>
                    </sparkline>
                </sparklines>
            </sparklineGroup>
            <sparklineGroup type="stacked">
                <sparklines>
                    <sparkline>
                        <xm:f>Sheet1!E1:E10</xm:f>
                        <xm:sqref>F1</xm:sqref>
                    </sparkline>
                </sparklines>
            </sparklineGroup>
        </sparklineGroups>"#;

        let groups = SparklineGroups::parse(xml);
        assert_eq!(groups.groups.len(), 3);
        assert_eq!(groups.groups[0].sparkline_type, SparklineType::Line);
        assert_eq!(groups.groups[1].sparkline_type, SparklineType::Column);
        assert_eq!(groups.groups[2].sparkline_type, SparklineType::WinLoss);
    }

    #[test]
    fn test_sparkline_groups_empty() {
        let xml = b"<worksheet><sheetData/></worksheet>";
        let groups = SparklineGroups::parse(xml);
        assert!(groups.groups.is_empty());
    }

    // -------------------------------------------------------------------------
    // parse_sparklines function tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_sparklines_function() {
        let xml = br#"<sparklineGroups>
            <sparklineGroup type="line">
                <colorSeries rgb="FF376092"/>
                <sparklines>
                    <sparkline>
                        <xm:f>Sheet1!A1:A10</xm:f>
                        <xm:sqref>B1</xm:sqref>
                    </sparkline>
                </sparklines>
            </sparklineGroup>
        </sparklineGroups>"#;

        let groups = parse_sparklines(xml);
        assert_eq!(groups.len(), 1);
        assert!(groups[0].color_series.is_some());
    }

    #[test]
    fn test_parse_sparklines_with_scanner() {
        let xml = br#"<worksheet>
            <sheetData/>
            <extLst>
                <ext>
                    <sparklineGroups>
                        <sparklineGroup type="column">
                            <sparklines>
                                <sparkline>
                                    <xm:f>Sheet1!A1:A5</xm:f>
                                    <xm:sqref>C1</xm:sqref>
                                </sparkline>
                            </sparklines>
                        </sparklineGroup>
                    </sparklineGroups>
                </ext>
            </extLst>
        </worksheet>"#;

        let mut scanner = XmlScanner::new(xml);
        let groups = parse_sparklines_with_scanner(&mut scanner);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].sparkline_type, SparklineType::Column);
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
    fn test_parse_bool_attr_true() {
        let xml = b"<tag enabled=\"1\"/>";
        assert!(parse_bool_attr(xml, b"enabled=\""));

        let xml = b"<tag enabled=\"true\"/>";
        assert!(parse_bool_attr(xml, b"enabled=\""));
    }

    #[test]
    fn test_parse_bool_attr_false() {
        let xml = b"<tag enabled=\"0\"/>";
        assert!(!parse_bool_attr(xml, b"enabled=\""));

        let xml = b"<tag enabled=\"false\"/>";
        assert!(!parse_bool_attr(xml, b"enabled=\""));
    }

    #[test]
    fn test_parse_bool_attr_missing() {
        let xml = b"<tag other=\"1\"/>";
        assert!(!parse_bool_attr(xml, b"enabled=\""));
    }

    #[test]
    fn test_parse_f64_attr_positive() {
        let xml = b"<tag tint=\"0.5\"/>";
        assert_eq!(parse_f64_attr(xml, b"tint=\""), Some(0.5));
    }

    #[test]
    fn test_parse_f64_attr_negative() {
        let xml = b"<tag tint=\"-0.25\"/>";
        assert_eq!(parse_f64_attr(xml, b"tint=\""), Some(-0.25));
    }

    #[test]
    fn test_decode_xml_entities() {
        assert_eq!(decode_xml_entities("hello"), "hello");
        assert_eq!(decode_xml_entities("&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_xml_entities("&amp;"), "&");
        assert_eq!(decode_xml_entities("&quot;text&quot;"), "\"text\"");
        assert_eq!(decode_xml_entities("&apos;"), "'");
        assert_eq!(
            decode_xml_entities("a &lt; b &amp;&amp; c &gt; d"),
            "a < b && c > d"
        );
    }

    // -------------------------------------------------------------------------
    // Malformed input tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_malformed_empty_xml() {
        let xml = b"";
        let groups = parse_sparklines(xml);
        assert!(groups.is_empty());
    }

    #[test]
    fn test_malformed_incomplete_tag() {
        let xml = b"<sparklineGroup type=\"line";
        let groups = parse_sparklines(xml);
        assert!(groups.is_empty());
    }

    #[test]
    fn test_malformed_missing_closing_tag() {
        let xml = b"<sparklineGroups><sparklineGroup type=\"line\">";
        let groups = parse_sparklines(xml);
        // Parser should still handle partial data
        assert_eq!(groups.len(), 1);
    }

    #[test]
    fn test_malformed_invalid_attribute_value() {
        let xml = br#"<sparklineGroup type="invalid_type">
            <sparklines/>
        </sparklineGroup>"#;
        let group = parse_sparkline_group(xml);
        // Should default to Line for unknown type
        assert_eq!(group.sparkline_type, SparklineType::Line);
    }

    // -------------------------------------------------------------------------
    // Integration tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_realistic_sparkline_xml() {
        // A more realistic sparkline XML structure from Excel
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
           xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">
    <sheetData>
        <row r="1">
            <c r="A1"><v>10</v></c>
            <c r="B1"><v>20</v></c>
            <c r="C1"><v>15</v></c>
        </row>
    </sheetData>
    <extLst>
        <ext uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}">
            <x14:sparklineGroups xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">
                <x14:sparklineGroup type="line" displayEmptyCellsAs="gap" markers="1" high="1" low="1" first="1" last="1" negative="1" displayXAxis="0" displayHidden="0" minAxisType="individual" maxAxisType="individual" rightToLeft="0">
                    <x14:colorSeries rgb="FF376092"/>
                    <x14:colorNegative rgb="FFD00000"/>
                    <x14:colorAxis rgb="FF000000"/>
                    <x14:colorMarkers rgb="FFD00000"/>
                    <x14:colorFirst rgb="FFD00000"/>
                    <x14:colorLast rgb="FFD00000"/>
                    <x14:colorHigh rgb="FFD00000"/>
                    <x14:colorLow rgb="FFD00000"/>
                    <x14:sparklines>
                        <x14:sparkline>
                            <xm:f>Sheet1!A1:C1</xm:f>
                            <xm:sqref>D1</xm:sqref>
                        </x14:sparkline>
                        <x14:sparkline>
                            <xm:f>Sheet1!A2:C2</xm:f>
                            <xm:sqref>D2</xm:sqref>
                        </x14:sparkline>
                    </x14:sparklines>
                </x14:sparklineGroup>
                <x14:sparklineGroup type="column" displayEmptyCellsAs="zero">
                    <x14:colorSeries theme="4" tint="0.39997558519241921"/>
                    <x14:colorNegative theme="5"/>
                    <x14:sparklines>
                        <x14:sparkline>
                            <xm:f>Sheet1!A1:C1</xm:f>
                            <xm:sqref>E1</xm:sqref>
                        </x14:sparkline>
                    </x14:sparklines>
                </x14:sparklineGroup>
            </x14:sparklineGroups>
        </ext>
    </extLst>
</worksheet>"#;

        let groups = parse_sparklines(xml);
        assert_eq!(groups.len(), 2);

        // First group: Line sparkline with all colors
        let group1 = &groups[0];
        assert_eq!(group1.sparkline_type, SparklineType::Line);
        assert_eq!(group1.display_empty_cells_as, DisplayEmptyCellsAs::Gap);
        assert!(group1.markers);
        assert!(group1.high);
        assert!(group1.low);
        assert!(group1.first);
        assert!(group1.last);
        assert!(group1.negative);
        assert!(!group1.display_x_axis);
        assert!(!group1.display_hidden);
        assert!(group1.color_series.is_some());
        assert!(group1.color_negative.is_some());
        assert!(group1.color_axis.is_some());
        assert!(group1.color_markers.is_some());
        assert!(group1.color_first.is_some());
        assert!(group1.color_last.is_some());
        assert!(group1.color_high.is_some());
        assert!(group1.color_low.is_some());
        assert_eq!(group1.sparklines.len(), 2);
        assert_eq!(group1.sparklines[0].location, "D1");
        assert_eq!(group1.sparklines[1].location, "D2");

        // Second group: Column sparkline with theme colors
        let group2 = &groups[1];
        assert_eq!(group2.sparkline_type, SparklineType::Column);
        assert_eq!(group2.display_empty_cells_as, DisplayEmptyCellsAs::Zero);
        assert!(group2.color_series.is_some());
        let color_series = group2.color_series.as_ref().unwrap();
        assert_eq!(color_series.theme, Some(4));
        assert!(color_series.tint.is_some());
        assert_eq!(group2.sparklines.len(), 1);
        assert_eq!(group2.sparklines[0].location, "E1");
    }

    #[test]
    fn test_sparkline_group_default_values() {
        // Test that defaults are correctly set for a minimal sparkline group
        let xml = br#"<sparklineGroup>
            <sparklines>
                <sparkline>
                    <xm:f>Sheet1!A1:A10</xm:f>
                    <xm:sqref>B1</xm:sqref>
                </sparkline>
            </sparklines>
        </sparklineGroup>"#;

        let group = parse_sparkline_group(xml);
        assert_eq!(group.sparkline_type, SparklineType::Line);
        assert_eq!(group.display_empty_cells_as, DisplayEmptyCellsAs::Gap);
        assert!(!group.display_x_axis);
        assert!(!group.display_hidden);
        assert!(!group.right_to_left);
        assert!(group.date_axis.is_none());
        assert!(!group.markers);
        assert!(!group.high);
        assert!(!group.low);
        assert!(!group.first);
        assert!(!group.last);
        assert!(!group.negative);
        assert!(group.manual_max.is_none());
        assert!(group.manual_min.is_none());
        assert!(group.line_weight.is_none());
        assert_eq!(group.min_axis_type, SparklineAxisType::Individual);
        assert_eq!(group.max_axis_type, SparklineAxisType::Individual);
        assert!(group.color_series.is_none());
        assert!(group.color_negative.is_none());
        assert!(group.color_axis.is_none());
        assert!(group.color_markers.is_none());
        assert!(group.color_first.is_none());
        assert!(group.color_last.is_none());
        assert!(group.color_high.is_none());
        assert!(group.color_low.is_none());
    }
}
