use super::store::{CommentAnchor, comment_mut, wire};
use crate::storage::WorkbookStorage;
use crate::storage::infra::time::now_millis;
use cell_types::SheetId;
use domain_types::domain::comment::{AddCommentOptions, Comment, CommentType, RichTextRun};
use value_types::ComputeError;

fn runs_plain_text(runs: &[RichTextRun]) -> String {
    runs.iter().map(|run| run.text.as_str()).collect()
}

/// Add a note or threaded comment, preserving the supplied thread metadata.
pub fn add_comment(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    cell: &str,
    runs: Vec<RichTextRun>,
    author: &str,
    options: AddCommentOptions,
    id_alloc: &cell_types::IdAllocator,
) -> Result<Comment, ComputeError> {
    let id = format!("{:032x}", id_alloc.next_u128());
    crate::storage::engine::history::metadata::capture_sheet_vector_entry!(storage, *sheet, comments, id, comment => comment.id);

    let metadata =
        storage
            .sheet_metadata
            .get_mut(sheet)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet.to_uuid_string(),
            })?;
    let (thread_id, parent_id) = match options.comment_type {
        CommentType::Note => {
            if options.parent_id.is_some() {
                return Err(ComputeError::Eval {
                    message: "notes cannot have a parent_id".into(),
                });
            }
            (None, None)
        }
        CommentType::ThreadedComment => {
            let thread = options
                .parent_id
                .as_ref()
                .map(|parent_id| {
                    metadata
                        .comments
                        .iter()
                        .find(|comment| comment.id == *parent_id)
                        .and_then(|parent| parent.thread_id.clone())
                        .unwrap_or_else(|| parent_id.clone())
                })
                .unwrap_or_else(|| id.clone());
            (Some(thread), options.parent_id.clone())
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
    let comment = Comment {
        id,
        cell_ref: cell.to_owned(),
        author: author.to_owned(),
        author_id: options.author_id,
        runs,
        content,
        thread_id,
        parent_id,
        person_id: options.person_id,
        resolved: if options.comment_type == CommentType::ThreadedComment {
            Some(options.resolved.unwrap_or(false))
        } else {
            options.resolved
        },
        timestamp: options.timestamp,
        created_at: Some(now_millis()),
        content_type: options.content_type,
        mentions: options.mentions.unwrap_or_default(),
        comment_type: options.comment_type,
        ..Default::default()
    };
    metadata
        .comments
        .push(comment.clone().map_cell_ref(CommentAnchor::from_wire));
    Ok(comment)
}

pub fn update_comment(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
    runs: Vec<RichTextRun>,
) -> Option<Comment> {
    let comment = comment_mut(storage, sheet, id)?;
    comment.content = Some(runs_plain_text(&runs));
    comment.runs = runs;
    comment.modified_at = Some(now_millis());
    Some(wire(comment))
}
pub fn update_comment_mentions(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
    content: &str,
    mentions: Vec<domain_types::domain::comment::CommentMention>,
) -> Option<Comment> {
    let comment = comment_mut(storage, sheet, id)?;
    comment.content = Some(content.to_owned());
    comment.content_type = Some(domain_types::domain::comment::CommentContentType::Mention);
    comment.mentions = mentions;
    comment.modified_at = Some(now_millis());
    Some(wire(comment))
}
pub fn complete_thread_metadata(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
    person: &str,
    timestamp: &str,
) -> Option<Comment> {
    let comment = comment_mut(storage, sheet, id)?;
    if comment.comment_type == CommentType::ThreadedComment {
        comment
            .content
            .get_or_insert_with(|| runs_plain_text(&comment.runs));
        comment.person_id = Some(person.to_owned());
        comment.resolved.get_or_insert(false);
        comment
            .timestamp
            .get_or_insert_with(|| timestamp.to_owned());
    }
    Some(wire(comment))
}
pub fn delete_comment(storage: &mut WorkbookStorage, sheet: &SheetId, id: &str) -> bool {
    crate::storage::engine::history::metadata::capture_sheet_vector_entry!(storage, *sheet, comments, id, comment => comment.id);

    let Some(metadata) = storage.sheet_metadata.get_mut(sheet) else {
        return false;
    };
    let before = metadata.comments.len();
    metadata.comments.retain(|comment| comment.id != id);
    before != metadata.comments.len()
}
pub fn delete_comments_for_cell(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    cell: &str,
) -> usize {
    if storage.history.is_active() {
        if let Some(meta) = storage.sheet_metadata.get(sheet) {
            for comment in &meta.comments {
                if comment.cell_ref.matches(cell) {
                    crate::storage::engine::history::metadata::capture_sheet_vector_entry!(storage, *sheet, comments, comment.id, value => value.id);
                }
            }
        }
    }

    let Some(metadata) = storage.sheet_metadata.get_mut(sheet) else {
        return 0;
    };
    let before = metadata.comments.len();
    metadata
        .comments
        .retain(|comment| !comment.cell_ref.matches(cell));
    before - metadata.comments.len()
}
pub fn set_thread_resolved(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    thread: &str,
    resolved: bool,
) {
    if storage.history.is_active() {
        if let Some(meta) = storage.sheet_metadata.get(sheet) {
            for comment in &meta.comments {
                if comment.thread_id.as_deref() == Some(thread) || comment.id == thread {
                    crate::storage::engine::history::metadata::capture_sheet_vector_entry!(storage, *sheet, comments, comment.id, value => value.id);
                }
            }
        }
    }

    if let Some(metadata) = storage.sheet_metadata.get_mut(sheet) {
        for comment in &mut metadata.comments {
            if comment.thread_id.as_deref() == Some(thread) || comment.id == thread {
                comment.resolved = Some(resolved);
            }
        }
    }
}
pub fn clear_all_comments(storage: &mut WorkbookStorage, sheet: &SheetId) {
    if storage.history.is_active() {
        if let Some(meta) = storage.sheet_metadata.get(sheet) {
            for comment in &meta.comments {
                if true {
                    crate::storage::engine::history::metadata::capture_sheet_vector_entry!(storage, *sheet, comments, comment.id, value => value.id);
                }
            }
        }
    }

    if let Some(metadata) = storage.sheet_metadata.get_mut(sheet) {
        metadata.comments.clear();
    }
}
