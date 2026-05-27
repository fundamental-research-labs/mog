use super::*;
use crate::write::{REL_HYPERLINK, REL_STYLES, REL_WORKSHEET};

#[test]
fn resolves_workbook_relationship_hints_without_collision() {
    let mut graph = PackageGraphBuilder::new();
    graph
        .register_part(modeled_part("xl/worksheets/sheet1.xml", CT_WORKSHEET))
        .unwrap();
    graph
        .register_part(modeled_part("xl/styles.xml", CT_STYLES))
        .unwrap();
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Workbook,
        relationship_type: REL_WORKSHEET.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: "xl/worksheets/sheet1.xml".to_string(),
        },
        identity_hint: Some(RelationshipIdentityHint::new("rId7")),
    });
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Workbook,
        relationship_type: REL_STYLES.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: "xl/styles.xml".to_string(),
        },
        identity_hint: Some(RelationshipIdentityHint::new("rId7")),
    });

    let resolved = graph.resolve().unwrap();
    assert_eq!(
        resolved.relationship_id(
            &PackageOwner::Workbook,
            REL_WORKSHEET,
            "worksheets/sheet1.xml"
        ),
        Some("rId7")
    );
    assert_eq!(
        resolved.relationship_id(&PackageOwner::Workbook, REL_STYLES, "styles.xml"),
        Some("rId8")
    );
}

#[test]
fn rejects_duplicate_part_paths_with_different_bytes() {
    let mut graph = PackageGraphBuilder::new();
    let mut part = modeled_part("xl/workbook.xml", "application/xml");
    part.bytes = Some(vec![1]);
    graph.register_part(part).unwrap();
    let mut part = modeled_part("/xl/workbook.xml", "application/xml");
    part.bytes = Some(vec![2]);
    assert!(graph.register_part(part).is_err());
}

#[test]
fn accepts_duplicate_part_paths_only_when_bytes_match() {
    let mut graph = PackageGraphBuilder::new();
    let mut part = modeled_part("xl/workbook.xml", "application/xml");
    part.bytes = Some(vec![1, 2, 3]);
    graph.register_part(part).unwrap();
    let mut part = modeled_part("/xl/workbook.xml", "application/xml");
    part.bytes = Some(vec![1, 2, 3]);
    graph.register_part(part).unwrap();
}

#[test]
fn resolved_graph_part_membership_normalizes_paths() {
    let mut graph = PackageGraphBuilder::new();
    graph
        .register_part(modeled_part("xl/drawings/drawing1.xml", CT_DRAWING))
        .unwrap();

    let resolved = graph.resolve().unwrap();

    assert!(resolved.contains_part("xl/drawings/drawing1.xml"));
    assert!(resolved.contains_part("/xl/drawings/drawing1.xml"));
    assert!(!resolved.contains_part("xl/drawings/drawing2.xml"));
}

#[test]
fn rejects_modeled_opaque_path_conflicts_even_when_bytes_match() {
    let mut graph = PackageGraphBuilder::new();
    let mut modeled = modeled_part("xl/workbook.xml", "application/xml");
    modeled.bytes = Some(vec![1, 2, 3]);
    graph.register_part(modeled).unwrap();

    let opaque = PackagePart {
        path: "/xl/workbook.xml".to_string(),
        content_type: Some("application/xml".to_string()),
        default_extension: None,
        kind: PackagePartKind::OpaqueClean,
        bytes: Some(vec![1, 2, 3]),
    };

    assert!(
        graph
            .register_opaque_part(opaque, OpaquePackageOwnershipState::Clean)
            .is_err()
    );
}

#[test]
fn ignores_sheet_id_hint_when_original_relationship_targets_stale_part() {
    let ctx = RoundTripContext {
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rId99".to_string(),
            rel_type: REL_WORKSHEET.to_string(),
            target: "worksheets/sheet9.xml".to_string(),
            target_mode: None,
        }],
        sheet_workbook_r_ids: vec!["rId99".to_string()],
        ..Default::default()
    };

    let resolved = build_modeled_workbook_graph(
        ModeledWorkbookGraphOptions {
            sheet_count: 1,
            has_theme: false,
            has_shared_strings: false,
            has_core_props: false,
            has_app_props: false,
            has_custom_props: false,
            has_metadata: false,
            has_persons: false,
            has_doc_metadata_label_info: false,
        },
        Some(&ctx),
    )
    .unwrap();

    assert_eq!(
        resolved.relationship_id(
            &PackageOwner::Workbook,
            REL_WORKSHEET,
            "worksheets/sheet1.xml"
        ),
        Some("rId1")
    );
}

