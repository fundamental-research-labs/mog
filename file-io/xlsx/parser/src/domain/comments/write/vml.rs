use crate::write::xml_writer::XmlWriter;
use domain_types::{VmlStyleDimensionInfo, VmlStyleDimensionStatus};
use std::collections::{HashMap, HashSet};

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
    let layout = shapes
        .iter()
        .filter_map(|shape| shape.presentation.as_ref())
        .find_map(|presentation| presentation.shape_layout_xml.as_deref())
        .filter(|xml| safe_fragment(xml));
    if let Some(layout) = layout {
        w.raw_str(layout);
    } else {
        w.start_element_ns("o", "shapelayout")
            .attr("v:ext", "edit")
            .end_attrs();
        w.start_element_ns("o", "idmap")
            .attr("v:ext", "edit")
            .attr("data", "1")
            .self_close();
        w.end_element_ns("o", "shapelayout");
    }

    let mut shape_types = HashSet::new();
    for shape in shapes {
        if let Some(xml) = shape
            .presentation
            .as_ref()
            .and_then(|p| p.shape_type_xml.as_deref())
            && safe_fragment(xml)
            && let Some((element, _)) = crate::infra::vml_presentation::elements(xml)
            && let Some(id) = element.attr("id")
            && shape_types.insert(id.to_string())
        {
            w.raw_str(xml);
        }
    }

    // Shape type definition for notes
    if !shape_types.contains("_x0000_t202") {
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
    }

    // Write shapes for each comment
    let mut ordered: Vec<_> = shapes.iter().collect();
    ordered.sort_by_key(|shape| {
        shape
            .presentation
            .as_ref()
            .map_or(u32::MAX, |p| p.source_order)
    });
    let reserved: HashSet<_> = shapes
        .iter()
        .filter_map(|shape| presentation_attr(shape, "id"))
        .collect();
    let mut used = HashSet::new();
    let mut next_id = 1025;
    for (index, shape) in ordered.into_iter().enumerate() {
        let imported_id = presentation_attr(shape, "id").filter(|id| !used.contains(*id));
        let shape_id = if let Some(id) = imported_id {
            id.to_string()
        } else {
            while reserved.contains(format!("_x0000_s{next_id}").as_str())
                || used.contains(&format!("_x0000_s{next_id}"))
            {
                next_id += 1;
            }
            let id = format!("_x0000_s{next_id}");
            next_id += 1;
            id
        };
        used.insert(shape_id.clone());
        if shape.presentation.is_some() {
            write_imported_shape(&mut w, shape, &shape_id);
        } else {
            write_vml_shape(&mut w, shape, index, &shape_id);
        }
    }

    w.end_element("xml");

    w.finish()
}

/// Write a VML shape for a comment
fn write_vml_shape(w: &mut XmlWriter, shape: &CommentShape, index: usize, shape_id: &str) {
    let (col, row) = parse_cell_ref(&shape.cell_ref);

    // Calculate style
    let visibility = if shape.visible { "visible" } else { "hidden" };
    let mut style = format!(
        "position:absolute;margin-left:{}pt;margin-top:{}pt;",
        (shape.left_offset + (shape.left_col as f64 * 64.0)) * 0.75,
        shape.top_offset * 0.75 + (shape.top_row as f64 * 15.0)
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
        .attr("id", shape_id)
        .attr("type", "#_x0000_t202")
        .attr("style", &style)
        .attr("fillcolor", "#ffffe1")
        .attr("o:insetmode", "auto")
        .end_attrs();

    // Fill
    w.start_element_ns("v", "fill")
        .attr("color2", "#ffffe1")
        .self_close();

    for image in &shape.note_images {
        if image.relationship_id.is_empty() {
            continue;
        }
        w.start_element_ns("v", "imagedata")
            .attr("o:relid", &image.relationship_id)
            .self_close();
    }

    // Shadow
    w.start_element_ns("v", "shadow")
        .attr("on", "t")
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

    if shape.visible {
        w.start_element_ns("x", "Visible").self_close();
    }

    w.end_element_ns("x", "ClientData");
    w.end_element_ns("v", "shape");
}

fn presentation_attr<'a>(shape: &'a CommentShape, name: &str) -> Option<&'a str> {
    shape
        .presentation
        .as_ref()?
        .shape_attrs
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}

fn safe_fragment(xml: &str) -> bool {
    crate::infra::vml_presentation::elements(xml).is_some()
        && !crate::infra::xml::raw_xml_contains_relationship_attr(xml)
}

fn set_style_property(style: &mut String, property: &str, value: Option<&str>) {
    let mut declarations: Vec<_> = style
        .split(';')
        .filter(|declaration| {
            declaration
                .split_once(':')
                .is_none_or(|(name, _)| !name.trim().eq_ignore_ascii_case(property))
        })
        .filter(|declaration| !declaration.trim().is_empty())
        .map(ToOwned::to_owned)
        .collect();
    if let Some(value) = value {
        declarations.push(format!("{property}:{value}"));
    }
    *style = declarations.join(";");
}

