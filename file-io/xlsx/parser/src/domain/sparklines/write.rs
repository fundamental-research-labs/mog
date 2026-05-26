//! Sparklines Writer for XLSX worksheets.
//!
//! This module generates sparkline XML elements for worksheet files
//! according to ECMA-376 x14:sparklineGroups extension (Excel 2010+).
//!
//! Sparklines are small inline charts embedded within worksheet cells that
//! provide visual representation of data trends.
//!
//! # Features
//!
//! - Line sparklines with data point markers
//! - Column sparklines (mini bar charts)
//! - Win/Loss sparklines (binary outcomes)
//! - Customizable colors for series, markers, and highlighted points
//! - Axis settings with manual min/max
//! - Display options (empty cells handling, hidden cells, RTL)
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::write::sparklines_writer::{SparklinesWriter, SparklineGroupBuilder, SparklineType};
//!
//! let mut writer = SparklinesWriter::new();
//!
//! // Add a simple line sparkline
//! writer.add_line("Sheet1!A1:A10", "B1");
//!
//! // Add a column sparkline group with customizations
//! let mut group = SparklineGroupBuilder::new(SparklineType::Column);
//! group
//!     .add("Sheet1!C1:C10", "D1")
//!     .add("Sheet1!C2:C11", "D2")
//!     .color("FF376092")
//!     .negative_color("FFD00000")
//!     .show_high_point(true)
//!     .show_low_point(true);
//! writer.add_group(group.build());
//!
//! // Generate XML
//! let xml = writer.to_xml();
//! ```

use crate::write::xml_writer::XmlWriter;

// Re-export canonical types from ooxml_types
pub use ooxml_types::sparklines::{
    DisplayEmptyCellsAs, Sparkline, SparklineAxisType, SparklineColor, SparklineGroup,
    SparklineType,
};

// ============================================================================
// Constants - Namespace URIs
// ============================================================================

/// x14 namespace URI for Excel 2010 extensions
const X14_NS: &str = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";

/// xm namespace URI for Excel formulas
const XM_NS: &str = "http://schemas.microsoft.com/office/excel/2006/main";

/// Extension URI for sparklines
const SPARKLINE_EXT_URI: &str = "{05C60535-1F16-4fd2-B633-F4F36F0B64E0}";

// ============================================================================
// SparklineGroupBuilder — ergonomic builder for SparklineGroup
// ============================================================================

/// Builder for constructing a `SparklineGroup` with a fluent API.
///
/// # Example
///
/// ```ignore
/// let mut group = SparklineGroupBuilder::new(SparklineType::Line);
/// group
///     .add("Sheet1!A1:A10", "B1")
///     .add("Sheet1!A2:A11", "B2")
///     .show_markers(true)
///     .show_high_point(true)
///     .color("FF376092")
///     .high_color("FFD00000");
/// let sparkline_group = group.build();
/// ```
pub struct SparklineGroupBuilder {
    inner: SparklineGroup,
}

impl SparklineGroupBuilder {
    /// Create a new builder with the specified sparkline type.
    pub fn new(sparkline_type: SparklineType) -> Self {
        let mut inner = SparklineGroup::default();
        inner.sparkline_type = sparkline_type;
        Self { inner }
    }

    /// Consume the builder and return the built `SparklineGroup`.
    pub fn build(self) -> SparklineGroup {
        self.inner
    }

    /// Add a sparkline to the group.
    pub fn add(&mut self, data_range: &str, location: &str) -> &mut Self {
        self.inner
            .sparklines
            .push(Sparkline::new(data_range, location));
        self
    }

    /// Set line weight (for line sparklines).
    pub fn line_weight(&mut self, weight: f64) -> &mut Self {
        self.inner.line_weight = Some(weight);
        self
    }

    /// Show markers on line sparklines.
    pub fn show_markers(&mut self, show: bool) -> &mut Self {
        self.inner.markers = show;
        self
    }

    /// Highlight high point.
    pub fn show_high_point(&mut self, show: bool) -> &mut Self {
        self.inner.high = show;
        self
    }

    /// Highlight low point.
    pub fn show_low_point(&mut self, show: bool) -> &mut Self {
        self.inner.low = show;
        self
    }

    /// Highlight first point.
    pub fn show_first_point(&mut self, show: bool) -> &mut Self {
        self.inner.first = show;
        self
    }