#[test]
fn ignores_external_mode_root_relationship_hints_for_internal_package_parts() {
    let ctx = RoundTripContext {
        root_relationships: vec![domain_types::OpcRelationship {
            id: "rId99".to_string(),
            rel_type: crate::write::REL_OFFICE_DOCUMENT.to_string(),
            target: "/xl/workbook.xml".to_string(),
            target_mode: Some("External".to_string()),
        }],
        ..Default::default()
    };

    let resolved = build_modeled_workbook_graph(
        ModeledWorkbookGraphOptions {
            sheet_count: 1,
            has_theme: false,
            has_shared_strings: false,
            has_core_props: false,
            has_app_props: false,
            has_custom_props: false,
            has_metadata: false,
            has_persons: false,
            has_doc_metadata_label_info: false,
        },
        Some(&ctx),
    )
    .unwrap();

    assert_eq!(
        resolved.relationship_id(
            &PackageOwner::Root,
            crate::write::REL_OFFICE_DOCUMENT,
            "/xl/workbook.xml"
        ),
        Some("rId1")
    );
}

#[test]
fn ignores_external_mode_workbook_relationship_hints_for_internal_package_parts() {
    let ctx = RoundTripContext {
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rId99".to_string(),
            rel_type: REL_STYLES.to_string(),
            target: "styles.xml".to_string(),
            target_mode: Some("External".to_string()),
        }],
        ..Default::default()
    };

    let resolved = build_modeled_workbook_graph(
        ModeledWorkbookGraphOptions {
            sheet_count: 1,
            has_theme: false,
            has_shared_strings: false,
            has_core_props: false,
            has_app_props: false,
            has_custom_props: false,
            has_metadata: false,
            has_persons: false,
            has_doc_metadata_label_info: false,
        },
        Some(&ctx),
    )
    .unwrap();

    assert_eq!(
        resolved.relationship_id(&PackageOwner::Workbook, REL_STYLES, "styles.xml"),
        Some("rId2")
    );
}

#[test]
fn ignores_external_mode_sheet_relationship_hints_for_internal_package_parts() {
    let ctx = RoundTripContext {
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rId99".to_string(),
            rel_type: REL_WORKSHEET.to_string(),
            target: "worksheets/sheet1.xml".to_string(),
            target_mode: Some("External".to_string()),
        }],
        sheet_workbook_r_ids: vec!["rId99".to_string()],
        ..Default::default()
    };

    let resolved = build_modeled_workbook_graph(
        ModeledWorkbookGraphOptions {
            sheet_count: 1,
            has_theme: false,
            has_shared_strings: false,
            has_core_props: false,
            has_app_props: false,
            has_custom_props: false,
            has_metadata: false,
            has_persons: false,
            has_doc_metadata_label_info: false,
        },
        Some(&ctx),
    )
    .unwrap();

    assert_eq!(
        resolved.relationship_id(
            &PackageOwner::Workbook,
            REL_WORKSHEET,
            "worksheets/sheet1.xml"
        ),
        Some("rId1")
    );
}

#[test]
fn original_root_relationships_only_hint_registered_modeled_relationships() {
    let ctx = RoundTripContext {
        root_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId7".to_string(),
                rel_type: crate::write::REL_OFFICE_DOCUMENT.to_string(),
                target: "/xl/workbook.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: crate::write::REL_CORE_PROPERTIES.to_string(),
                target: "/docProps/core.xml".to_string(),
                target_mode: None,
            },
        ],
        ..Default::default()
    };

    let resolved = build_modeled_workbook_graph(
        ModeledWorkbookGraphOptions {
            sheet_count: 1,
            has_theme: false,
            has_shared_strings: false,
            has_core_props: false,
            has_app_props: false,
            has_custom_props: false,
            has_metadata: false,
            has_persons: false,
            has_doc_metadata_label_info: false,
        },
        Some(&ctx),
    )
    .unwrap();
    let rels = resolved.relationship_manager_for_owner(&PackageOwner::Root);

    assert!(rels.get_by_id("rId99").is_none());
    assert_eq!(
        resolved.relationship_id(
            &PackageOwner::Root,
            crate::write::REL_OFFICE_DOCUMENT,
            "/xl/workbook.xml",
        ),
        Some("rId7")
    );
    assert_eq!(rels.len(), 1);
}

