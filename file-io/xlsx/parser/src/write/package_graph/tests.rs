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

fn external_relationship_hint(
    id: &str,
    relationship_type: &str,
    target: &str,
) -> domain_types::PackageRelationshipHint {
    domain_types::PackageRelationshipHint {
        id: id.to_string(),
        relationship_type: relationship_type.to_string(),
        target: target.to_string(),
        target_mode: Some("External".to_string()),
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
    assert_eq!(root_rels[0].target, "docProps/core.xml");
    assert_eq!(root_rels[1].id, "rId9");
    assert_eq!(root_rels[1].relationship_type, REL_OFFICE_DOCUMENT);
    assert_eq!(root_rels[1].target, "xl/workbook.xml");
}

#[test]
fn imported_order_is_kept_for_surviving_root_relationships() {
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
fn imported_workbook_relationship_ids_survive_dropped_siblings() {
    let metadata = PackageFidelityMetadata {
        workbook_relationships: vec![
            relationship_hint("rId1", REL_WORKSHEET, "worksheets/sheet2.xml"),
            relationship_hint("rId2", REL_PERSON, "persons/person.xml"),
            relationship_hint("rId8", REL_WORKSHEET, "worksheets/sheet1.xml"),
            relationship_hint("rId9", REL_STYLES, "styles.xml"),
            relationship_hint("rId10", REL_SHARED_STRINGS, "sharedStrings.xml"),
            relationship_hint("rId11", REL_THEME, "theme/theme1.xml"),
        ],
        ..Default::default()
    };
    let mut options = graph_options(Some(metadata));
    options.sheet_count = 2;
    options.has_shared_strings = true;
    options.has_theme = true;

    let graph = build_modeled_workbook_graph(options).unwrap();

    assert_eq!(
        graph.relationship_id(
            &PackageOwner::Workbook,
            REL_WORKSHEET,
            "worksheets/sheet2.xml"
        ),
        Some("rId1")
    );
    assert_eq!(
        graph.relationship_id(
            &PackageOwner::Workbook,
            REL_WORKSHEET,
            "worksheets/sheet1.xml"
        ),
        Some("rId8")
    );
    assert_eq!(
        graph.relationship_id(&PackageOwner::Workbook, REL_STYLES, "styles.xml"),
        Some("rId9")
    );
    assert_eq!(
        graph.relationship_id(
            &PackageOwner::Workbook,
            REL_SHARED_STRINGS,
            "sharedStrings.xml"
        ),
        Some("rId10")
    );
    assert_eq!(
        graph.relationship_id(&PackageOwner::Workbook, REL_THEME, "theme/theme1.xml"),
        Some("rId11")
    );
    assert!(
        !graph
            .relationships
            .iter()
            .any(|rel| { rel.owner_rels_path == "xl/_rels/workbook.xml.rels" && rel.id == "rId2" })
    );
}

#[test]
fn duplicate_imported_relationship_matches_use_occurrence_order() {
    let metadata = PackageFidelityMetadata {
        root_relationships: vec![
            relationship_hint("rId8", REL_CORE_PROPERTIES, "docProps/core.xml"),
            relationship_hint("rId9", REL_CORE_PROPERTIES, "docProps/core.xml"),
        ],
        ..Default::default()
    };
    let mut builder = PackageGraphBuilder::with_package_fidelity(Some(metadata));
    builder
        .register_part(modeled_part("docProps/core.xml", CT_CORE_PROPERTIES))
        .unwrap();
    let first = builder.add_relationship(PackageRelationship {
        owner: PackageOwner::Root,
        relationship_type: REL_CORE_PROPERTIES.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: "docProps/core.xml".to_string(),
        },
        identity_hint: None,
    });
    let second = builder.add_relationship(PackageRelationship {
        owner: PackageOwner::Root,
        relationship_type: REL_CORE_PROPERTIES.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: "docProps/core.xml".to_string(),
        },
        identity_hint: None,
    });

    let graph = builder.resolve().unwrap();

    assert_eq!(graph.relationship_id_for_key(first), Some("rId8"));
    assert_eq!(graph.relationship_id_for_key(second), Some("rId9"));
}

