use cell_types::SheetId;
use domain_types::domain::comment::{Comment, RichTextRun};

use crate::storage::WorkbookStorage;

pub(super) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(super) fn storage_with_sheet() -> (WorkbookStorage, SheetId) {
    let mut storage = WorkbookStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");
    (storage, sheet_id)
}

pub(super) fn simple_runs(text: &str) -> Vec<RichTextRun> {
    vec![RichTextRun {
        text: text.to_string(),
        ..Default::default()
    }]
}

pub(super) fn native_grid_with_cell(
    sheet_id: SheetId,
    key: &str,
) -> compute_document::identity::GridIndex {
    let mut grid = compute_document::identity::GridIndex::new(
        sheet_id,
        100,
        26,
        std::sync::Arc::new(cell_types::IdAllocator::new()),
    );
    let id = cell_types::CellId::from_raw(compute_document::hex::hex_to_id(key).unwrap());
    grid.register_cell(id, 0, 0);
    grid
}

pub(super) fn insert_comment(storage: &mut WorkbookStorage, sheet_id: &SheetId, comment: &Comment) {
    let comments = &mut storage.sheet_metadata.get_mut(sheet_id).unwrap().comments;
    let native = comment
        .clone()
        .map_cell_ref(crate::storage::sheet::comments::CommentAnchor::from_wire);
    if let Some(existing) = comments
        .iter_mut()
        .find(|existing| existing.id == comment.id)
    {
        *existing = native;
    } else {
        comments.push(native);
    }
}
