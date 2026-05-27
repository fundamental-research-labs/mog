use super::*;

#[test]
fn dirty_typed_opaque_subgraph_suppresses_legacy_custom_xml_passthrough() {
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
        content_type_overrides: vec![(
            "/customXml/item1.xml".to_string(),
            "application/xml".to_string(),
        )],
        custom_xml_parts: vec![custom_part.clone()],
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
        custom_xml_parts: vec![generated_part.clone(), deleted_part.clone()],
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
                relationship_type: "http://schemas.microsoft.com/office/2007/relationships/slicer"
                    .to_string(),
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
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert_eq!(
        archive.read_file("xl/slicers/slicer1.xml").unwrap(),
        b"<slicer/>".to_vec()
    );
    assert!(sheet_rels.contains(r#"Id="rIdSlicer""#));
    assert!(sheet_rels.contains(r#"Target="../slicers/slicer1.xml""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn legacy_custom_xml_with_dangling_sidecar_relationship_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        custom_xml_parts: vec![
            domain_types::BlobPart {
                path: "customXml/item1.xml".to_string(),
                data: b"<item/>".to_vec(),
            },
            domain_types::BlobPart {
                path: "customXml/_rels/item1.xml.rels".to_string(),
                data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="missingItemProps.xml"/></Relationships>"#.to_vec(),
            },
        ],
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rId9".to_string(),
            rel_type:
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"
                    .to_string(),
            target: "../customXml/item1.xml".to_string(),
            target_mode: None,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();

    assert!(!archive.contains("customXml/item1.xml"));
    assert!(!archive.contains("customXml/_rels/item1.xml.rels"));
    assert!(!workbook_rels.contains("customXml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn legacy_custom_xml_with_unreachable_item_props_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        custom_xml_parts: vec![
            domain_types::BlobPart {
                path: "customXml/item1.xml".to_string(),
                data: b"<item/>".to_vec(),
            },
            domain_types::BlobPart {
                path: "customXml/itemProps1.xml".to_string(),
                data: b"<props/>".to_vec(),
            },
        ],
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rId9".to_string(),
            rel_type:
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"
                    .to_string(),
            target: "../customXml/item1.xml".to_string(),
            target_mode: None,
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
    assert!(!archive.contains("customXml/itemProps1.xml"));
    assert!(!workbook_rels.contains("customXml"));
    assert!(!content_types.contains("/customXml/item"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn legacy_custom_xml_without_workbook_owner_relationship_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        custom_xml_parts: vec![
            domain_types::BlobPart {
                path: "customXml/item1.xml".to_string(),
                data: b"<item/>".to_vec(),
            },
            domain_types::BlobPart {
                path: "customXml/itemProps1.xml".to_string(),
                data: b"<props/>".to_vec(),
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

    assert!(!archive.contains("customXml/item1.xml"));
    assert!(!archive.contains("customXml/itemProps1.xml"));
    assert!(!workbook_rels.contains("customXml"));
    assert!(!content_types.contains("/customXml/item"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn clean_legacy_web_extension_package_is_emitted_as_structured_opaque_subgraph() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        root_relationships: vec![domain_types::OpcRelationship {
            id: "rIdWeb".to_string(),
            rel_type: crate::domain::web_extensions::read::REL_WEB_EXTENSION_TASKPANES.to_string(),
            target: "/xl/webextensions/taskpanes.xml".to_string(),
            target_mode: None,
        }],
        web_extension_parts: vec![
            domain_types::BlobPart {
                path: "xl/webextensions/taskpanes.xml".to_string(),
                data: br#"<wetp:taskpanes xmlns:wetp="http://schemas.microsoft.com/office/webextensions/taskpanes/2010/11"><wetp:taskpane><wetp:webextensionref r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></wetp:taskpane></wetp:taskpanes>"#.to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/webextensions/_rels/taskpanes.xml.rels".to_string(),
                data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2011/relationships/webextension" Target="webextension1.xml"/></Relationships>"#.to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/webextensions/webextension1.xml".to_string(),
                data: br#"<we:webextension xmlns:we="http://schemas.microsoft.com/office/webextensions/webextension/2010/11"/>"#.to_vec(),
            },
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let root_rels = String::from_utf8(archive.read_file("_rels/.rels").unwrap()).unwrap();
    let taskpanes_rels = String::from_utf8(
        archive
            .read_file("xl/webextensions/_rels/taskpanes.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/webextensions/taskpanes.xml"));
    assert!(archive.contains("xl/webextensions/webextension1.xml"));
    assert!(root_rels.contains("webextensiontaskpanes"));
    assert!(root_rels.contains("Target=\"/xl/webextensions/taskpanes.xml\""));
    assert!(taskpanes_rels.contains("webextension1.xml"));
    assert!(content_types.contains("/xl/webextensions/taskpanes.xml"));
    assert!(content_types.contains("/xl/webextensions/webextension1.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn legacy_web_extension_with_unreachable_part_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        root_relationships: vec![domain_types::OpcRelationship {
            id: "rIdWeb".to_string(),
            rel_type: crate::domain::web_extensions::read::REL_WEB_EXTENSION_TASKPANES.to_string(),
            target: "/xl/webextensions/taskpanes.xml".to_string(),
            target_mode: None,
        }],
        web_extension_parts: vec![
            domain_types::BlobPart {
                path: "xl/webextensions/taskpanes.xml".to_string(),
                data: br#"<wetp:taskpanes xmlns:wetp="http://schemas.microsoft.com/office/webextensions/taskpanes/2010/11"><wetp:taskpane><wetp:webextensionref r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></wetp:taskpane></wetp:taskpanes>"#.to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/webextensions/_rels/taskpanes.xml.rels".to_string(),
                data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2011/relationships/webextension" Target="webextension1.xml"/></Relationships>"#.to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/webextensions/webextension1.xml".to_string(),
                data: br#"<we:webextension xmlns:we="http://schemas.microsoft.com/office/webextensions/webextension/2010/11"/>"#.to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/webextensions/staleUnreachable.xml".to_string(),
                data: br#"<we:webextension xmlns:we="http://schemas.microsoft.com/office/webextensions/webextension/2010/11"/>"#.to_vec(),
            },
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let root_rels = String::from_utf8(archive.read_file("_rels/.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/webextensions/taskpanes.xml"));
    assert!(!archive.contains("xl/webextensions/webextension1.xml"));
    assert!(!archive.contains("xl/webextensions/staleUnreachable.xml"));
    assert!(!root_rels.contains("webextensiontaskpanes"));
    assert!(!content_types.contains("/xl/webextensions/"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn legacy_web_extension_without_root_owner_relationship_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        web_extension_parts: vec![
            domain_types::BlobPart {
                path: "xl/webextensions/taskpanes.xml".to_string(),
                data: br#"<wetp:taskpanes xmlns:wetp="http://schemas.microsoft.com/office/webextensions/taskpanes/2010/11"><wetp:taskpane><wetp:webextensionref r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></wetp:taskpane></wetp:taskpanes>"#.to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/webextensions/_rels/taskpanes.xml.rels".to_string(),
                data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2011/relationships/webextension" Target="webextension1.xml"/></Relationships>"#.to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/webextensions/webextension1.xml".to_string(),
                data: br#"<we:webextension xmlns:we="http://schemas.microsoft.com/office/webextensions/webextension/2010/11"/>"#.to_vec(),
            },
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let root_rels = String::from_utf8(archive.read_file("_rels/.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/webextensions/taskpanes.xml"));
    assert!(!archive.contains("xl/webextensions/webextension1.xml"));
    assert!(!root_rels.contains("webextensiontaskpanes"));
    assert!(!content_types.contains("/xl/webextensions/"));
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
    let stale_blob = domain_types::BlobPart {
        path: "xl/media/stale.bin".to_string(),
        data: b"stale media".to_vec(),
    };
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext::default()],
        content_type_defaults: vec![("bin".to_string(), "application/octet-stream".to_string())],
        binary_blobs: vec![clean_orphan.clone(), stale_blob],
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

#[test]
fn legacy_untyped_binary_blob_is_not_emitted_by_blanket_passthrough() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        content_type_defaults: vec![("bin".to_string(), "application/octet-stream".to_string())],
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/media/stale.bin".to_string(),
            data: b"stale media".to_vec(),
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/media/stale.bin"));
    assert!(!content_types.contains("application/octet-stream"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn raw_metadata_xml_is_dropped_when_current_value_metadata_refs_are_unsupported() {
    let mut metadata_cell = make_cell(0, 0, DomainValue::Text(Arc::from("rich value")));
    metadata_cell.vm = Some(1);
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![metadata_cell],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        raw_metadata_xml: Some(
            br#"<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/metadata.xml"));
    assert!(!workbook_rels.contains(crate::write::relationships::REL_METADATA));
    assert!(!content_types.contains("/xl/metadata.xml"));
    assert!(!sheet_xml.contains(r#" vm="1""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
