use std::sync::Arc;

use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::comment::{AddCommentOptions, Comment, CommentType, RichTextRun};
use domain_types::yrs_schema::comment as comment_schema;
use value_types::ComputeError;

use super::yrs_io::{get_comments_map, read_all_comments};
use crate::storage::infra::yrs_helpers::now_millis;

fn runs_plain_text(runs: &[RichTextRun]) -> String {
    runs.iter().map(|run| run.text.as_str()).collect()
}

/// Add a new comment to a cell.
///
/// `options.comment_type` is the single discriminator that drives both
/// storage shape (notes have no `thread_id`; threaded comments do) and
/// downstream XLSX writer dispatch. Notes cannot have replies; passing
/// `parent_id` together with `CommentType::Note` is a contract violation
/// and returns an error.
#[allow(clippy::too_many_arguments)]
pub fn add_comment(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
    runs: Vec<RichTextRun>,
    author: &str,
    options: AddCommentOptions,
    id_alloc: &cell_types::IdAllocator,
) -> Result<Comment, ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let n = id_alloc.next_u128();
    let id = format!("{:032x}", n);
    let now = now_millis();
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let comments_map =
        get_comments_map(&txn, sheets, &sheet_hex).ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_hex.to_string(),
        })?;
    let (thread_id, parent_id) = match options.comment_type {
        CommentType::Note => {
            // Notes never have replies; reject `parent_id` as a contract violation.
            if options.parent_id.is_some() {
                return Err(ComputeError::Eval {
                    message: "notes cannot have a parent_id".into(),
                });
            }
            (None, None)
        }
        CommentType::ThreadedComment => {
            let tid = if let Some(ref pid) = options.parent_id {
                match comments_map.get(&txn, pid.as_str()) {
                    Some(Out::YMap(map)) => comment_schema::from_yrs_map(&map, &txn)
                        .and_then(|parent| parent.thread_id)
                        .unwrap_or_else(|| pid.clone()),
                    _ => pid.clone(),
                }
            } else {
                id.clone()
            };
            (Some(tid), options.parent_id.clone())
        }
    };
    let content = match options.comment_type {
        CommentType::ThreadedComment => Some(
            options
                .content
                .clone()
                .unwrap_or_else(|| runs_plain_text(&runs)),
        ),
        CommentType::Note => options.content.clone(),
    };
    let resolved = match options.comment_type {
        CommentType::ThreadedComment => Some(options.resolved.unwrap_or(false)),
        CommentType::Note => options.resolved,
    };
    let comment = Comment {
        id: id.clone(),
        cell_ref: cell_id.to_string(),
        author: author.to_string(),
        author_id: options.author_id.clone(),
        author_email: None,
        created_at: Some(now),
        modified_at: None,
        runs,
        content,
        thread_id,
        parent_id,
        resolved,
        person_id: options.person_id.clone(),
        timestamp: options.timestamp.clone(),
        xr_uid: None,
        shape_id: None,
        ext_lst_xml: None,
        content_type: options.content_type,
        mentions: options.mentions.unwrap_or_default(),
        comment_type: options.comment_type,
        visible: None,
        note_height: None,
        note_width: None,
        note_shape_anchor: None,
        comment_pr: None,
    };
    let prelim: MapPrelim = comment_schema::to_yrs_prelim(&comment)
        .into_iter()
        .collect();
    comments_map.insert(&mut txn, &*id, prelim);
    Ok(comment)
}
/// Update a comment's content. Sets `modified_at` to now.
pub fn update_comment(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    comment_id: &str,
    runs: Vec<RichTextRun>,
) -> Option<Comment> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let comments_map = get_comments_map(&txn, sheets, &sheet_hex)?;
    let comment_map = match comments_map.get(&txn, comment_id)? {
        Out::YMap(m) => m,
        _ => return None,
    };
    let mut comment = comment_schema::from_yrs_map(&comment_map, &txn)?;
    comment.runs = runs.clone();
    let now = now_millis();
    comment.modified_at = Some(now);
    if comment.comment_type == CommentType::ThreadedComment {
        comment.content = Some(runs_plain_text(&runs));
    }
    // Update fields in-place on the existing Y.Map.
    if let Ok(json) = serde_json::to_string(&runs) {
        comment_map.insert(
            &mut txn,
            comment_schema::KEY_RUNS,
            Any::String(Arc::from(json)),
        );
    }
    if comment.comment_type == CommentType::ThreadedComment
        && let Some(ref content) = comment.content
    {
        comment_map.insert(
            &mut txn,
            comment_schema::KEY_CONTENT,
            Any::String(Arc::from(content.as_str())),
        );
    }
    comment_map.insert(
        &mut txn,
        comment_schema::KEY_MODIFIED_AT,
        Any::Number(now as f64),
    );
    Some(comment)
}

