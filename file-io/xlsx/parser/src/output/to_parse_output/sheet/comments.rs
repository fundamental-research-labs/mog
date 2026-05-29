use super::*;

pub(super) fn build_sheet_comments(sheet: &FullParsedSheet) -> Vec<Comment> {
    let mut comments: Vec<Comment> = sheet
        .comments
        .iter()
        .map(|c| {
            let author = sheet
                .comment_authors
                .get(c.author_id as usize)
                .cloned()
                .unwrap_or_default();
            Comment {
                id: String::new(),
                cell_ref: c.cell_ref.clone(),
                author,
                author_id: None,
                author_email: None,
                content: Some(c.text.clone()),
                runs: convert_comment_runs(&c.runs),
                thread_id: None,
                parent_id: None,
                person_id: None,
                resolved: Some(false),
                timestamp: None,
                created_at: None,
                modified_at: None,
                xr_uid: c.xr_uid.clone(),
                shape_id: c.shape_id,
                ext_lst_xml: None,
                content_type: None,
                mentions: Vec::new(),
                comment_type: domain_types::domain::comment::CommentType::Note,
                visible: None,
                note_height: None,
                note_width: None,
                note_shape_anchor: None,
                comment_pr: c.comment_pr.clone(),
            }
        })
        .collect();

    // --- Hydrate VML shape data (visible, note_height, note_width) onto note comments ---
    {
        use crate::domain::comments::read::parse_vml_shapes;
        struct ShapeData {
            visible: bool,
            note_height: Option<f64>,
            note_width: Option<f64>,
            note_shape_anchor: domain_types::domain::comment::NoteShapeAnchor,
        }
        let mut shape_by_cell: HashMap<String, ShapeData> = HashMap::new();
        for (_, bytes, _) in &sheet.raw_vml_drawings {
            for shape in parse_vml_shapes(bytes) {
                if let Some(ref cell_ref) = shape.cell_ref {
                    shape_by_cell.entry(cell_ref.clone()).or_insert(ShapeData {
                        visible: shape.visible,
                        note_height: shape.note_height,
                        note_width: shape.note_width,
                        note_shape_anchor: domain_types::domain::comment::NoteShapeAnchor {
                            left_column: shape.left_column,
                            left_offset: shape.left_offset,
                            top_row: shape.top_row,
                            top_offset: shape.top_offset,
                            right_column: shape.right_column,
                            right_offset: shape.right_offset,
                            bottom_row: shape.bottom_row,
                            bottom_offset: shape.bottom_offset,
                        },
                    });
                }
            }
        }
        if !shape_by_cell.is_empty() {
            for comment in comments.iter_mut() {
                if let Some(data) = shape_by_cell.get(&comment.cell_ref) {
                    if data.visible {
                        comment.visible = Some(true);
                    }
                    comment.note_height = data.note_height;
                    comment.note_width = data.note_width;
                    comment.note_shape_anchor = Some(data.note_shape_anchor.clone());
                }
            }
        }
    }

    comments
}
