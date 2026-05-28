//! Cell comment CRUD with threading, resolution, and orphan cleanup.
//!
//! Port of `spreadsheet-model/src/comments.ts` (spreadsheet-model elimination).
//!
//! ## Yrs Storage Layout
//!
//! Each sheet has a `comments` map storing comments as structured Y.Maps keyed
//! by comment ID:
//! ```text
//! sheets: Y.Map<SheetId, Y.Map>
//!   +-- {sheetId}: Y.Map
//!       +-- comments: Y.Map
//!           +-- {commentId}: Y.Map  (structured fields: id, cellRef, author, ...)
//! ```
//!
//! ## Cell Identity Model
//!
//! Comments reference cells via CellId (stable UUID). Position is resolved at
//! render time. `validate_and_clean_comments()` removes orphaned comments when
//! their parent cells are deleted.

use std::sync::Arc;

use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::storage::infra::grid_helpers::get_cells_map;
use crate::storage::infra::yrs_helpers::now_millis;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
#[cfg(test)]
use compute_document::schema::KEY_CELLS;
use compute_document::schema::{KEY_COMMENTS, KEY_GRID_ID_TO_POS, KEY_GRID_INDEX};
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::yrs_schema::comment as comment_schema;
use value_types::ComputeError;

pub use domain_types::domain::comment::{AddCommentOptions, Comment, CommentType, RichTextRun};

// =============================================================================
// Internal Helpers
// =============================================================================

/// Get the `comments` MapRef for a given sheet (read-only).
fn get_comments_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, KEY_COMMENTS) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

fn comment_cell_ref_exists<T: yrs::ReadTxn>(
    txn: &T,
    sheets: &MapRef,
    sheet_hex: &str,
    cells_map: Option<&MapRef>,
    cell_ref: &str,
) -> bool {
    if cells_map.is_some_and(|cells| cells.get(txn, cell_ref).is_some()) {
        return true;
    }

    let Some(Out::YMap(sheet_map)) = sheets.get(txn, sheet_hex) else {
        return false;
    };
    let Some(Out::YMap(grid_index)) = sheet_map.get(txn, KEY_GRID_INDEX) else {
        return false;
    };
    let Some(Out::YMap(id_to_pos)) = grid_index.get(txn, KEY_GRID_ID_TO_POS) else {
        return false;
    };
    id_to_pos.get(txn, cell_ref).is_some()
}

/// Read all comments from a comments map.
///
/// Sorts entries by key numeric suffix (`comment-0`, `comment-1`, …) to preserve
/// the original hydration order, which matches the XLSX file's comment ordering.
/// Keys without a numeric suffix (runtime-created comments) sort after the
/// numeric-keyed entries in lexicographic order.
fn read_all_comments<T: yrs::ReadTxn>(txn: &T, comments_map: &MapRef) -> Vec<Comment> {
    // Collect and sort by key suffix for deterministic order
    let mut entries: Vec<(String, Out)> = comments_map
        .iter(txn)
        .map(|(k, v)| (k.to_string(), v))
        .collect();
    entries.sort_by(|(a, _), (b, _)| {
        let parse_suffix = |k: &str| -> Option<usize> {
            k.rsplit_once('-')
                .and_then(|(_, s)| s.parse::<usize>().ok())
        };
        let ai = parse_suffix(a);
        let bi = parse_suffix(b);
        match (ai, bi) {
            (Some(ai), Some(bi)) => ai.cmp(&bi),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.cmp(b),
        }
    });

    let mut result = Vec::new();
    for (_key, value) in entries {
        if let Out::YMap(map) = value
            && let Some(comment) = comment_schema::from_yrs_map(&map, txn)
        {
            result.push(comment);
        }
    }
    result
}

/// Sort comments chronologically.
fn sort_comments(comments: &mut [Comment]) {
    comments.sort_by(|a, b| {
        a.created_at
            .unwrap_or(0)
            .cmp(&b.created_at.unwrap_or(0))
            .then_with(|| a.parent_id.is_some().cmp(&b.parent_id.is_some()))
            .then_with(|| a.id.cmp(&b.id))
    });
}

// =============================================================================
// Comment Operations (free functions)
// =============================================================================

