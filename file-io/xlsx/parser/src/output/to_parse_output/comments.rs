use super::*;

pub(super) fn build_sheet_comment_package_info(
    sheet: &FullParsedSheet,
) -> Option<domain_types::SheetCommentPackageInfo> {
    let owner_path = format!("xl/worksheets/sheet{}.xml", sheet.index + 1);
    let mut info = domain_types::SheetCommentPackageInfo {
        comments_root_namespace_attrs: sheet.comments_root_namespace_attrs.clone(),
        ..Default::default()
    };

    for rel in &sheet.sheet_opc_rels {
        let Ok(path) = resolve_relationship_target(Some(&owner_path), &rel.target) else {
            continue;
        };
        match rel.rel_type.as_str() {
            REL_COMMENTS => {
                info.comments_path_hint = Some(path);
                info.comments_relationship_id_hint = Some(rel.id.clone());
            }
            REL_VML_DRAWING => {
                if sheet.legacy_drawing_r_id.as_deref() == Some(rel.id.as_str())
                    && sheet
                        .raw_vml_drawings
                        .iter()
                        .any(|(vml_path, _, _)| vml_path == &path)
                {
                    info.vml_path_hint = Some(path);
                    info.vml_relationship_id_hint = Some(rel.id.clone());
                }
            }
            REL_THREADED_COMMENT => {
                info.threaded_comments_path_hint = Some(path.clone());
                info.threaded_comments_relationship_id_hint = Some(rel.id.clone());
            }
            _ => {}
        }
    }

    (!info.is_empty()).then_some(info)
}
