use crate::storage::engine::history::metadata::capture_sheet_entry;
pub(super) fn empty_patches() -> Vec<u8> {
    compute_wire::mutation::serialize_multi_viewport_patches(&[])
}

pub(super) fn with_empty_patches<T>(result: T) -> (Vec<u8>, T) {
    (empty_patches(), result)
}

/// Register only the sparse identities needed by changed drawing anchors.
pub(super) fn sync_floating_anchors(
    stores: &mut crate::storage::engine::stores::EngineStores,
    mirror: &mut crate::mirror::CellMirror,
    sheet_id: &cell_types::SheetId,
    result: &mut crate::snapshot::MutationResult,
    reanchor: bool,
) -> Result<(), value_types::ComputeError> {
    use crate::storage::sheet::floating_objects;
    use cell_types::CellId;
    use compute_document::hex::{hex_to_id, id_to_hex};
    for change in &mut result.floating_object_changes {
        let Some(object) = stores
            .storage
            .sheet_metadata
            .get(sheet_id)
            .and_then(|metadata| metadata.floating_objects.objects.get(&change.object_id))
        else {
            continue;
        };
        let common = &object.common;
        if common.anchor.anchor_mode == domain_types::domain::floating_object::AnchorMode::Absolute
        {
            continue;
        }
        let resolve = |id: &Option<String>, fallback| {
            if reanchor {
                return fallback;
            }
            id.as_ref()
                .and_then(|id| {
                    hex_to_id(id)
                        .map(CellId::from_raw)
                        .or_else(|| CellId::from_uuid_str(id).ok())
                })
                .and_then(|id| stores.grid_indexes.get(sheet_id)?.cell_position(&id))
                .unwrap_or(fallback)
        };
        let start = resolve(
            &common.anchor_cell_id,
            (common.anchor.anchor_row, common.anchor.anchor_col),
        );
        let end = common
            .anchor
            .end_row
            .zip(common.anchor.end_col)
            .map(|position| resolve(&common.to_anchor_cell_id, position));
        let start_id = crate::storage::engine::services::cell_editing::ensure_cell_id_mirrored(
            stores, mirror, sheet_id, start.0, start.1,
        )
        .ok_or_else(|| value_types::ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;
        let end_id = end.and_then(|end| {
            crate::storage::engine::services::cell_editing::ensure_cell_id_mirrored(
                stores, mirror, sheet_id, end.0, end.1,
            )
        });
        capture_sheet_entry!(
            stores.storage,
            *sheet_id,
            floating_objects.objects,
            change.object_id
        );
        let object = stores
            .storage
            .sheet_metadata
            .get_mut(sheet_id)
            .unwrap()
            .floating_objects
            .objects
            .get_mut(&change.object_id)
            .unwrap();
        object.common.anchor_cell_id = Some(id_to_hex(start_id.as_u128()).to_string());
        object.common.anchor.anchor_row = start.0;
        object.common.anchor.anchor_col = start.1;
        object.common.to_anchor_cell_id = end_id.map(|id| id_to_hex(id.as_u128()).to_string());
        if let Some(end) = end {
            object.common.anchor.end_row = Some(end.0);
            object.common.anchor.end_col = Some(end.1);
        }
        let json = serde_json::to_value(object.as_ref()).ok();
        change.bounds = json.as_ref().and_then(|json| {
            floating_objects::compute_object_pixel_bounds(
                stores.grid_indexes.get(sheet_id),
                stores.layout_indexes.get(sheet_id),
                json,
            )
        });
        if change.data.is_some() {
            change.data = Some(object.as_ref().clone());
        }
    }
    Ok(())
}

pub(super) fn changes_anchor(update: &serde_json::Value) -> bool {
    [
        "anchor",
        "anchorRow",
        "anchorCol",
        "endRow",
        "endCol",
        "anchorCellId",
        "toAnchorCellId",
    ]
    .iter()
    .any(|key| update.get(key).is_some())
}
