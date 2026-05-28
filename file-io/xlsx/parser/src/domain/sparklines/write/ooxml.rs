//! Low-level OOXML serialization for canonical sparkline groups.

use crate::write::xml_writer::XmlWriter;
use ooxml_types::sparklines::{
    DisplayEmptyCellsAs, Sparkline, SparklineAxisType, SparklineColor, SparklineGroup,
    SparklineType,
};

/// Write a single sparkline entry to an XmlWriter.
pub(super) fn write_sparkline(sparkline: &Sparkline, writer: &mut XmlWriter) {
    writer.start_element("x14:sparkline").end_attrs();
    writer.element_with_text("xm:f", &sparkline.data_range);
    writer.element_with_text("xm:sqref", &sparkline.location);
    writer.end_element("x14:sparkline");
}

/// Write a color element to an XmlWriter.
pub(super) fn write_color_element(
    writer: &mut XmlWriter,
    name: &str,
    color: &Option<SparklineColor>,
) {
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
pub(super) fn write_sparkline_group(group: &SparklineGroup, writer: &mut XmlWriter) {
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
