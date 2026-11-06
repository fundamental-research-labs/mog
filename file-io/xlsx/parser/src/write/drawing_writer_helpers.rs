//! Helpers for converting domain-types floating objects into DrawingWriter anchors.
//!
//! This module bridges domain floating objects and write-side drawing anchors while
//! keeping the public writer surface narrow.

mod anchors;
mod connectors;
mod hyperlinks;
mod images;
mod layer_order;
mod objects;
mod ooxml_props;
mod shapes;
mod smartart;

#[cfg(test)]
mod tests;

use domain_types::domain::floating_object::{FloatingObject, FloatingObjectData};

use crate::domain::drawings::write::DrawingAnchor;

pub use anchors::{
    anchor_position_to_absolute, anchor_position_to_one_cell, anchor_position_to_two_cell,
};
pub(in crate::write) use images::parse_data_url;
pub use layer_order::{add_ordered_anchors, build_feature_drawing_anchors};

/// Result of assembling drawing data for a single sheet.
///
/// Contains the drawing anchors ready for `DrawingWriter`, plus any image blobs
/// that need to be written to the ZIP archive (keyed by their relationship target path).
pub struct SheetDrawingData {
    /// Drawing anchors to feed into `DrawingWriter::add_anchor`, paired with their
    /// original anchor index in the drawing XML (from `anchorIndex` in ooxml props).
    /// `None` means the anchor index is unknown.
    pub anchors: Vec<(Option<usize>, DrawingAnchor)>,
    /// Image blobs: `(relationship_target_path, image_bytes)`.
    /// The caller is responsible for writing these to the ZIP and creating rels.
    pub image_blobs: Vec<(String, Vec<u8>)>,
    /// Image relationship entries: `(provisional_r_id, target_path)`.
    /// The provisional id is remapped after `PackageGraphBuilder` resolves the
    /// final drawing relationship ids.
    pub image_rels: Vec<(String, String)>,
    /// Non-image drawing relationship entries imported with OOXML drawing objects.
    pub drawing_rels: Vec<ooxml_types::shared::OpcRelationship>,
}

pub(super) fn floating_object_requires_drawing_part(obj: &FloatingObject) -> bool {
    matches!(
        &obj.data,
        FloatingObjectData::Picture(_)
            | FloatingObjectData::Shape(_)
            | FloatingObjectData::Textbox(_)
            | FloatingObjectData::Drawing(_)
            | FloatingObjectData::Connector(_)
            | FloatingObjectData::Diagram(_)
    )
}

/// Assemble all floating objects for a sheet into drawing anchors suitable for `DrawingWriter`.
///
/// The unified `FloatingObject` type contains all object types (pictures, shapes,
/// connectors, SmartArt, etc.) in a single Vec. This function dispatches on the
/// `data` variant to produce the appropriate `DrawingAnchor`.
///
/// This is the main entry point for the `from_parse_output` writer.
pub fn build_sheet_drawing_data(floating_objects: &[FloatingObject]) -> SheetDrawingData {
    build_sheet_drawing_data_for_owner(floating_objects, "xl/drawings/drawing1.xml")
}

