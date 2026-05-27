pub(super) fn now_millis() -> i64 {
    crate::storage::infra::yrs_helpers::now_millis() as i64
}

/// Generate a unique floating object ID: `fobj-{timestamp_millis}-{counter_hex}`.
///
/// Uses the `fobj-` prefix to match the canonical key convention expected by
/// the export pipeline (`export_floating_objects_for_sheet` filters on `fobj-*`).
/// Uniqueness is guaranteed by the monotonic `IdAllocator` counter.
pub(super) fn generate_object_id(id_alloc: &cell_types::IdAllocator) -> String {
    let ts = now_millis();
    let n = id_alloc.next_u128();
    format!("fobj-{}-{:x}", ts, n)
}

/// Generate a unique floating object group ID: `grp-{timestamp_millis}-{counter_hex}`.
pub(super) fn generate_group_id(id_alloc: &cell_types::IdAllocator) -> String {
    let ts = now_millis();
    let n = id_alloc.next_u128();
    format!("grp-{}-{:x}", ts, n)
}