#[test]
fn original_workbook_relationships_only_hint_registered_modeled_relationships() {
    let ctx = RoundTripContext {
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId7".to_string(),
                rel_type: REL_STYLES.to_string(),
                target: "styles.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: crate::write::REL_SHARED_STRINGS.to_string(),
                target: "sharedStrings.xml".to_string(),
                target_mode: None,
            },
        ],
        ..Default::default()
    };

    let resolved = build_modeled_workbook_graph(
        ModeledWorkbookGraphOptions {
            sheet_count: 1,
            has_theme: false,
            has_shared_strings: false,
            has_core_props: false,
            has_app_props: false,
            has_custom_props: false,
            has_metadata: false,
            has_persons: false,
            has_doc_metadata_label_info: false,
        },
        Some(&ctx),
    )
    .unwrap();
    let rels = resolved.relationship_manager_for_owner(&PackageOwner::Workbook);

    assert!(rels.get_by_id("rId99").is_none());
    assert_eq!(
        resolved.relationship_id(&PackageOwner::Workbook, REL_STYLES, "styles.xml"),
        Some("rId7")
    );
    assert_eq!(rels.len(), 2);
}

#[test]
fn reuses_sheet_id_hint_when_original_relationship_targets_same_part() {
    let ctx = RoundTripContext {
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rId99".to_string(),
            rel_type: REL_WORKSHEET.to_string(),
            target: "worksheets/sheet1.xml".to_string(),
            target_mode: None,
        }],
        sheet_workbook_r_ids: vec!["rId99".to_string()],
        ..Default::default()
    };

    let resolved = build_modeled_workbook_graph(
        ModeledWorkbookGraphOptions {
            sheet_count: 1,
            has_theme: false,
            has_shared_strings: false,
            has_core_props: false,
            has_app_props: false,
            has_custom_props: false,
            has_metadata: false,
            has_persons: false,
            has_doc_metadata_label_info: false,
        },
        Some(&ctx),
    )
    .unwrap();

    assert_eq!(
        resolved.relationship_id(
            &PackageOwner::Workbook,
            REL_WORKSHEET,
            "worksheets/sheet1.xml"
        ),
        Some("rId99")
    );
}

#[test]
fn resolves_external_relationships_without_registered_parts() {
    let mut graph = PackageGraphBuilder::new();
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Worksheet {
            index: 0,
            path: "xl/worksheets/sheet1.xml".to_string(),
        },
        relationship_type: REL_HYPERLINK.to_string(),
        target: PackageRelationshipTarget::External {
            target: "https://example.com".to_string(),
        },
        identity_hint: Some(RelationshipIdentityHint::new("rId4")),
    });

    let rels = graph
        .resolve()
        .unwrap()
        .relationship_manager_for_owner(&PackageOwner::Worksheet {
            index: 0,
            path: "xl/worksheets/sheet1.xml".to_string(),
        });
    let rel = rels.get_by_id("rId4").unwrap();
    assert_eq!(rel.target, "https://example.com");
    assert_eq!(rel.target_mode.as_deref(), Some("External"));
}

#[test]
fn registers_doc_metadata_label_info_content_type_when_emitted() {
    let resolved = build_modeled_workbook_graph(
        ModeledWorkbookGraphOptions {
            sheet_count: 1,
            has_theme: false,
            has_shared_strings: false,
            has_core_props: false,
            has_app_props: false,
            has_custom_props: false,
            has_metadata: false,
            has_persons: false,
            has_doc_metadata_label_info: true,
        },
        None,
    )
    .unwrap();
    let mut content_types = ContentTypesManager::new();

    resolved.add_content_types_to(&mut content_types);

    assert!(content_types.has_override("/docMetadata/LabelInfo.xml"));
}

