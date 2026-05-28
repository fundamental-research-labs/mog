//! Collection writer for worksheet sparkline extension XML.

use crate::write::xml_writer::XmlWriter;
use ooxml_types::sparklines::{SparklineGroup, SparklineType};

use super::builder::SparklineGroupBuilder;
use super::constants::{SPARKLINE_EXT_URI, X14_NS, XM_NS};
use super::ooxml::write_sparkline_group;

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
