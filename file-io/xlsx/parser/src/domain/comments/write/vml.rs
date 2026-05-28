use crate::write::xml_writer::XmlWriter;

use super::helpers::parse_cell_ref;
use super::namespaces::{EXCEL_NS, OFFICE_NS, VML_NS};
use super::types::CommentShape;

pub(super) fn write_vml(shapes: &[CommentShape]) -> Vec<u8> {
    let mut w = XmlWriter::new();

    // VML doesn't use XML declaration
    w.start_element("xml")
        .attr("xmlns:v", VML_NS)
        .attr("xmlns:o", OFFICE_NS)
        .attr("xmlns:x", EXCEL_NS)
        .end_attrs();

    // Shape layout
    w.start_element_ns("o", "shapelayout")
        .attr("v:ext", "edit")
        .end_attrs();
    w.start_element_ns("o", "idmap")
        .attr("v:ext", "edit")
        .attr("data", "1")
        .self_close();
    w.end_element_ns("o", "shapelayout");

    // Shape type definition for notes
    w.start_element_ns("v", "shapetype")
        .attr("id", "_x0000_t202")
        .attr("coordsize", "21600,21600")
        .attr("o:spt", "202")
        .attr("path", "m,l,21600r21600,l21600,xe")
        .end_attrs();
    w.start_element_ns("v", "stroke")
        .attr("joinstyle", "miter")
        .self_close();
    w.start_element_ns("v", "path")
        .attr("gradientshapeok", "t")
        .attr("o:connecttype", "rect")
        .self_close();
    w.end_element_ns("v", "shapetype");

    // Write shapes for each comment
    for (index, shape) in shapes.iter().enumerate() {
        write_vml_shape(&mut w, shape, index);
    }

    w.end_element("xml");

    w.finish()
}

/// Write a VML shape for a comment
fn write_vml_shape(w: &mut XmlWriter, shape: &CommentShape, index: usize) {
    let shape_id = format!("_x0000_s{}", 1025 + index);
    let (col, row) = parse_cell_ref(&shape.cell_ref);

    // Calculate style
    let visibility = if shape.visible { "visible" } else { "hidden" };
    let width_pt = shape.note_width.unwrap_or(96.0);
    let height_pt = shape.note_height.unwrap_or(55.5);
    let style = format!(
        "position:absolute;margin-left:{}pt;margin-top:{}pt;width:{}pt;height:{}pt;z-index:{};visibility:{}",
        shape.left_offset + (shape.left_col as f64 * 64.0),
        shape.top_offset + (shape.top_row as f64 * 15.0),
        width_pt,
        height_pt,
        index + 1,
        visibility
    );

    w.start_element_ns("v", "shape")
        .attr("id", &shape_id)
        .attr("type", "#_x0000_t202")
        .attr("style", &style)
        .attr("fillcolor", "#ffffe1")
        .attr("o:insetmode", "auto")
        .end_attrs();

    // Fill
    w.start_element_ns("v", "fill")
        .attr("color2", "#ffffe1")
        .self_close();

    // Shadow
    w.start_element_ns("v", "shadow")
        .attr("color", "black")
        .attr("obscured", "t")
        .self_close();

    // Path
    w.start_element_ns("v", "path")
        .attr("o:connecttype", "none")
        .self_close();

    // Textbox
    w.start_element_ns("v", "textbox")
        .attr("style", "mso-direction-alt:auto")
        .end_attrs();
    w.raw_str("<div style=\"text-align:left\"/>");
    w.end_element_ns("v", "textbox");

    // Client data
    w.start_element_ns("x", "ClientData")
        .attr("ObjectType", "Note")
        .end_attrs();

    w.start_element_ns("x", "MoveWithCells").self_close();
    w.start_element_ns("x", "SizeWithCells").self_close();

    // Anchor: left_col, left_offset, top_row, top_offset, right_col, right_offset, bottom_row, bottom_offset
    let anchor = format!(
        "{}, {}, {}, {}, {}, {}, {}, {}",
        shape.left_col,
        shape.left_offset as u32,
        shape.top_row,
        shape.top_offset as u32,
        shape.right_col,
        shape.right_offset as u32,
        shape.bottom_row,
        shape.bottom_offset as u32
    );
    w.element_with_text_and_attrs("x:Anchor", &[], &anchor);

    w.element_with_text("x:AutoFill", "False");
    w.element_with_text("x:Row", &row.to_string());
    w.element_with_text("x:Column", &col.to_string());

    w.end_element_ns("x", "ClientData");
    w.end_element_ns("v", "shape");
}
