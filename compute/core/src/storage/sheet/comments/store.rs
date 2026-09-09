use cell_types::{CellId, SheetId};
use domain_types::domain::comment::Comment;

use crate::storage::WorkbookStorage;

/// Valid comment anchors use durable cell identities. An unresolvable imported
/// reference remains opaque package metadata so malformed input is not discarded.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum CommentAnchor {
    Cell(CellId),
    Unresolved(String),
}

pub(crate) type StoredComment = Comment<CommentAnchor>;

impl CommentAnchor {
    pub(crate) fn from_wire(value: String) -> Self {
        CellId::from_uuid_str(&value)
            .map(Self::Cell)
            .unwrap_or(Self::Unresolved(value))
    }
    pub(crate) fn wire(self) -> String {
        match self {
            Self::Cell(id) => compute_document::hex::id_to_hex(id.as_u128()).to_string(),
            Self::Unresolved(source) => source,
        }
    }
    pub(crate) fn cell(&self) -> Option<CellId> {
        match self {
            Self::Cell(id) => Some(*id),
            Self::Unresolved(_) => None,
        }
    }
    pub(super) fn matches(&self, value: &str) -> bool {
        match self {
            Self::Cell(id) => CellId::from_uuid_str(value).ok() == Some(*id),
            Self::Unresolved(source) => source == value,
        }
    }
}

pub(super) fn comments<'a>(storage: &'a WorkbookStorage, sheet: &SheetId) -> &'a [StoredComment] {
    storage
        .sheet_metadata
        .get(sheet)
        .map(|meta| meta.comments.as_slice())
        .unwrap_or_default()
}

pub(super) fn comment_mut<'a>(
    storage: &'a mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
) -> Option<&'a mut StoredComment> {
    crate::storage::engine::history::metadata::capture_sheet_vector_entry!(storage, *sheet, comments, id, comment => comment.id);

    storage
        .sheet_metadata
        .get_mut(sheet)?
        .comments
        .iter_mut()
        .find(|comment| comment.id == id)
}

pub(super) fn wire(comment: &StoredComment) -> Comment {
    comment.clone().map_cell_ref(CommentAnchor::wire)
}

pub(super) fn sort_comments(comments: &mut [Comment]) {
    comments.sort_by(|a, b| {
        a.created_at
            .unwrap_or(0)
            .cmp(&b.created_at.unwrap_or(0))
            .then_with(|| a.parent_id.is_some().cmp(&b.parent_id.is_some()))
            .then_with(|| a.id.cmp(&b.id))
    });
}

pub(crate) fn remap_for_copy(
    metadata: &mut crate::storage::sheet::SheetMetadata,
    cells: &rustc_hash::FxHashMap<CellId, CellId>,
    allocator: &cell_types::IdAllocator,
) {
    let ids: std::collections::HashMap<_, _> = metadata
        .comments
        .iter()
        .map(|comment| {
            (
                comment.id.clone(),
                compute_document::hex::id_to_hex(allocator.next_u128()).to_string(),
            )
        })
        .collect();
    metadata.comments.retain_mut(|comment| {
        if let CommentAnchor::Cell(id) = &mut comment.cell_ref {
            let Some(new) = cells.get(id) else {
                return false;
            };
            *id = *new;
        }
        comment.id = ids[&comment.id].clone();
        for link in [&mut comment.thread_id, &mut comment.parent_id]
            .into_iter()
            .flatten()
        {
            if let Some(new) = ids.get(link) {
                *link = new.clone();
            }
        }
        true
    });
    metadata.cell_annotations = std::mem::take(&mut metadata.cell_annotations)
        .into_iter()
        .filter_map(|(old, record)| {
            let new = cells.get(&old)?;
            let mut record = record.map_anchor(|_| *new);
            record.id = compute_document::hex::id_to_hex(allocator.next_u128()).to_string();
            record.status = crate::engine_types::AnnotationStatus::Unchecked;
            record.checked_at = None;
            record.stale_reason = None;
            Some((*new, record))
        })
        .collect();
}

/// Move identity-owned comments and annotations after a range relocation.
pub(crate) fn relocate_anchors(
    storage: &mut WorkbookStorage,
    mirror: &crate::mirror::CellMirror,
    source: &SheetId,
    target: &SheetId,
) {
    if source == target {
        return;
    }
    if storage.history.is_active() {
        if let Some(meta) = storage.sheet_metadata.get(source) {
            for comment in &meta.comments {
                if comment
                    .cell_ref
                    .cell()
                    .and_then(|id| mirror.sheet_for_cell(&id))
                    == Some(*target)
                {
                    crate::storage::engine::history::metadata::capture_sheet_vector_entry!(storage,*source,comments,comment.id,value=>value.id);
                    crate::storage::engine::history::metadata::capture_sheet_vector_entry!(storage,*target,comments,comment.id,value=>value.id);
                }
            }
            for &id in meta
                .cell_annotations
                .keys()
                .filter(|id| mirror.sheet_for_cell(id) == Some(*target))
            {
                crate::storage::engine::history::metadata::capture_cell_annotation(
                    storage, *source, id,
                );
                crate::storage::engine::history::metadata::capture_cell_annotation(
                    storage, *target, id,
                );
            }
        }
    }
    let mut moved_comments = Vec::new();
    let mut moved_annotations = Vec::new();
    if let Some(metadata) = storage.sheet_metadata.get_mut(source) {
        let old = std::mem::take(&mut metadata.comments);
        for comment in old {
            if comment
                .cell_ref
                .cell()
                .and_then(|id| mirror.sheet_for_cell(&id))
                == Some(*target)
            {
                moved_comments.push(comment);
            } else {
                metadata.comments.push(comment);
            }
        }
        metadata.cell_annotations.retain(|id, record| {
            if mirror.sheet_for_cell(id) == Some(*target) {
                moved_annotations.push((*id, record.clone()));
                false
            } else {
                true
            }
        });
    }
    if let Some(metadata) = storage.sheet_metadata.get_mut(target) {
        metadata.comments.extend(moved_comments);
        metadata.cell_annotations.extend(moved_annotations);
    }
}
