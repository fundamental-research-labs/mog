use super::*;
use domain_types::PackageFidelityMetadata;

fn graph_options(package_fidelity: Option<PackageFidelityMetadata>) -> ModeledWorkbookGraphOptions {
    ModeledWorkbookGraphOptions {
        sheet_count: 1,
        has_theme: false,
        theme_part_path: None,
        theme_relationship_id_hint: None,
        theme_relationship_type: None,
        has_shared_strings: false,
        has_core_props: true,
        has_app_props: false,
        has_custom_props: false,
        has_metadata: false,
        has_persons: false,
        has_doc_metadata_label_info: false,
        package_fidelity,
    }
}

fn relationship_hint(
    id: &str,
    relationship_type: &str,
    target: &str,
) -> domain_types::PackageRelationshipHint {
    domain_types::PackageRelationshipHint {
        id: id.to_string(),
        relationship_type: relationship_type.to_string(),
        target: target.to_string(),
        target_mode: None,
    }
}

#[test]
fn imported_root_order_and_ids_are_reused_only_for_matching_current_set() {
    let metadata = PackageFidelityMetadata {
        root_relationships: vec![
            relationship_hint("rId5", REL_CORE_PROPERTIES, "docProps/core.xml"),
            relationship_hint("rId9", REL_OFFICE_DOCUMENT, "xl/workbook.xml"),
        ],
        ..Default::default()
    };

    let graph = build_modeled_workbook_graph(graph_options(Some(metadata))).unwrap();
    let root_rels: Vec<_> = graph
        .relationships
        .iter()
        .filter(|rel| rel.owner_rels_path == "_rels/.rels")
        .collect();

    assert_eq!(root_rels[0].id, "rId5");
    assert_eq!(root_rels[0].relationship_type, REL_CORE_PROPERTIES);
    assert_eq!(root_rels[1].id, "rId9");
    assert_eq!(root_rels[1].relationship_type, REL_OFFICE_DOCUMENT);
}

#[test]
fn imported_order_is_ignored_when_current_owner_set_changes() {
    let metadata = PackageFidelityMetadata {
        root_relationships: vec![relationship_hint(
            "rId9",
            REL_OFFICE_DOCUMENT,
            "xl/workbook.xml",
        )],
        ..Default::default()
    };

    let graph = build_modeled_workbook_graph(graph_options(Some(metadata))).unwrap();
    let root_rels: Vec<_> = graph
        .relationships
        .iter()
        .filter(|rel| rel.owner_rels_path == "_rels/.rels")
        .collect();

    assert_eq!(root_rels[0].relationship_type, REL_OFFICE_DOCUMENT);
    assert_eq!(root_rels[1].relationship_type, REL_CORE_PROPERTIES);
}

#[test]
fn imported_default_mime_preference_updates_existing_current_default() {
    let metadata = PackageFidelityMetadata {
        content_type_defaults: vec![domain_types::PackageContentTypeDefaultHint {
            extension: "jpg".to_string(),
            content_type: "image/jpg".to_string(),
        }],
        ..Default::default()
    };
    let mut builder = PackageGraphBuilder::with_package_fidelity(Some(metadata));
    register_media_part(&mut builder, "xl/media/image1.jpg").unwrap();
    let graph = builder.resolve().unwrap();
    let mut content_types = ContentTypesManager::new();
    content_types.add_default("jpg", CT_JPEG);
    graph.add_content_types_to(&mut content_types);
    graph.apply_content_type_preferences_to(&mut content_types);

    let jpg = content_types
        .defaults()
        .iter()
        .find(|default| default.extension == "jpg")
        .unwrap();
    assert_eq!(jpg.content_type, "image/jpg");
}

#[test]
fn inert_custom_xml_cluster_is_registered_with_graph_generated_sidecar() {
    let metadata = PackageFidelityMetadata {
        root_relationships: vec![relationship_hint(
            "rId7",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml",
            "customXml/item1.xml",
        )],
        opaque_parts: vec![
            domain_types::OpaquePackagePartHint {
                path: "customXml/item1.xml".to_string(),
                bytes: b"<root/>".to_vec(),
                content_type: Some("application/xml".to_string()),
                relationships: vec![relationship_hint(
                    "rId1",
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps",
                    "itemProps1.xml",
                )],
            },
            domain_types::OpaquePackagePartHint {
                path: "customXml/itemProps1.xml".to_string(),
                bytes: b"<props/>".to_vec(),
                content_type: Some("application/xml".to_string()),
                relationships: Vec::new(),
            },
        ],
        ..Default::default()
    };

    let mut builder = build_modeled_workbook_graph_builder(graph_options(Some(metadata))).unwrap();
    builder.register_imported_opaque_parts().unwrap();
    let graph = builder.resolve().unwrap();

    assert!(graph.contains_part("customXml/item1.xml"));
    assert!(graph.contains_part("customXml/itemProps1.xml"));
    assert!(graph.relationships.iter().any(|rel| {
        rel.owner_rels_path == "_rels/.rels"
            && rel.id == "rId7"
            && rel.target == "/customXml/item1.xml"
    }));
    assert!(graph.relationships.iter().any(|rel| {
        rel.owner_rels_path == "customXml/_rels/item1.xml.rels"
            && rel.id == "rId1"
            && rel.target == "itemProps1.xml"
    }));
}

#[test]
fn modeled_paths_are_not_replayed_as_opaque_parts() {
    let metadata = PackageFidelityMetadata {
        opaque_parts: vec![domain_types::OpaquePackagePartHint {
            path: "xl/comments1.xml".to_string(),
            bytes: b"<comments/>".to_vec(),
            content_type: Some(CT_COMMENTS.to_string()),
            relationships: Vec::new(),
        }],
        ..Default::default()
    };

    let mut builder = build_modeled_workbook_graph_builder(graph_options(Some(metadata))).unwrap();
    builder.register_imported_opaque_parts().unwrap();
    let graph = builder.resolve().unwrap();

    assert!(!graph.contains_part("xl/comments1.xml"));
}