/// Get all comments for a cell, sorted by `created_at`.
pub fn get_comments_for_cell(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
) -> Vec<Comment> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let comments_map = match get_comments_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return vec![],
    };
    let mut result: Vec<Comment> = read_all_comments(&txn, &comments_map)
        .into_iter()
        .filter(|c| c.cell_ref == cell_id)
        .collect();
    sort_comments(&mut result);
    result
}

/// Get a single comment by ID.
pub fn get_comment(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    comment_id: &str,
) -> Option<Comment> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let comments_map = get_comments_map(&txn, sheets, &sheet_hex)?;
    match comments_map.get(&txn, comment_id)? {
        Out::YMap(map) => comment_schema::from_yrs_map(&map, &txn),
        _ => None,
    }
}

/// Check if a cell has any comments.
pub fn has_comments(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, cell_id: &str) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let comments_map = match get_comments_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };
    for (_key, value) in comments_map.iter(&txn) {
        if let Out::YMap(map) = value
            && let Some(comment) = comment_schema::from_yrs_map(&map, &txn)
            && comment.cell_ref == cell_id
        {
            return true;
        }
    }
    false
}

/// Get all comments in a sheet.
pub fn get_all_comments(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<Comment> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let comments_map = match get_comments_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return vec![],
    };
    read_all_comments(&txn, &comments_map)
}

/// Get all CellIds that have comments (for rendering comment indicators).
pub fn get_cell_ids_with_comments(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<String> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let comments_map = match get_comments_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return vec![],
    };
    let mut cell_ids = std::collections::HashSet::new();
    for (_key, value) in comments_map.iter(&txn) {
        if let Out::YMap(map) = value
            && let Some(comment) = comment_schema::from_yrs_map(&map, &txn)
        {
            cell_ids.insert(comment.cell_ref);
        }
    }
    cell_ids.into_iter().collect()
}

/// Get the count of comments in a sheet.
pub fn get_comment_count(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> u32 {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let comments_map = match get_comments_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return 0,
    };
    comments_map.len(&txn) as u32
}

/// Get the count of notes (comments with `comment_type == CommentType::Note`) in a sheet.
pub fn get_note_count(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> u32 {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let comments_map = match get_comments_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return 0,
    };
    read_all_comments(&txn, &comments_map)
        .into_iter()
        .filter(|c| c.comment_type == CommentType::Note)
        .count() as u32
}

/// Get all notes (comments with `comment_type == CommentType::Note`) in a sheet.
pub fn get_all_notes(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<Comment> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let comments_map = match get_comments_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return vec![],
    };
    read_all_comments(&txn, &comments_map)
        .into_iter()
        .filter(|c| c.comment_type == CommentType::Note)
        .collect()
}

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

