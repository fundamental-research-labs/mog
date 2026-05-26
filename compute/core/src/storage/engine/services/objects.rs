//! Extracted object-domain functions (comments, charts, floating objects, pivots, hyperlinks).
//!
//! Each function takes explicit references to the engine sub-structs it needs
//! (e.g. `&EngineStores`, `&mut EngineStores`, `&CellMirror`) instead of `&self`.
//! The original bridge methods in `objects.rs` delegate to these with one-line calls.

use crate::engine_types::floating_objects::{
    CreateShapeConfig, FlipAxis, MoveTarget, ResizeConfig, ShapeStyleUpdate,
};
use crate::engine_types::{SerializedFloatingObjectGroup, ZOrderEntry};
use crate::mirror::CellMirror;
use crate::snapshot::{
    CellPosition, ChangeKind, CommentChange, FloatingObjectBounds, FloatingObjectChange,
    FloatingObjectChangeKind, MutationResult, PivotTableChange,
};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::floating_objects::compute_object_pixel_bounds;
use crate::storage::sheet::{comments, floating_objects, hyperlinks, pivots};
use cell_types::{CellId, SheetId};
use compute_document::hex::id_to_hex;
use compute_pivot::PivotTableDefExt;
use domain_types::domain::comment::{
    AddCommentOptions, Comment, CommentMention, CommentType, RichTextRun,
};
use domain_types::domain::floating_object::{
    FloatingObject, FloatingObjectData, FloatingObjectKind,
};
use domain_types::domain::pivot::PivotTableConfig;
use value_types::ComputeError;

/// Result type for comment deletion: `(MutationResult, Option<(row, col)>, still_has_comments)`.
type DeleteCommentResult = Result<(MutationResult, Option<(u32, u32)>, bool), ComputeError>;

// -------------------------------------------------------------------
// Comments — core logic (returns data for bridge to produce viewport patches)
// -------------------------------------------------------------------

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
    let options = AddCommentOptions {
        author_id: author_id.map(|s| s.to_string()),
        parent_id: parent_id.map(|s| s.to_string()),
        content_type: None,
        mentions: None,
        comment_type,
    };
    let comment = comments::add_comment(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        cell_id,
        runs,
        author,
        options,
        &stores.id_alloc,
    )?;
    // Resolve actual row/col from the grid index when possible.
    let (row, col) = compute_document::hex::hex_to_id(cell_id)
        .map(CellId::from_raw)
        .and_then(|cid| {
            stores
                .grid_indexes
                .get(sheet_id)
                .and_then(|g| g.cell_position(&cid))
        })
        .unwrap_or((u32::MAX, u32::MAX));
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
    let cell_pos = comments::get_comment(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        comment_id,
    )
    .and_then(|c| {
        compute_document::hex::hex_to_id(&c.cell_ref)
            .map(CellId::from_raw)
            .and_then(|cid| {
                stores
                    .grid_indexes
                    .get(sheet_id)
                    .and_then(|g| g.cell_position(&cid))
            })
    });

    comments::delete_comment(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        comment_id,
    );

    // Check if the cell still has other comments after this deletion.
    let still_has = if let Some((row, col)) = cell_pos {
        let cell_id = super::cell_editing::find_cell_id_at(stores, sheet_id, row, col);
        cell_id
            .map(|cid| {
                let cell_hex = id_to_hex(cid.as_u128());
                comments::has_comments(
                    stores.storage.doc(),
                    stores.storage.sheets(),
                    sheet_id,
                    &cell_hex,
                )
            })
            .unwrap_or(false)
    } else {
        false
    };

    Ok((MutationResult::empty(), cell_pos, still_has))
}

