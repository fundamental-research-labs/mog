use domain_types::RoundTripContext;

pub(super) fn keep_round_trip_binary_blob(
    _ctx: &RoundTripContext,
    pivot_data: &crate::write::pivot_writer::PivotWriteData,
    path: &str,
) -> bool {
    if !super::pivot_package::keep_binary_blob(pivot_data, path) {
        return false;
    }
    if pivot_data.has_typed_package_contract
        && pivot_data
            .preserved_part_paths
            .contains(path.trim_start_matches('/'))
    {
        return false;
    }
    false
}

pub(super) fn relationship_id_hint(
    relationships: &[domain_types::OpcRelationship],
    relationship_type: &str,
    target: &str,
    target_mode: Option<&str>,
) -> Option<String> {
    relationships
        .iter()
        .find(|rel| {
            rel.rel_type == relationship_type
                && rel.target == target
                && rel.target_mode.as_deref() == target_mode
        })
        .map(|rel| rel.id.clone())
}
