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
