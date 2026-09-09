//! Typed runtime-to-OOXML filter metadata bindings.
use super::FilterMetadataBinding;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;

pub fn upsert_filter_metadata_binding(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    binding: &FilterMetadataBinding,
) {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet_id,
        filter_bindings,
        binding.filter_id
    );

    if let Some(metadata) = storage.sheet_metadata.get_mut(sheet_id) {
        metadata
            .filter_bindings
            .insert(binding.filter_id.clone(), binding.clone());
    }
}
pub fn get_filter_metadata_binding(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<FilterMetadataBinding> {
    storage
        .sheet_metadata
        .get(sheet_id)?
        .filter_bindings
        .get(filter_id)
        .cloned()
}
pub fn get_filter_metadata_bindings_in_sheet(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
) -> Vec<FilterMetadataBinding> {
    storage
        .sheet_metadata
        .get(sheet_id)
        .map(|m| m.filter_bindings.values().cloned().collect())
        .unwrap_or_default()
}
pub fn delete_filter_metadata_binding(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    filter_id: &str,
) -> bool {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet_id,
        filter_bindings,
        filter_id
    );

    storage
        .sheet_metadata
        .get_mut(sheet_id)
        .is_some_and(|m| m.filter_bindings.remove(filter_id).is_some())
}
pub fn delete_stale_filter_metadata_bindings_for_source_key(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    binding: &FilterMetadataBinding,
) -> usize {
    if storage.history.is_active() {
        if let Some(meta) = storage.sheet_metadata.get(sheet_id) {
            for (id, value) in &meta.filter_bindings {
                if value.filter_id != binding.filter_id && value.source_key == binding.source_key {
                    crate::storage::engine::history::metadata::capture_sheet_entry!(
                        storage,
                        *sheet_id,
                        filter_bindings,
                        id
                    );
                }
            }
        }
    }

    let Some(metadata) = storage.sheet_metadata.get_mut(sheet_id) else {
        return 0;
    };
    let original_len = metadata.filter_bindings.len();
    metadata.filter_bindings.retain(|_, existing| {
        existing.filter_id == binding.filter_id || existing.source_key != binding.source_key
    });
    original_len - metadata.filter_bindings.len()
}
pub fn clear_filter_metadata_bindings(storage: &mut WorkbookStorage, sheet_id: &SheetId) {
    if storage.history.is_active() {
        if let Some(meta) = storage.sheet_metadata.get(sheet_id) {
            for (id, _value) in &meta.filter_bindings {
                if true {
                    crate::storage::engine::history::metadata::capture_sheet_entry!(
                        storage,
                        *sheet_id,
                        filter_bindings,
                        id
                    );
                }
            }
        }
    }

    if let Some(m) = storage.sheet_metadata.get_mut(sheet_id) {
        m.filter_bindings.clear();
    }
}
