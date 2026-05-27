use domain_types::RoundTripContext;

use super::SheetExtras;
use crate::write::{
    REL_COMMENTS, REL_CTRL_PROP, REL_DRAWING, REL_PIVOT_TABLE, REL_PRINTER_SETTINGS, REL_TABLE,
    REL_THREADED_COMMENT, REL_VML_DRAWING,
};

pub(super) fn round_trip_content_type_part_is_emitted(
    ctx: &RoundTripContext,
    part_name: &str,
) -> bool {
    let path = part_name.trim_start_matches('/');
    ctx.binary_blobs.iter().any(|part| part.path == path)
        || ctx.web_extension_parts.iter().any(|part| part.path == path)
        || ctx.custom_xml_parts.iter().any(|part| part.path == path)
        || (path == "docMetadata/LabelInfo.xml" && ctx.doc_metadata_label_info.is_some())
}

pub(super) fn keep_original_sheet_relationship(
    _pivot_data: &crate::write::pivot_writer::PivotWriteData,
    sheet_idx: usize,
    extras: &SheetExtras,
    rel: &domain_types::OpcRelationship,
) -> bool {
    let _ = sheet_idx;
    match rel.rel_type.as_str() {
        REL_TABLE => !extras.tables.is_empty(),
        REL_COMMENTS => extras.comments.is_some(),
        REL_THREADED_COMMENT => extras.threaded_comments.is_some(),
        REL_DRAWING => {
            extras.has_charts
                || extras.has_chart_ex
                || extras.has_floating_objects
                || extras.original_drawing_path.is_some()
        }
        REL_VML_DRAWING => {
            extras.comments.is_some() || extras.hf_vml.is_some() || !extras.form_controls.is_empty()
        }
        REL_PRINTER_SETTINGS => extras.has_printer_settings,
        REL_CTRL_PROP => !extras.form_controls.is_empty(),
        REL_PIVOT_TABLE => true,
        _ => true,
    }
}
