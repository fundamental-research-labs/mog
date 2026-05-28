//! Sheet data binding ID generation.

/// Generate a unique sheet data binding ID.
pub(super) fn generate_binding_id(id_alloc: &cell_types::IdAllocator) -> String {
    format!(
        "sdb-{}",
        cell_types::CellId::from_raw(id_alloc.next_u128()).to_uuid_string()
    )
}
