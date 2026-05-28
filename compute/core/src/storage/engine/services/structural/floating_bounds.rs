use cell_types::SheetId;

use crate::snapshot::{FloatingObjectChange, FloatingObjectChangeKind};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::floating_objects;
use crate::storage::sheet::floating_objects::compute_object_pixel_bounds;

// -------------------------------------------------------------------
// Floating Object Bounds Invalidation
// -------------------------------------------------------------------

/// Recompute pixel bounds for all cell-anchored floating objects on a sheet.
///
/// When rows/columns are resized, inserted, deleted, hidden, or unhidden,
/// the LayoutIndex changes but cell-anchored objects' anchor configs stay
/// the same. Their absolute pixel bounds shift silently. This function emits
/// `FloatingObjectChange` entries with the recomputed bounds so that the TS
/// layer can update the render cache without a full re-read.
pub(in crate::storage::engine) fn recompute_floating_object_bounds(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<FloatingObjectChange> {
    let mut changes = Vec::new();
    let objects = floating_objects::get_all_floating_objects(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    );
    let layout = stores.layout_indexes.get(sheet_id);

    for (object_id, obj_json) in &objects {
        let anchor_mode = obj_json
            .get("anchorMode")
            .and_then(|v| v.as_str())
            .unwrap_or("oneCell");
        if anchor_mode == "absolute" {
            continue;
        }
        if let Some(bounds) =
            compute_object_pixel_bounds(stores.grid_indexes.get(sheet_id), layout, obj_json)
        {
            changes.push(FloatingObjectChange {
                sheet_id: sheet_id.to_uuid_string(),
                object_id: object_id.clone(),
                kind: FloatingObjectChangeKind::Updated {
                    changed_fields: vec!["bounds".into()],
                },
                object_type: None,
                data: None,
                bounds: Some(bounds),
            });
        }
    }

    changes
}
