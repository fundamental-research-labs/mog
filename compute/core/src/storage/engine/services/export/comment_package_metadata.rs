use crate::storage::engine::stores::EngineStores;
use cell_types::SheetId;
use domain_types::{SheetCommentPackageInfo, SheetDrawingPackageInfo};

pub(in crate::storage::engine) fn export_comment_package_metadata(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> (
    Vec<String>,
    Option<SheetCommentPackageInfo>,
    Option<SheetDrawingPackageInfo>,
) {
    let Some(metadata) = stores.storage.sheet_metadata.get(sheet_id) else {
        return Default::default();
    };
    (
        metadata.legacy_comment_authors.clone(),
        metadata.comment_package.clone(),
        metadata.drawing_package.clone(),
    )
}
