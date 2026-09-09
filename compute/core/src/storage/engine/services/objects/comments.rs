use super::shared::{cell_hex_at_position, cell_position_for_hex};
use crate::mirror::CellMirror;
use crate::snapshot::{CellPosition, ChangeKind, CommentChange, MutationResult};
use crate::storage::engine::history::metadata::capture_workbook_field;
use crate::storage::engine::services::cell_editing;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::comments;
use cell_types::{CellId, SheetId};
use compute_document::hex::id_to_hex;
use domain_types::domain::comment::{
    AddCommentOptions, Comment, CommentMention, CommentType, PersonInfo, RichTextRun,
};
use value_types::ComputeError;

/// Result type for comment deletion: `(MutationResult, Option<(row, col)>, still_has_comments)`.
type DeleteCommentResult = Result<(MutationResult, Option<(u32, u32)>, bool), ComputeError>;

fn comment_change(
    stores: &EngineStores,
    sheet_id: &SheetId,
    cell_id: &str,
    kind: ChangeKind,
) -> CommentChange {
    CommentChange {
        sheet_id: sheet_id.to_uuid_string(),
        cell_id: cell_id.to_owned(),
        position: cell_position_for_hex(stores, sheet_id, cell_id)
            .map(|(row, col)| CellPosition { row, col }),
        kind,
    }
}

// -------------------------------------------------------------------

fn threaded_comment_timestamp() -> String {
    let now =
        chrono::DateTime::from_timestamp_millis(crate::storage::infra::time::now_millis() as i64)
            .unwrap_or_else(|| {
                chrono::DateTime::from_timestamp_millis(0).expect("UNIX epoch timestamp is valid")
            });
    now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn ensure_threaded_comment_person(
    stores: &mut EngineStores,
    author: &str,
    author_id: Option<&str>,
) -> String {
    if let Some(person) = stores
        .storage
        .metadata
        .persons
        .iter()
        .find(|person| person.display_name == author && person.user_id.as_deref() == author_id)
    {
        return person.id.clone();
    }
    let person_id = stores.next_id_uuid_string();
    capture_workbook_field!(stores.storage, persons);
    capture_workbook_field!(stores.storage, has_persons_part);
    stores.storage.metadata.persons.push(PersonInfo {
        id: person_id.clone(),
        display_name: author.to_owned(),
        user_id: author_id.map(str::to_owned),
        provider_id: None,
    });
    stores.storage.metadata.has_persons_part = true;
    person_id
}

fn add_comment_options(
    stores: &mut EngineStores,
    text: &str,
    author: &str,
    author_id: Option<&str>,
    parent_id: Option<&str>,
    comment_type: CommentType,
) -> AddCommentOptions {
    let is_threaded = comment_type == CommentType::ThreadedComment;
    let person_id = is_threaded.then(|| ensure_threaded_comment_person(stores, author, author_id));
    AddCommentOptions {
        author_id: author_id.map(ToOwned::to_owned),
        person_id,
        parent_id: parent_id.map(ToOwned::to_owned),
        content: is_threaded.then(|| text.to_string()),
        resolved: is_threaded.then_some(false),
        timestamp: is_threaded.then(threaded_comment_timestamp),
        content_type: None,
        mentions: None,
        comment_type,
    }
}

/// Core logic for `add_comment`. Returns `(MutationResult, row, col)` so the
/// bridge can call `produce_comment_viewport_patches` with the position.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn add_comment(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    cell_id: &str,
    text: &str,
    author: &str,
    author_id: Option<&str>,
    parent_id: Option<&str>,
    comment_type: CommentType,
) -> Result<(MutationResult, u32, u32), ComputeError> {
    let runs = vec![RichTextRun {
        text: text.to_string(),
        ..Default::default()
    }];
    let options = add_comment_options(stores, text, author, author_id, parent_id, comment_type);
    let comment = comments::add_comment(
        &mut stores.storage,
        sheet_id,
        cell_id,
        runs,
        author,
        options,
        &stores.id_alloc,
    )?;
    // Resolve actual row/col from the grid index when possible.
    let (row, col) =
        cell_position_for_hex(stores, sheet_id, cell_id).unwrap_or((u32::MAX, u32::MAX));
    let position = if row == u32::MAX || col == u32::MAX {
        None
    } else {
        Some(CellPosition { row, col })
    };
    let mut result = MutationResult::empty();
    result.comment_changes.push(CommentChange {
        sheet_id: sheet_id.to_uuid_string(),
        cell_id: cell_id.to_string(),
        position,
        kind: ChangeKind::Set,
    });
    Ok((result.with_data(&comment)?, row, col))
}

