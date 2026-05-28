use std::collections::HashSet;

use yrs::{Doc, Map, MapRef, Out, Transact};

use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use domain_types::domain::comment::{Comment, CommentType};
use domain_types::yrs_schema::comment as comment_schema;

use super::yrs_io::{get_comments_map, read_all_comments, sort_comments};

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
    let mut cell_ids = HashSet::new();
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
