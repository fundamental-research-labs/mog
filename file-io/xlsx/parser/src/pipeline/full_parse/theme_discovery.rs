use ooxml_types::shared::OpcRelationship;

use crate::domain::content_types::read::{CONTENT_TYPE_THEME, ContentTypes};
use crate::infra::opc::{REL_THEME, resolve_relationship_target};
use crate::zip::XlsxArchive;

#[derive(Debug, Clone, Default)]
pub(super) struct WorkbookThemePart {
    pub path: String,
    pub relationship_id_hint: Option<String>,
    pub relationship_type: Option<String>,
}

pub(super) fn discover_workbook_theme_part(
    archive: &XlsxArchive<'_>,
    workbook_relationships: &[OpcRelationship],
    content_types: Option<&ContentTypes>,
) -> Option<WorkbookThemePart> {
    for rel in workbook_relationships {
        if !crate::infra::opc::is_theme_relationship_type(&rel.rel_type) {
            continue;
        }
        if rel
            .target_mode
            .as_deref()
            .is_some_and(|mode| mode.eq_ignore_ascii_case("External"))
        {
            continue;
        }
        let Ok(path) = resolve_relationship_target(Some("xl/workbook.xml"), &rel.target) else {
            continue;
        };
        if !archive.contains(&path) {
            continue;
        }
        if let Some(content_types) = content_types {
            if content_types.get_type(&path) != Some(CONTENT_TYPE_THEME) {
                continue;
            }
        }
        return Some(WorkbookThemePart {
            path,
            relationship_id_hint: Some(rel.id.clone()),
            relationship_type: Some(rel.rel_type.clone()),
        });
    }

    match archive.read_file("xl/theme/theme1.xml") {
        Ok(_) => Some(WorkbookThemePart {
            path: "xl/theme/theme1.xml".to_string(),
            relationship_id_hint: None,
            relationship_type: Some(REL_THEME.to_string()),
        }),
        Err(_) => None,
    }
}