fn write_imported_shape(w: &mut XmlWriter, shape: &CommentShape, shape_id: &str) {
    use crate::infra::xml::{relationship_attr_values, remap_relationship_attrs};
    let presentation = shape
        .presentation
        .as_ref()
        .expect("imported shape presentation");
    let mut style = presentation_attr(shape, "style").unwrap_or("").to_string();
    let anchor = domain_types::domain::comment::NoteShapeAnchor {
        left_column: shape.left_col,
        left_offset: shape.left_offset as u32,
        top_row: shape.top_row,
        top_offset: shape.top_offset as u32,
        right_column: shape.right_col,
        right_offset: shape.right_offset as u32,
        bottom_row: shape.bottom_row,
        bottom_offset: shape.bottom_offset as u32,
    };
    if domain_types::VmlCellAnchor::from(&anchor) != presentation.anchor {
        // Imported absolute offsets are stale after an anchor edit. The current
        // cell anchor is authoritative; let Excel derive absolute placement
        // from actual worksheet dimensions instead of inventing fixed metrics.
        set_style_property(&mut style, "margin-left", None);
        set_style_property(&mut style, "margin-top", None);
    }
    for (property, current, imported) in [
        ("width", shape.note_width, shape.note_width_style.as_ref()),
        (
            "height",
            shape.note_height,
            shape.note_height_style.as_ref(),
        ),
    ] {
        let value = dimension_style_value(current, imported, true, 0.0);
        if value.as_deref() != imported.map(|dimension| dimension.raw.as_str()) {
            set_style_property(&mut style, property, value.as_deref());
        }
    }
    if shape.visible != presentation.visible {
        set_style_property(
            &mut style,
            "visibility",
            Some(if shape.visible { "visible" } else { "hidden" }),
        );
    }
    w.start_element_ns("v", "shape");
    for (name, value) in &presentation.namespace_attrs {
        if !presentation.shape_attrs.iter().any(|(key, _)| key == name) {
            w.attr(name, value);
        }
    }
    for (name, value) in &presentation.shape_attrs {
        if name != "id" && name != "style" {
            // Shape-level relationship attributes are not an independent media
            // owner. Only validated note child references are written below.
            let mut probe = XmlWriter::new();
            probe.start_element("shape").attr(name, value).self_close();
            if !crate::infra::xml::raw_xml_contains_relationship_attr(&String::from_utf8_lossy(
                &probe.finish(),
            )) {
                w.attr(name, value);
            }
        }
    }
    w.attr("id", shape_id);
    if !style.is_empty() {
        w.attr("style", &style);
    }
    w.end_attrs();

    let mappings: HashMap<_, _> = shape
        .note_images
        .iter()
        .map(|image| {
            (
                image.original_relationship_id.clone(),
                image.relationship_id.clone(),
            )
        })
        .collect();
    let mut emitted = HashSet::new();
    for xml in &presentation.children_xml {
        if crate::infra::vml_presentation::elements(xml).is_none() {
            continue;
        }
        let references = relationship_attr_values(xml);
        if references.iter().all(|id| mappings.contains_key(id)) {
            emitted.extend(references);
            w.raw_str(&remap_relationship_attrs(xml, &mappings));
        }
    }
    for image in &shape.note_images {
        if !emitted.contains(&image.original_relationship_id) {
            w.start_element_ns("v", "imagedata")
                .attr("o:relid", &image.relationship_id)
                .self_close();
        }
    }
    w.start_element_ns("x", "ClientData");
    for (name, value) in &presentation.client_data_attrs {
        w.attr(name, value);
    }
    w.end_attrs();
    for xml in &presentation.client_data_children_xml {
        if safe_fragment(xml) {
            w.raw_str(xml);
        }
    }
    let anchor_text = format!(
        "{}, {}, {}, {}, {}, {}, {}, {}",
        anchor.left_column,
        anchor.left_offset,
        anchor.top_row,
        anchor.top_offset,
        anchor.right_column,
        anchor.right_offset,
        anchor.bottom_row,
        anchor.bottom_offset
    );
    w.element_with_text("x:Anchor", &anchor_text);
    let (col, row) = parse_cell_ref(&shape.cell_ref);
    w.element_with_text("x:Row", &row.to_string());
    w.element_with_text("x:Column", &col.to_string());
    if shape.visible == presentation.visible {
        if let Some(xml) = &presentation.visible_element_xml
            && safe_fragment(xml)
        {
            w.raw_str(xml);
        }
    } else if shape.visible {
        w.start_element_ns("x", "Visible").self_close();
    }
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
