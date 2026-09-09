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
/// the PixelLayout changes but cell-anchored objects' anchor configs stay
/// the same. Their absolute pixel bounds shift silently. This function emits
/// `FloatingObjectChange` entries with the recomputed bounds so that the TS
/// layer can update the render cache without a full re-read.
pub(in crate::storage::engine) fn recompute_floating_object_bounds(
    stores: &EngineStores,
    cell_store: &crate::cells::CellStore,
    sheet_id: &SheetId,
) -> Vec<FloatingObjectChange> {
    let mut changes = Vec::new();
    let objects = floating_objects::get_all_floating_objects(&stores.storage, sheet_id);
    if objects.is_empty() {
        return changes;
    }
    let layout = stores.pixel_layout(sheet_id);

    for (object_id, obj_json) in &objects {
        let anchor_mode = obj_json
            .get("anchor")
            .unwrap_or(obj_json)
            .get("anchorMode")
            .and_then(|v| v.as_str())
            .unwrap_or("oneCell");
        if anchor_mode == "absolute" {
            continue;
        }
        if let Some(bounds) =
            compute_object_pixel_bounds(cell_store.get_sheet(sheet_id), layout.as_deref(), obj_json)
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
