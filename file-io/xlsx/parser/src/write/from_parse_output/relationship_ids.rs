use crate::write::relationships::RelationshipManager;

pub(super) fn reserve_preferred_or_allocate(
    rels: &mut RelationshipManager,
    preferred_id: &str,
    rel_type: &str,
    target: &str,
) -> String {
    if let Some(existing) = rels.get_by_id(preferred_id) {
        if existing.rel_type == rel_type && existing.target == target {
            return preferred_id.to_string();
        }
        return rels
            .relationships()
            .iter()
            .find(|rel| rel.rel_type == rel_type && rel.target == target)
            .map(|rel| rel.id.clone())
            .unwrap_or_else(|| rels.add(rel_type, target));
    }

    rels.add_with_id(preferred_id, rel_type, target);
    preferred_id.to_string()
}

#[cfg(test)]
mod tests {
    use crate::infra::opc::REL_IMAGE;
    use crate::write::REL_CHART;

    use super::*;

    #[test]
    fn preserves_free_preferred_id() {
        let mut rels = RelationshipManager::new();

        let id =
            reserve_preferred_or_allocate(&mut rels, "rId2", REL_CHART, "../charts/chart2.xml");

        assert_eq!(id, "rId2");
        assert_eq!(rels.get_by_id("rId2").unwrap().rel_type, REL_CHART);
        assert_eq!(
            rels.get_by_id("rId2").unwrap().target,
            "../charts/chart2.xml"
        );
    }

    #[test]
    fn reuses_existing_matching_preferred_id() {
        let mut rels = RelationshipManager::new();
        rels.add_with_id("rId2", REL_CHART, "../charts/chart2.xml");

        let id =
            reserve_preferred_or_allocate(&mut rels, "rId2", REL_CHART, "../charts/chart2.xml");

        assert_eq!(id, "rId2");
        assert_eq!(rels.relationships().len(), 1);
    }

    #[test]
    fn allocates_when_preferred_id_is_occupied_by_another_relationship() {
        let mut rels = RelationshipManager::new();
        rels.add_with_id("rId2", REL_IMAGE, "../media/image2.png");

        let id =
            reserve_preferred_or_allocate(&mut rels, "rId2", REL_CHART, "../charts/chart2.xml");

        assert_ne!(id, "rId2");
        assert_eq!(rels.get_by_id("rId2").unwrap().rel_type, REL_IMAGE);
        assert_eq!(rels.get_by_id(&id).unwrap().rel_type, REL_CHART);
        assert_eq!(rels.get_by_id(&id).unwrap().target, "../charts/chart2.xml");
    }
}
