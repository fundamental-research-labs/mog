use super::store::{comment_mut, wire};
use crate::storage::WorkbookStorage;
use crate::storage::infra::time::now_millis;
use cell_types::SheetId;
use domain_types::domain::comment::{Comment, CommentType};

pub fn set_note_visible(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
    visible: bool,
) -> bool {
    let Some(comment) = comment_mut(storage, sheet, id) else {
        return false;
    };
    comment.visible = Some(visible);
    true
}
pub fn set_note_dimensions(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
    height: Option<f64>,
    width: Option<f64>,
) -> bool {
    let Some(comment) = comment_mut(storage, sheet, id) else {
        return false;
    };
    if let Some(value) = height {
        comment.note_height = Some(value);
    }
    if let Some(value) = width {
        comment.note_width = Some(value);
    }
    true
}
pub fn convert_note_to_thread(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
) -> Option<Comment> {
    let comment = comment_mut(storage, sheet, id)?;
    if comment.comment_type != CommentType::ThreadedComment {
        comment.comment_type = CommentType::ThreadedComment;
        comment.thread_id = Some(id.to_owned());
        comment.note_height = None;
        comment.note_width = None;
        comment.visible = None;
        comment.shape_id = None;
        comment.modified_at = Some(now_millis());
    }
    Some(wire(comment))
}
