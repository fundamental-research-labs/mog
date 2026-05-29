use std::collections::HashMap;

use ooxml_types::shared::OpcRelationship;

use crate::domain::web_extensions::read::{
    CT_WEB_EXTENSION_TASKPANES, REL_WEB_EXTENSION_TASKPANES,
};
use crate::infra::opc::{
    REL_CHART, REL_CHART_EX, REL_CHART_USER_SHAPES, REL_COMMENTS, REL_CORE_PROPERTIES,
    REL_CUSTOM_PROPERTIES, REL_DRAWING, REL_EXTENDED_PROPERTIES, REL_OFFICE_DOCUMENT,
    REL_SHARED_STRINGS, REL_STYLES, REL_TABLE, REL_THEME, REL_THREADED_COMMENT, REL_VML_DRAWING,
    REL_WORKSHEET, relationship_owner_from_rels_path, resolve_relationship_target,
};
use crate::write::{
    CT_CHART, CT_COMMENTS, CT_CORE_PROPERTIES, CT_CUSTOM_PROPERTIES, CT_DRAWING,
    CT_EXTENDED_PROPERTIES, CT_SHARED_STRINGS, CT_STYLES, CT_TABLE, CT_THEME, CT_WORKSHEET,
};
use crate::zip::XlsxArchive;

use super::content_types::require_content_type;
use super::error::PackageIntegrityError;
use super::paths::{
    is_chart_ex_part, is_chart_part, is_comment_part, is_drawing_part,
    is_relationship_reference_part, is_table_part, is_threaded_comment_part, is_vml_part,
    is_worksheet_part, relationship_target_part,
};
use super::refs::{validate_part_relationship_references, validate_worksheet_r_ids};

const CT_CHART_EX: &str = "application/vnd.ms-office.chartex+xml";
const CT_THREADED_COMMENTS: &str = "application/vnd.ms-excel.threadedcomments+xml";
const CT_VML_DRAWING: &str = "application/vnd.openxmlformats-officedocument.vmlDrawing";

pub(super) fn validate_modeled_part_invariants(
    archive: &XlsxArchive<'_>,
    relationships_by_part: &HashMap<String, Vec<OpcRelationship>>,
    errors: &mut Vec<PackageIntegrityError>,
) {
    require_relationship(
        relationships_by_part,
        "_rels/.rels",
        REL_OFFICE_DOCUMENT,
        "xl/workbook.xml",
        errors,
    );

    if archive.contains("docProps/core.xml") {
        require_relationship(
            relationships_by_part,
            "_rels/.rels",
            REL_CORE_PROPERTIES,
            "docProps/core.xml",
            errors,
        );
        require_content_type(archive, "docProps/core.xml", CT_CORE_PROPERTIES, errors);
    }
    if archive.contains("docProps/app.xml") {
        require_relationship(
            relationships_by_part,
            "_rels/.rels",
            REL_EXTENDED_PROPERTIES,
            "docProps/app.xml",
            errors,
        );
        require_content_type(archive, "docProps/app.xml", CT_EXTENDED_PROPERTIES, errors);
    }
    if archive.contains("docProps/custom.xml") {
        require_relationship(
            relationships_by_part,
            "_rels/.rels",
            REL_CUSTOM_PROPERTIES,
            "docProps/custom.xml",
            errors,
        );
        require_content_type(archive, "docProps/custom.xml", CT_CUSTOM_PROPERTIES, errors);
    }
    if archive.contains("xl/webextensions/taskpanes.xml") {
        require_relationship(
            relationships_by_part,
            "_rels/.rels",
            REL_WEB_EXTENSION_TASKPANES,
            "xl/webextensions/taskpanes.xml",
            errors,
        );
        require_content_type(
            archive,
            "xl/webextensions/taskpanes.xml",
            CT_WEB_EXTENSION_TASKPANES,
            errors,
        );
    }

    let workbook_rels = "xl/_rels/workbook.xml.rels";
    if archive.contains("xl/sharedStrings.xml") {
        require_relationship(
            relationships_by_part,
            workbook_rels,
            REL_SHARED_STRINGS,
            "xl/sharedStrings.xml",
            errors,
        );
        require_content_type(archive, "xl/sharedStrings.xml", CT_SHARED_STRINGS, errors);
    }
    if archive.contains("xl/styles.xml") {
        require_relationship(
            relationships_by_part,
            workbook_rels,
            REL_STYLES,
            "xl/styles.xml",
            errors,
        );
        require_content_type(archive, "xl/styles.xml", CT_STYLES, errors);
    }
    for entry in archive.entries() {
        let path = entry.name.as_str();
        if path.starts_with("xl/theme/") && path.ends_with(".xml") {
            require_relationship(
                relationships_by_part,
                workbook_rels,
                REL_THEME,
                path,
                errors,
            );
            require_content_type(archive, path, CT_THEME, errors);
        }
        if is_relationship_reference_part(path) && !is_worksheet_part(path) {
            validate_part_relationship_references(archive, path, relationships_by_part, errors);
        }
        if is_worksheet_part(path) {
            require_relationship(
                relationships_by_part,
                workbook_rels,
                REL_WORKSHEET,
                path,
                errors,
            );
            require_content_type(archive, path, CT_WORKSHEET, errors);
            validate_worksheet_r_ids(archive, path, relationships_by_part, errors);
        } else if is_table_part(path) {
            require_any_relationship_to_path(relationships_by_part, REL_TABLE, path, errors);
            require_content_type(archive, path, CT_TABLE, errors);
        } else if is_comment_part(path) {
            require_any_relationship_to_path(relationships_by_part, REL_COMMENTS, path, errors);
            require_content_type(archive, path, CT_COMMENTS, errors);
        } else if is_vml_part(path) {
            require_any_relationship_to_path(relationships_by_part, REL_VML_DRAWING, path, errors);
            require_content_type(archive, path, CT_VML_DRAWING, errors);
        } else if is_threaded_comment_part(path) {
            require_any_relationship_to_path(
                relationships_by_part,
                REL_THREADED_COMMENT,
                path,
                errors,
            );
            require_content_type(archive, path, CT_THREADED_COMMENTS, errors);
        } else if is_drawing_part(path) {
            if has_any_relationship_to_path(relationships_by_part, REL_CHART_USER_SHAPES, path) {
                require_any_relationship_to_path(
                    relationships_by_part,
                    REL_CHART_USER_SHAPES,
                    path,
                    errors,
                );
            } else {
                require_any_relationship_to_path(relationships_by_part, REL_DRAWING, path, errors);
            }
            require_content_type(archive, path, CT_DRAWING, errors);
        } else if is_chart_ex_part(path) {
            require_any_relationship_to_path(relationships_by_part, REL_CHART_EX, path, errors);
            require_content_type(archive, path, CT_CHART_EX, errors);
        } else if is_chart_part(path) {
            require_any_relationship_to_path(relationships_by_part, REL_CHART, path, errors);
            require_content_type(archive, path, CT_CHART, errors);
        }
    }
}

