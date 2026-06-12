use domain_types::domain::chart::ObjectSize;
use domain_types::domain::floating_object::{FloatingObject, FloatingObjectData};

use crate::domain::drawings::write::{ClientData, DrawingAnchor, DrawingObject};

use super::anchors::{anchor_mode_to_edit_as, anchor_to_legacy_position, wrap_in_anchor};
use super::images::{convert_image, next_available_image_r_id, push_image_blob_if_data_url};
use super::ooxml_props::get_anchor_ooxml_props;
use super::shapes::{
    convert_group_fallback, convert_group_from_data, convert_shape, convert_text_box,
};

/// Convert a unified `FloatingObject` (Picture/Shape/Textbox/Drawing) into a `DrawingAnchor`.
///
/// Dispatches on `data` variant. Returns `None` if the object type cannot be converted.
pub(super) fn convert_floating_object(
    obj: &FloatingObject,
    image_blobs: &mut Vec<(String, Vec<u8>)>,
    image_rels: &mut Vec<(String, String)>,
    drawing_rels: &mut Vec<ooxml_types::shared::OpcRelationship>,
) -> Option<DrawingAnchor> {
    let drawing_obj = match &obj.data {
        FloatingObjectData::Picture(pic_data) => {
            if let Some(ref ooxml) = pic_data.ooxml {
                let mut image_props =
                    crate::domain::drawings::write::convert::picture_to_image_props(&ooxml.picture);
                if let Some(ref image_path) = ooxml.image_path {
                    let r_id = reusable_image_relationship_id(ooxml, image_path, image_rels)
                        .unwrap_or_else(|| next_available_image_r_id(image_rels));
                    image_props.r_id = r_id.clone();
                    if !image_rels.iter().any(|(existing_id, existing_path)| {
                        existing_id == &r_id && existing_path == image_path
                    }) {
                        image_rels.push((r_id, image_path.clone()));
                    }
                    push_image_blob_if_data_url(image_blobs, image_path, &pic_data.src);
                }
                drawing_rels.extend(
                    ooxml
                        .relationships
                        .iter()
                        .filter(|relationship| {
                            Some(relationship.id.as_str())
                                != ooxml.picture.blip_fill.embed_id.as_deref()
                        })
                        .cloned(),
                );
                DrawingObject::Picture(image_props)
            } else {
                convert_image(&obj.common, &pic_data.src, image_blobs, image_rels)?
            }
        }
        FloatingObjectData::Shape(shape_data) => {
            if let Some(ref ooxml) = shape_data.ooxml {
                if shape_data.shape_type == "group" {
                    if let Some(ref grp) = ooxml.group_shape {
                        DrawingObject::GroupShape(convert_group_from_data(&obj.common, grp))
                    } else {
                        DrawingObject::GroupShape(convert_group_fallback(&obj.common))
                    }
                } else {
                    let text_box =
                        crate::domain::drawings::write::convert::shape_to_text_box(&ooxml.shape);
                    DrawingObject::TextBox(text_box)
                }
            } else if shape_data.shape_type == "group" {
                DrawingObject::GroupShape(convert_group_fallback(&obj.common))
            } else {
                DrawingObject::Shape(convert_shape(&obj.common, shape_data))
            }
        }
        FloatingObjectData::Textbox(tb_data) => {
            if let Some(ref ooxml) = tb_data.ooxml {
                let text_box =
                    crate::domain::drawings::write::convert::shape_to_text_box(&ooxml.shape);
                DrawingObject::TextBox(text_box)
            } else {
                DrawingObject::TextBox(convert_text_box(&obj.common, tb_data))
            }
        }
        _ => return None,
    };

    let position = anchor_to_legacy_position(&obj.common.anchor);
    let size = ObjectSize {
        width: obj.common.width,
        height: obj.common.height,
        ..Default::default()
    };

    let anchor_props = get_anchor_ooxml_props(&obj.data, &obj.common.anchor);
    let extent_emu = anchor_props.extent_emu;
    let edit_as_str = anchor_props
        .edit_as
        .or_else(|| anchor_mode_to_edit_as(&obj.common.anchor.anchor_mode));

    let mut anchor = wrap_in_anchor(
        &position,
        &size,
        edit_as_str.as_deref(),
        extent_emu,
        drawing_obj,
    );

    if let Some(ref raw_xml) = anchor_props.mc_alternate_content_raw_xml {
        let mc = crate::domain::drawings::McAlternateContent {
            raw_xml: raw_xml.clone(),
        };
        if let DrawingAnchor::TwoCell(tc, _) = &mut anchor {
            tc.mc_alternate_content = Some(mc)
        }
    }

    let restored_client_data = ClientData {
        locks_with_sheet: anchor_props.client_data_locks_with_sheet.unwrap_or(true),
        prints_with_sheet: anchor_props.client_data_prints_with_sheet.unwrap_or(true),
    };
    match &mut anchor {
        DrawingAnchor::TwoCell(tc, _) => tc.client_data = restored_client_data,
        DrawingAnchor::OneCell(oc, _) => oc.client_data = restored_client_data,
        _ => {}
    }

    Some(anchor)
}

fn reusable_image_relationship_id(
    ooxml: &domain_types::domain::floating_object::PictureOoxmlProps,
    image_path: &str,
    image_rels: &[(String, String)],
) -> Option<String> {
    let embed_id = ooxml.picture.blip_fill.embed_id.as_deref()?;
    let relationship = ooxml
        .relationships
        .iter()
        .find(|relationship| relationship.id == embed_id && relationship.target == image_path)?;

    if image_rels
        .iter()
        .any(|(id, target)| id == &relationship.id && target != &relationship.target)
    {
        return None;
    }

    Some(relationship.id.clone())
}
