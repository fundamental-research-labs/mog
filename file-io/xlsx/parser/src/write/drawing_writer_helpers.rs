//! Helpers for converting domain-types floating objects into DrawingWriter anchors.
//!
//! This module bridges domain floating objects and write-side drawing anchors while
//! keeping the public writer surface narrow.

mod anchors;
mod connectors;
mod images;
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
}

/// Assemble all floating objects for a sheet into drawing anchors suitable for `DrawingWriter`.
///
/// The unified `FloatingObject` type contains all object types (pictures, shapes,
/// connectors, SmartArt, etc.) in a single Vec. This function dispatches on the
/// `data` variant to produce the appropriate `DrawingAnchor`.
///
/// This is the main entry point for the `from_parse_output` writer.
pub fn build_sheet_drawing_data(floating_objects: &[FloatingObject]) -> SheetDrawingData {
    let mut anchors = Vec::new();
    let mut image_blobs: Vec<(String, Vec<u8>)> = Vec::new();
    let mut image_rels: Vec<(String, String)> = Vec::new();

    for obj in floating_objects {
        let anchor_index = ooxml_props::get_anchor_index(&obj.data);

        match &obj.data {
            FloatingObjectData::Picture(_)
            | FloatingObjectData::Shape(_)
            | FloatingObjectData::Textbox(_) => {
                if let Some(anchor) =
                    objects::convert_floating_object(obj, &mut image_blobs, &mut image_rels)
                {
                    anchors.push((anchor_index, anchor));
                }
            }
            FloatingObjectData::Drawing(_) => {}
            FloatingObjectData::Connector(conn_data) => {
                let anchor =
                    connectors::convert_unified_connector_to_anchor(&obj.common, conn_data);
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
    }
}
