use super::*;

#[test]
fn dirty_typed_opaque_subgraph_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let custom_part = domain_types::BlobPart {
        path: "customXml/item1.xml".to_string(),
        data: b"<stale/>".to_vec(),
    };
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext::default()],
        opaque_package_subgraphs: vec![domain_types::OpaquePackageSubgraph {
            owner: domain_types::OpaquePackageOwner::Workbook,
            owner_relationship: domain_types::OpaquePackageRelationship {
                owner: domain_types::OpaquePackageOwner::Workbook,
                relationship_type:
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"
                        .to_string(),
                target: domain_types::OpaqueRelationshipTarget::InternalPart {
                    path: custom_part.path.clone(),
                },
                relationship_id_hint: Some("rId99".to_string()),
            },
            parts: vec![domain_types::OpaquePackagePart {
                part: custom_part,
                content_type: Some("application/xml".to_string()),
                default_extension: Some(("xml".to_string(), "application/xml".to_string())),
                ownership: domain_types::OpaquePackageOwnership::DirtyImported,
            }],
            relationships: Vec::new(),
            ownership: domain_types::OpaquePackageOwnership::DirtyImported,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("customXml/item1.xml"));
    assert!(!workbook_rels.contains("customXml"));
    assert!(!content_types.contains("/customXml/item1.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_and_deleted_typed_opaque_subgraphs_are_not_raw_passthrough() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let generated_part = domain_types::BlobPart {
        path: "customXml/generated.xml".to_string(),
        data: b"<generated/>".to_vec(),
    };
    let deleted_part = domain_types::BlobPart {
        path: "customXml/deleted.xml".to_string(),
        data: b"<deleted/>".to_vec(),
    };
    let ctx = domain_types::RoundTripContext {
        opaque_package_subgraphs: vec![
            domain_types::OpaquePackageSubgraph {
                owner: domain_types::OpaquePackageOwner::Workbook,
                owner_relationship: domain_types::OpaquePackageRelationship {
                    owner: domain_types::OpaquePackageOwner::Workbook,
                    relationship_type:
                        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"
                            .to_string(),
                    target: domain_types::OpaqueRelationshipTarget::InternalPart {
                        path: generated_part.path.clone(),
                    },
                    relationship_id_hint: Some("rIdGenerated".to_string()),
                },
                parts: vec![domain_types::OpaquePackagePart {
                    part: generated_part,
                    content_type: Some("application/xml".to_string()),
                    default_extension: Some(("xml".to_string(), "application/xml".to_string())),
                    ownership: domain_types::OpaquePackageOwnership::Generated,
                }],
                relationships: Vec::new(),
                ownership: domain_types::OpaquePackageOwnership::Generated,
            },
            domain_types::OpaquePackageSubgraph {
                owner: domain_types::OpaquePackageOwner::Workbook,
                owner_relationship: domain_types::OpaquePackageRelationship {
                    owner: domain_types::OpaquePackageOwner::Workbook,
                    relationship_type:
                        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"
                            .to_string(),
                    target: domain_types::OpaqueRelationshipTarget::InternalPart {
                        path: deleted_part.path.clone(),
                    },
                    relationship_id_hint: Some("rIdDeleted".to_string()),
                },
                parts: vec![domain_types::OpaquePackagePart {
                    part: deleted_part,
                    content_type: Some("application/xml".to_string()),
                    default_extension: Some(("xml".to_string(), "application/xml".to_string())),
                    ownership: domain_types::OpaquePackageOwnership::Deleted,
                }],
                relationships: Vec::new(),
                ownership: domain_types::OpaquePackageOwnership::Deleted,
            },
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("customXml/generated.xml"));
    assert!(!archive.contains("customXml/deleted.xml"));
    assert!(!workbook_rels.contains("rIdGenerated"));
    assert!(!workbook_rels.contains("rIdDeleted"));
    assert!(!content_types.contains("/customXml/generated.xml"));
    assert!(!content_types.contains("/customXml/deleted.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn clean_typed_opaque_subgraph_with_missing_owner_target_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        opaque_package_subgraphs: vec![domain_types::OpaquePackageSubgraph {
            owner: domain_types::OpaquePackageOwner::Workbook,
            owner_relationship: domain_types::OpaquePackageRelationship {
                owner: domain_types::OpaquePackageOwner::Workbook,
                relationship_type:
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"
                        .to_string(),
                target: domain_types::OpaqueRelationshipTarget::InternalPart {
                    path: "customXml/missing.xml".to_string(),
                },
                relationship_id_hint: Some("rIdMissing".to_string()),
            },
            parts: vec![domain_types::OpaquePackagePart {
                part: domain_types::BlobPart {
                    path: "customXml/itemProps1.xml".to_string(),
                    data: b"<props/>".to_vec(),
                },
                content_type: Some(
                    "application/vnd.openxmlformats-officedocument.customXmlProperties+xml"
                        .to_string(),
                ),
                default_extension: Some(("xml".to_string(), "application/xml".to_string())),
                ownership: domain_types::OpaquePackageOwnership::CleanImported,
            }],
            relationships: Vec::new(),
            ownership: domain_types::OpaquePackageOwnership::CleanImported,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("customXml/missing.xml"));
    assert!(!archive.contains("customXml/itemProps1.xml"));
    assert!(!workbook_rels.contains("rIdMissing"));
    assert!(!content_types.contains("/customXml/itemProps1.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn worksheet_owned_clean_opaque_subgraph_writes_sheet_owner_relationship() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext::default()],
        opaque_package_subgraphs: vec![domain_types::OpaquePackageSubgraph {
            owner: domain_types::OpaquePackageOwner::Worksheet {
                index: 0,
                path: "xl/worksheets/sheet1.xml".to_string(),
            },
            owner_relationship: domain_types::OpaquePackageRelationship {
                owner: domain_types::OpaquePackageOwner::Worksheet {
                    index: 0,
                    path: "xl/worksheets/sheet1.xml".to_string(),
                },
                relationship_type: "http://schemas.example.com/relationships/opaqueWidget"
                    .to_string(),
                target: domain_types::OpaqueRelationshipTarget::InternalPart {
                    path: "xl/opaqueWidgets/widget1.xml".to_string(),
                },
                relationship_id_hint: Some("rIdWidget".to_string()),
            },
            parts: vec![domain_types::OpaquePackagePart {
                part: domain_types::BlobPart {
                    path: "xl/opaqueWidgets/widget1.xml".to_string(),
                    data: b"<widget/>".to_vec(),
                },
                content_type: Some("application/vnd.example.opaque-widget+xml".to_string()),
                default_extension: Some(("xml".to_string(), "application/xml".to_string())),
                ownership: domain_types::OpaquePackageOwnership::CleanImported,
            }],
            relationships: Vec::new(),
            ownership: domain_types::OpaquePackageOwnership::CleanImported,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert_eq!(
        archive.read_file("xl/opaqueWidgets/widget1.xml").unwrap(),
        b"<widget/>".to_vec()
    );
    assert!(sheet_rels.contains(r#"Id="rIdWidget""#));
    assert!(sheet_rels.contains(r#"Target="../opaqueWidgets/widget1.xml""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn modeled_slicer_subgraph_is_not_replayed_as_opaque_roundtrip_data() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext::default()],
        opaque_package_subgraphs: vec![domain_types::OpaquePackageSubgraph {
            owner: domain_types::OpaquePackageOwner::Worksheet {
                index: 0,
                path: "xl/worksheets/sheet1.xml".to_string(),
            },
            owner_relationship: domain_types::OpaquePackageRelationship {
                owner: domain_types::OpaquePackageOwner::Worksheet {
                    index: 0,
                    path: "xl/worksheets/sheet1.xml".to_string(),
                },
                relationship_type: crate::infra::opc::REL_SLICER.to_string(),
                target: domain_types::OpaqueRelationshipTarget::InternalPart {
                    path: "xl/slicers/slicer1.xml".to_string(),
                },
                relationship_id_hint: Some("rIdSlicer".to_string()),
            },
            parts: vec![domain_types::OpaquePackagePart {
                part: domain_types::BlobPart {
                    path: "xl/slicers/slicer1.xml".to_string(),
                    data: b"<slicer/>".to_vec(),
                },
                content_type: Some("application/vnd.ms-excel.slicer+xml".to_string()),
                default_extension: Some(("xml".to_string(), "application/xml".to_string())),
                ownership: domain_types::OpaquePackageOwnership::CleanImported,
            }],
            relationships: Vec::new(),
            ownership: domain_types::OpaquePackageOwnership::CleanImported,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();

    assert!(!archive.contains("xl/slicers/slicer1.xml"));
    if let Ok(sheet_rels) = archive.read_file("xl/worksheets/_rels/sheet1.xml.rels") {
        let sheet_rels = String::from_utf8(sheet_rels).unwrap();
        assert!(!sheet_rels.contains("rIdSlicer"));
    }
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn typed_orphan_clean_binary_blob_is_emitted_without_blanket_binary_passthrough() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let clean_orphan = domain_types::BlobPart {
        path: "xl/printerSettings/printerSettings1.bin".to_string(),
        data: b"clean printer settings".to_vec(),
    };
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext::default()],
        opaque_package_subgraphs: vec![domain_types::OpaquePackageSubgraph {
            owner: domain_types::OpaquePackageOwner::Part {
                path: clean_orphan.path.clone(),
            },
            owner_relationship: domain_types::OpaquePackageRelationship {
                owner: domain_types::OpaquePackageOwner::Part {
                    path: clean_orphan.path.clone(),
                },
                relationship_type: String::new(),
                target: domain_types::OpaqueRelationshipTarget::InternalPath {
                    target: String::new(),
                },
                relationship_id_hint: None,
            },
            parts: vec![domain_types::OpaquePackagePart {
                part: clean_orphan,
                content_type: None,
                default_extension: Some((
                    "bin".to_string(),
                    "application/octet-stream".to_string(),
                )),
                ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
            }],
            relationships: Vec::new(),
            ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/printerSettings/printerSettings1.bin"));
    assert!(!archive.contains("xl/media/stale.bin"));
    assert!(content_types.contains("Extension=\"bin\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