    /// Highlight last point.
    pub fn show_last_point(&mut self, show: bool) -> &mut Self {
        self.inner.last = show;
        self
    }

    /// Highlight negative points.
    pub fn show_negative_points(&mut self, show: bool) -> &mut Self {
        self.inner.negative = show;
        self
    }

    /// Show X axis.
    pub fn show_x_axis(&mut self, show: bool) -> &mut Self {
        self.inner.display_x_axis = show;
        self
    }

    /// Set how empty cells are displayed.
    pub fn display_empty_cells_as(&mut self, mode: DisplayEmptyCellsAs) -> &mut Self {
        self.inner.display_empty_cells_as = mode;
        self
    }

    /// Include hidden cells in data.
    pub fn show_hidden(&mut self, show: bool) -> &mut Self {
        self.inner.display_hidden = show;
        self
    }

    /// Set right-to-left display.
    pub fn right_to_left(&mut self, rtl: bool) -> &mut Self {
        self.inner.right_to_left = rtl;
        self
    }

    /// Set series color (main sparkline color).
    pub fn color(&mut self, color: &str) -> &mut Self {
        self.inner.color_series = Some(SparklineColor::from_rgb(color));
        self
    }

    /// Set negative color.
    pub fn negative_color(&mut self, color: &str) -> &mut Self {
        self.inner.color_negative = Some(SparklineColor::from_rgb(color));
        self
    }

    /// Set axis color.
    pub fn axis_color(&mut self, color: &str) -> &mut Self {
        self.inner.color_axis = Some(SparklineColor::from_rgb(color));
        self
    }

    /// Set marker color.
    pub fn marker_color(&mut self, color: &str) -> &mut Self {
        self.inner.color_markers = Some(SparklineColor::from_rgb(color));
        self
    }

    /// Set first point color.
    pub fn first_color(&mut self, color: &str) -> &mut Self {
        self.inner.color_first = Some(SparklineColor::from_rgb(color));
        self
    }

    /// Set last point color.
    pub fn last_color(&mut self, color: &str) -> &mut Self {
        self.inner.color_last = Some(SparklineColor::from_rgb(color));
        self
    }

    /// Set high point color.
    pub fn high_color(&mut self, color: &str) -> &mut Self {
        self.inner.color_high = Some(SparklineColor::from_rgb(color));
        self
    }

    /// Set low point color.
    pub fn low_color(&mut self, color: &str) -> &mut Self {
        self.inner.color_low = Some(SparklineColor::from_rgb(color));
        self
    }

    /// Set axis min/max range.
    ///
    /// This sets both min and max axis types to Custom and sets the manual values.
    pub fn set_axis_range(&mut self, min: f64, max: f64) -> &mut Self {
        self.inner.min_axis_type = SparklineAxisType::Custom;
        self.inner.max_axis_type = SparklineAxisType::Custom;
        self.inner.manual_min = Some(min);
        self.inner.manual_max = Some(max);
        self
    }

    /// Set minimum axis type.
    pub fn min_axis_type(&mut self, axis_type: SparklineAxisType) -> &mut Self {
        self.inner.min_axis_type = axis_type;
        self
    }

    /// Set maximum axis type.
    pub fn max_axis_type(&mut self, axis_type: SparklineAxisType) -> &mut Self {
        self.inner.max_axis_type = axis_type;
        self
    }

    /// Set date axis range reference.
    pub fn date_axis(&mut self, range: &str) -> &mut Self {
        self.inner.date_axis = Some(range.to_string());
        self
    }
}

// ============================================================================
// XML Writing Helpers
// ============================================================================

/// Write a single sparkline entry to an XmlWriter.
fn write_sparkline(sparkline: &Sparkline, writer: &mut XmlWriter) {
    writer.start_element("x14:sparkline").end_attrs();
    writer.element_with_text("xm:f", &sparkline.data_range);
    writer.element_with_text("xm:sqref", &sparkline.location);
    writer.end_element("x14:sparkline");
}

