use super::*;

pub(super) fn build_sheet_comment_package_info(
    sheet: &FullParsedSheet,
) -> Option<domain_types::SheetCommentPackageInfo> {
    let owner_path = sheet
        .owner_part_path
        .clone()
        .unwrap_or_else(|| format!("xl/worksheets/sheet{}.xml", sheet.index + 1));
    let mut info = domain_types::SheetCommentPackageInfo {
        comments_root_namespace_attrs: sheet.comments_root_namespace_attrs.clone(),
        comments_ext_lst_xml: sheet.comments_ext_lst_xml.clone(),
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

    for (vml_path, bytes, _) in &sheet.raw_vml_drawings {
        for shape in crate::domain::comments::read::parse_vml_shapes(bytes) {
            info.vml_note_shapes
                .push(domain_types::SheetVmlNoteShapeInfo {
                    vml_path: Some(vml_path.clone()),
                    cell_ref: shape.cell_ref,
                    shape_id: (!shape.id.is_empty()).then_some(shape.id),
                    width: shape.note_width_style,
                    height: shape.note_height_style,
                });
        }
    }

    (!info.is_empty()).then_some(info)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::opc::{REL_COMMENTS, REL_THREADED_COMMENT, REL_VML_DRAWING};
    use crate::output::results::FullParsedSheet;

    fn rel(id: &str, rel_type: &str, target: &str) -> ooxml_types::shared::OpcRelationship {
        ooxml_types::shared::OpcRelationship {
            id: id.to_string(),
            rel_type: rel_type.to_string(),
            target: target.to_string(),
            target_mode: None,
        }
    }

    #[test]
    fn comment_package_paths_resolve_against_actual_worksheet_owner_path() {
        let sheet = FullParsedSheet {
            index: 0,
            owner_part_path: Some("xl/worksheets/sheet6.xml".to_string()),
            legacy_drawing_r_id: Some("rIdVml".to_string()),
            comments_root_namespace_attrs: vec![
                (
                    "xmlns".to_string(),
                    "http://schemas.openxmlformats.org/spreadsheetml/2006/main".to_string(),
                ),
                (
                    "xmlns:mc".to_string(),
                    "http://schemas.openxmlformats.org/markup-compatibility/2006".to_string(),
                ),
                ("mc:Ignorable".to_string(), "xr".to_string()),
                (
                    "xmlns:xr".to_string(),
                    "http://schemas.microsoft.com/office/spreadsheetml/2014/revision".to_string(),
                ),
            ],
            sheet_opc_rels: vec![
                rel("rIdComments", REL_COMMENTS, "../comments6.xml"),
                rel("rIdVml", REL_VML_DRAWING, "../drawings/vmlDrawing6.vml"),
                rel(
                    "rIdThreaded",
                    REL_THREADED_COMMENT,
                    "../threadedComments/threadedComment6.xml",
                ),
            ],
            raw_vml_drawings: vec![("xl/drawings/vmlDrawing6.vml".to_string(), Vec::new(), None)],
            ..Default::default()
        };

        let package = build_sheet_comment_package_info(&sheet).expect("comment package");

        assert_eq!(
            package.comments_path_hint.as_deref(),
            Some("xl/comments6.xml")
        );
        assert_eq!(
            package.comments_relationship_id_hint.as_deref(),
            Some("rIdComments")
        );
        assert_eq!(
            package.vml_path_hint.as_deref(),
            Some("xl/drawings/vmlDrawing6.vml")
        );
        assert_eq!(package.vml_relationship_id_hint.as_deref(), Some("rIdVml"));
        assert_eq!(
            package.threaded_comments_path_hint.as_deref(),
            Some("xl/threadedComments/threadedComment6.xml")
        );
        assert_eq!(
            package.threaded_comments_relationship_id_hint.as_deref(),
            Some("rIdThreaded")
        );
        assert_eq!(package.comments_root_namespace_attrs.len(), 4);
    }
}
