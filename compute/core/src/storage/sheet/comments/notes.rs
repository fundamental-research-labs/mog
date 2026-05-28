use std::sync::Arc;

use yrs::{Any, Doc, Map, MapRef, Origin, Out, Transact};

use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::comment::{Comment, CommentType};
use domain_types::yrs_schema::comment as comment_schema;

use super::yrs_io::get_comments_map;
use crate::storage::infra::yrs_helpers::now_millis;

/// Set the `visible` flag on a comment (note visibility from VML).
pub fn set_note_visible(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    comment_id: &str,
    visible: bool,
) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let comments_map = match get_comments_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };
    let comment_map = match comments_map.get(&txn, comment_id) {
        Some(Out::YMap(m)) => m,
        _ => return false,
    };
    comment_map.insert(&mut txn, comment_schema::KEY_VISIBLE, Any::Bool(visible));
    true
}

/// Set the height and/or width of a note (in points).
pub fn set_note_dimensions(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    comment_id: &str,
    height: Option<f64>,
    width: Option<f64>,
) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let comments_map = match get_comments_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };
    let comment_map = match comments_map.get(&txn, comment_id) {
        Some(Out::YMap(m)) => m,
        _ => return false,
    };
    if let Some(h) = height {
        comment_map.insert(&mut txn, comment_schema::KEY_NOTE_HEIGHT, Any::Number(h));
    }
    if let Some(w) = width {
        comment_map.insert(&mut txn, comment_schema::KEY_NOTE_WIDTH, Any::Number(w));
    }
    true
}
/// Convert an existing note into a threaded comment.
///
/// Flips `comment_type` to `ThreadedComment`, assigns `thread_id = Some(comment_id)`
/// (notes have `None`; threads need `Some`), clears the four note geometry
/// fields (`note_height`, `note_width`, `visible`, `shape_id`), and bumps
/// `modified_at`. Idempotent on a comment that's already a thread (early-returns
/// the existing comment unchanged).
///
/// Returns `None` if the sheet or the comment doesn't exist.
pub fn convert_note_to_thread(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    comment_id: &str,
) -> Option<Comment> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let comments_map = get_comments_map(&txn, sheets, &sheet_hex)?;
    let comment_map = match comments_map.get(&txn, comment_id)? {
        Out::YMap(m) => m,
        _ => return None,
    };
    let mut comment = comment_schema::from_yrs_map(&comment_map, &txn)?;
    if comment.comment_type == CommentType::ThreadedComment {
        // Idempotent: already a thread. Return unchanged.
        return Some(comment);
    }
    let now = now_millis();
    comment.comment_type = CommentType::ThreadedComment;
    comment.thread_id = Some(comment_id.to_string());
    comment.note_height = None;
    comment.note_width = None;
    comment.visible = None;
    comment.shape_id = None;
    comment.modified_at = Some(now);

    // Update yrs in-place. Write the new commentType + thread_id, remove the
    // four geometry fields if present, and bump modified_at.
    comment_map.insert(
        &mut txn,
        comment_schema::KEY_COMMENT_TYPE,
        Any::String(Arc::from("threadedComment")),
    );
    comment_map.insert(
        &mut txn,
        comment_schema::KEY_THREAD_ID,
        Any::String(Arc::from(comment_id)),
    );
    comment_map.remove(&mut txn, comment_schema::KEY_NOTE_HEIGHT);
    comment_map.remove(&mut txn, comment_schema::KEY_NOTE_WIDTH);
    comment_map.remove(&mut txn, comment_schema::KEY_VISIBLE);
    comment_map.remove(&mut txn, comment_schema::KEY_SHAPE_ID);
    comment_map.insert(
        &mut txn,
        comment_schema::KEY_MODIFIED_AT,
        Any::Number(now as f64),
    );

    Some(comment)
}
