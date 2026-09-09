use crate::storage::WorkbookStorage;
use cell_types::SheetId;

/// Remove comments whose stable cell anchors have been deleted.
pub fn validate_and_clean_comments(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    grid: &compute_document::identity::GridIndex,
) -> usize {
    if storage.history.is_active() {
        if let Some(meta) = storage.sheet_metadata.get(sheet) {
            for comment in &meta.comments {
                if !comment
                    .cell_ref
                    .cell()
                    .is_some_and(|id| grid.cell_position(&id).is_some())
                {
                    crate::storage::engine::history::metadata::capture_sheet_vector_entry!(storage,*sheet,comments,comment.id,value=>value.id);
                }
            }
        }
    }
    let Some(metadata) = storage.sheet_metadata.get_mut(sheet) else {
        return 0;
    };
    let before = metadata.comments.len();
    metadata.comments.retain(|comment| {
        comment
            .cell_ref
            .cell()
            .is_some_and(|id| grid.cell_position(&id).is_some())
    });
    before - metadata.comments.len()
}