/// Core logic for `delete_comments_for_cell`. Returns `(MutationResult, u32, u32)` —
/// the resolved position for viewport patches.
pub(in crate::storage::engine) fn delete_comments_for_cell(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    cell_id: &str,
) -> Result<(MutationResult, u32, u32), ComputeError> {
    let count = comments::delete_comments_for_cell(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        cell_id,
    );
    // Resolve actual row/col from the grid index when possible.
    let (row, col) = compute_document::hex::hex_to_id(cell_id)
        .map(CellId::from_raw)
        .and_then(|cid| {
            stores
                .grid_indexes
                .get(sheet_id)
                .and_then(|g| g.cell_position(&cid))
        })
        .unwrap_or((u32::MAX, u32::MAX));
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
    let cell_hexes = comments::get_cell_ids_with_comments(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    );
    let positions: Vec<(u32, u32)> = cell_hexes
        .iter()
        .filter_map(|hex| {
            compute_document::hex::hex_to_id(hex)
                .map(CellId::from_raw)
                .and_then(|cid| {
                    stores
                        .grid_indexes
                        .get(sheet_id)
                        .and_then(|g| g.cell_position(&cid))
                })
        })
        .collect();

    comments::clear_all_comments(stores.storage.doc(), stores.storage.sheets(), sheet_id);

    Ok((MutationResult::empty(), positions))
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
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    text: &str,
    author: &str,
    author_id: Option<&str>,
    parent_id: Option<&str>,
    comment_type: CommentType,
) -> Result<(MutationResult, CellId), ComputeError> {
    // Resolve existing CellId or mint a new one (mirroring into the yrs
    // `gridIndex/{posToId, idToPos}` sub-maps so remote peers can resolve
    // this cell's position after CRDT sync).
    let Some(cell_id) =
        super::cell_editing::ensure_cell_id_mirrored(stores, mirror, sheet_id, row, col)
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
        let existing = comments::get_comments_for_cell(
            stores.storage.doc(),
            stores.storage.sheets(),
            sheet_id,
            &cell_hex,
        );
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
    let options = AddCommentOptions {
        author_id: author_id.map(|s| s.to_string()),
        parent_id: parent_id.map(|s| s.to_string()),
        content_type: None,
        mentions: None,
        comment_type,
    };
    let comment = comments::add_comment(
        stores.storage.doc(),
        stores.storage.sheets(),
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
    let cell_id = match super::cell_editing::find_cell_id_at(stores, sheet_id, row, col) {
        Some(cid) => cid,
        None => {
            // No cell at this position — nothing to delete
            return Ok((MutationResult::empty().with_data(&0usize)?, None));
        }
    };
    let cell_hex: String = id_to_hex(cell_id.as_u128()).into();
    let count = comments::delete_comments_for_cell(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &cell_hex,
    );

    let mut result = MutationResult::empty();
    result.comment_changes.push(CommentChange {
        sheet_id: sheet_id.to_uuid_string(),
        cell_id: cell_hex,
        position: Some(CellPosition { row, col }),
        kind: ChangeKind::Removed,
    });
    Ok((result.with_data(&count)?, Some(cell_id)))
}

/// Core logic for `pivot_create_with_sheet`. The bridge handles calling
/// `mutation_create_sheet` which requires `&mut self`.
pub(in crate::storage::engine) fn pivot_create_with_sheet_inner(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    config: PivotTableConfig,
) -> Result<PivotTableConfig, ComputeError> {
    pivots::create_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        config,
        &stores.id_alloc,
    )
}

// -------------------------------------------------------------------
// Comments (self-contained — no viewport patch calls)
// -------------------------------------------------------------------

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
    comments::update_comment(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        comment_id,
        runs,
    );
    let patches = compute_wire::mutation::serialize_multi_viewport_patches(&[]);
    Ok((patches, MutationResult::empty()))
}