#[test]
fn registers_chart_content_types_when_emitted() {
    let mut graph = PackageGraphBuilder::new();
    register_chart(&mut graph, 2).unwrap();
    register_chart_ex(&mut graph, 3).unwrap();
    register_chart_auxiliary_part(&mut graph, "xl/charts/style1.xml").unwrap();
    register_chart_auxiliary_part(&mut graph, "xl/charts/colors1.xml").unwrap();
    let resolved = graph.resolve().unwrap();
    let mut content_types = ContentTypesManager::new();

    resolved.add_content_types_to(&mut content_types);
    let xml = String::from_utf8(content_types.to_xml()).unwrap();

    assert!(xml.contains(r#"PartName="/xl/charts/chart2.xml""#));
    assert!(xml.contains(
        r#"ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml""#
    ));
    assert!(xml.contains(r#"PartName="/xl/charts/chartEx3.xml""#));
    assert!(xml.contains(r#"ContentType="application/vnd.ms-office.chartex+xml""#));
    assert!(xml.contains(r#"PartName="/xl/charts/style1.xml""#));
    assert!(xml.contains(r#"ContentType="application/vnd.ms-office.chartstyle+xml""#));
    assert!(xml.contains(r#"PartName="/xl/charts/colors1.xml""#));
    assert!(xml.contains(r#"ContentType="application/vnd.ms-office.chartcolorstyle+xml""#));
}

#[test]
fn registers_chart_auxiliary_relationship_with_resolved_id() {
    let mut graph = PackageGraphBuilder::new();
    register_chart(&mut graph, 2).unwrap();
    register_chart_auxiliary_part(&mut graph, "xl/charts/style1.xml").unwrap();
    register_chart_auxiliary_relationship(
        &mut graph,
        "xl/charts/chart2.xml",
        "http://schemas.microsoft.com/office/2011/relationships/chartStyle",
        "xl/charts/style1.xml",
        "rId8",
    );
    let rels = graph
        .resolve()
        .unwrap()
        .relationship_manager_for_owner(&PackageOwner::Part {
            path: "xl/charts/chart2.xml".to_string(),
        });

    let rel = rels.get_by_id("rId8").unwrap();
    assert_eq!(rel.target, "style1.xml");
    assert_eq!(
        rel.rel_type,
        "http://schemas.microsoft.com/office/2011/relationships/chartStyle"
    );
}

#[test]
fn registers_media_default_content_types_when_emitted() {
    let mut graph = PackageGraphBuilder::new();
    register_media_part(&mut graph, "xl/media/image1.png").unwrap();
    register_media_part(&mut graph, "xl/media/image2.jpg").unwrap();
    let resolved = graph.resolve().unwrap();
    let mut content_types = ContentTypesManager::new();

    resolved.add_content_types_to(&mut content_types);
    let xml = String::from_utf8(content_types.to_xml()).unwrap();

    assert!(xml.contains(r#"Extension="png" ContentType="image/png""#));
    assert!(xml.contains(r#"Extension="jpg" ContentType="image/jpeg""#));
}

#[test]
fn worksheet_custom_property_parts_require_worksheet_relationship() {
    let mut graph = PackageGraphBuilder::new();
    graph
        .register_part(modeled_part(
            "xl/customProperty/item1.xml",
            CT_WORKSHEET_CUSTOM_PROPERTY,
        ))
        .unwrap();

    let resolved = graph.resolve().unwrap();
    let err = resolved.validate_for_export().unwrap_err();

    match err {
        WriteError::PackageIntegrityIssues(issues) => {
            assert!(issues.iter().any(|issue| matches!(
                issue,
                PackageIntegrityIssue::MissingRequiredRelationship {
                    relationship_type,
                    target_path,
                    ..
                } if relationship_type == REL_WORKSHEET_CUSTOM_PROPERTY
                    && target_path == "xl/customProperty/item1.xml"
            )));
        }
        other => panic!("expected package integrity issues, got {other:?}"),
    }
}

#[test]
fn rejects_dangling_internal_relationship_targets() {
    let mut graph = PackageGraphBuilder::new();
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Workbook,
        relationship_type: REL_WORKSHEET.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: "xl/worksheets/missing.xml".to_string(),
        },
        identity_hint: None,
    });

    assert!(graph.resolve().is_err());
}

#[test]
fn opaque_parts_require_explicit_clean_ownership() {
    let mut graph = PackageGraphBuilder::new();
    let part = PackagePart {
        path: "xl/customXml/item1.xml".to_string(),
        content_type: Some("application/xml".to_string()),
        default_extension: None,
        kind: PackagePartKind::OpaqueClean,
        bytes: Some(b"<root/>".to_vec()),
    };
    assert!(graph.register_part(part.clone()).is_err());
    assert!(
        graph
            .register_opaque_part(part.clone(), OpaquePackageOwnershipState::Dirty)
            .is_err()
    );
    graph
        .register_opaque_part(part, OpaquePackageOwnershipState::Clean)
        .unwrap();
}

#[test]
fn opaque_relationships_require_clean_ownership() {
    let mut graph = PackageGraphBuilder::new();
    let relationship = PackageRelationship {
        owner: PackageOwner::Workbook,
        relationship_type: "opaque-rel".to_string(),
        target: PackageRelationshipTarget::InternalPath {
            target: "../customXml/item1.xml".to_string(),
        },
        identity_hint: Some(RelationshipIdentityHint::new("rId5")),
    };
    assert!(
        graph
            .add_opaque_relationship(relationship.clone(), OpaquePackageOwnershipState::Dirty,)
            .is_err()
    );
    graph
        .add_opaque_relationship(relationship, OpaquePackageOwnershipState::Clean)
        .unwrap();
    assert_eq!(
        graph.resolve().unwrap().relationship_id(
            &PackageOwner::Workbook,
            "opaque-rel",
            "../customXml/item1.xml",
        ),
        Some("rId5")
    );
}
