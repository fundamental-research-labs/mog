//! Connection-wide native data-binding operations.
use crate::engine_types::bindings::SheetDataBinding;
use crate::storage::WorkbookStorage;
pub fn get_bindings_for_connection(
    storage: &WorkbookStorage,
    connection_id: &str,
) -> Vec<SheetDataBinding> {
    let mut bindings: Vec<_> = storage
        .sheet_metadata
        .values()
        .flat_map(|sheet| sheet.data_bindings.values())
        .filter(|binding| binding.connection_id == connection_id)
        .cloned()
        .collect();
    bindings.sort_by(|a, b| a.sheet_id.cmp(&b.sheet_id).then(a.id.cmp(&b.id)));
    bindings
}
pub fn remove_bindings_for_connection(storage: &mut WorkbookStorage, connection_id: &str) -> u32 {
    if storage.history.is_active() {
        for (sid, sheet) in &storage.sheet_metadata {
            for (id, binding) in &sheet.data_bindings {
                if binding.connection_id == connection_id {
                    crate::storage::engine::history::metadata::capture_sheet_entry!(
                        storage,
                        *sid,
                        data_bindings,
                        id
                    );
                }
            }
        }
    }

    storage
        .sheet_metadata
        .values_mut()
        .map(|sheet| {
            let old = sheet.data_bindings.len();
            sheet
                .data_bindings
                .retain(|_, binding| binding.connection_id != connection_id);
            (old - sheet.data_bindings.len()) as u32
        })
        .sum()
}
