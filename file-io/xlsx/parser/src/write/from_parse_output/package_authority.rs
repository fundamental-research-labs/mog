use domain_types::RoundTripContext;

use super::SheetExtras;
use crate::write::{
    REL_CHART, REL_CHART_EX, REL_COMMENTS, REL_CTRL_PROP, REL_DIAGRAM_COLORS, REL_DIAGRAM_DATA,
    REL_DIAGRAM_DRAWING, REL_DIAGRAM_LAYOUT, REL_DIAGRAM_QUICK_STYLE, REL_DRAWING, REL_HYPERLINK,
    REL_PIVOT_TABLE, REL_PRINTER_SETTINGS, REL_TABLE, REL_THREADED_COMMENT, REL_VML_DRAWING,
};

const REL_IMAGE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

fn emits_opaque_ownership(ownership: domain_types::OpaquePackageOwnership) -> bool {
    matches!(
        ownership,
        domain_types::OpaquePackageOwnership::CleanImported
            | domain_types::OpaquePackageOwnership::OrphanCleanPackageData
    )
}

pub(super) fn round_trip_content_type_part_is_emitted(
    ctx: &RoundTripContext,
    part_name: &str,
) -> bool {
    let path = part_name.trim_start_matches('/');
    if !ctx.opaque_package_subgraphs.is_empty() {
        return ctx.opaque_package_subgraphs.iter().any(|subgraph| {
            emits_opaque_ownership(subgraph.ownership)
                && subgraph.parts.iter().any(|part| {
                    emits_opaque_ownership(part.ownership)
                        && part.part.path.trim_start_matches('/') == path
                })
        }) || (path == "docMetadata/LabelInfo.xml"
            && ctx.doc_metadata_label_info.is_some());
    }
    path == "docMetadata/LabelInfo.xml" && ctx.doc_metadata_label_info.is_some()
}

pub(super) fn round_trip_default_extension_is_emitted(
    ctx: &RoundTripContext,
    pivot_data: &crate::write::pivot_writer::PivotWriteData,
    extension: &str,
) -> bool {
    let extension = extension.trim_start_matches('.').to_ascii_lowercase();
    if ctx.opaque_package_subgraphs.is_empty() {
        let _ = pivot_data;
        return false;
    }

    ctx.opaque_package_subgraphs.iter().any(|subgraph| {
        emits_opaque_ownership(subgraph.ownership)
            && subgraph.parts.iter().any(|part| {
                emits_opaque_ownership(part.ownership)
                    && (part
                        .default_extension
                        .as_ref()
                        .is_some_and(|(ext, _)| ext.eq_ignore_ascii_case(&extension))
                        || part_extension(&part.part.path).as_deref() == Some(extension.as_str()))
            })
    })
}

pub(super) fn keep_round_trip_binary_blob(
    _ctx: &RoundTripContext,
    pivot_data: &crate::write::pivot_writer::PivotWriteData,
    path: &str,
) -> bool {
    if !super::pivot_package::keep_binary_blob(pivot_data, path) {
        return false;
    }
    if pivot_data.has_typed_package_contract
        && pivot_data
            .preserved_part_paths
            .contains(path.trim_start_matches('/'))
    {
        return false;
    }
    false
}

fn part_extension(path: &str) -> Option<String> {
    path.rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
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
        REL_HYPERLINK => extras.has_external_hyperlinks,
        _ => false,
    }
}

pub(super) fn keep_original_drawing_relationship(
    extras: &SheetExtras,
    rel: &domain_types::OpcRelationship,
) -> bool {
    match rel.rel_type.as_str() {
        REL_CHART => extras.has_charts,
        REL_CHART_EX => extras.has_chart_ex,
        REL_IMAGE => extras.has_floating_objects,
        REL_HYPERLINK => extras.has_charts || extras.has_chart_ex || extras.has_floating_objects,
        REL_DIAGRAM_DATA
        | REL_DIAGRAM_LAYOUT
        | REL_DIAGRAM_COLORS
        | REL_DIAGRAM_QUICK_STYLE
        | REL_DIAGRAM_DRAWING => extras.has_floating_objects,
        _ => false,
    }
}
