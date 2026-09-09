//! Imported OLE preview presentation, scoped to the current embedding owner.

use super::anchors::vml_offset;
use super::types::{ControlAnchor, OleObject};
use crate::infra::vml_presentation::{capture_shape, elements};
use crate::infra::xml::{
    raw_xml_contains_relationship_attr, relationship_attr_values, remap_relationship_attrs,
};
use crate::write::xml_writer::XmlWriter;
use domain_types::{VmlCellAnchor, VmlShapePresentation};
use std::collections::HashMap;

pub(super) fn capture(xml: &[u8], objects: &mut [OleObject]) {
    let Some((root, children)) = std::str::from_utf8(xml).ok().and_then(elements) else {
        return;
    };
    for (order, element) in children.iter().enumerate() {
        if element.local_name() != "shape" {
            continue;
        }
        let Some(id) = element
            .attr("o:spid")
            .or_else(|| element.attr("id"))
            .and_then(super::vml::extract_vml_shape_number)
        else {
            continue;
        };
        let Some(object) = objects.iter_mut().find(|object| object.shape_id == id) else {
            continue;
        };
        let mut anchor = ControlAnchor::default();
        if let Some((_, shape_children)) = elements(element.xml) {
            for child in shape_children {
                if child.local_name() == "ClientData"
                    && let Some((_, properties)) = elements(child.xml)
                {
                    for property in properties {
                        if property.local_name() == "Anchor" {
                            let text = property
                                .xml
                                .split('>')
                                .nth(1)
                                .unwrap_or("")
                                .split('<')
                                .next()
                                .unwrap_or("");
                            if let Some(parsed) = ControlAnchor::from_vml_anchor(text) {
                                anchor = parsed;
                            }
                        }
                    }
                }
            }
        }
        let visible = !element.attr("style").unwrap_or("").split(';').any(|part| {
            part.split_once(':').is_some_and(|(key, value)| {
                key.trim().eq_ignore_ascii_case("visibility")
                    && value.trim().eq_ignore_ascii_case("hidden")
            })
        });
        object.preview_vml = capture_shape(
            element.xml.as_bytes(),
            &root,
            &children,
            vml_anchor(&anchor),
            visible,
        );
        if let Some(presentation) = &mut object.preview_vml {
            presentation.source_order = order as u32;
        }
    }
}

pub(super) fn vml_anchor(anchor: &ControlAnchor) -> VmlCellAnchor {
    VmlCellAnchor {
        left_column: anchor.from_col,
        left_offset: vml_offset(anchor.from_col_offset, &anchor.anchor_source),
        top_row: anchor.from_row,
        top_offset: vml_offset(anchor.from_row_offset, &anchor.anchor_source),
        right_column: anchor.to_col,
        right_offset: vml_offset(anchor.to_col_offset, &anchor.anchor_source),
        bottom_row: anchor.to_row,
        bottom_offset: vml_offset(anchor.to_row_offset, &anchor.anchor_source),
    }
}

pub(super) fn safe_fragment(xml: &str) -> bool {
    elements(xml).is_some() && !raw_xml_contains_relationship_attr(xml)
}

fn set_style(style: &mut String, key: &str, value: Option<&str>) {
    let mut parts: Vec<_> = style
        .split(';')
        .filter(|part| !part.trim().is_empty())
        .filter(|part| {
            part.split_once(':')
                .is_none_or(|(name, _)| !name.trim().eq_ignore_ascii_case(key))
        })
        .map(ToOwned::to_owned)
        .collect();
    if let Some(value) = value {
        parts.push(format!("{key}:{value}"));
    }
    *style = parts.join(";");
}

