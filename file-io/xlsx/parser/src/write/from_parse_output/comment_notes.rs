pub(super) fn register_note_vml_image_relationships(
    graph: &mut crate::write::package_graph::PackageGraphBuilder,
    sheet: &domain_types::SheetData,
    vml_path: &str,
) {
    let mut registered_note_images = std::collections::BTreeSet::new();
    for image in sheet
        .comments
        .iter()
        .flat_map(|comment| &comment.note_images)
    {
        if note_image_is_external(image) {
            if image.original_target.is_empty()
                || !registered_note_images
                    .insert((image.relationship_id.clone(), image.original_target.clone()))
            {
                continue;
            }
            graph.add_relationship(crate::write::package_graph::PackageRelationship {
                owner: crate::write::package_graph::PackageOwner::Part {
                    path: domain_types::normalize_package_path(vml_path),
                },
                relationship_type: crate::infra::opc::REL_IMAGE.to_string(),
                target: crate::write::package_graph::PackageRelationshipTarget::External {
                    target: image.original_target.clone(),
                    target_mode: image.target_mode.clone(),
                },
                identity_hint: Some(crate::write::package_graph::RelationshipIdentityHint::new(
                    &image.relationship_id,
                )),
            });
            continue;
        }
        if image.package_path.is_empty() || image.bytes.is_empty() {
            continue;
        }
        if !registered_note_images
            .insert((image.relationship_id.clone(), image.package_path.clone()))
        {
            continue;
        }
        crate::write::package_graph::register_part_image_relationship(
            graph,
            vml_path,
            &image.package_path,
            &image.relationship_id,
        );
    }
}

pub(super) fn note_image_is_external(
    image: &domain_types::domain::comment::CommentNoteImage,
) -> bool {
    image
        .target_mode
        .as_deref()
        .is_some_and(|mode| mode.eq_ignore_ascii_case("External"))
}
