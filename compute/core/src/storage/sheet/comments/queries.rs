use super::store::{comments, sort_comments, wire};
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::domain::comment::{Comment, CommentType};

pub fn get_comments_for_cell(
    storage: &WorkbookStorage,
    sheet: &SheetId,
    cell: &str,
) -> Vec<Comment> {
    let mut result: Vec<_> = comments(storage, sheet)
        .iter()
        .filter(|comment| comment.cell_ref.matches(cell))
        .map(wire)
        .collect();
    sort_comments(&mut result);
    result
}
pub fn get_comment(storage: &WorkbookStorage, sheet: &SheetId, id: &str) -> Option<Comment> {
    comments(storage, sheet)
        .iter()
        .find(|comment| comment.id == id)
        .map(wire)
}
pub fn has_comments(storage: &WorkbookStorage, sheet: &SheetId, cell: &str) -> bool {
    comments(storage, sheet)
        .iter()
        .any(|comment| comment.cell_ref.matches(cell))
}
pub fn get_all_comments(storage: &WorkbookStorage, sheet: &SheetId) -> Vec<Comment> {
    comments(storage, sheet).iter().map(wire).collect()
}
pub fn get_cell_ids_with_comments(storage: &WorkbookStorage, sheet: &SheetId) -> Vec<String> {
    comments(storage, sheet)
        .iter()
        .map(|comment| comment.cell_ref.clone().wire())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect()
}
pub fn get_comment_count(storage: &WorkbookStorage, sheet: &SheetId) -> u32 {
    comments(storage, sheet).len() as u32
}
pub fn get_note_count(storage: &WorkbookStorage, sheet: &SheetId) -> u32 {
    comments(storage, sheet)
        .iter()
        .filter(|comment| comment.comment_type == CommentType::Note)
        .count() as u32
}
pub fn get_all_notes(storage: &WorkbookStorage, sheet: &SheetId) -> Vec<Comment> {
    comments(storage, sheet)
        .iter()
        .filter(|comment| comment.comment_type == CommentType::Note)
        .map(wire)
        .collect()
}
pub fn get_comment_thread(
    storage: &WorkbookStorage,
    sheet: &SheetId,
    thread: &str,
) -> Vec<Comment> {
    let mut result: Vec<_> = comments(storage, sheet)
        .iter()
        .filter(|comment| comment.thread_id.as_deref() == Some(thread) || comment.id == thread)
        .map(wire)
        .collect();
    sort_comments(&mut result);
    result
}