#[test]
fn invalid_imported_relationship_id_is_reallocated() {
    let metadata = PackageFidelityMetadata {
        root_relationships: vec![relationship_hint(
            "",
            REL_CORE_PROPERTIES,
            "docProps/core.xml",
        )],
        ..Default::default()
    };

    let graph = build_modeled_workbook_graph(graph_options(Some(metadata))).unwrap();

    assert!(graph.relationships.iter().any(|rel| {
        rel.owner_rels_path == "_rels/.rels"
            && rel.relationship_type == REL_CORE_PROPERTIES
            && rel.id == "rId1"
    }));
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
fn media_jfif_part_registers_content_type_from_current_bytes() {
    let mut builder = PackageGraphBuilder::new();
    register_media_part_with_bytes(&mut builder, "xl/media/image2.jfif", b"\xff\xd8\xff\xe0")
        .unwrap();
    let graph = builder.resolve().unwrap();

    let mut content_types = ContentTypesManager::new();
    graph.add_content_types_to(&mut content_types);

    let jfif = content_types
        .defaults()
        .iter()
        .find(|default| default.extension == "jfif")
        .expect("current JFIF media parts must emit a content type default");
    assert_eq!(jfif.content_type, CT_JPEG);
}

#[test]
fn imported_default_without_current_part_is_reported_as_unused_drop() {
    let metadata = PackageFidelityMetadata {
        content_type_defaults: vec![domain_types::PackageContentTypeDefaultHint {
            extension: "png".to_string(),
            content_type: CT_PNG.to_string(),
        }],
        ..Default::default()
    };
    let graph = build_modeled_workbook_graph(graph_options(Some(metadata))).unwrap();

    let dispositions = graph.content_type_manifest_dispositions();

    assert!(dispositions.iter().any(|disposition| {
        disposition.row_kind == domain_types::PackageContentTypeManifestRowKind::Default
            && disposition.extension.as_deref() == Some("png")
            && disposition.disposition
                == domain_types::PackageContentTypeManifestDispositionKind::UnusedDefaultDropped
    }));
}

#[test]
fn graph_content_types_do_not_seed_unrelated_binary_or_image_defaults() {
    let graph = build_modeled_workbook_graph(graph_options(None)).unwrap();
    let mut content_types = ContentTypesManager::with_xlsx_defaults();

    graph.add_content_types_to(&mut content_types);

    for extension in [
        "bin", "png", "jpg", "jpeg", "gif", "bmp", "svg", "emf", "wmf", "tiff", "vml",
    ] {
        assert!(
            !content_types.has_default(extension),
            "unexpected default for {extension}"
        );
    }
}

#[test]
fn imported_binary_default_cannot_retype_current_printer_settings_part() {
    let metadata = PackageFidelityMetadata {
        content_type_defaults: vec![domain_types::PackageContentTypeDefaultHint {
            extension: "bin".to_string(),
            content_type: crate::write::CT_VBA.to_string(),
        }],
        ..Default::default()
    };
    let mut builder = PackageGraphBuilder::with_package_fidelity(Some(metadata));
    builder
        .register_part(PackagePart {
            path: "xl/printerSettings/printerSettings1.bin".to_string(),
            content_type: None,
            default_extension: Some((
                "bin".to_string(),
                crate::write::CT_PRINTER_SETTINGS.to_string(),
            )),
            kind: PackagePartKind::Modeled,
            semantic_kind: Some(domain_types::XlsxPackagePartKind::PrinterSettings),
            bytes: None,
        })
        .unwrap();
    let graph = builder.resolve().unwrap();
    let mut content_types = ContentTypesManager::with_xlsx_defaults();

    graph.add_content_types_to(&mut content_types);
    graph.apply_content_type_preferences_to(&mut content_types);

    let bin = content_types
        .defaults()
        .iter()
        .find(|default| default.extension == "bin")
        .unwrap();
    assert_eq!(bin.content_type, crate::write::CT_PRINTER_SETTINGS);
    assert!(
        graph
            .content_type_manifest_dispositions()
            .iter()
            .any(|disposition| {
                disposition.row_kind == domain_types::PackageContentTypeManifestRowKind::Default
                    && disposition.extension.as_deref() == Some("bin")
                    && disposition.disposition
                        == domain_types::PackageContentTypeManifestDispositionKind::Rewritten
            })
    );
}

#[test]
fn rich_data_parts_can_own_image_relationships() {
    let mut builder = PackageGraphBuilder::new();
    builder
        .register_part(modeled_part(
            "xl/richData/richValueRel.xml",
            "application/vnd.ms-excel.rdrichvaluerel+xml",
        ))
        .unwrap();
    register_media_part(&mut builder, "xl/media/image1.png").unwrap();
    builder.add_relationship(PackageRelationship {
        owner: PackageOwner::Part {
            path: "xl/richData/richValueRel.xml".to_string(),
        },
        relationship_type: REL_IMAGE.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: "xl/media/image1.png".to_string(),
        },
        identity_hint: Some(RelationshipIdentityHint::new("rId1")),
    });

    let graph = builder.resolve().unwrap();

    assert!(graph.relationships.iter().any(|relationship| {
        relationship.owner_rels_path == "xl/richData/_rels/richValueRel.xml.rels"
            && relationship.id == "rId1"
            && relationship.relationship_type == REL_IMAGE
            && relationship.target == "../media/image1.png"
    }));
}