/// Write a color element to an XmlWriter.
fn write_color_element(writer: &mut XmlWriter, name: &str, color: &Option<SparklineColor>) {
    if let Some(c) = color {
        if let Some(ref rgb) = c.rgb {
            writer.start_element_ns("x14", name).attr("rgb", rgb);
            if let Some(theme) = c.theme {
                writer.attr("theme", &theme.to_string());
            }
            if let Some(tint) = c.tint {
                writer.attr("tint", &tint.to_string());
            }
            writer.self_close();
        } else if let Some(theme) = c.theme {
            writer
                .start_element_ns("x14", name)
                .attr("theme", &theme.to_string());
            if let Some(tint) = c.tint {
                writer.attr("tint", &tint.to_string());
            }
            writer.self_close();
        }
    }
}

/// Write a sparkline group to an XmlWriter.
fn write_sparkline_group(group: &SparklineGroup, writer: &mut XmlWriter) {
    writer.start_element_ns("x14", "sparklineGroup");

    // Type attribute (omit if default "line")
    if group.sparkline_type != SparklineType::Line {
        writer.attr("type", group.sparkline_type.to_ooxml());
    }

    // displayEmptyCellsAs attribute (omit if default "gap")
    if group.display_empty_cells_as != DisplayEmptyCellsAs::Gap {
        writer.attr(
            "displayEmptyCellsAs",
            group.display_empty_cells_as.to_ooxml(),
        );
    }

    // Boolean attributes (write as "1" only when true)
    if group.markers {
        writer.attr("markers", "1");
    }
    if group.high {
        writer.attr("high", "1");
    }
    if group.low {
        writer.attr("low", "1");
    }
    if group.first {
        writer.attr("first", "1");
    }
    if group.last {
        writer.attr("last", "1");
    }
    if group.negative {
        writer.attr("negative", "1");
    }
    if group.display_x_axis {
        writer.attr("displayXAxis", "1");
    }
    if group.display_hidden {
        writer.attr("displayHidden", "1");
    }
    if group.right_to_left {
        writer.attr("rightToLeft", "1");
    }

    // Line weight
    if let Some(weight) = group.line_weight {
        writer.attr_num("lineWeight", weight);
    }

    // Axis type attributes (omit if default "individual")
    if group.min_axis_type != SparklineAxisType::Individual {
        writer.attr("minAxisType", group.min_axis_type.to_ooxml());
    }
    if group.max_axis_type != SparklineAxisType::Individual {
        writer.attr("maxAxisType", group.max_axis_type.to_ooxml());
    }

    // Manual min/max
    if let Some(min) = group.manual_min {
        writer.attr_num("manualMin", min);
    }
    if let Some(max) = group.manual_max {
        writer.attr_num("manualMax", max);
    }

    writer.end_attrs();

    // Write color elements
    write_color_element(writer, "colorSeries", &group.color_series);
    write_color_element(writer, "colorNegative", &group.color_negative);
    write_color_element(writer, "colorAxis", &group.color_axis);
    write_color_element(writer, "colorMarkers", &group.color_markers);
    write_color_element(writer, "colorFirst", &group.color_first);
    write_color_element(writer, "colorLast", &group.color_last);
    write_color_element(writer, "colorHigh", &group.color_high);
    write_color_element(writer, "colorLow", &group.color_low);

    // Write sparklines
    if !group.sparklines.is_empty() {
        writer.start_element_ns("x14", "sparklines").end_attrs();

        for sparkline in &group.sparklines {
            write_sparkline(sparkline, writer);
        }

        writer.end_element_ns("x14", "sparklines");
    }

    writer.end_element_ns("x14", "sparklineGroup");
}

// ============================================================================
// SparklinesWriter
// ============================================================================

/// Writer for sparklines in a worksheet.
///
/// Collects sparkline groups and generates the `<extLst>` XML element with
/// x14:sparklineGroups extension.
///
/// # Example
///
/// ```ignore
/// let mut writer = SparklinesWriter::new();
///
/// // Add simple sparklines
/// writer
///     .add_line("Sheet1!A1:A10", "B1")
///     .add_column("Sheet1!C1:C10", "D1")
///     .add_winloss("Sheet1!E1:E10", "F1");
///
/// // Add a customized group
/// let mut group = SparklineGroupBuilder::new(SparklineType::Line);
/// group
///     .add("Sheet1!G1:G10", "H1")
///     .show_markers(true)
///     .color("FF0000FF");
/// writer.add_group(group.build());
///
/// // Write to an XmlWriter
/// let mut xml_writer = XmlWriter::new();
/// writer.write_to(&mut xml_writer);
/// ```
#[derive(Debug, Clone, Default)]
pub struct SparklinesWriter {
    groups: Vec<SparklineGroup>,
}