/// Core logic for `delete_comment`. Returns `(MutationResult, Option<(u32, u32)>)` —
/// the position of the deleted comment's cell (if resolvable) and whether the cell
/// still has comments after deletion.
pub(in crate::storage::engine) fn delete_comment(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    comment_id: &str,
) -> DeleteCommentResult {
    // Look up the comment before deleting to get its cell_id for viewport patches.
    let existing = comments::get_comment(&stores.storage, sheet_id, comment_id);
    let cell_pos = existing
        .as_ref()
        .and_then(|comment| cell_position_for_hex(stores, sheet_id, &comment.cell_ref));

    comments::delete_comment(&mut stores.storage, sheet_id, comment_id);

    // Check if the cell still has other comments after this deletion.
    let still_has = if let Some((row, col)) = cell_pos {
        cell_hex_at_position(stores, sheet_id, row, col)
            .map(|cell_hex| comments::has_comments(&stores.storage, sheet_id, &cell_hex))
            .unwrap_or(false)
    } else {
        false
    };

    let mut result = MutationResult::empty();
    if let Some(comment) = existing {
        result.comment_changes.push(comment_change(
            stores,
            sheet_id,
            &comment.cell_ref,
            if still_has {
                ChangeKind::Set
            } else {
                ChangeKind::Removed
            },
        ));
    }
    Ok((result, cell_pos, still_has))
}

/// Core logic for `delete_comments_for_cell`. Returns `(MutationResult, u32, u32)` —
/// the resolved position for viewport patches.
pub(in crate::storage::engine) fn delete_comments_for_cell(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    cell_id: &str,
) -> Result<(MutationResult, u32, u32), ComputeError> {
    let count = comments::delete_comments_for_cell(&mut stores.storage, sheet_id, cell_id);
    // Resolve actual row/col from the grid index when possible.
    let (row, col) =
        cell_position_for_hex(stores, sheet_id, cell_id).unwrap_or((u32::MAX, u32::MAX));
    let position = if row == u32::MAX || col == u32::MAX {
        None
    } else {
        Some(CellPosition { row, col })
    };
    let mut result = MutationResult::empty();
    result.comment_changes.push(CommentChange {
        sheet_id: sheet_id.to_uuid_string(),
        cell_id: cell_id.to_string(),
        position,
        kind: ChangeKind::Removed,
    });
    Ok((result.with_data(&count)?, row, col))
}

/// Core logic for `clear_all_comments`. Returns `(MutationResult, Vec<(u32, u32)>)` —
/// the positions of all cells that had comments, for viewport patch production.
pub(in crate::storage::engine) fn clear_all_comments(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) -> Result<(MutationResult, Vec<(u32, u32)>), ComputeError> {
    // Collect positions of all cells with comments before clearing.
    let cell_hexes = comments::get_cell_ids_with_comments(&stores.storage, sheet_id);
    let positions: Vec<(u32, u32)> = cell_hexes
        .iter()
        .filter_map(|hex| cell_position_for_hex(stores, sheet_id, hex))
        .collect();

    comments::clear_all_comments(&mut stores.storage, sheet_id);

    let mut result = MutationResult::empty();
    result.comment_changes = cell_hexes
        .iter()
        .map(|id| comment_change(stores, sheet_id, id, ChangeKind::Removed))
        .collect();
    Ok((result, positions))
}

/// Core logic for `add_comment_by_position`. Returns `(MutationResult, u32, u32, CellId)`.
/// The bridge uses the position for viewport patches and the CellId for mirror tracking.
///
/// Enforces the cell-level XOR invariant: a `ThreadedComment` cannot coexist
/// with an existing `Note` on the same cell. The popover dispatches
/// `convertNoteToThread` first as the sanctioned promotion path; this guard
/// is defense-in-depth for direct API callers.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn add_comment_by_position(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    text: &str,
    author: &str,
    author_id: Option<&str>,
    parent_id: Option<&str>,
    comment_type: CommentType,
) -> Result<(MutationResult, CellId), ComputeError> {
    // Resolve or allocate the native stable identity for this comment anchor.
    let Some(cell_id) = cell_editing::ensure_cell_id_mirrored(stores, mirror, sheet_id, row, col)
    else {
        return Err(ComputeError::Eval {
            message: format!("Sheet not found: {:?}", sheet_id),
        });
    };

    let cell_hex: String = id_to_hex(cell_id.as_u128()).into();

    // Cell-level XOR enforcement: refuse to add a thread to a cell that
    // already has a note. `addNote()` (TS) preserves the symmetric escape
    // valve via "delete then add"; this branch is the asymmetric guard.
    if matches!(comment_type, CommentType::ThreadedComment) {
        let existing = comments::get_comments_for_cell(&stores.storage, sheet_id, &cell_hex);
        if existing.iter().any(|c| c.comment_type == CommentType::Note) {
            return Err(ComputeError::Eval {
                message: "cell already has a note; convert it before adding a thread".into(),
            });
        }
    }

    let runs = vec![RichTextRun {
        text: text.to_string(),
        ..Default::default()
    }];
    let options = add_comment_options(stores, text, author, author_id, parent_id, comment_type);
    let comment = comments::add_comment(
        &mut stores.storage,
        sheet_id,
        &cell_hex,
        runs,
        author,
        options,
        &stores.id_alloc,
    )?;

    let mut result = MutationResult::empty();
    result.comment_changes.push(CommentChange {
        sheet_id: sheet_id.to_uuid_string(),
        cell_id: cell_hex,
        position: Some(CellPosition { row, col }),
        kind: ChangeKind::Set,
    });
    Ok((result.with_data(&comment)?, cell_id))
}