#[test]
fn worksheet_drawing_relationship_cannot_target_chart_user_shapes_part() {
    let mut builder = PackageGraphBuilder::new();
    builder
        .register_part(modeled_part("xl/workbook.xml", CT_WORKBOOK))
        .unwrap();
    builder
        .register_part(modeled_part("xl/worksheets/sheet1.xml", CT_WORKSHEET))
        .unwrap();
    register_chart_auxiliary_part(&mut builder, "xl/drawings/drawing1.xml").unwrap();
    builder.add_relationship(PackageRelationship {
        owner: PackageOwner::Worksheet {
            index: 0,
            path: "xl/worksheets/sheet1.xml".to_string(),
        },
        relationship_type: REL_DRAWING.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: "xl/drawings/drawing1.xml".to_string(),
        },
        identity_hint: Some(RelationshipIdentityHint::new("rId1")),
    });

    let graph = builder.resolve().unwrap();
    let err = graph.validate_for_export().unwrap_err();
    let WriteError::PackageIntegrityIssues(issues) = err else {
        panic!("expected package integrity issues");
    };
    assert!(issues.iter().any(|issue| {
        matches!(
            issue,
            PackageIntegrityIssue::InvalidRelationshipTargetKind {
                relationship_type,
                expected_kind,
                actual_kind,
                ..
            } if relationship_type == REL_DRAWING
                && expected_kind == "WorksheetDrawing"
                && actual_kind == "ChartUserShapes"
        )
    }));
}

#[test]
fn chart_user_shapes_relationship_cannot_target_worksheet_drawing_part() {
    let mut builder = PackageGraphBuilder::new();
    register_worksheet_drawing(&mut builder, 0, "xl/drawings/drawing1.xml", None).unwrap();
    register_chart(&mut builder, 1).unwrap();
    register_drawing_chart_relationship(
        &mut builder,
        "xl/drawings/drawing1.xml",
        "xl/charts/chart1.xml",
        "rId1",
    )
    .unwrap();
    register_chart_auxiliary_relationship(
        &mut builder,
        "xl/charts/chart1.xml",
        crate::infra::opc::REL_CHART_USER_SHAPES,
        "xl/drawings/drawing1.xml",
        "rId2",
    );

    let graph = builder.resolve().unwrap();
    let err = graph.validate_for_export().unwrap_err();
    let WriteError::PackageIntegrityIssues(issues) = err else {
        panic!("expected package integrity issues");
    };
    assert!(issues.iter().any(|issue| {
        matches!(
            issue,
            PackageIntegrityIssue::InvalidRelationshipTargetKind {
                relationship_type,
                expected_kind,
                actual_kind,
                ..
            } if relationship_type == crate::infra::opc::REL_CHART_USER_SHAPES
                && expected_kind == "ChartUserShapes"
                && actual_kind == "WorksheetDrawing"
        )
    }));
}

