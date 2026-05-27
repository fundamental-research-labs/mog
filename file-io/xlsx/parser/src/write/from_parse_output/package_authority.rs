use domain_types::RoundTripContext;

use super::SheetExtras;
use crate::write::relationships::RelationshipManager;
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
        || (path == "xl/persons/person.xml" && ctx.raw_persons_xml.is_some())
}

pub(super) fn keep_original_workbook_relationship(
    ctx: &RoundTripContext,
    sheet_count: usize,
    rel: &domain_types::OpcRelationship,
) -> bool {
    if rel.rel_type == super::super::REL_CALC_CHAIN {
        return false;
    }
    if rel.rel_type == super::super::REL_WORKSHEET {
        let Some(sheet_idx) = ctx.sheet_workbook_r_ids.iter().position(|id| id == &rel.id) else {
            return false;
        };
        if sheet_idx >= sheet_count {
            return false;
        }
        return workbook_relationship_target_path(&rel.target).as_deref()
            == Some(format!("xl/worksheets/sheet{}.xml", sheet_idx + 1).as_str());
    }
    !matches!(
        rel.rel_type.as_str(),
        super::super::REL_STYLES
            | super::super::REL_THEME
            | super::super::REL_SHARED_STRINGS
            | super::super::REL_METADATA
    )
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

pub(super) fn ensure_root_relationships(
    root_rels: &mut RelationshipManager,
    has_doc_props: bool,
    has_custom_props: bool,
    has_web_extensions: bool,
) {
    if root_rels.find_by_target("/xl/workbook.xml").is_none()
        && root_rels.find_by_target("xl/workbook.xml").is_none()
    {
        root_rels.add(super::super::REL_OFFICE_DOCUMENT, "/xl/workbook.xml");
    }
    if has_doc_props {
        if root_rels.find_by_target("/docProps/core.xml").is_none()
            && root_rels.find_by_target("docProps/core.xml").is_none()
        {
            root_rels.add(super::super::REL_CORE_PROPERTIES, "/docProps/core.xml");
        }
        if root_rels.find_by_target("/docProps/app.xml").is_none()
            && root_rels.find_by_target("docProps/app.xml").is_none()
        {
            root_rels.add(super::super::REL_EXTENDED_PROPERTIES, "/docProps/app.xml");
        }
    }
    if has_custom_props
        && root_rels.find_by_target("/docProps/custom.xml").is_none()
        && root_rels.find_by_target("docProps/custom.xml").is_none()
    {
        root_rels.add(super::super::REL_CUSTOM_PROPERTIES, "/docProps/custom.xml");
    }
    if has_web_extensions
        && root_rels
            .find_by_target("/xl/webextensions/taskpanes.xml")
            .is_none()
        && root_rels
            .find_by_target("xl/webextensions/taskpanes.xml")
            .is_none()
    {
        root_rels.add(
            crate::domain::web_extensions::read::REL_WEB_EXTENSION_TASKPANES,
            "/xl/webextensions/taskpanes.xml",
        );
    }
}

pub(super) fn ensure_workbook_modeled_relationships(
    workbook_rels: &mut RelationshipManager,
    round_trip_ctx: Option<&RoundTripContext>,
    sheet_count: usize,
    has_theme: bool,
    has_shared_strings: bool,
    has_metadata: bool,
) {
    for sheet_idx in 0..sheet_count {
        let target = format!("worksheets/sheet{}.xml", sheet_idx + 1);
        if workbook_rels.find_by_target(&target).is_some() {
            continue;
        }
        if let Some(ctx) = round_trip_ctx
            && let Some(r_id) = ctx.sheet_workbook_r_ids.get(sheet_idx)
            && workbook_rels.get_by_id(r_id).is_none()
        {
            workbook_rels.add_with_id(r_id, super::super::REL_WORKSHEET, &target);
            continue;
        }
        workbook_rels.add(super::super::REL_WORKSHEET, &target);
    }
    if workbook_rels.find_by_target("styles.xml").is_none() {
        workbook_rels.add(super::super::REL_STYLES, "styles.xml");
    }
    if has_theme && workbook_rels.find_by_target("theme/theme1.xml").is_none() {
        workbook_rels.add(super::super::REL_THEME, "theme/theme1.xml");
    }
    if has_shared_strings && workbook_rels.find_by_target("sharedStrings.xml").is_none() {
        workbook_rels.add(super::super::REL_SHARED_STRINGS, "sharedStrings.xml");
    }
    if has_metadata && workbook_rels.find_by_target("metadata.xml").is_none() {
        workbook_rels.add(super::super::REL_METADATA, "metadata.xml");
    }
}

fn workbook_relationship_target_path(target: &str) -> Option<String> {
    let part = target.split_once('#').map_or(target, |(part, _)| part);
    crate::infra::opc::resolve_relationship_target(Some("xl/workbook.xml"), part).ok()
}