/// Core logic for `convert_note_to_thread`. Returns the updated `Comment`
/// in `MutationResult.data` so the bridge can echo it back for UI re-render.
/// Returns an error when the comment doesn't exist or the sheet is missing.
pub(in crate::storage::engine) fn convert_note_to_thread(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    comment_id: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let updated = comments::convert_note_to_thread(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        comment_id,
    )
    .ok_or_else(|| ComputeError::Eval {
        message: format!("comment not found: {}", comment_id),
    })?;

    // Resolve the cell position so we can emit a comment-change for viewport
    // refresh (geometry changed; the popover needs to re-render in thread mode).
    let position = compute_document::hex::hex_to_id(&updated.cell_ref)
        .map(CellId::from_raw)
        .and_then(|cid| {
            stores
                .grid_indexes
                .get(sheet_id)
                .and_then(|g| g.cell_position(&cid))
        })
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
    let thread_comments = comments::get_comment_thread(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        cell_id,
    );
    let affected_comment = thread_comments
        .iter()
        .find(|comment| comment.id == cell_id)
        .or_else(|| thread_comments.first());

    comments::set_thread_resolved(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        cell_id,
        resolved,
    );

    let mut result = MutationResult::empty();
    if let Some(comment) = affected_comment {
        let position = compute_document::hex::hex_to_id(&comment.cell_ref)
            .map(CellId::from_raw)
            .and_then(|cid| {
                stores
                    .grid_indexes
                    .get(sheet_id)
                    .and_then(|g| g.cell_position(&cid))
            })
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
    comments::get_comments_for_cell(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        cell_id,
    )
}

pub(in crate::storage::engine) fn get_all_comments(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<Comment> {
    comments::get_all_comments(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_comment(
    stores: &EngineStores,
    sheet_id: &SheetId,
    comment_id: &str,
) -> Option<Comment> {
    comments::get_comment(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        comment_id,
    )
}

pub(in crate::storage::engine) fn get_comment_thread(
    stores: &EngineStores,
    sheet_id: &SheetId,
    thread_id: &str,
) -> Vec<Comment> {
    comments::get_comment_thread(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        thread_id,
    )
}

pub(in crate::storage::engine) fn get_comment_count(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> u32 {
    comments::get_comment_count(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_note_count(stores: &EngineStores, sheet_id: &SheetId) -> u32 {
    comments::get_note_count(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_all_notes(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<Comment> {
    comments::get_all_notes(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn set_note_visible(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    comment_id: &str,
    visible: bool,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    comments::set_note_visible(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        comment_id,
        visible,
    );
    let patches = compute_wire::mutation::serialize_multi_viewport_patches(&[]);
    Ok((patches, MutationResult::empty()))
}

pub(in crate::storage::engine) fn set_note_dimensions(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    comment_id: &str,
    height: Option<f64>,
    width: Option<f64>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    comments::set_note_dimensions(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        comment_id,
        height,
        width,
    );
    let patches = compute_wire::mutation::serialize_multi_viewport_patches(&[]);
    Ok((patches, MutationResult::empty()))
}

pub(in crate::storage::engine) fn has_comments(
    stores: &EngineStores,
    sheet_id: &SheetId,
    cell_id: &str,
) -> bool {
    comments::has_comments(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        cell_id,
    )
}

pub(in crate::storage::engine) fn validate_and_clean_comments(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let removed_count = comments::validate_and_clean_comments(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
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
    comments::update_comment_mentions(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        comment_id,
        content,
        mentions,
    );
    let patches = compute_wire::mutation::serialize_multi_viewport_patches(&[]);
    Ok((patches, MutationResult::empty()))
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
    match super::cell_editing::find_cell_id_at(stores, sheet_id, row, col) {
        Some(cid) => {
            let cell_hex = id_to_hex(cid.as_u128());
            comments::get_comments_for_cell(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                &cell_hex,
            )
        }
        None => Vec::new(),
    }
}

pub(in crate::storage::engine) fn has_comments_by_position(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    match super::cell_editing::find_cell_id_at(stores, sheet_id, row, col) {
        Some(cid) => {
            let cell_hex = id_to_hex(cid.as_u128());
            comments::has_comments(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                &cell_hex,
            )
        }
        None => false,
    }
}

// -------------------------------------------------------------------
// Charts
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn create_chart(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    config: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let object_json = floating_objects::create_chart_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        config,
        stores.grid_indexes.get_mut(sheet_id),
        &stores.id_alloc,
    )?;
    let object_id = object_json["id"].as_str().unwrap_or("").to_string();
    let bounds = compute_object_pixel_bounds(
        stores.grid_indexes.get(sheet_id),
        stores.layout_indexes.get(sheet_id),
        &object_json,
    );
    let data: Option<FloatingObject> = serde_json::from_value(object_json).ok();
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.clone(),
        kind: FloatingObjectChangeKind::Created,
        object_type: Some(FloatingObjectKind::Chart),
        data,
        bounds,
    });
    Ok(result.with_data(&object_id)?)
}

pub(in crate::storage::engine) fn update_chart(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
    updates: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    floating_objects::update_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
        updates,
    );
    let data: Option<FloatingObject> = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let obj_json = floating_objects::get_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let bounds = obj_json.and_then(|json| {
        compute_object_pixel_bounds(
            stores.grid_indexes.get(sheet_id),
            stores.layout_indexes.get(sheet_id),
            &json,
        )
    });
    let changed = updates
        .as_object()
        .map(|m| m.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: chart_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: changed,
        },
        object_type: Some(FloatingObjectKind::Chart),
        data,
        bounds,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn delete_chart(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Result<MutationResult, ComputeError> {
    let pre_delete = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    floating_objects::delete_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: chart_id.to_string(),
        kind: FloatingObjectChangeKind::Removed,
        object_type: Some(FloatingObjectKind::Chart),
        data: pre_delete,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn get_chart(
    stores: &EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Option<FloatingObject> {
    let obj = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    )?;
    if obj.object_type() != "chart" {
        return None;
    }
    Some(obj)
}

pub(in crate::storage::engine) fn get_all_charts(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<FloatingObject> {
    floating_objects::get_all_floating_objects_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
    .into_iter()
    .filter(|obj| obj.object_type() == "chart")
    .collect()
}

pub(in crate::storage::engine) fn bring_chart_to_front(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::bring_floating_object_to_front(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: chart_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["zIndex".to_string()],
        },
        object_type: Some(FloatingObjectKind::Chart),
        data,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn send_chart_to_back(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::send_floating_object_to_back(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: chart_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["zIndex".to_string()],
        },
        object_type: Some(FloatingObjectKind::Chart),
        data,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn bring_chart_forward(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::bring_floating_object_forward(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: chart_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["zIndex".to_string()],
        },
        object_type: Some(FloatingObjectKind::Chart),
        data,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn send_chart_backward(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::send_floating_object_backward(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: chart_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["zIndex".to_string()],
        },
        object_type: Some(FloatingObjectKind::Chart),
        data,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn get_charts_in_z_order(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<FloatingObject> {
    let mut charts: Vec<FloatingObject> = floating_objects::get_all_floating_objects_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
    .into_iter()
    .filter(|obj| obj.object_type() == "chart")
    .collect();
    charts.sort_by_key(|obj| obj.common.z_index);
    charts
}

pub(in crate::storage::engine) fn link_chart_to_table(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
    table_id: &str,
) -> Result<MutationResult, ComputeError> {
    let updates = serde_json::json!({ "sourceTableId": table_id });
    floating_objects::update_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
        &updates,
    );
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn unlink_chart_from_table(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Result<MutationResult, ComputeError> {
    let updates = serde_json::json!({ "sourceTableId": null });
    floating_objects::update_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
        &updates,
    );
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn is_chart_linked_to_table(
    stores: &EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> bool {
    floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    )
    .and_then(|obj| {
        if let FloatingObjectData::Chart(ref c) = obj.data {
            c.source_table_id.as_ref().map(|_| true)
        } else {
            None
        }
    })
    .unwrap_or(false)
}

pub(in crate::storage::engine) fn get_charts_linked_to_table(
    stores: &EngineStores,
    sheet_id: &SheetId,
    table_id: &str,
) -> Vec<FloatingObject> {
    floating_objects::get_all_floating_objects_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
    .into_iter()
    .filter(|obj| {
        if let FloatingObjectData::Chart(ref c) = obj.data {
            c.source_table_id.as_deref() == Some(table_id)
        } else {
            false
        }
    })
    .collect()
}

pub(in crate::storage::engine) fn get_max_z_index(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> i32 {
    floating_objects::get_floating_object_max_z_index(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
}

pub(in crate::storage::engine) fn get_min_z_index(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> i32 {
    floating_objects::get_floating_object_min_z_index(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
}

// -------------------------------------------------------------------
// Floating Objects
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn set_floating_object(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
    json: serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    floating_objects::set_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
        &json,
    )?;
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec![],
        },
        object_type: None,
        data: None,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn get_floating_object(
    stores: &EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
) -> Result<Option<serde_json::Value>, ComputeError> {
    Ok(floating_objects::get_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    ))
}

pub(in crate::storage::engine) fn get_floating_objects_in_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Result<Vec<(String, serde_json::Value)>, ComputeError> {
    Ok(floating_objects::get_all_floating_objects(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    ))
}

pub(in crate::storage::engine) fn delete_floating_object(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
) -> Result<MutationResult, ComputeError> {
    let pre_delete = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    floating_objects::delete_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let object_type = pre_delete.as_ref().map(|d| d.kind());
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Removed,
        object_type,
        data: pre_delete,
        bounds: None,
    });
    Ok(result)
}

// -------------------------------------------------------------------
// Floating Object Groups
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn set_floating_object_group(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
    json: serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    floating_objects::set_floating_object_group(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
        &json,
    )?;
    let mut result = MutationResult::empty();
    result
        .floating_object_group_changes
        .push(FloatingObjectChange {
            sheet_id: sheet_id.to_uuid_string(),
            object_id: group_id.to_string(),
            kind: FloatingObjectChangeKind::Updated {
                changed_fields: vec![],
            },
            object_type: None,
            data: None,
            bounds: None,
        });
    Ok(result)
}

pub(in crate::storage::engine) fn get_floating_object_group(
    stores: &EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
) -> Result<Option<serde_json::Value>, ComputeError> {
    Ok(floating_objects::get_floating_object_group(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
    ))
}

pub(in crate::storage::engine) fn get_floating_object_groups_in_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Result<Vec<(String, serde_json::Value)>, ComputeError> {
    Ok(floating_objects::get_all_floating_object_groups(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    ))
}

pub(in crate::storage::engine) fn delete_floating_object_group(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::delete_floating_object_group(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
    );
    let mut result = MutationResult::empty();
    result
        .floating_object_group_changes
        .push(FloatingObjectChange {
            sheet_id: sheet_id.to_uuid_string(),
            object_id: group_id.to_string(),
            kind: FloatingObjectChangeKind::Removed,
            object_type: None,
            data: None,
            bounds: None,
        });
    Ok(result)
}

// -------------------------------------------------------------------
// Typed Floating Objects (new API)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn create_floating_object(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    config: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let object_id = floating_objects::create_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        config,
        &stores.id_alloc,
    )?;
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &object_id,
    );
    // Bounds must travel with the create patch — the renderer skips objects
    // whose `FloatingObjectPatch.bounds` is None (parity with create_shape /
    // move/resize paths). Without this the typed-API picture/textbox flows
    // (paste-image, ws.pictures.add, ws.textboxes.add, etc.) would render
    // nothing on first paint.
    let bounds = data.as_ref().and_then(|obj| {
        serde_json::to_value(obj).ok().and_then(|json| {
            compute_object_pixel_bounds(
                stores.grid_indexes.get(sheet_id),
                stores.layout_indexes.get(sheet_id),
                &json,
            )
        })
    });
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.clone(),
        kind: FloatingObjectChangeKind::Created,
        object_type: None,
        data,
        bounds,
    });
    Ok(result.with_data(&object_id)?)
}

pub(in crate::storage::engine) fn update_floating_object(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
    updates: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    floating_objects::update_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
        updates,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec![],
        },
        object_type: None,
        data: None,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn create_shape(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    mut config: CreateShapeConfig,
) -> Result<MutationResult, ComputeError> {
    // Resolve absolute pixel coordinates to cell-anchor + offset when provided.
    if let (Some(px_f), Some(py_f)) = (config.pixel_x, config.pixel_y) {
        let px = px_f.get();
        let py = py_f.get();
        let li = stores.layout_indexes.get(sheet_id);
        let row = li.map_or(
            (py / compute_layout_index::DEFAULT_ROW_HEIGHT.0).max(0.0) as u32,
            |l| l.get_row_at_pixel(domain_types::units::Pixels(py)) as u32,
        );
        let col = li.map_or(
            (px / compute_layout_index::platform_default_col_width().0).max(0.0) as u32,
            |l| l.get_col_at_pixel(domain_types::units::Pixels(px)) as u32,
        );
        let row_pos = li.map_or(
            row as f64 * compute_layout_index::DEFAULT_ROW_HEIGHT.0,
            |l| l.get_row_position(row as usize).0,
        );
        let col_pos = li.map_or(
            col as f64 * compute_layout_index::platform_default_col_width().0,
            |l| l.get_col_position(col as usize).0,
        );
        config.anchor_row = row;
        config.anchor_col = col;
        // px/py and row_pos/col_pos are all finite-derived pixel coordinates;
        // their differences stay finite (no overflow possible at these scales).
        config.x_offset = value_types::FiniteF64::must(px - col_pos);
        config.y_offset = value_types::FiniteF64::must(py - row_pos);
    }
    let object_json = floating_objects::create_shape_from_config(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &config,
        stores.grid_indexes.get_mut(sheet_id),
        &stores.id_alloc,
    )?;
    let object_id = object_json["id"].as_str().unwrap_or("").to_string();
    let bounds = compute_object_pixel_bounds(
        stores.grid_indexes.get(sheet_id),
        stores.layout_indexes.get(sheet_id),
        &object_json,
    );
    let data: Option<FloatingObject> = serde_json::from_value(object_json.clone()).ok();
    let object_type = data.as_ref().map(|d| d.kind());
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id,
        kind: FloatingObjectChangeKind::Created,
        object_type,
        data,
        bounds,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn move_floating_object_typed(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
    target: MoveTarget,
) -> Result<MutationResult, ComputeError> {
    let updated = floating_objects::move_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
        &target,
        stores.grid_indexes.get_mut(sheet_id),
    );
    let bounds = updated.as_ref().and_then(|v| {
        compute_object_pixel_bounds(
            stores.grid_indexes.get(sheet_id),
            stores.layout_indexes.get(sheet_id),
            v,
        )
    });
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec![
                "anchorRow".into(),
                "anchorCol".into(),
                "xOffset".into(),
                "yOffset".into(),
            ],
        },
        object_type: None,
        data: updated.and_then(|v| serde_json::from_value::<FloatingObject>(v).ok()),
        bounds,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn resize_floating_object_typed(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
    config: ResizeConfig,
) -> Result<MutationResult, ComputeError> {
    let updated = floating_objects::resize_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
        &config,
    );
    let bounds = updated.as_ref().and_then(|v| {
        compute_object_pixel_bounds(
            stores.grid_indexes.get(sheet_id),
            stores.layout_indexes.get(sheet_id),
            v,
        )
    });
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["width".into(), "height".into()],
        },
        object_type: None,
        data: updated.and_then(|v| serde_json::from_value::<FloatingObject>(v).ok()),
        bounds,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn rotate_floating_object_typed(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
    rotation: f64,
) -> Result<MutationResult, ComputeError> {
    let updated = floating_objects::rotate_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
        rotation,
    );
    let bounds = updated.as_ref().and_then(|v| {
        compute_object_pixel_bounds(
            stores.grid_indexes.get(sheet_id),
            stores.layout_indexes.get(sheet_id),
            v,
        )
    });
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["rotation".into()],
        },
        object_type: None,
        data: updated.and_then(|v| serde_json::from_value::<FloatingObject>(v).ok()),
        bounds,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn update_shape_style(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
    style: ShapeStyleUpdate,
) -> Result<MutationResult, ComputeError> {
    let updated = floating_objects::update_shape_style(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
        &style,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["fill".into(), "outline".into()],
        },
        object_type: None,
        data: updated.and_then(|v| serde_json::from_value::<FloatingObject>(v).ok()),
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn flip_floating_object_typed(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
    axis: FlipAxis,
) -> Result<MutationResult, ComputeError> {
    let updated = floating_objects::flip_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
        &axis,
    );
    let bounds = updated.as_ref().and_then(|v| {
        compute_object_pixel_bounds(
            stores.grid_indexes.get(sheet_id),
            stores.layout_indexes.get(sheet_id),
            v,
        )
    });
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["flipH".into(), "flipV".into()],
        },
        object_type: None,
        data: updated.and_then(|v| serde_json::from_value::<FloatingObject>(v).ok()),
        bounds,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn duplicate_floating_object_typed(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
    offset_x: f64,
    offset_y: f64,
) -> Result<MutationResult, ComputeError> {
    let new_object_json = floating_objects::duplicate_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
        offset_x,
        offset_y,
        &stores.id_alloc,
    )
    .ok_or_else(|| ComputeError::Eval {
        message: format!("Failed to duplicate floating object {object_id}"),
    })?;
    let new_object_id = new_object_json["id"].as_str().unwrap_or("").to_string();
    let bounds = compute_object_pixel_bounds(
        stores.grid_indexes.get(sheet_id),
        stores.layout_indexes.get(sheet_id),
        &new_object_json,
    );
    let data: Option<FloatingObject> = serde_json::from_value(new_object_json).ok();
    let object_type = data.as_ref().map(|d| d.kind());
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: new_object_id,
        kind: FloatingObjectChangeKind::Created,
        object_type,
        data,
        bounds,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn find_connectors_for_shape(
    stores: &EngineStores,
    sheet_id: &SheetId,
    shape_id: &str,
) -> Vec<FloatingObject> {
    let pairs = floating_objects::find_connectors_for_shape(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        shape_id,
    );
    pairs
        .into_iter()
        .filter_map(|(_key, json)| serde_json::from_value(json).ok())
        .collect()
}

pub(in crate::storage::engine) fn get_floating_object_typed(
    stores: &EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
) -> Option<FloatingObject> {
    floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    )
}

pub(in crate::storage::engine) fn get_all_floating_objects_typed(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<FloatingObject> {
    floating_objects::get_all_floating_objects_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
}

pub(in crate::storage::engine) fn compute_all_object_bounds(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<(String, FloatingObjectBounds)> {
    let grid = stores.grid_indexes.get(sheet_id);
    let layout = stores.layout_indexes.get(sheet_id);
    let all_objects = floating_objects::get_all_floating_objects(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    );
    let mut results = Vec::with_capacity(all_objects.len());
    for (object_id, obj_json) in &all_objects {
        if let Some(bounds) = compute_object_pixel_bounds(grid, layout, obj_json) {
            results.push((object_id.clone(), bounds));
        }
    }
    results
}

// -------------------------------------------------------------------
// Floating Object Z-Order
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn bring_floating_object_to_front(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::bring_floating_object_to_front(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["zIndex".into()],
        },
        object_type: None,
        data,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn send_floating_object_to_back(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::send_floating_object_to_back(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["zIndex".into()],
        },
        object_type: None,
        data,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn bring_floating_object_forward(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::bring_floating_object_forward(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["zIndex".into()],
        },
        object_type: None,
        data,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn send_floating_object_backward(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::send_floating_object_backward(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["zIndex".into()],
        },
        object_type: None,
        data,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn get_floating_objects_in_z_order(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<FloatingObject> {
    floating_objects::get_floating_objects_in_z_order(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
}

pub(in crate::storage::engine) fn get_floating_object_max_z_index(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> i32 {
    floating_objects::get_floating_object_max_z_index(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
}

pub(in crate::storage::engine) fn get_floating_object_min_z_index(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> i32 {
    floating_objects::get_floating_object_min_z_index(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
}

// -------------------------------------------------------------------
// Typed Floating Object Groups (new API)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn create_floating_object_group(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    config: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let group_id = floating_objects::create_floating_object_group(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        config,
        &stores.id_alloc,
    )?;
    let mut result = MutationResult::empty();
    result
        .floating_object_group_changes
        .push(FloatingObjectChange {
            sheet_id: sheet_id.to_uuid_string(),
            object_id: group_id.clone(),
            kind: FloatingObjectChangeKind::Created,
            object_type: None,
            data: None,
            bounds: None,
        });
    Ok(result.with_data(&group_id)?)
}

pub(in crate::storage::engine) fn update_floating_object_group(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
    updates: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    floating_objects::update_floating_object_group(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
        updates,
    );
    let mut result = MutationResult::empty();
    result
        .floating_object_group_changes
        .push(FloatingObjectChange {
            sheet_id: sheet_id.to_uuid_string(),
            object_id: group_id.to_string(),
            kind: FloatingObjectChangeKind::Updated {
                changed_fields: vec![],
            },
            object_type: None,
            data: None,
            bounds: None,
        });
    Ok(result)
}

pub(in crate::storage::engine) fn get_floating_object_group_typed(
    stores: &EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<SerializedFloatingObjectGroup> {
    floating_objects::get_floating_object_group_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
    )
}

pub(in crate::storage::engine) fn get_all_floating_object_groups_typed(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<SerializedFloatingObjectGroup> {
    floating_objects::get_all_floating_object_groups_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
}

// -------------------------------------------------------------------
// Unified Z-Order
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_max_z_index_all(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> i32 {
    floating_objects::get_max_z_index_all(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_min_z_index_all(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> i32 {
    floating_objects::get_min_z_index_all(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_all_in_z_order(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<ZOrderEntry> {
    floating_objects::get_all_in_z_order(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

// -------------------------------------------------------------------
// Hyperlinks
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn set_hyperlink(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    url: &str,
) -> Result<MutationResult, ComputeError> {
    // Capture whether a cell already exists at this position before calling in;
    // `set_hyperlink` allocates a marker CellId via GridIndex when the slot is
    // empty, and we need to mirror that allocation into CellMirror.
    let pre_existing_id = stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|g| g.cell_id_at(row, col));

    let Some(grid) = stores.grid_indexes.get_mut(sheet_id) else {
        return Ok(MutationResult::empty());
    };
    hyperlinks::set_hyperlink(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        grid,
        row,
        col,
        url,
    );

    // If a new marker cell was allocated, mirror it into CellMirror so that
    // subsequent queries find it immediately.
    if pre_existing_id.is_none()
        && let Some(cell_id) = stores
            .grid_indexes
            .get(sheet_id)
            .and_then(|g| g.cell_id_at(row, col))
    {
        let pos = cell_types::SheetPos::new(row, col);
        mirror.apply_edit(sheet_id, cell_id, pos, value_types::CellValue::Null, None);
    }

    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn remove_hyperlink(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Result<MutationResult, ComputeError> {
    // Capture the (potential) marker CellId before removal; if the cell is
    // fully deleted below, its id will no longer resolve in the GridIndex.
    let pre_existing_id = stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|g| g.cell_id_at(row, col));

    let Some(grid) = stores.grid_indexes.get_mut(sheet_id) else {
        return Ok(MutationResult::empty());
    };
    hyperlinks::remove_hyperlink(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        grid,
        row,
        col,
    );

    // If the marker cell was deleted (no longer resolvable at the position),
    // also drop it from CellMirror.
    if let Some(cell_id) = pre_existing_id
        && stores
            .grid_indexes
            .get(sheet_id)
            .and_then(|g| g.cell_id_at(row, col))
            .is_none()
    {
        mirror.remove_cell(&cell_id);
    }

    Ok(MutationResult::empty())
}

// -------------------------------------------------------------------
// Pivot Tables
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn pivot_create(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    config: PivotTableConfig,
) -> Result<MutationResult, ComputeError> {
    let pivot_config = pivots::create_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        config,
        &stores.id_alloc,
    )?;
    let mut result = MutationResult::empty();
    result.pivot_changes.push(PivotTableChange {
        sheet_id: sheet_id.to_uuid_string(),
        pivot_id: pivot_config.id.clone(),
        kind: ChangeKind::Set,
    });
    Ok(result.with_data(&pivot_config)?)
}

pub(in crate::storage::engine) fn pivot_update(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    pivot_id: &str,
    config: PivotTableConfig,
) -> Result<MutationResult, ComputeError> {
    let updated = pivots::update_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        pivot_id,
        config,
    );
    let mut result = MutationResult::empty();
    if updated.is_some() {
        result.pivot_changes.push(PivotTableChange {
            sheet_id: sheet_id.to_uuid_string(),
            pivot_id: pivot_id.to_string(),
            kind: ChangeKind::Set,
        });
    }
    Ok(result.with_data(&updated)?)
}

pub(in crate::storage::engine) fn pivot_delete(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    pivot_id: &str,
) -> Result<MutationResult, ComputeError> {
    let deleted = pivots::delete_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        pivot_id,
    );
    let mut result = MutationResult::empty();
    if deleted {
        result.pivot_changes.push(PivotTableChange {
            sheet_id: sheet_id.to_uuid_string(),
            pivot_id: pivot_id.to_string(),
            kind: ChangeKind::Removed,
        });
    }
    Ok(result.with_data(&deleted)?)
}

pub(in crate::storage::engine) fn pivot_get(
    stores: &EngineStores,
    sheet_id: &SheetId,
    pivot_id: &str,
) -> Option<PivotTableConfig> {
    pivots::get_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        pivot_id,
    )
}

pub(in crate::storage::engine) fn pivot_get_all(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<PivotTableConfig> {
    pivots::get_all_pivots(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn pivot_register_def(
    stores: &EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    pivot_id: &str,
    total_rows: u32,
    total_cols: u32,
    first_data_row: u32,
    first_data_col: u32,
) -> Result<MutationResult, ComputeError> {
    let config = pivots::get_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        pivot_id,
    )
    .ok_or_else(|| ComputeError::Eval {
        message: format!("pivot_register_def: pivot {pivot_id} not found on sheet {sheet_id}"),
    })?;

    let bounds = compute_pivot::PivotRenderedBounds {
        total_rows,
        total_cols,
        first_data_row,
        first_data_col,
        num_data_cols: 0,
    };
    let output_sheet_id = mirror
        .sheet_by_name(&config.output_sheet_name)
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: config.output_sheet_name.clone(),
        })?;

    let engine_config =
        compute_pivot::PivotEngineConfig::try_from(config).map_err(|e| ComputeError::Eval {
            message: format!("Pivot config conversion error: {e}"),
        })?;
    let def = engine_config.to_pivot_table_def(&bounds, &output_sheet_id);
    mirror.upsert_pivot_table_def(def);
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn pivot_unregister_def(
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    pivot_name: &str,
) -> Result<MutationResult, ComputeError> {
    let sheet_uuid = sheet_id.to_uuid_string();
    mirror.remove_pivot_table_def(pivot_name, &sheet_uuid);
    Ok(MutationResult::empty())
}