#[test]
fn duplicate_same_target_relationships_keep_distinct_resolved_keys() {
    let mut builder = PackageGraphBuilder::new();
    register_worksheet_drawing(&mut builder, 0, "xl/drawings/drawing1.xml", None).unwrap();
    register_media_part(&mut builder, "xl/media/image1.png").unwrap();

    let first = register_drawing_image_relationship(
        &mut builder,
        "xl/drawings/drawing1.xml",
        "xl/media/image1.png",
        "rId1",
    )
    .unwrap();
    let second = register_drawing_image_relationship(
        &mut builder,
        "xl/drawings/drawing1.xml",
        "xl/media/image1.png",
        "rId2",
    )
    .unwrap();

    let graph = builder.resolve().unwrap();

    assert_eq!(graph.relationship_id_for_key(first), Some("rId1"));
    assert_eq!(graph.relationship_id_for_key(second), Some("rId2"));
    let drawing_image_relationships = graph
        .relationships
        .iter()
        .filter(|relationship| {
            relationship.owner_rels_path == "xl/drawings/_rels/drawing1.xml.rels"
                && relationship.relationship_type == REL_IMAGE
                && relationship.target == "../media/image1.png"
        })
        .count();
    assert_eq!(drawing_image_relationships, 2);
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
            && rel.target == "customXml/item1.xml"
    }));
    assert!(graph.relationships.iter().any(|rel| {
        rel.owner_rels_path == "customXml/_rels/item1.xml.rels"
            && rel.id == "rId1"
            && rel.target == "itemProps1.xml"
    }));
}

#[test]
fn webextension_cluster_is_registered_with_root_and_taskpane_relationships() {
    let metadata = PackageFidelityMetadata {
        root_relationships: vec![
            relationship_hint("rId3", REL_CORE_PROPERTIES, "docProps/core.xml"),
            relationship_hint(
                "rId2",
                "http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes",
                "xl/webextensions/taskpanes.xml",
            ),
            relationship_hint("rId1", REL_OFFICE_DOCUMENT, "xl/workbook.xml"),
        ],
        opaque_parts: vec![
            domain_types::OpaquePackagePartHint {
                path: "xl/webextensions/taskpanes.xml".to_string(),
                bytes: b"<wetp:taskpanes/>".to_vec(),
                content_type: Some(
                    "application/vnd.ms-office.webextensiontaskpanes+xml".to_string(),
                ),
                relationships: vec![relationship_hint(
                    "rId1",
                    "http://schemas.microsoft.com/office/2011/relationships/webextension",
                    "webextension1.xml",
                )],
            },
            domain_types::OpaquePackagePartHint {
                path: "xl/webextensions/webextension1.xml".to_string(),
                bytes: b"<we:webextension/>".to_vec(),
                content_type: Some("application/vnd.ms-office.webextension+xml".to_string()),
                relationships: Vec::new(),
            },
        ],
        ..Default::default()
    };

    let mut builder = build_modeled_workbook_graph_builder(graph_options(Some(metadata))).unwrap();
    builder.register_imported_opaque_parts().unwrap();
    let graph = builder.resolve().unwrap();

    assert!(graph.contains_part("xl/webextensions/taskpanes.xml"));
    assert!(graph.contains_part("xl/webextensions/webextension1.xml"));
    assert!(graph.relationships.iter().any(|rel| {
        rel.owner_rels_path == "_rels/.rels"
            && rel.id == "rId2"
            && rel.relationship_type
                == "http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes"
            && rel.target == "xl/webextensions/taskpanes.xml"
    }));
    assert!(graph.relationships.iter().any(|rel| {
        rel.owner_rels_path == "xl/webextensions/_rels/taskpanes.xml.rels"
            && rel.id == "rId1"
            && rel.relationship_type
                == "http://schemas.microsoft.com/office/2011/relationships/webextension"
            && rel.target == "webextension1.xml"
    }));
}

