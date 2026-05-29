use crate::write::xml_writer::XmlWriter;
use domain_types::{VmlStyleDimensionInfo, VmlStyleDimensionStatus};

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
    let mut style = format!(
        "position:absolute;margin-left:{}pt;margin-top:{}pt;",
        shape.left_offset + (shape.left_col as f64 * 64.0),
        shape.top_offset + (shape.top_row as f64 * 15.0)
    );
    if let Some(width) = dimension_style_value(
        shape.note_width,
        shape.note_width_style.as_ref(),
        shape.has_vml_note_provenance,
        96.0,
    ) {
        style.push_str("width:");
        style.push_str(&width);
        style.push(';');
    }
    if let Some(height) = dimension_style_value(
        shape.note_height,
        shape.note_height_style.as_ref(),
        shape.has_vml_note_provenance,
        55.5,
    ) {
        style.push_str("height:");
        style.push_str(&height);
        style.push(';');
    }
    style.push_str(&format!("z-index:{};visibility:{}", index + 1, visibility));

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

fn dimension_style_value(
    current_pt: Option<f64>,
    imported: Option<&VmlStyleDimensionInfo>,
    has_vml_note_provenance: bool,
    default_pt: f64,
) -> Option<String> {
    if let Some(current_pt) = current_pt {
        if let Some(imported) = imported {
            match imported.status {
                VmlStyleDimensionStatus::Supported | VmlStyleDimensionStatus::UnitlessZero
                    if imported
                        .normalized_pt
                        .map(|normalized| points_match(normalized, current_pt))
                        .unwrap_or(false) =>
                {
                    return Some(imported.raw.clone());
                }
                _ => {}
            }
        }
        return Some(format!("{}pt", current_pt));
    }

    if let Some(imported) = imported {
        if matches!(
            imported.status,
            VmlStyleDimensionStatus::UnsupportedUnit | VmlStyleDimensionStatus::Malformed
        ) {
            return Some(imported.raw.clone());
        }
    }

    (!has_vml_note_provenance).then(|| format!("{}pt", default_pt))
}

fn points_match(left: f64, right: f64) -> bool {
    (left - right).abs() < 0.000_001
}