/// Update a comment with mention content. Sets content text, content_type to Mention,
/// and mentions array, plus updates `modified_at`.
pub fn update_comment_mentions(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    comment_id: &str,
    content: &str,
    mentions: Vec<domain_types::domain::comment::CommentMention>,
) -> Option<Comment> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let comments_map = get_comments_map(&txn, sheets, &sheet_hex)?;
    let comment_map = match comments_map.get(&txn, comment_id)? {
        Out::YMap(m) => m,
        _ => return None,
    };
    let mut comment = comment_schema::from_yrs_map(&comment_map, &txn)?;
    let now = now_millis();
    comment.content = Some(content.to_string());
    comment.content_type = Some(domain_types::domain::comment::CommentContentType::Mention);
    comment.mentions = mentions.clone();
    comment.modified_at = Some(now);

    // Update fields in-place on the existing Y.Map.
    comment_map.insert(
        &mut txn,
        comment_schema::KEY_CONTENT,
        Any::String(Arc::from(content)),
    );
    comment_map.insert(
        &mut txn,
        comment_schema::KEY_CONTENT_TYPE,
        Any::String(Arc::from("mention")),
    );
    if let Ok(json) = serde_json::to_string(&mentions) {
        comment_map.insert(
            &mut txn,
            comment_schema::KEY_MENTIONS,
            Any::String(Arc::from(json)),
        );
    }
    comment_map.insert(
        &mut txn,
        comment_schema::KEY_MODIFIED_AT,
        Any::Number(now as f64),
    );
    Some(comment)
}

/// Complete threaded-comment metadata after a note promotion or legacy import repair.
///
/// This updates the same domain fields populated by XLSX threaded-comment import:
/// `content`, `person_id`, `resolved`, and `timestamp`.
pub fn complete_thread_metadata(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    comment_id: &str,
    person_id: &str,
    timestamp: &str,
) -> Option<Comment> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let comments_map = get_comments_map(&txn, sheets, &sheet_hex)?;
    let comment_map = match comments_map.get(&txn, comment_id)? {
        Out::YMap(m) => m,
        _ => return None,
    };
    let mut comment = comment_schema::from_yrs_map(&comment_map, &txn)?;
    if comment.comment_type != CommentType::ThreadedComment {
        return Some(comment);
    }

    let content = comment
        .content
        .clone()
        .unwrap_or_else(|| runs_plain_text(&comment.runs));
    comment.content = Some(content.clone());
    comment.person_id = Some(person_id.to_string());
    if comment.resolved.is_none() {
        comment.resolved = Some(false);
    }
    if comment.timestamp.is_none() {
        comment.timestamp = Some(timestamp.to_string());
    }

    comment_map.insert(
        &mut txn,
        comment_schema::KEY_CONTENT,
        Any::String(Arc::from(content.as_str())),
    );
    comment_map.insert(
        &mut txn,
        comment_schema::KEY_PERSON_ID,
        Any::String(Arc::from(person_id)),
    );
    if let Some(resolved) = comment.resolved {
        comment_map.insert(&mut txn, comment_schema::KEY_RESOLVED, Any::Bool(resolved));
    }
    if let Some(ref timestamp) = comment.timestamp {
        comment_map.insert(
            &mut txn,
            comment_schema::KEY_TIMESTAMP,
            Any::String(Arc::from(timestamp.as_str())),
        );
    }

    Some(comment)
}

/// Delete a single comment.
pub fn delete_comment(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, comment_id: &str) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let comments_map = match get_comments_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };
    if comments_map.get(&txn, comment_id).is_none() {
        return false;
    }
    comments_map.remove(&mut txn, comment_id);
    true
}

/// Delete all comments for a cell.
pub fn delete_comments_for_cell(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
) -> usize {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let comments_map = match get_comments_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return 0,
    };
    let to_delete: Vec<String> = comments_map
        .iter(&txn)
        .filter_map(|(key, value)| {
            if let Out::YMap(map) = value {
                let comment = comment_schema::from_yrs_map(&map, &txn)?;
                if comment.cell_ref == cell_id {
                    Some(key.to_string())
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();
    let count = to_delete.len();
    for id in &to_delete {
        comments_map.remove(&mut txn, id.as_str());
    }
    count
}

/// Resolve or unresolve a thread.
pub fn set_thread_resolved(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    thread_id: &str,
    resolved: bool,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let comments_map = match get_comments_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };
    // Collect the IDs of comments in this thread, then update each Y.Map in-place.
    let thread_ids: Vec<String> = read_all_comments(&txn, &comments_map)
        .into_iter()
        .filter(|c| c.thread_id.as_deref() == Some(thread_id) || c.id == thread_id)
        .map(|c| c.id)
        .collect();
    if thread_ids.is_empty() {
        return;
    }
    for cid in &thread_ids {
        if let Some(Out::YMap(map)) = comments_map.get(&txn, cid.as_str()) {
            map.insert(&mut txn, comment_schema::KEY_RESOLVED, Any::Bool(resolved));
        }
    }
}

/// Clear all comments for a sheet.
pub fn clear_all_comments(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let comments_map = match get_comments_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };
    let keys: Vec<String> = comments_map
        .iter(&txn)
        .map(|(key, _)| key.to_string())
        .collect();
    for key in &keys {
        comments_map.remove(&mut txn, key.as_str());
    }
}