fn require_relationship(
    relationships_by_part: &HashMap<String, Vec<OpcRelationship>>,
    rels_path: &'static str,
    rel_type: &'static str,
    target_path: &str,
    errors: &mut Vec<PackageIntegrityError>,
) {
    if has_relationship_to_path(relationships_by_part, rels_path, rel_type, target_path) {
        return;
    }
    errors.push(PackageIntegrityError::MissingRequiredRelationship {
        rels_path: rels_path.to_string(),
        rel_type,
        target_path: target_path.to_string(),
    });
}

fn require_any_relationship_to_path(
    relationships_by_part: &HashMap<String, Vec<OpcRelationship>>,
    rel_type: &'static str,
    target_path: &str,
    errors: &mut Vec<PackageIntegrityError>,
) {
    if relationships_by_part.keys().any(|rels_path| {
        has_relationship_to_path(relationships_by_part, rels_path, rel_type, target_path)
    }) {
        return;
    }
    errors.push(PackageIntegrityError::MissingRequiredRelationship {
        rels_path: "*".to_string(),
        rel_type,
        target_path: target_path.to_string(),
    });
}

fn has_any_relationship_to_path(
    relationships_by_part: &HashMap<String, Vec<OpcRelationship>>,
    rel_type: &str,
    target_path: &str,
) -> bool {
    relationships_by_part.keys().any(|rels_path| {
        has_relationship_to_path(relationships_by_part, rels_path, rel_type, target_path)
    })
}

fn has_relationship_to_path(
    relationships_by_part: &HashMap<String, Vec<OpcRelationship>>,
    rels_path: &str,
    rel_type: &str,
    target_path: &str,
) -> bool {
    let owner = relationship_owner_from_rels_path(rels_path);
    relationships_by_part
        .get(rels_path)
        .into_iter()
        .flatten()
        .any(|rel| {
            (rel.rel_type == rel_type
                || (rel_type == REL_THEME
                    && crate::infra::opc::is_theme_relationship_type(&rel.rel_type)))
                && rel.target_mode.as_deref() != Some("External")
                && relationship_target_part(&rel.target)
                    .and_then(|target| resolve_relationship_target(owner.as_deref(), target).ok())
                    .as_deref()
                    == Some(target_path)
        })
}