impl SparklinesWriter {
    /// Create a new empty sparklines writer.
    pub fn new() -> Self {
        Self { groups: Vec::new() }
    }

    /// Add a sparkline group.
    pub fn add_group(&mut self, group: SparklineGroup) -> &mut Self {
        self.groups.push(group);
        self
    }

    /// Add a simple line sparkline.
    ///
    /// Creates a new group with a single line sparkline.
    pub fn add_line(&mut self, data_range: &str, location: &str) -> &mut Self {
        let mut builder = SparklineGroupBuilder::new(SparklineType::Line);
        builder.add(data_range, location);
        self.add_group(builder.build())
    }

    /// Add a simple column sparkline.
    ///
    /// Creates a new group with a single column sparkline.
    pub fn add_column(&mut self, data_range: &str, location: &str) -> &mut Self {
        let mut builder = SparklineGroupBuilder::new(SparklineType::Column);
        builder.add(data_range, location);
        self.add_group(builder.build())
    }

    /// Add a simple win/loss sparkline.
    ///
    /// Creates a new group with a single win/loss sparkline.
    pub fn add_winloss(&mut self, data_range: &str, location: &str) -> &mut Self {
        let mut builder = SparklineGroupBuilder::new(SparklineType::WinLoss);
        builder.add(data_range, location);
        self.add_group(builder.build())
    }

    /// Check if there are any sparkline groups.
    pub fn is_empty(&self) -> bool {
        self.groups.is_empty()
    }

    /// Get the number of sparkline groups.
    pub fn len(&self) -> usize {
        self.groups.len()
    }

    /// Get a reference to the groups.
    pub fn groups(&self) -> &[SparklineGroup] {
        &self.groups
    }

    /// Write sparklines extLst element to an XmlWriter.
    ///
    /// Does nothing if there are no sparklines.
    pub fn write_to(&self, writer: &mut XmlWriter) {
        if self.groups.is_empty() {
            return;
        }

        // <extLst>
        writer.start_element("extLst").end_attrs();

        // <ext uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}" xmlns:x14="...">
        writer
            .start_element("ext")
            .attr("xmlns:x14", X14_NS)
            .attr("uri", SPARKLINE_EXT_URI)
            .end_attrs();

        // <x14:sparklineGroups xmlns:xm="...">
        writer
            .start_element_ns("x14", "sparklineGroups")
            .attr("xmlns:xm", XM_NS)
            .end_attrs();

        for group in &self.groups {
            write_sparkline_group(group, writer);
        }

        writer.end_element_ns("x14", "sparklineGroups");
        writer.end_element("ext");
        writer.end_element("extLst");
    }

    /// Generate standalone XML (for testing).
    pub fn to_xml(&self) -> Vec<u8> {
        let mut writer = XmlWriter::new();
        self.write_to(&mut writer);
        writer.finish()
    }
}

// ============================================================================
// Bridge: domain_types::Sparkline → XML (used by from_parse_output)
// ============================================================================

use crate::infra::a1::to_a1;
use domain_types::domain::sparkline::{
    AxisBound, AxisBoundLabel, SparklineType as DomainSparklineType,
};

/// Convert a `SparklineDataRange` to an A1-style range string (e.g. "A1:E1").
fn data_range_to_a1(r: &domain_types::domain::sparkline::SparklineDataRange) -> String {
    let start = to_a1(r.start_row, r.start_col);
    let end = to_a1(r.end_row, r.end_col);
    if start == end {
        start
    } else {
        format!("{}:{}", start, end)
    }
}

/// Convert a `SparklineType` enum to its OOXML string representation.
fn domain_sparkline_type_str(t: &DomainSparklineType) -> &'static str {
    match t {
        DomainSparklineType::Line => "line",
        DomainSparklineType::Column => "column",
        DomainSparklineType::WinLoss => "stacked",
    }
}