#[test]
fn webextension_cluster_uses_package_level_sidecar_relationships_for_opaque_parts() {
    let metadata = PackageFidelityMetadata {
        root_relationships: vec![relationship_hint(
            "rId2",
            "http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes",
            "xl/webextensions/taskpanes.xml",
        )],
        part_relationships: vec![domain_types::PartRelationshipPackageInfo {
            owner_path: "xl/webextensions/taskpanes.xml".to_string(),
            relationships: vec![relationship_hint(
                "rId1",
                "http://schemas.microsoft.com/office/2011/relationships/webextension",
                "webextension1.xml",
            )],
        }],
        opaque_parts: vec![
            domain_types::OpaquePackagePartHint {
                path: "xl/webextensions/taskpanes.xml".to_string(),
                bytes: br#"<wetp:taskpanes xmlns:wetp="http://schemas.microsoft.com/office/webextensions/taskpanes/2010/11"><wetp:taskpane><wetp:webextensionref xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></wetp:taskpane></wetp:taskpanes>"#.to_vec(),
                content_type: Some(
                    "application/vnd.ms-office.webextensiontaskpanes+xml".to_string(),
                ),
                relationships: Vec::new(),
            },
            domain_types::OpaquePackagePartHint {
                path: "xl/webextensions/webextension1.xml".to_string(),
                bytes: b"<we:webextension/>".to_vec(),
                content_type: Some("application/vnd.ms-office.webextension+xml".to_string()),
                relationships: Vec::new(),
            },
        ],
        ..Default::default()
    };

    let mut builder = build_modeled_workbook_graph_builder(graph_options(Some(metadata))).unwrap();
    builder.register_imported_opaque_parts().unwrap();
    let graph = builder.resolve().unwrap();

    graph.validate_for_export().unwrap();
    assert!(graph.relationships.iter().any(|rel| {
        rel.owner_rels_path == "xl/webextensions/_rels/taskpanes.xml.rels"
            && rel.id == "rId1"
            && rel.relationship_type
                == "http://schemas.microsoft.com/office/2011/relationships/webextension"
            && rel.target == "webextension1.xml"
    }));
}

#[test]
fn opaque_xml_relationship_references_must_have_registered_owner_relationships() {
    let metadata = PackageFidelityMetadata {
        root_relationships: vec![relationship_hint(
            "rId7",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml",
            "customXml/item1.xml",
        )],
        opaque_parts: vec![domain_types::OpaquePackagePartHint {
            path: "customXml/item1.xml".to_string(),
            bytes: br#"<root xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdMissing"/>"#.to_vec(),
            content_type: Some("application/xml".to_string()),
            relationships: Vec::new(),
        }],
        ..Default::default()
    };

    let mut builder = build_modeled_workbook_graph_builder(graph_options(Some(metadata))).unwrap();
    builder.register_imported_opaque_parts().unwrap();
    let graph = builder.resolve().unwrap();
    let error = graph
        .validate_for_export()
        .expect_err("opaque XML r:id must require a matching sidecar relationship");

    assert!(
        error
            .to_string()
            .contains("opaque part customXml/item1.xml references relationship rIdMissing")
    );
}

#[test]
fn opaque_sidecar_external_relationships_are_not_replayed() {
    let metadata = PackageFidelityMetadata {
        root_relationships: vec![relationship_hint(
            "rId7",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml",
            "customXml/item1.xml",
        )],
        opaque_parts: vec![domain_types::OpaquePackagePartHint {
            path: "customXml/item1.xml".to_string(),
            bytes: b"<root/>".to_vec(),
            content_type: Some("application/xml".to_string()),
            relationships: vec![external_relationship_hint(
                "rId1",
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
                "https://example.invalid/",
            )],
        }],
        ..Default::default()
    };

    let mut builder = build_modeled_workbook_graph_builder(graph_options(Some(metadata))).unwrap();
    builder.register_imported_opaque_parts().unwrap();
    let graph = builder.resolve().unwrap();

    assert!(graph.contains_part("customXml/item1.xml"));
    assert!(!graph.relationships.iter().any(|rel| {
        rel.owner_rels_path == "customXml/_rels/item1.xml.rels"
            && rel.id == "rId1"
            && rel.target == "https://example.invalid/"
    }));
}

#[test]
fn webextension_cluster_is_dropped_without_root_taskpanes_relationship() {
    let metadata = PackageFidelityMetadata {
        opaque_parts: vec![
            domain_types::OpaquePackagePartHint {
                path: "xl/webextensions/taskpanes.xml".to_string(),
                bytes: b"<wetp:taskpanes/>".to_vec(),
                content_type: Some(
                    "application/vnd.ms-office.webextensiontaskpanes+xml".to_string(),
                ),
                relationships: vec![relationship_hint(
                    "rId1",
                    "http://schemas.microsoft.com/office/2011/relationships/webextension",
                    "webextension1.xml",
                )],
            },
            domain_types::OpaquePackagePartHint {
                path: "xl/webextensions/webextension1.xml".to_string(),
                bytes: b"<we:webextension/>".to_vec(),
                content_type: Some("application/vnd.ms-office.webextension+xml".to_string()),
                relationships: Vec::new(),
            },
        ],
        ..Default::default()
    };

    let mut builder = build_modeled_workbook_graph_builder(graph_options(Some(metadata))).unwrap();
    builder.register_imported_opaque_parts().unwrap();
    let graph = builder.resolve().unwrap();

    assert!(!graph.contains_part("xl/webextensions/taskpanes.xml"));
    assert!(!graph.contains_part("xl/webextensions/webextension1.xml"));
}