pub(super) fn write_shape(
    w: &mut XmlWriter,
    object: &OleObject,
    shape_id: u32,
    preview_id: &str,
    presentation: &VmlShapePresentation,
) {
    let anchor = vml_anchor(&object.anchor);
    let mut style = presentation
        .shape_attrs
        .iter()
        .find(|(name, _)| name == "style")
        .map(|(_, value)| value.clone())
        .unwrap_or_default();
    if anchor != presentation.anchor {
        // Cell anchors define placement after a move. Replaying stale absolute
        // coordinates would conflict with the live worksheet geometry.
        set_style(&mut style, "margin-left", None);
        set_style(&mut style, "margin-top", None);
    }
    for (name, current, imported) in [
        (
            "width",
            object.preview_width_pt,
            presentation.width.as_ref(),
        ),
        (
            "height",
            object.preview_height_pt,
            presentation.height.as_ref(),
        ),
    ] {
        if let Some(current) = current
            && imported
                .and_then(|dimension| dimension.normalized_pt)
                .is_none_or(|original| (original - current).abs() > 1e-8)
        {
            set_style(&mut style, name, Some(&format!("{current}pt")));
        }
    }
    if let Some(visible) = object.preview_visible
        && visible != presentation.visible
    {
        set_style(
            &mut style,
            "visibility",
            Some(if visible { "visible" } else { "hidden" }),
        );
    }
    // Only imagedata relationships belong to this live preview owner. Other
    // relationship-bearing presentation cannot be replayed without its owner.
    let mappings: HashMap<_, _> = presentation
        .children_xml
        .iter()
        .filter(|xml| elements(xml).is_some_and(|(element, _)| element.local_name() == "imagedata"))
        .flat_map(|xml| relationship_attr_values(xml))
        .filter(|_| !preview_id.is_empty())
        .map(|id| (id, preview_id.to_string()))
        .collect();
    w.start_element("v:shape");
    for (name, value) in &presentation.namespace_attrs {
        if !presentation.shape_attrs.iter().any(|(key, _)| key == name) {
            w.attr(name, value);
        }
    }
    for (name, value) in &presentation.shape_attrs {
        if !matches!(name.as_str(), "id" | "o:spid" | "style") && !relationship_attribute(name) {
            w.attr(name, value);
        }
    }
    w.attr("id", &format!("_x0000_s{shape_id}"));
    if presentation
        .shape_attrs
        .iter()
        .any(|(key, _)| key == "o:spid")
    {
        w.attr("o:spid", &format!("_x0000_s{shape_id}"));
    }
    if !style.is_empty() {
        w.attr("style", &style);
    }
    w.end_attrs();
    let mut emitted_preview = false;
    for child in &presentation.children_xml {
        if elements(child).is_none() {
            continue;
        }
        let references = relationship_attr_values(child);
        if references.iter().all(|id| mappings.contains_key(id)) {
            emitted_preview |= !references.is_empty();
            w.raw_str(&remap_relationship_attrs(child, &mappings));
        }
    }
    if !emitted_preview && !preview_id.is_empty() {
        w.start_element("v:imagedata")
            .attr("o:relid", preview_id)
            .self_close();
    }
    w.start_element("x:ClientData");
    for (name, value) in &presentation.client_data_attrs {
        if !relationship_attribute(name) {
            w.attr(name, value);
        }
    }
    if presentation.client_data_attrs.is_empty() {
        w.attr("ObjectType", "Pict");
    }
    w.end_attrs();
    for child in &presentation.client_data_children_xml {
        if safe_fragment(child) {
            w.raw_str(child);
        }
    }
    w.element_with_text(
        "x:Anchor",
        &format!(
            "{}, {}, {}, {}, {}, {}, {}, {}",
            anchor.left_column,
            anchor.left_offset,
            anchor.top_row,
            anchor.top_offset,
            anchor.right_column,
            anchor.right_offset,
            anchor.bottom_row,
            anchor.bottom_offset
        ),
    );
    if object.preview_visible.unwrap_or(presentation.visible)
        && let Some(xml) = &presentation.visible_element_xml
        && safe_fragment(xml)
    {
        w.raw_str(xml);
    }
    w.end_element("x:ClientData");
    w.end_element("v:shape");
}

fn relationship_attribute(name: &str) -> bool {
    name.split_once(':').is_some_and(|(prefix, local)| {
        prefix != "xmlns" && matches!(local, "id" | "embed" | "link" | "relid")
    })
}