/// Get all comments in a thread, sorted by `created_at`.
pub fn get_comment_thread(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    thread_id: &str,
) -> Vec<Comment> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let comments_map = match get_comments_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return vec![],
    };
    let mut result: Vec<Comment> = read_all_comments(&txn, &comments_map)
        .into_iter()
        .filter(|c| c.thread_id.as_deref() == Some(thread_id) || c.id == thread_id)
        .collect();
    sort_comments(&mut result);
    result
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
    let comment = Comment {
        id: id.clone(),
        cell_ref: cell_id.to_string(),
        author: author.to_string(),
        author_id: options.author_id.clone(),
        author_email: None,
        created_at: Some(now),
        modified_at: None,
        runs,
        content: None,
        thread_id,
        parent_id,
        resolved: None,
        person_id: None,
        timestamp: None,
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
    };
    let prelim: MapPrelim = comment_schema::to_yrs_prelim(&comment)
        .into_iter()
        .collect();
    comments_map.insert(&mut txn, &*id, prelim);
    Ok(comment)
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
    // Update fields in-place on the existing Y.Map.
    if let Ok(json) = serde_json::to_string(&runs) {
        comment_map.insert(
            &mut txn,
            comment_schema::KEY_RUNS,
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

/// Validate and clean orphaned comments.
pub fn validate_and_clean_comments(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> usize {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let comments_map = match get_comments_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return 0,
    };
    let cells_map = get_cells_map(&txn, sheets, &sheet_hex);
    let to_remove: Vec<String> = comments_map
        .iter(&txn)
        .filter_map(|(key, value)| {
            if let Out::YMap(map) = value {
                let comment = comment_schema::from_yrs_map(&map, &txn)?;
                if !comment_cell_ref_exists(
                    &txn,
                    sheets,
                    &sheet_hex,
                    cells_map.as_ref(),
                    &comment.cell_ref,
                ) {
                    Some(key.to_string())
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();
    let count = to_remove.len();
    for key in &to_remove {
        comments_map.remove(&mut txn, key.as_str());
    }
    count
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;
    use cell_types::SheetId;

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    fn storage_with_sheet() -> (YrsStorage, SheetId) {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let sheet_id = make_sheet_id(1);
        storage
            .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
            .expect("add_sheet should succeed");
        (storage, sheet_id)
    }

    fn simple_runs(text: &str) -> Vec<RichTextRun> {
        vec![RichTextRun {
            text: text.to_string(),
            ..Default::default()
        }]
    }

    fn add_cell_to_sheet(storage: &YrsStorage, sheet_id: &SheetId, cell_id_key: &str) {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let mut txn = storage
            .doc()
            .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let sheet_map = match storage.sheets_ref().get(&txn, &sheet_hex) {
            Some(Out::YMap(m)) => m,
            _ => panic!("sheet not found"),
        };
        let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
            Some(Out::YMap(m)) => m,
            _ => panic!("cells map not found"),
        };
        let cell_prelim = yrs::MapPrelim::from([("v", Any::Number(0.0))]);
        cells_map.insert(&mut txn, cell_id_key, cell_prelim);
    }

    #[test]
    fn test_add_comment_and_retrieve() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let comment = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Hello world"),
            "Alice",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .expect("add_comment should succeed");
        assert!(!comment.id.is_empty());
        assert_eq!(comment.cell_ref, "cell-001");
        assert_eq!(comment.author, "Alice");
        assert!(comment.created_at.unwrap_or(0) > 0);
        assert!(comment.modified_at.is_none());
        assert_eq!(comment.runs.len(), 1);
        assert_eq!(comment.runs[0].text, "Hello world");
        assert_eq!(comment.thread_id, Some(comment.id.clone()));
        assert!(comment.parent_id.is_none());
        assert!(comment.resolved.is_none());
        let fetched = get_comment(doc, sheets, &sheet_id, &comment.id);
        assert!(fetched.is_some());
        assert_eq!(fetched.unwrap(), comment);
    }

    #[test]
    fn test_add_reply_inherits_thread_id() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let root = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Root comment"),
            "Alice",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let reply = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Reply to root"),
            "Bob",
            AddCommentOptions {
                author_id: Some("bob-123".to_string()),
                parent_id: Some(root.id.clone()),
                comment_type: CommentType::ThreadedComment,
                ..Default::default()
            },
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert_ne!(reply.id, root.id);
        assert_eq!(reply.thread_id, root.thread_id);
        assert_eq!(reply.parent_id, Some(root.id.clone()));
        assert_eq!(reply.author_id, Some("bob-123".to_string()));
    }

    #[test]
    fn test_get_comment_thread() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let root = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Thread root"),
            "Alice",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let _reply1 = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Reply 1"),
            "Bob",
            AddCommentOptions {
                parent_id: Some(root.id.clone()),
                comment_type: CommentType::ThreadedComment,
                ..Default::default()
            },
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let _reply2 = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Reply 2"),
            "Charlie",
            AddCommentOptions {
                parent_id: Some(root.id.clone()),
                comment_type: CommentType::ThreadedComment,
                ..Default::default()
            },
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let _other = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-002",
            simple_runs("Different thread"),
            "Dave",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let thread = get_comment_thread(doc, sheets, &sheet_id, &root.id);
        assert_eq!(thread.len(), 3);
        assert_eq!(thread[0].runs[0].text, "Thread root");
        let reply_texts: Vec<&str> = thread[1..]
            .iter()
            .map(|c| c.runs[0].text.as_str())
            .collect();
        assert!(reply_texts.contains(&"Reply 1"));
        assert!(reply_texts.contains(&"Reply 2"));
    }

    #[test]
    fn test_update_comment() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let comment = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Original"),
            "Alice",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert!(comment.modified_at.is_none());
        let updated = update_comment(
            doc,
            sheets,
            &sheet_id,
            &comment.id,
            simple_runs("Updated text"),
        )
        .expect("update should succeed");
        assert_eq!(updated.id, comment.id);
        assert_eq!(updated.runs[0].text, "Updated text");
        assert!(updated.modified_at.is_some());
        assert!(updated.modified_at.unwrap() >= comment.created_at.unwrap_or(0));
        assert_eq!(updated.author, "Alice");
        assert_eq!(updated.cell_ref, "cell-001");
        assert_eq!(updated.thread_id, comment.thread_id);
    }

    #[test]
    fn test_delete_comment() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let comment = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("To be deleted"),
            "Alice",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert!(delete_comment(doc, sheets, &sheet_id, &comment.id));
        assert!(get_comment(doc, sheets, &sheet_id, &comment.id).is_none());
        assert_eq!(get_comment_count(doc, sheets, &sheet_id), 0);
        assert!(!delete_comment(doc, sheets, &sheet_id, &comment.id));
    }

    #[test]
    fn test_delete_comments_for_cell() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        for i in 0..3 {
            add_comment(
                doc,
                sheets,
                &sheet_id,
                "cell-001",
                simple_runs(&format!("Comment {}", i)),
                "Alice",
                AddCommentOptions::default(),
                &crate::storage::STORAGE_ID_ALLOC,
            )
            .unwrap();
        }
        add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-002",
            simple_runs("Other cell"),
            "Bob",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert_eq!(get_comment_count(doc, sheets, &sheet_id), 4);
        let deleted = delete_comments_for_cell(doc, sheets, &sheet_id, "cell-001");
        assert_eq!(deleted, 3);
        assert_eq!(get_comment_count(doc, sheets, &sheet_id), 1);
        assert!(has_comments(doc, sheets, &sheet_id, "cell-002"));
        assert!(!has_comments(doc, sheets, &sheet_id, "cell-001"));
    }

    #[test]
    fn test_has_comments() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        assert!(!has_comments(doc, sheets, &sheet_id, "cell-001"));
        add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("A comment"),
            "Alice",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert!(has_comments(doc, sheets, &sheet_id, "cell-001"));
        assert!(!has_comments(doc, sheets, &sheet_id, "cell-002"));
    }

    #[test]
    fn test_get_cell_ids_with_comments() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Comment 1"),
            "Alice",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Comment 2"),
            "Bob",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-002",
            simple_runs("Comment 3"),
            "Charlie",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let mut cell_ids = get_cell_ids_with_comments(doc, sheets, &sheet_id);
        cell_ids.sort();
        assert_eq!(cell_ids.len(), 2);
        assert!(cell_ids.contains(&"cell-001".to_string()));
        assert!(cell_ids.contains(&"cell-002".to_string()));
    }

    #[test]
    fn test_comment_count() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        assert_eq!(get_comment_count(doc, sheets, &sheet_id), 0);
        add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("First"),
            "Alice",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert_eq!(get_comment_count(doc, sheets, &sheet_id), 1);
        add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-002",
            simple_runs("Second"),
            "Bob",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert_eq!(get_comment_count(doc, sheets, &sheet_id), 2);
    }

    #[test]
    fn test_set_thread_resolved() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let root = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Root"),
            "Alice",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let _reply = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Reply"),
            "Bob",
            AddCommentOptions {
                parent_id: Some(root.id.clone()),
                comment_type: CommentType::ThreadedComment,
                ..Default::default()
            },
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        set_thread_resolved(doc, sheets, &sheet_id, &root.id, true);
        let thread = get_comment_thread(doc, sheets, &sheet_id, &root.id);
        assert_eq!(thread.len(), 2);
        for comment in &thread {
            assert_eq!(comment.resolved, Some(true));
        }
        set_thread_resolved(doc, sheets, &sheet_id, &root.id, false);
        let thread = get_comment_thread(doc, sheets, &sheet_id, &root.id);
        for comment in &thread {
            assert_eq!(comment.resolved, Some(false));
        }
    }

    #[test]
    fn test_clear_all_comments() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        for i in 0..5 {
            add_comment(
                doc,
                sheets,
                &sheet_id,
                &format!("cell-{:03}", i),
                simple_runs(&format!("Comment {}", i)),
                "Alice",
                AddCommentOptions::default(),
                &crate::storage::STORAGE_ID_ALLOC,
            )
            .unwrap();
        }
        assert_eq!(get_comment_count(doc, sheets, &sheet_id), 5);
        clear_all_comments(doc, sheets, &sheet_id);
        assert_eq!(get_comment_count(doc, sheets, &sheet_id), 0);
        assert!(get_all_comments(doc, sheets, &sheet_id).is_empty());
    }

    #[test]
    fn test_empty_sheet_returns_empty() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        assert!(get_comments_for_cell(doc, sheets, &sheet_id, "cell-001").is_empty());
        assert!(get_comment(doc, sheets, &sheet_id, "nonexistent").is_none());
        assert!(!has_comments(doc, sheets, &sheet_id, "cell-001"));
        assert!(get_all_comments(doc, sheets, &sheet_id).is_empty());
        assert!(get_cell_ids_with_comments(doc, sheets, &sheet_id).is_empty());
        assert_eq!(get_comment_count(doc, sheets, &sheet_id), 0);
        assert!(get_comment_thread(doc, sheets, &sheet_id, "nonexistent").is_empty());
    }

    #[test]
    fn test_comments_sorted_by_created_at() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("First"),
            "Alice",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Second"),
            "Bob",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Third"),
            "Charlie",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let comments = get_comments_for_cell(doc, sheets, &sheet_id, "cell-001");
        assert_eq!(comments.len(), 3);
        assert!(comments[0].created_at.unwrap_or(0) <= comments[1].created_at.unwrap_or(0));
        assert!(comments[1].created_at.unwrap_or(0) <= comments[2].created_at.unwrap_or(0));
    }

    #[test]
    fn test_validate_and_clean_orphaned_comments() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        add_cell_to_sheet(&storage, &sheet_id, "existing-cell");
        add_comment(
            doc,
            sheets,
            &sheet_id,
            "existing-cell",
            simple_runs("Valid comment"),
            "Alice",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        add_comment(
            doc,
            sheets,
            &sheet_id,
            "orphaned-cell",
            simple_runs("Orphaned comment"),
            "Bob",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert_eq!(get_comment_count(doc, sheets, &sheet_id), 2);
        let removed = validate_and_clean_comments(doc, sheets, &sheet_id);
        assert_eq!(removed, 1);
        assert_eq!(get_comment_count(doc, sheets, &sheet_id), 1);
        assert!(has_comments(doc, sheets, &sheet_id, "existing-cell"));
        assert!(!has_comments(doc, sheets, &sheet_id, "orphaned-cell"));
    }

    #[test]
    fn test_multiple_cells_different_comments() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let c1 = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-A1",
            simple_runs("Comment on A1"),
            "Alice",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let c2 = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-B2",
            simple_runs("Comment on B2"),
            "Bob",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let c3 = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-C3",
            simple_runs("Comment on C3"),
            "Charlie",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert_eq!(
            get_comments_for_cell(doc, sheets, &sheet_id, "cell-A1").len(),
            1
        );
        assert_eq!(
            get_comments_for_cell(doc, sheets, &sheet_id, "cell-B2").len(),
            1
        );
        assert_eq!(
            get_comments_for_cell(doc, sheets, &sheet_id, "cell-C3").len(),
            1
        );
        assert_eq!(get_comment_count(doc, sheets, &sheet_id), 3);
        assert_eq!(get_all_comments(doc, sheets, &sheet_id).len(), 3);
        let cell_ids = get_cell_ids_with_comments(doc, sheets, &sheet_id);
        assert_eq!(cell_ids.len(), 3);
        delete_comments_for_cell(doc, sheets, &sheet_id, "cell-B2");
        assert_eq!(get_comment_count(doc, sheets, &sheet_id), 2);
        assert!(get_comment(doc, sheets, &sheet_id, &c1.id).is_some());
        assert!(get_comment(doc, sheets, &sheet_id, &c2.id).is_none());
        assert!(get_comment(doc, sheets, &sheet_id, &c3.id).is_some());
    }

    #[test]
    fn test_nonexistent_sheet() {
        let storage = YrsStorage::new();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let fake_sheet = make_sheet_id(999);
        assert!(get_comments_for_cell(doc, sheets, &fake_sheet, "cell-001").is_empty());
        assert!(get_comment(doc, sheets, &fake_sheet, "some-id").is_none());
        assert!(!has_comments(doc, sheets, &fake_sheet, "cell-001"));
        assert!(get_all_comments(doc, sheets, &fake_sheet).is_empty());
        assert!(get_cell_ids_with_comments(doc, sheets, &fake_sheet).is_empty());
        assert_eq!(get_comment_count(doc, sheets, &fake_sheet), 0);
        assert!(get_comment_thread(doc, sheets, &fake_sheet, "some-id").is_empty());
    }

    #[test]
    fn test_update_nonexistent_comment() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let result = update_comment(
            doc,
            sheets,
            &sheet_id,
            "nonexistent",
            simple_runs("New content"),
        );
        assert!(result.is_none());
    }

    #[test]
    fn test_delete_comments_for_cell_no_comments() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let count = delete_comments_for_cell(doc, sheets, &sheet_id, "cell-001");
        assert_eq!(count, 0);
    }

    #[test]
    fn test_clear_all_empty_sheet() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        clear_all_comments(doc, sheets, &sheet_id);
        assert_eq!(get_comment_count(doc, sheets, &sheet_id), 0);
    }

    #[test]
    fn test_validate_and_clean_no_orphans() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        add_cell_to_sheet(&storage, &sheet_id, "cell-001");
        add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Valid"),
            "Alice",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let removed = validate_and_clean_comments(doc, sheets, &sheet_id);
        assert_eq!(removed, 0);
        assert_eq!(get_comment_count(doc, sheets, &sheet_id), 1);
    }

    #[test]
    fn test_cell_comment_serde_roundtrip() {
        let comment = Comment {
            id: "abc-123".to_string(),
            cell_ref: "cell-001".to_string(),
            author: "Alice".to_string(),
            author_id: Some("alice-id".to_string()),
            author_email: None,
            created_at: Some(1700000000000),
            modified_at: Some(1700000001000),
            runs: vec![
                RichTextRun {
                    text: "Hello ".to_string(),
                    bold: true,
                    ..Default::default()
                },
                RichTextRun {
                    text: "world".to_string(),
                    italic: true,
                    color: Some("#ff0000".to_string()),
                    ..Default::default()
                },
            ],
            content: None,
            thread_id: Some("abc-123".to_string()),
            parent_id: None,
            resolved: Some(false),
            person_id: None,
            timestamp: None,
            xr_uid: None,
            shape_id: None,
            ext_lst_xml: None,
            content_type: None,
            mentions: Vec::new(),
            comment_type: CommentType::ThreadedComment,
            visible: None,
            note_height: None,
            note_width: None,
        };
        let json = serde_json::to_string(&comment).unwrap();
        let deserialized: Comment = serde_json::from_str(&json).unwrap();
        assert_eq!(comment, deserialized);
    }

    #[test]
    fn test_reply_to_nonexistent_parent() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let comment = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Reply to ghost"),
            "Alice",
            AddCommentOptions {
                parent_id: Some("nonexistent-parent".to_string()),
                comment_type: CommentType::ThreadedComment,
                ..Default::default()
            },
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert_eq!(comment.thread_id, Some("nonexistent-parent".to_string()));
        assert_eq!(comment.parent_id, Some("nonexistent-parent".to_string()));
    }

    #[test]
    fn test_set_thread_resolved_nonexistent() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        set_thread_resolved(doc, sheets, &sheet_id, "nonexistent-thread", true);
    }

    #[test]
    fn test_add_comment_nonexistent_sheet() {
        let storage = YrsStorage::new();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let fake_sheet = make_sheet_id(999);
        let result = add_comment(
            doc,
            sheets,
            &fake_sheet,
            "cell-001",
            simple_runs("Hello"),
            "Alice",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        assert!(result.is_err());
    }

    // -------------------------------------------------------------------
    // Note vs thread discriminator tests
    // -------------------------------------------------------------------

    #[test]
    fn test_add_comment_note_has_no_thread_or_parent() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let note = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("A note"),
            "Alice",
            AddCommentOptions {
                comment_type: CommentType::Note,
                ..Default::default()
            },
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .expect("note add should succeed");
        assert_eq!(note.comment_type, CommentType::Note);
        assert!(note.thread_id.is_none(), "notes never have a thread_id");
        assert!(note.parent_id.is_none(), "notes never have a parent_id");
    }

    #[test]
    fn test_add_comment_note_with_parent_id_is_rejected() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let result = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Illegal note reply"),
            "Alice",
            AddCommentOptions {
                comment_type: CommentType::Note,
                parent_id: Some("some-parent".to_string()),
                ..Default::default()
            },
            &crate::storage::STORAGE_ID_ALLOC,
        );
        assert!(result.is_err(), "notes cannot have replies");
    }

    #[test]
    fn test_add_comment_threaded_keeps_thread_id() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let comment = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("A thread"),
            "Alice",
            AddCommentOptions {
                comment_type: CommentType::ThreadedComment,
                ..Default::default()
            },
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .expect("thread add should succeed");
        assert_eq!(comment.comment_type, CommentType::ThreadedComment);
        assert_eq!(comment.thread_id, Some(comment.id.clone()));
    }

    #[test]
    fn test_convert_note_to_thread_flips_discriminator_and_clears_geometry() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let note = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Convert me"),
            "Alice",
            AddCommentOptions {
                comment_type: CommentType::Note,
                ..Default::default()
            },
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        // Inject geometry that should be cleared on convert.
        set_note_visible(doc, sheets, &sheet_id, &note.id, true);
        set_note_dimensions(doc, sheets, &sheet_id, &note.id, Some(120.0), Some(60.0));
        // Sanity: geometry was actually written.
        let with_geometry = get_comment(doc, sheets, &sheet_id, &note.id).unwrap();
        assert_eq!(with_geometry.visible, Some(true));
        assert_eq!(with_geometry.note_height, Some(120.0));
        assert_eq!(with_geometry.note_width, Some(60.0));

        let converted = convert_note_to_thread(doc, sheets, &sheet_id, &note.id)
            .expect("convert should return the updated comment");
        assert_eq!(converted.comment_type, CommentType::ThreadedComment);
        assert_eq!(converted.thread_id, Some(note.id.clone()));
        assert!(converted.visible.is_none());
        assert!(converted.note_height.is_none());
        assert!(converted.note_width.is_none());
        assert!(converted.shape_id.is_none());
        assert!(converted.modified_at.is_some());

        // Re-fetch and confirm the in-yrs state matches.
        let refetched = get_comment(doc, sheets, &sheet_id, &note.id).unwrap();
        assert_eq!(refetched.comment_type, CommentType::ThreadedComment);
        assert_eq!(refetched.thread_id, Some(note.id.clone()));
        assert!(refetched.visible.is_none());
        assert!(refetched.note_height.is_none());
        assert!(refetched.note_width.is_none());
        assert!(refetched.shape_id.is_none());
    }

    #[test]
    fn test_convert_note_to_thread_idempotent_on_existing_thread() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = &storage.sheets_ref();
        let thread = add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs("Already a thread"),
            "Alice",
            AddCommentOptions {
                comment_type: CommentType::ThreadedComment,
                ..Default::default()
            },
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let modified_before = thread.modified_at;
        let converted = convert_note_to_thread(doc, sheets, &sheet_id, &thread.id)
            .expect("idempotent convert should return the existing comment");
        // Discriminator is unchanged; thread_id and modified_at are not bumped.
        assert_eq!(converted.comment_type, CommentType::ThreadedComment);
        assert_eq!(converted.thread_id, thread.thread_id);
        assert_eq!(converted.modified_at, modified_before);
    }
}