/// Extract the OOXML `minAxisType`/`maxAxisType` attribute value from an `AxisBound`.
fn axis_bound_type_str(b: &AxisBound) -> Option<&'static str> {
    match b {
        AxisBound::Value(_) => Some("custom"),
        AxisBound::Label(AxisBoundLabel::Same) => Some("group"),
        AxisBound::Label(AxisBoundLabel::Auto) => None, // auto is default, omit
    }
}

/// Extract the numeric value from an `AxisBound::Value`.
fn axis_bound_value(b: &AxisBound) -> Option<f64> {
    match b {
        AxisBound::Value(v) => Some(*v),
        _ => None,
    }
}

/// Build the `<extLst>` XML containing sparkline groups for a worksheet,
/// consuming the unified `domain_types::Sparkline` representation.
///
/// Sparklines are grouped by `group_id`; sparklines without a group_id each get
/// their own singleton group. The first sparkline in each group determines
/// the group-level display settings (type, colors, markers, axis config).
pub fn sparklines_xml_from_domain(
    sheet_name: &str,
    sparklines: &[domain_types::domain::sparkline::Sparkline],
) -> String {
    // Group sparklines by group_id, preserving insertion order via Vec of (key, members).
    // Ungrouped sparklines each get a unique synthetic key.
    let mut group_order: Vec<String> = Vec::new();
    let mut group_map: std::collections::HashMap<
        String,
        Vec<&domain_types::domain::sparkline::Sparkline>,
    > = std::collections::HashMap::new();
    for sp in sparklines {
        let cell_ref = to_a1(sp.cell.row, sp.cell.col);
        let key = sp
            .group_id
            .clone()
            .unwrap_or_else(|| format!("__solo_{}", cell_ref));
        if !group_map.contains_key(&key) {
            group_order.push(key.clone());
        }
        group_map.entry(key).or_default().push(sp);
    }

    let mut xml = String::new();
    xml.push_str("<extLst>");
    xml.push_str("<ext uri=\"{05C60535-1F16-4fd2-B633-F4F36F0B64E0}\" xmlns:x14=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/main\">");
    xml.push_str(
        "<x14:sparklineGroups xmlns:xm=\"http://schemas.microsoft.com/office/excel/2006/main\">",
    );

    for key in &group_order {
        let group = &group_map[key];
        // First sparkline in group determines group-level attributes.
        let leader = group[0];

        // NOTE: `data_in_rows` is intentionally not written to the XML output.
        // The OOXML `x14:sparklineGroup` element has no `dataInRows` attribute;
        // the data orientation (row vs column) is fully determined by the shape
        // of the data_range reference itself (e.g. "A1:A5" is a column range,
        // "A1:E1" is a row range).  The field exists only as parser metadata.

        // Build sparklineGroup opening tag with attributes.
        xml.push_str("<x14:sparklineGroup");

        // Type (omit for "line" since it's the default)
        let type_str = domain_sparkline_type_str(&leader.sparkline_type);
        if type_str != "line" {
            xml.push_str(&format!(" type=\"{}\"", type_str));
        }

        xml.push_str(" displayEmptyCellsAs=\"gap\"");

        // Line weight (only meaningful for line sparklines)
        if let Some(weight) = leader.visual.line_weight {
            xml.push_str(&format!(" lineWeight=\"{}\"", weight));
        }

        // Boolean display flags — inferred from visual settings
        if leader.visual.show_markers.unwrap_or(false) {
            xml.push_str(" markers=\"1\"");
        }
        if leader.visual.high_point_color.is_some() {
            xml.push_str(" high=\"1\"");
        }
        if leader.visual.low_point_color.is_some() {
            xml.push_str(" low=\"1\"");
        }
        if leader.visual.first_point_color.is_some() {
            xml.push_str(" first=\"1\"");
        }
        if leader.visual.last_point_color.is_some() {
            xml.push_str(" last=\"1\"");
        }
        if leader.visual.negative_color.is_some() {
            xml.push_str(" negative=\"1\"");
        }
        if leader.axis.right_to_left.unwrap_or(false) {
            xml.push_str(" rightToLeft=\"1\"");
        }

        // Axis type attributes
        if let Some(min_type) = axis_bound_type_str(&leader.axis.min_value) {
            xml.push_str(&format!(" minAxisType=\"{}\"", min_type));
        }
        if let Some(max_type) = axis_bound_type_str(&leader.axis.max_value) {
            xml.push_str(&format!(" maxAxisType=\"{}\"", max_type));
        }

        // Custom axis values
        if let Some(min_val) = axis_bound_value(&leader.axis.min_value) {
            xml.push_str(&format!(" manualMin=\"{}\"", min_val));
        }
        if let Some(max_val) = axis_bound_value(&leader.axis.max_value) {
            xml.push_str(&format!(" manualMax=\"{}\"", max_val));
        }

        xml.push('>');

        // Color elements — use ARGB format
        // Series color is always present in unified type
        if !leader.visual.color.is_empty() {
            xml.push_str(&format!(
                "<x14:colorSeries rgb=\"{}\"/>",
                hex_to_argb(&leader.visual.color)
            ));
        }
        if let Some(ref c) = leader.visual.negative_color {
            xml.push_str(&format!("<x14:colorNegative rgb=\"{}\"/>", hex_to_argb(c)));
        }
        // Axis color is always black
        xml.push_str("<x14:colorAxis rgb=\"FF000000\"/>");
        if let Some(ref c) = leader.visual.marker_color {
            xml.push_str(&format!("<x14:colorMarkers rgb=\"{}\"/>", hex_to_argb(c)));
        }
        if let Some(ref c) = leader.visual.first_point_color {
            xml.push_str(&format!("<x14:colorFirst rgb=\"{}\"/>", hex_to_argb(c)));
        }
        if let Some(ref c) = leader.visual.last_point_color {
            xml.push_str(&format!("<x14:colorLast rgb=\"{}\"/>", hex_to_argb(c)));
        }
        if let Some(ref c) = leader.visual.high_point_color {
            xml.push_str(&format!("<x14:colorHigh rgb=\"{}\"/>", hex_to_argb(c)));
        }
        if let Some(ref c) = leader.visual.low_point_color {
            xml.push_str(&format!("<x14:colorLow rgb=\"{}\"/>", hex_to_argb(c)));
        }

        // Sparkline entries
        xml.push_str("<x14:sparklines>");
        for sp in group {
            xml.push_str("<x14:sparkline>");
            // Data range — always qualify with sheet name
            let data_range_a1 = data_range_to_a1(&sp.data_range);
            let qualified_range = format_sheet_qualified_ref(sheet_name, &data_range_a1);
            xml.push_str(&format!(
                "<xm:f>{}</xm:f>",
                sparkline_xml_escape(&qualified_range)
            ));
            let cell_ref = to_a1(sp.cell.row, sp.cell.col);
            xml.push_str(&format!(
                "<xm:sqref>{}</xm:sqref>",
                sparkline_xml_escape(&cell_ref)
            ));
            xml.push_str("</x14:sparkline>");
        }
        xml.push_str("</x14:sparklines>");

        xml.push_str("</x14:sparklineGroup>");
    }

    xml.push_str("</x14:sparklineGroups>");
    xml.push_str("</ext>");
    xml.push_str("</extLst>");

    xml
}

