use super::connectors::connector_to_props;
use super::graphic_frames::extract_chart_ref_from_graphic_frame;
use super::groups::{group_shape_to_props, relationship_ids_for_group};
use super::outcome::{
    DrawingConversionOutcome, relationship_ids_for_graphic_frame, relationship_ids_for_non_visual,
    relationship_ids_for_opaque_unknown, relationship_ids_for_picture,
    relationship_ids_for_smartart,
};
use super::pictures::picture_to_image_props;
use super::shapes::shape_to_text_box;
use super::smartart::smartart_to_write_data;
use super::write::OpaqueDrawingObject;
use super::{read, write};

/// Convert a read-side `DrawingContent` to a write-side `DrawingObject`.
///
/// Returns `None` only for payload-less `DrawingContent::Unknown` values.
pub fn convert_drawing_content(content: &read::DrawingContent) -> Option<write::DrawingObject> {
    convert_drawing_content_with_outcome(content).object
}

/// Convert read-side drawing content and report the conversion contract outcome.
pub fn convert_drawing_content_with_outcome(
    content: &read::DrawingContent,
) -> DrawingConversionOutcome {
    match content {
        read::DrawingContent::Picture(p) => DrawingConversionOutcome::emitted(
            write::DrawingObject::Picture(picture_to_image_props(p)),
            relationship_ids_for_picture(p),
        ),
        read::DrawingContent::Shape(s) => DrawingConversionOutcome::emitted(
            write::DrawingObject::TextBox(shape_to_text_box(s)),
            relationship_ids_for_non_visual(&s.nv_sp_pr.c_nv_pr),
        ),
        read::DrawingContent::GroupShape(g) => DrawingConversionOutcome::emitted(
            write::DrawingObject::GroupShape(group_shape_to_props(g)),
            relationship_ids_for_group(g),
        ),
        read::DrawingContent::Connector(c) => DrawingConversionOutcome::emitted(
            write::DrawingObject::Connector(connector_to_props(c)),
            relationship_ids_for_non_visual(&c.nv_cxn_sp_pr.c_nv_pr),
        ),
        read::DrawingContent::GraphicFrame(gf) => {
            if let Some(chart_ref) = extract_chart_ref_from_graphic_frame(gf) {
                let rel_id = chart_ref.r_id.clone();
                DrawingConversionOutcome::emitted(
                    write::DrawingObject::Chart(chart_ref),
                    vec![rel_id],
                )
            } else {
                DrawingConversionOutcome::opaque(
                    write::DrawingObject::GraphicFrame(write::OpaqueGraphicFrame {
                        raw_xml: gf.graphic_xml.clone().unwrap_or_default(),
                    }),
                    relationship_ids_for_graphic_frame(gf),
                )
            }
        }
        read::DrawingContent::SmartArt(sa) => DrawingConversionOutcome::emitted(
            write::DrawingObject::SmartArt(smartart_to_write_data(sa)),
            relationship_ids_for_smartart(sa),
        ),
        read::DrawingContent::ContentPart(content_part) => DrawingConversionOutcome::emitted(
            write::DrawingObject::ContentPart(content_part.clone()),
            vec![content_part.r_id.clone()],
        ),
        read::DrawingContent::OpaqueUnknown(opaque) => {
            if opaque.raw_xml.is_empty() {
                DrawingConversionOutcome::unsupported("unknown drawing content without raw XML")
            } else {
                DrawingConversionOutcome::opaque(
                    write::DrawingObject::OpaqueRaw(OpaqueDrawingObject {
                        raw_xml: opaque.raw_xml.clone(),
                    }),
                    relationship_ids_for_opaque_unknown(opaque),
                )
            }
        }
        read::DrawingContent::Unknown => {
            DrawingConversionOutcome::unsupported("unknown drawing content")
        }
    }
}