pub(crate) fn build_sheet_drawing_data_for_owner(
    floating_objects: &[FloatingObject],
    drawing_owner: &str,
) -> SheetDrawingData {
    let mut anchors = Vec::new();
    let mut image_blobs: Vec<(String, Vec<u8>)> = Vec::new();
    let mut image_rels: Vec<(String, String)> = Vec::new();
    let mut drawing_rels: Vec<ooxml_types::shared::OpcRelationship> = Vec::new();

    for obj in floating_objects {
        let anchor_index = ooxml_props::get_anchor_index(&obj.data);

        match &obj.data {
            FloatingObjectData::Picture(_)
            | FloatingObjectData::Shape(_)
            | FloatingObjectData::Textbox(_) => {
                // Imported relationship IDs are local to each object's original drawing.
                // Merge only after conversion, then remap this object's descendants.
                let mut object_image_rels = Vec::new();
                let mut object_drawing_rels = Vec::new();
                if let Some(anchor) = objects::convert_floating_object(
                    obj,
                    drawing_owner,
                    &mut image_blobs,
                    &mut object_image_rels,
                    &mut object_drawing_rels,
                ) {
                    let mut anchor = anchor;
                    let mut remap = std::collections::HashMap::new();
                    for (id, target) in object_image_rels {
                        let resolved = merge_object_relationship(
                            &id,
                            crate::infra::opc::REL_IMAGE,
                            &target,
                            None,
                            &image_rels,
                            &drawing_rels,
                        );
                        if !image_rels.iter().any(|(id, _)| id == &resolved) {
                            image_rels.push((resolved.clone(), target));
                        }
                        remap.insert(id, resolved);
                    }
                    for mut rel in object_drawing_rels {
                        let resolved = merge_object_relationship(
                            &rel.id,
                            &rel.rel_type,
                            &rel.target,
                            rel.target_mode.as_deref(),
                            &image_rels,
                            &drawing_rels,
                        );
                        remap.insert(rel.id.clone(), resolved.clone());
                        rel.id = resolved;
                        if !drawing_rels.iter().any(|existing| existing.id == rel.id) {
                            drawing_rels.push(rel);
                        }
                    }
                    crate::domain::drawings::write::DrawingWriter::remap_anchor_relationship_ids(
                        &mut anchor,
                        &remap,
                    );
                    hyperlinks::register_anchor_hyperlink_relationships(
                        &mut anchor,
                        &mut drawing_rels,
                        &image_rels,
                    );
                    anchors.push((anchor_index, anchor));
                }
            }
            FloatingObjectData::Drawing(drawing_data) => {
                if let Some(ref ooxml) = drawing_data.ooxml {
                    drawing_rels.extend(ooxml.relationships.clone());
                    let drawing_obj = match &ooxml.object {
                        domain_types::domain::floating_object::DrawingObjectOoxml::ContentPart {
                            content_part,
                        } => crate::domain::drawings::write::DrawingObject::ContentPart(
                            content_part.clone(),
                        ),
                        domain_types::domain::floating_object::DrawingObjectOoxml::GraphicFrame {
                            graphic_frame,
                        } => crate::domain::drawings::write::DrawingObject::GraphicFrame(
                            {
                                let raw_xml = graphic_frame.graphic_xml.clone().unwrap_or_default();
                                if is_chart_graphic_frame_xml(&raw_xml) {
                                    continue;
                                }
                                crate::domain::drawings::write::OpaqueGraphicFrame { raw_xml }
                            },
                        ),
                        domain_types::domain::floating_object::DrawingObjectOoxml::Unknown => {
                            continue;
                        }
                    };
                    let position = anchors::anchor_to_legacy_position(&obj.common.anchor);
                    let size = domain_types::domain::chart::ObjectSize {
                        width: obj.common.width,
                        height: obj.common.height,
                        ..Default::default()
                    };
                    let mut anchor = anchors::wrap_in_anchor(
                        &position,
                        &size,
                        ooxml.edit_as.as_deref(),
                        ooxml.extent_emu_cx.zip(ooxml.extent_emu_cy),
                        drawing_obj,
                    );
                    let restored_client_data = crate::domain::drawings::write::ClientData {
                        locks_with_sheet: ooxml.client_data_locks_with_sheet.unwrap_or(true),
                        prints_with_sheet: ooxml.client_data_prints_with_sheet.unwrap_or(true),
                    };
                    match &mut anchor {
                        DrawingAnchor::TwoCell(tc, _) => tc.client_data = restored_client_data,
                        DrawingAnchor::OneCell(oc, _) => oc.client_data = restored_client_data,
                        DrawingAnchor::Absolute(abs, _) => abs.client_data = restored_client_data,
                    }
                    hyperlinks::register_anchor_hyperlink_relationships(
                        &mut anchor,
                        &mut drawing_rels,
                        &image_rels,
                    );
                    anchors.push((ooxml.anchor_index.map(|idx| idx as usize), anchor));
                }
            }
            FloatingObjectData::Connector(conn_data) => {
                if conn_data
                    .ooxml
                    .as_ref()
                    .is_some_and(|ooxml| ooxml.nested_in_group)
                {
                    continue;
                }
                let mut anchor =
                    connectors::convert_unified_connector_to_anchor(&obj.common, conn_data);
                hyperlinks::register_anchor_hyperlink_relationships(
                    &mut anchor,
                    &mut drawing_rels,
                    &image_rels,
                );
                anchors.push((anchor_index, anchor));
            }
            FloatingObjectData::Diagram(diagram_data) => {
                let anchor =
                    smartart::convert_unified_smartart_to_anchor(&obj.common, diagram_data);
                anchors.push((anchor_index, anchor));
            }
            _ => {}
        }
    }

    SheetDrawingData {
        anchors,
        image_blobs,
        image_rels,
        drawing_rels,
    }
}

fn is_chart_graphic_frame_xml(xml: &str) -> bool {
    xml.contains("schemas.openxmlformats.org/drawingml/2006/chart")
        || xml.contains("schemas.microsoft.com/office/drawing/2014/chartex")
        || xml.contains("<c:chart")
        || xml.contains("<cx:chart")
}

/// Preserve an imported ID if available; otherwise allocate a drawing-local ID.
fn merge_object_relationship(
    preferred: &str,
    rel_type: &str,
    target: &str,
    target_mode: Option<&str>,
    image_rels: &[(String, String)],
    drawing_rels: &[ooxml_types::shared::OpcRelationship],
) -> String {
    let mut candidate = preferred.to_string();
    let mut suffix = 1;
    loop {
        let image = image_rels.iter().find(|(id, _)| id == &candidate);
        let drawing = drawing_rels.iter().find(|rel| rel.id == candidate);
        let same_image = image.is_some_and(|(_, path)| path == target)
            && rel_type == crate::infra::opc::REL_IMAGE
            && target_mode.is_none();
        let same_drawing = drawing.is_some_and(|rel| {
            rel.rel_type == rel_type
                && rel.target == target
                && rel.target_mode.as_deref() == target_mode
        });
        if (image.is_none() && drawing.is_none()) || same_image || same_drawing {
            return candidate;
        }
        candidate = format!("rId{suffix}");
        suffix += 1;
    }
}