/// Format a sheet-qualified cell reference (e.g. "Sheet1!A1:A5").
/// Quotes the sheet name if it contains spaces or special characters.
fn format_sheet_qualified_ref(sheet_name: &str, range: &str) -> String {
    if sheet_name.contains(' ')
        || sheet_name.contains('\'')
        || sheet_name.contains('!')
        || sheet_name.contains('[')
    {
        // Escape single quotes by doubling them
        let escaped = sheet_name.replace('\'', "''");
        format!("'{}'!{}", escaped, range)
    } else {
        format!("{}!{}", sheet_name, range)
    }
}

/// Minimal XML escaping for sparkline text content.
fn sparkline_xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Convert a "#RRGGBB" or "AARRGGBB" hex string to OOXML "AARRGGBB" format.
pub(crate) fn hex_to_argb(hex: &str) -> String {
    if let Some(stripped) = hex.strip_prefix('#') {
        format!("FF{}", stripped.to_uppercase())
    } else if hex.len() == 6 {
        format!("FF{}", hex.to_uppercase())
    } else {
        hex.to_uppercase()
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

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
            xml.matches("<x14:sparklineGroup>").count()
                + xml.matches("<x14:sparklineGroup ").count(),
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
            xml.matches("<x14:sparklineGroup>").count()
                + xml.matches("<x14:sparklineGroup ").count(),
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
}