/// Core logic for `delete_comments_for_cell_by_position`. Returns
/// `(MutationResult, Option<CellId>)` — the CellId for mirror tracking.
pub(in crate::storage::engine) fn delete_comments_for_cell_by_position(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Result<(MutationResult, Option<CellId>), ComputeError> {
    let cell_id = match cell_editing::find_cell_id_at(stores, sheet_id, row, col) {
        Some(cid) => cid,
        None => {
            // No cell at this position — nothing to delete
            return Ok((MutationResult::empty().with_data(&0usize)?, None));
        }
    };
    let cell_hex: String = id_to_hex(cell_id.as_u128()).into();
    let count = comments::delete_comments_for_cell(&mut stores.storage, sheet_id, &cell_hex);

    let mut result = MutationResult::empty();
    result.comment_changes.push(CommentChange {
        sheet_id: sheet_id.to_uuid_string(),
        cell_id: cell_hex,
        position: Some(CellPosition { row, col }),
        kind: ChangeKind::Removed,
    });
    Ok((result.with_data(&count)?, Some(cell_id)))
}

pub(in crate::storage::engine) fn update_comment(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    comment_id: &str,
    text: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let runs = vec![RichTextRun {
        text: text.to_string(),
        ..Default::default()
    }];
    let updated = comments::update_comment(&mut stores.storage, sheet_id, comment_id, runs);
    let patches = compute_wire::mutation::serialize_multi_viewport_patches(&[]);
    let mut result = MutationResult::empty();
    if let Some(comment) = updated {
        result.comment_changes.push(comment_change(
            stores,
            sheet_id,
            &comment.cell_ref,
            ChangeKind::Set,
        ));
    }
    Ok((patches, result))
}

/// Core logic for `convert_note_to_thread`. Returns the updated `Comment`
/// in `MutationResult.data` so the bridge can echo it back for UI re-render.
/// Returns an error when the comment doesn't exist or the sheet is missing.
pub(in crate::storage::engine) fn convert_note_to_thread(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    comment_id: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let updated = comments::convert_note_to_thread(&mut stores.storage, sheet_id, comment_id)
        .ok_or_else(|| ComputeError::Eval {
            message: format!("comment not found: {}", comment_id),
        })?;
    let person_id =
        ensure_threaded_comment_person(stores, &updated.author, updated.author_id.as_deref());
    let timestamp = updated
        .timestamp
        .clone()
        .unwrap_or_else(threaded_comment_timestamp);
    let updated = comments::complete_thread_metadata(
        &mut stores.storage,
        sheet_id,
        comment_id,
        &person_id,
        &timestamp,
    )
    .unwrap_or(updated);

    // Resolve the cell position so we can emit a comment-change for viewport
    // refresh (geometry changed; the popover needs to re-render in thread mode).
    let position = cell_position_for_hex(stores, sheet_id, &updated.cell_ref)
        .map(|(row, col)| CellPosition { row, col });

    let mut result = MutationResult::empty();
    result.comment_changes.push(CommentChange {
        sheet_id: sheet_id.to_uuid_string(),
        cell_id: updated.cell_ref.clone(),
        position,
        kind: ChangeKind::Set,
    });
    let patches = compute_wire::mutation::serialize_multi_viewport_patches(&[]);
    Ok((patches, result.with_data(&updated)?))
}

pub(in crate::storage::engine) fn set_thread_resolved(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    cell_id: &str,
    resolved: bool,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let thread_comments = comments::get_comment_thread(&stores.storage, sheet_id, cell_id);
    let affected_comment = thread_comments
        .iter()
        .find(|comment| comment.id == cell_id)
        .or_else(|| thread_comments.first());

    comments::set_thread_resolved(&mut stores.storage, sheet_id, cell_id, resolved);

    let mut result = MutationResult::empty();
    if let Some(comment) = affected_comment {
        let position = cell_position_for_hex(stores, sheet_id, &comment.cell_ref)
            .map(|(row, col)| CellPosition { row, col });

        result.comment_changes.push(CommentChange {
            sheet_id: sheet_id.to_uuid_string(),
            cell_id: comment.cell_ref.clone(),
            position,
            kind: ChangeKind::Set,
        });
    }

    let patches = compute_wire::mutation::serialize_multi_viewport_patches(&[]);
    Ok((patches, result))
}

pub(in crate::storage::engine) fn get_comments_for_cell(
    stores: &EngineStores,
    sheet_id: &SheetId,
    cell_id: &str,
) -> Vec<Comment> {
    comments::get_comments_for_cell(&stores.storage, sheet_id, cell_id)
}

pub(in crate::storage::engine) fn get_all_comments(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<Comment> {
    comments::get_all_comments(&stores.storage, sheet_id)
}

pub(in crate::storage::engine) fn get_comment(
    stores: &EngineStores,
    sheet_id: &SheetId,
    comment_id: &str,
) -> Option<Comment> {
    comments::get_comment(&stores.storage, sheet_id, comment_id)
}

pub(in crate::storage::engine) fn get_comment_thread(
    stores: &EngineStores,
    sheet_id: &SheetId,
    thread_id: &str,
) -> Vec<Comment> {
    comments::get_comment_thread(&stores.storage, sheet_id, thread_id)
}

pub(in crate::storage::engine) fn get_comment_count(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> u32 {
    comments::get_comment_count(&stores.storage, sheet_id)
}

pub(in crate::storage::engine) fn get_note_count(stores: &EngineStores, sheet_id: &SheetId) -> u32 {
    comments::get_note_count(&stores.storage, sheet_id)
}

pub(in crate::storage::engine) fn get_all_notes(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<Comment> {
    comments::get_all_notes(&stores.storage, sheet_id)
}

pub(in crate::storage::engine) fn set_note_visible(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    comment_id: &str,
    visible: bool,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let changed = comments::set_note_visible(&mut stores.storage, sheet_id, comment_id, visible);
    let patches = compute_wire::mutation::serialize_multi_viewport_patches(&[]);
    let mut result = MutationResult::empty();
    if changed {
        if let Some(comment) = comments::get_comment(&stores.storage, sheet_id, comment_id) {
            result.comment_changes.push(comment_change(
                stores,
                sheet_id,
                &comment.cell_ref,
                ChangeKind::Set,
            ));
        }
    }
    Ok((patches, result))
}

pub(in crate::storage::engine) fn set_note_dimensions(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    comment_id: &str,
    height: Option<f64>,
    width: Option<f64>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let changed =
        comments::set_note_dimensions(&mut stores.storage, sheet_id, comment_id, height, width);
    let patches = compute_wire::mutation::serialize_multi_viewport_patches(&[]);
    let mut result = MutationResult::empty();
    if changed {
        if let Some(comment) = comments::get_comment(&stores.storage, sheet_id, comment_id) {
            result.comment_changes.push(comment_change(
                stores,
                sheet_id,
                &comment.cell_ref,
                ChangeKind::Set,
            ));
        }
    }
    Ok((patches, result))
}

pub(in crate::storage::engine) fn has_comments(
    stores: &EngineStores,
    sheet_id: &SheetId,
    cell_id: &str,
) -> bool {
    comments::has_comments(&stores.storage, sheet_id, cell_id)
}

pub(in crate::storage::engine) fn validate_and_clean_comments(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let removed_count = comments::validate_and_clean_comments(
        &mut stores.storage,
        sheet_id,
        stores
            .grid_indexes
            .get(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?,
    );
    let patches = compute_wire::mutation::serialize_multi_viewport_patches(&[]);
    Ok((patches, MutationResult::empty().with_data(&removed_count)?))
}

pub(in crate::storage::engine) fn update_comment_mentions(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    comment_id: &str,
    content: &str,
    mentions: Vec<CommentMention>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let updated = comments::update_comment_mentions(
        &mut stores.storage,
        sheet_id,
        comment_id,
        content,
        mentions,
    );
    let patches = compute_wire::mutation::serialize_multi_viewport_patches(&[]);
    let mut result = MutationResult::empty();
    if let Some(comment) = updated {
        result.comment_changes.push(comment_change(
            stores,
            sheet_id,
            &comment.cell_ref,
            ChangeKind::Set,
        ));
    }
    Ok((patches, result))
}

// -------------------------------------------------------------------
// Comments — position-based (self-contained, no viewport patches)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_comments_for_cell_by_position(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Vec<Comment> {
    match cell_hex_at_position(stores, sheet_id, row, col) {
        Some(cell_hex) => comments::get_comments_for_cell(&stores.storage, sheet_id, &cell_hex),
        None => Vec::new(),
    }
}

pub(in crate::storage::engine) fn has_comments_by_position(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    match cell_hex_at_position(stores, sheet_id, row, col) {
        Some(cell_hex) => comments::has_comments(&stores.storage, sheet_id, &cell_hex),
        None => false,
    }
}

// -------------------------------------------------------------------
// Charts