#[test]
fn webextension_cluster_is_dropped_for_unsafe_internal_target() {
    let metadata = PackageFidelityMetadata {
        root_relationships: vec![relationship_hint(
            "rId2",
            "http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes",
            "xl/webextensions/taskpanes.xml",
        )],
        opaque_parts: vec![
            domain_types::OpaquePackagePartHint {
                path: "xl/webextensions/taskpanes.xml".to_string(),
                bytes: b"<wetp:taskpanes/>".to_vec(),
                content_type: Some(
                    "application/vnd.ms-office.webextensiontaskpanes+xml".to_string(),
                ),
                relationships: vec![relationship_hint(
                    "rId1",
                    "http://schemas.microsoft.com/office/2011/relationships/webextension",
                    "../media/image1.png",
                )],
            },
            domain_types::OpaquePackagePartHint {
                path: "xl/media/image1.png".to_string(),
                bytes: vec![1, 2, 3],
                content_type: Some(CT_PNG.to_string()),
                relationships: Vec::new(),
            },
        ],
        ..Default::default()
    };

    let mut builder = build_modeled_workbook_graph_builder(graph_options(Some(metadata))).unwrap();
    builder.register_imported_opaque_parts().unwrap();
    let graph = builder.resolve().unwrap();

    assert!(!graph.contains_part("xl/webextensions/taskpanes.xml"));
}

#[test]
fn vba_project_is_registered_as_quarantined_workbook_opaque_part() {
    let metadata = PackageFidelityMetadata {
        content_type_defaults: vec![domain_types::PackageContentTypeDefaultHint {
            extension: "bin".to_string(),
            content_type: crate::write::CT_VBA.to_string(),
        }],
        workbook_relationships: vec![relationship_hint(
            "rIdMacro",
            crate::infra::opc::REL_VBA_PROJECT,
            "vbaProject.bin",
        )],
        opaque_parts: vec![domain_types::OpaquePackagePartHint {
            path: "xl/vbaProject.bin".to_string(),
            bytes: vec![0xD0, 0xCF, 0x11, 0xE0],
            content_type: Some(crate::write::CT_VBA.to_string()),
            relationships: Vec::new(),
        }],
        ..Default::default()
    };

    let mut builder = build_modeled_workbook_graph_builder(graph_options(Some(metadata))).unwrap();
    builder.register_imported_opaque_parts().unwrap();
    let graph = builder.resolve().unwrap();

    assert!(graph.contains_part("xl/vbaProject.bin"));
    assert!(graph.relationships.iter().any(|rel| {
        rel.owner_rels_path == "xl/_rels/workbook.xml.rels"
            && rel.id == "rIdMacro"
            && rel.relationship_type == crate::infra::opc::REL_VBA_PROJECT
            && rel.target == "vbaProject.bin"
    }));
}

#[test]
fn imported_vba_bin_default_does_not_retype_unrelated_bin_parts() {
    let metadata = PackageFidelityMetadata {
        content_type_defaults: vec![domain_types::PackageContentTypeDefaultHint {
            extension: "bin".to_string(),
            content_type: crate::write::CT_VBA.to_string(),
        }],
        ..Default::default()
    };
    let builder = build_modeled_workbook_graph_builder(graph_options(Some(metadata))).unwrap();
    let graph = builder.resolve().unwrap();
    let mut content_types = ContentTypesManager::new();
    content_types.add_default(
        "bin",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings",
    );
    graph.apply_content_type_preferences_to(&mut content_types);

    let bin = content_types
        .defaults()
        .iter()
        .find(|default| default.extension == "bin")
        .unwrap();
    assert_eq!(
        bin.content_type,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings"
    );
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
