use super::*;

#[test]
fn raw_doc_props_do_not_override_modeled_document_properties() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.properties = Some(DocumentProperties {
        title: Some("Modeled Title".to_string()),
        creator: Some("Modeled Creator".to_string()),
        custom: vec![("ReviewStatus".to_string(), "Modeled".to_string())],
        ..Default::default()
    });
    let ctx = domain_types::RoundTripContext {
        raw_doc_props_core_xml: Some(
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Stale Title</dc:title><dc:creator>Stale Creator</dc:creator></cp:coreProperties>"#
                .to_vec(),
        ),
        raw_doc_props_app_xml: Some(
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Excel</Application><Company>Stale Company</Company></Properties>"#
                .to_vec(),
        ),
        raw_doc_props_custom_xml: Some(
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="ReviewStatus"><vt:lpwstr>Stale</vt:lpwstr></property></Properties>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let core_xml = String::from_utf8(archive.read_file("docProps/core.xml").unwrap()).unwrap();
    let app_xml = String::from_utf8(archive.read_file("docProps/app.xml").unwrap()).unwrap();
    let custom_xml = String::from_utf8(archive.read_file("docProps/custom.xml").unwrap()).unwrap();

    assert!(core_xml.contains("Modeled Title"));
    assert!(core_xml.contains("Modeled Creator"));
    assert!(!core_xml.contains("Stale Title"));
    assert!(!app_xml.contains("Stale Company"));
    assert!(custom_xml.contains(r#"name="ReviewStatus""#));
    assert!(custom_xml.contains(">Modeled<"));
    assert!(!custom_xml.contains(">Stale<"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn typed_custom_doc_props_export_from_modeled_state_not_raw_strings() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.properties = Some(DocumentProperties {
        typed_custom: vec![
            DocumentCustomProperty {
                name: "Approved".to_string(),
                value: DocumentCustomPropertyValue::Bool(true),
            },
            DocumentCustomProperty {
                name: "Revision".to_string(),
                value: DocumentCustomPropertyValue::I4(7),
            },
            DocumentCustomProperty {
                name: "Confidence".to_string(),
                value: DocumentCustomPropertyValue::R8(0.875),
            },
            DocumentCustomProperty {
                name: "ReviewedAt".to_string(),
                value: DocumentCustomPropertyValue::Filetime("2026-05-27T10:00:00Z".to_string()),
            },
        ],
        ..Default::default()
    });
    let ctx = domain_types::RoundTripContext {
        raw_doc_props_custom_xml: Some(
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Approved"><vt:lpwstr>stale</vt:lpwstr></property></Properties>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let custom_xml = String::from_utf8(archive.read_file("docProps/custom.xml").unwrap()).unwrap();

    assert!(custom_xml.contains(r#"name="Approved"><vt:bool>true</vt:bool>"#));
    assert!(custom_xml.contains(r#"name="Revision"><vt:i4>7</vt:i4>"#));
    assert!(custom_xml.contains(r#"name="Confidence"><vt:r8>0.875</vt:r8>"#));
    assert!(
        custom_xml.contains(r#"name="ReviewedAt"><vt:filetime>2026-05-27T10:00:00Z</vt:filetime>"#)
    );
    assert!(!custom_xml.contains("<vt:lpwstr>true</vt:lpwstr>"));
    assert!(!custom_xml.contains(">stale<"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn raw_doc_props_are_dropped_when_document_properties_are_unmodeled() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        raw_doc_props_core_xml: Some(b"<cp:coreProperties/>".to_vec()),
        raw_doc_props_app_xml: Some(b"<Properties/>".to_vec()),
        raw_doc_props_custom_xml: Some(b"<Properties/>".to_vec()),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let root_rels = String::from_utf8(archive.read_file("_rels/.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("docProps/core.xml"));
    assert!(!archive.contains("docProps/app.xml"));
    assert!(!archive.contains("docProps/custom.xml"));
    assert!(!root_rels.contains("docProps/"));
    assert!(!content_types.contains("docProps/"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn workbook_views_are_exported_from_modeled_state() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.workbook_views = vec![WorkbookView {
        active_tab: 0,
        first_sheet: 0,
        tab_ratio: Some(700.0),
        window_width: Some(12345),
        ..Default::default()
    }];
    let ctx = domain_types::RoundTripContext::default();

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert!(workbook_xml.contains(r#"tabRatio="700""#));
    assert!(workbook_xml.contains(r#"windowWidth="12345""#));
    assert!(!workbook_xml.contains(r#"tabRatio="300""#));
    assert!(!workbook_xml.contains(r#"windowWidth="999""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn workbook_metadata_is_exported_from_modeled_state_not_preserved_xml() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.file_version = Some(FileVersion {
        app_name: Some("xl".to_string()),
        last_edited: Some("7".to_string()),
        lowest_edited: Some("7".to_string()),
        rup_build: Some("28130".to_string()),
        code_name: Some("ModeledVersion".to_string()),
    });
    output.file_sharing = Some(FileSharing {
        read_only_recommended: true,
        user_name: Some("Modeled User".to_string()),
        reservation_password: Some("ABCD".to_string()),
        ..Default::default()
    });
    output.workbook_properties = Some(WorkbookProperties {
        date1904: true,
        code_name: Some("ModeledCode".to_string()),
        default_theme_version: Some(166925),
        ..Default::default()
    });
    let ctx = domain_types::RoundTripContext {
        workbook_preserved_elements: vec![
            (
                "workbook\0first\0\0fileVersion".to_string(),
                r#"<fileVersion appName="StaleApp" codeName="StaleVersion"/>"#.to_string(),
            ),
            (
                "workbook\0after\0fileVersion\0fileSharing".to_string(),
                r#"<fileSharing readOnlyRecommended="0" userName="Stale User"/>"#.to_string(),
            ),
            (
                "workbook\0after\0fileVersion\0workbookPr".to_string(),
                r#"<workbookPr codeName="StaleCode" defaultThemeVersion="1"/>"#.to_string(),
            ),
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert!(workbook_xml.contains(r#"<fileVersion appName="xl" lastEdited="7""#));
    assert!(workbook_xml.contains(r#"codeName="ModeledVersion""#));
    assert!(workbook_xml.contains(r#"<fileSharing readOnlyRecommended="1""#));
    assert!(workbook_xml.contains(r#"userName="Modeled User""#));
    assert!(workbook_xml.contains(r#"<workbookPr date1904="1""#));
    assert!(workbook_xml.contains(r#"codeName="ModeledCode""#));
    assert!(workbook_xml.contains(r#"defaultThemeVersion="166925""#));
    assert!(!workbook_xml.contains("StaleApp"));
    assert!(!workbook_xml.contains("StaleVersion"));
    assert!(!workbook_xml.contains("Stale User"));
    assert!(!workbook_xml.contains("StaleCode"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_workbook_preserved_known_children_are_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        workbook_preserved_elements: vec![
            (
                "workbook\0after\0workbookPr\0bookViews".to_string(),
                r#"<bookViews><workbookView activeTab="9" windowWidth="999"/></bookViews>"#
                    .to_string(),
            ),
            (
                "workbook\0after\0sheets\0workbookProtection".to_string(),
                r#"<workbookProtection lockStructure="1"/>"#.to_string(),
            ),
            (
                "workbook\0after\0workbookProtection\0definedNames".to_string(),
                r#"<definedNames><definedName name="StaleName">Sheet1!$A$1</definedName></definedNames>"#
                    .to_string(),
            ),
            (
                "workbook\0after\0definedNames\0calcPr".to_string(),
                r#"<calcPr calcId="999999"/>"#.to_string(),
            ),
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert!(!workbook_xml.contains("activeTab=\"9\""));
    assert!(!workbook_xml.contains("windowWidth=\"999\""));
    assert!(!workbook_xml.contains("<workbookProtection"));
    assert!(!workbook_xml.contains("StaleName"));
    assert!(!workbook_xml.contains("999999"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn workbook_preserved_unknown_wrapper_with_modeled_children_is_not_replayed() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.named_ranges = vec![NamedRange {
        name: "ModeledName".to_string(),
        refers_to: "Sheet1!$A$1".to_string(),
        ..Default::default()
    }];
    output.calculation = domain_types::CalculationProperties {
        calc_mode: domain_types::CalcMode::Manual,
        calc_id: Some(191029),
        ..Default::default()
    };
    let ctx = domain_types::RoundTripContext {
        workbook_preserved_elements: vec![(
            "workbook\0after\0workbookPr\0vendorState".to_string(),
            r#"<vendorState><definedNames><definedName name="StaleName">Sheet1!$Z$99</definedName></definedNames><calcPr calcId="999999" calcMode="auto"/></vendorState>"#
                .to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert!(!workbook_xml.contains("vendorState"));
    assert!(!workbook_xml.contains("StaleName"));
    assert!(!workbook_xml.contains("999999"));
    assert_eq!(workbook_xml.matches("<definedName ").count(), 1);
    assert!(workbook_xml.contains(r#"name="ModeledName""#));
    assert!(workbook_xml.contains(r#"<calcPr calcId="191029""#));
    assert!(workbook_xml.contains(r#"calcMode="manual""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_sheet_drawing_relationship_without_modeled_or_opaque_drawing_is_ignored() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: REL_DRAWING.to_string(),
                target: "../drawings/drawing1.xml".to_string(),
                target_mode: None,
            }],
            original_drawing_path: Some("xl/drawings/drawing1.xml".to_string()),
            drawing_anchor_passthroughs: vec![(
                0,
                r#"<xdr:twoCellAnchor><xdr:graphicFrame><a:graphic><a:graphicData><cx:chart r:id="rId99"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor>"#
                    .to_string(),
            )],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!archive.contains("xl/drawings/drawing1.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn external_link_workbook_relationship_uses_graph_resolved_id() {
    let modeled_link = domain_types::domain::external_link::ExternalLink {
        id: "1".to_string(),
        imported_identity: Some(
            domain_types::domain::external_link::ImportedExternalLinkIdentity {
                excel_ordinal: 1,
                workbook_rel_id: "rId20".to_string(),
                part_name: "externalLinks/externalLink9.xml".to_string(),
                external_book_rid: None,
                target: Some("externalLinks/externalLink9.xml".to_string()),
                target_mode: None,
            },
        ),
        ..Default::default()
    };
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.external_links = vec![modeled_link];
    let ctx = domain_types::RoundTripContext::default();

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(workbook_xml.contains(r#"<externalReference r:id="rId20"/>"#));
    assert!(workbook_rels.contains(r#"Id="rId20""#));
    assert!(workbook_rels.contains(r#"Target="externalLinks/externalLink9.xml""#));
    assert!(content_types.contains(r#"PartName="/xl/externalLinks/externalLink9.xml""#));
    assert!(archive.contains("xl/externalLinks/externalLink9.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn external_link_owned_relationships_use_graph_resolved_ids() {
    let modeled_link = domain_types::domain::external_link::ExternalLink {
        id: "1".to_string(),
        file_path: Some("file:///workbook.xlsx".to_string()),
        file_path_rid: Some("rId1".to_string()),
        alternate_url: Some("https://example.com/workbook.xlsx".to_string()),
        alternate_url_rid: Some("rId1".to_string()),
        imported_identity: Some(
            domain_types::domain::external_link::ImportedExternalLinkIdentity {
                excel_ordinal: 1,
                workbook_rel_id: "rId20".to_string(),
                part_name: "externalLinks/externalLink9.xml".to_string(),
                external_book_rid: Some("rId1".to_string()),
                target: Some("externalLinks/externalLink9.xml".to_string()),
                target_mode: None,
            },
        ),
        ..Default::default()
    };
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.external_links = vec![modeled_link];

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let link_xml = String::from_utf8(
        archive
            .read_file("xl/externalLinks/externalLink9.xml")
            .unwrap(),
    )
    .unwrap();
    let link_rels = String::from_utf8(
        archive
            .read_file("xl/externalLinks/_rels/externalLink9.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(link_xml.contains(r#"<externalBook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1">"#));
    assert!(link_xml.contains(r#"<xxl21:absoluteUrl r:id="rId2"/>"#));
    assert!(link_rels.contains(r#"Id="rId1""#));
    assert!(link_rels.contains(r#"Target="file:///workbook.xlsx""#));
    assert!(link_rels.contains(r#"Id="rId2""#));
    assert!(link_rels.contains(r#"Target="https://example.com/workbook.xlsx""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn external_link_defined_names_export_from_modeled_state_not_roundtrip_context() {
    let identity = domain_types::domain::external_link::ImportedExternalLinkIdentity {
        excel_ordinal: 1,
        workbook_rel_id: "rId20".to_string(),
        part_name: "externalLinks/externalLink9.xml".to_string(),
        external_book_rid: Some("rId1".to_string()),
        target: Some("externalLinks/externalLink9.xml".to_string()),
        target_mode: None,
    };
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.external_links = vec![domain_types::domain::external_link::ExternalLink {
        id: "1".to_string(),
        file_path: Some("file:///modeled.xlsx".to_string()),
        file_path_rid: Some("rId1".to_string()),
        defined_names: vec![
            domain_types::domain::external_link::ExternalDefinedName::with_details(
                "ModeledExternalName".to_string(),
                Some("'[1]Sheet1'!$A$1".to_string()),
                Some(0),
            ),
        ],
        imported_identity: Some(identity.clone()),
        ..Default::default()
    }];
    let ctx = domain_types::RoundTripContext::default();

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let link_xml = String::from_utf8(
        archive
            .read_file("xl/externalLinks/externalLink9.xml")
            .unwrap(),
    )
    .unwrap();
    let link_rels = String::from_utf8(
        archive
            .read_file("xl/externalLinks/_rels/externalLink9.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(link_xml.contains(r#"name="ModeledExternalName""#));
    assert!(link_xml.contains(r#"refersTo="&apos;[1]Sheet1&apos;!$A$1""#));
    assert!(link_xml.contains(r#"sheetId="0""#));
    assert!(link_rels.contains(r#"Target="file:///modeled.xlsx""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn absent_modeled_external_links_do_not_export_external_link_parts() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext::default();

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!workbook_xml.contains("<externalReferences"));
    assert!(!workbook_rels.contains(crate::write::relationships::REL_EXTERNAL_LINK));
    assert!(!content_types.contains("/xl/externalLinks/"));
    assert!(!archive.contains("xl/externalLinks/externalLink9.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn raw_workbook_external_references_do_not_override_modeled_external_links() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.external_links = vec![domain_types::domain::external_link::ExternalLink {
        id: "1".to_string(),
        imported_identity: Some(
            domain_types::domain::external_link::ImportedExternalLinkIdentity {
                excel_ordinal: 1,
                workbook_rel_id: "rId20".to_string(),
                part_name: "externalLinks/externalLink9.xml".to_string(),
                external_book_rid: None,
                target: Some("externalLinks/externalLink9.xml".to_string()),
                target_mode: None,
            },
        ),
        ..Default::default()
    }];
    let ctx = domain_types::RoundTripContext {
        workbook_preserved_elements: vec![(
            "workbook\0after\0workbookProtection\0externalReferences".to_string(),
            r#"<externalReferences><externalReference r:id="rIdStale"/></externalReferences>"#
                .to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert_eq!(workbook_xml.matches("<externalReferences>").count(), 1);
    assert!(workbook_xml.contains(r#"<externalReference r:id="rId20"/>"#));
    assert!(!workbook_xml.contains("rIdStale"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn unknown_preserved_workbook_xml_with_raw_relationship_id_is_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        workbook_preserved_elements: vec![(
            "workbook\0after\0workbookPr\0vendorState".to_string(),
            r#"<vendor:state r:id = "rIdStale"/>"#.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert!(!workbook_xml.contains("vendor:state"));
    assert!(!workbook_xml.contains("rIdStale"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn unknown_preserved_workbook_xml_with_prefixed_relationship_id_is_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        workbook_preserved_elements: vec![(
            "workbook\0after\0workbookPr\0vendorState".to_string(),
            r#"<vendor:state rel:id = "rIdStale"/>"#.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert!(!workbook_xml.contains("vendor:state"));
    assert!(!workbook_xml.contains("rIdStale"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn unknown_preserved_workbook_xml_with_nonstandard_prefixed_relationship_id_is_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        workbook_preserved_elements: vec![(
            "workbook\0after\0workbookPr\0vendorState".to_string(),
            r#"<vendor:state rel:id = "customRelationship"/>"#.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert!(!workbook_xml.contains("vendor:state"));
    assert!(!workbook_xml.contains("customRelationship"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn external_link_imported_identity_cannot_move_part_outside_external_links_cluster() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.external_links = vec![domain_types::domain::external_link::ExternalLink {
        id: "1".to_string(),
        imported_identity: Some(
            domain_types::domain::external_link::ImportedExternalLinkIdentity {
                excel_ordinal: 1,
                workbook_rel_id: "rId20".to_string(),
                part_name: "docProps/custom.xml".to_string(),
                external_book_rid: None,
                target: Some("docProps/custom.xml".to_string()),
                target_mode: None,
            },
        ),
        ..Default::default()
    }];

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/externalLinks/externalLink1.xml"));
    assert!(!archive.contains("xl/docProps/custom.xml"));
    assert!(workbook_xml.contains("<externalReference"));
    assert!(workbook_rels.contains(r#"Target="externalLinks/externalLink1.xml""#));
    assert!(!workbook_rels.contains("docProps/custom.xml"));
    assert!(content_types.contains(r#"PartName="/xl/externalLinks/externalLink1.xml""#));
    assert!(!content_types.contains(r#"PartName="/xl/docProps/custom.xml""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn external_link_owned_relationships_drop_unsupported_imported_relationship_types() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.external_links = vec![domain_types::domain::external_link::ExternalLink {
        id: "1".to_string(),
        file_path: Some("file:///workbook.xlsx".to_string()),
        file_path_rid: Some("rId1".to_string()),
        file_path_rel_type: Some("http://example.invalid/relationships/private".to_string()),
        extra_rels: vec![domain_types::domain::external_link::ExternalLinkExtraRel {
            id: "rId99".to_string(),
            target: "https://example.invalid/private".to_string(),
            rel_type: "http://example.invalid/relationships/private".to_string(),
        }],
        ..Default::default()
    }];

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let link_rels = String::from_utf8(
        archive
            .read_file("xl/externalLinks/_rels/externalLink1.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(link_rels.contains(crate::domain::external::write::REL_EXTERNAL_LINK_PATH));
    assert!(link_rels.contains(r#"Target="file:///workbook.xlsx""#));
    assert!(!link_rels.contains("example.invalid/relationships/private"));
    assert!(!link_rels.contains("https://example.invalid/private"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn persons_are_exported_from_modeled_state_not_raw_person_xml() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.persons = vec![PersonInfo {
        id: "{MODELED-PERSON}".to_string(),
        display_name: "Modeled Person".to_string(),
        user_id: Some("S::modeled@example.com::1".to_string()),
        provider_id: Some("AD".to_string()),
    }];
    let ctx = domain_types::RoundTripContext {
        raw_persons_xml: Some(
            br#"<personList xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"><person displayName="Stale Person" id="{STALE-PERSON}" userId="stale"/></personList>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let persons_xml =
        String::from_utf8(archive.read_file("xl/persons/person.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(persons_xml.contains("Modeled Person"));
    assert!(persons_xml.contains("{MODELED-PERSON}"));
    assert!(!persons_xml.contains("Stale Person"));
    assert!(!persons_xml.contains("{STALE-PERSON}"));
    assert!(workbook_rels.contains("persons/person.xml"));
    assert!(content_types.contains(r#"PartName="/xl/persons/person.xml""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn modeled_persons_reuse_imported_workbook_relationship_identity() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.persons = vec![PersonInfo {
        id: "{MODELED-PERSON}".to_string(),
        display_name: "Modeled Person".to_string(),
        user_id: Some("S::modeled@example.com::1".to_string()),
        provider_id: Some("AD".to_string()),
    }];
    let ctx = domain_types::RoundTripContext {
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rIdPersons".to_string(),
            rel_type: crate::write::REL_PERSON.to_string(),
            target: "persons/person.xml".to_string(),
            target_mode: None,
        }],
        raw_persons_xml: Some(
            br#"<personList xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"><person displayName="Stale Person" id="{STALE-PERSON}" userId="stale"/></personList>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let persons_xml =
        String::from_utf8(archive.read_file("xl/persons/person.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(workbook_rels.contains(r#"Id="rIdPersons""#));
    assert!(workbook_rels.contains(crate::write::REL_PERSON));
    assert!(workbook_rels.contains(r#"Target="persons/person.xml""#));
    assert!(persons_xml.contains("Modeled Person"));
    assert!(persons_xml.contains("{MODELED-PERSON}"));
    assert!(!persons_xml.contains("Stale Person"));
    assert!(!persons_xml.contains("{STALE-PERSON}"));
    assert!(content_types.contains(r#"PartName="/xl/persons/person.xml""#));
    assert!(content_types.contains("application/vnd.ms-excel.person+xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_raw_person_xml_is_dropped_without_modeled_persons() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        raw_persons_xml: Some(
            br#"<personList xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"><person displayName="Stale Person" id="{STALE-PERSON}"/></personList>"#
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

    assert!(!archive.contains("xl/persons/person.xml"));
    assert!(!workbook_rels.contains("persons/person.xml"));
    assert!(!content_types.contains("/xl/persons/person.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_doc_metadata_label_info_is_not_emitted_as_raw_sidecar() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        doc_metadata_label_info: Some(
            br#"<clbl:labelList xmlns:clbl="http://schemas.microsoft.com/office/2020/mipLabelMetadata"><clbl:label id="stale"/></clbl:labelList>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("docMetadata/LabelInfo.xml"));
    assert!(!content_types.contains("/docMetadata/LabelInfo.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn deprecated_named_range_roundtrip_fields_do_not_resurrect_deleted_names() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.named_ranges = vec![NamedRange {
        name: "ModeledName".to_string(),
        refers_to: "Sheet1!$A$1".to_string(),
        local_sheet_id: Some(0),
        hidden: true,
        function: true,
        xlm: true,
        ..Default::default()
    }];
    let ctx = domain_types::RoundTripContext {
        skipped_named_ranges: vec![NamedRange {
            name: "DeletedSkippedName".to_string(),
            refers_to: "Sheet1!$Z$99".to_string(),
            hidden: true,
            ..Default::default()
        }],
        original_named_ranges_order: vec![
            NamedRange {
                name: "DeletedOriginalName".to_string(),
                refers_to: "Sheet1!$Y$99".to_string(),
                ..Default::default()
            },
            NamedRange {
                name: "ModeledName".to_string(),
                refers_to: "Sheet1!$A$1".to_string(),
                ..Default::default()
            },
        ],
        workbook_preserved_elements: vec![(
            "workbook\0after\0workbookProtection\0definedNames".to_string(),
            r#"<definedNames><definedName name="DeletedPreservedName">Sheet1!$X$99</definedName></definedNames>"#
                .to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert_eq!(workbook_xml.matches("<definedName ").count(), 1);
    assert!(workbook_xml.contains(r#"name="ModeledName""#));
    assert!(workbook_xml.contains(r#"localSheetId="0""#));
    assert!(workbook_xml.contains(r#"hidden="1""#));
    assert!(workbook_xml.contains(r#"function="1""#));
    assert!(workbook_xml.contains(r#"xlm="1""#));
    assert!(!workbook_xml.contains("DeletedSkippedName"));
    assert!(!workbook_xml.contains("DeletedOriginalName"));
    assert!(!workbook_xml.contains("DeletedPreservedName"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_raw_metadata_xml_is_dropped_without_current_cell_metadata_references() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(
            0,
            0,
            DomainValue::Text(Arc::from("ordinary cell")),
        )],
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

#[test]
fn raw_metadata_xml_is_not_replayed_for_current_cell_metadata_references() {
    let mut metadata_cell = make_cell(0, 0, DomainValue::Text(Arc::from("dynamic")));
    metadata_cell.cm = true;
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
    assert!(!sheet_xml.contains(r#" cm="1""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn modeled_xlsx_metadata_is_exported_without_raw_metadata_replay() {
    let mut metadata_cell = make_cell(0, 0, DomainValue::Text(Arc::from("dynamic")));
    metadata_cell.cm = true;
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![metadata_cell],
        ..Default::default()
    }]);
    output.metadata = Some(domain_types::WorkbookMetadata {
        metadata_types: vec![domain_types::MetadataType {
            name: "XLDAPR".to_string(),
            min_supported_version: 120000,
            copy: true,
            paste_all: true,
            paste_values: true,
            merge: true,
            split_first: true,
            row_col_shift: true,
            clear_formats: true,
            clear_comments: true,
            assign: true,
            coerce: true,
            cell_meta: true,
        }],
        future_metadata: vec![domain_types::FutureMetadataGroup {
            name: "XLDAPR".to_string(),
            blocks: vec![domain_types::FutureMetadataBlock {
                raw_xml: r#"<xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/>"#.to_string(),
            }],
        }],
        cell_metadata: vec![domain_types::CellMetadataBlock {
            records: vec![domain_types::CellMetadataRecord { t: 1, v: 0 }],
        }],
    });
    let ctx = domain_types::RoundTripContext {
        raw_metadata_xml: Some(
            br#"<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><metadataTypes count="1"><metadataType name="STALE" cellMeta="1"/></metadataTypes></metadata>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let metadata_xml = String::from_utf8(archive.read_file("xl/metadata.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(metadata_xml.contains(r#"name="XLDAPR""#));
    assert!(metadata_xml.contains(r#"<xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/>"#));
    assert!(metadata_xml.contains(r#"<rc t="1" v="0"/>"#));
    assert!(!metadata_xml.contains("STALE"));
    assert!(workbook_rels.contains(crate::write::relationships::REL_METADATA));
    assert!(content_types.contains("/xl/metadata.xml"));
    assert!(sheet_xml.contains(r#" cm="1""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn x14_worksheet_ext_lst_is_preserved_without_modeled_standard_owner() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(
            0,
            0,
            DomainValue::Number(FiniteF64::new(42.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            ext_lst_xml: Some(
                r#"<extLst><ext uri="{CCE6A557-97BC-4B89-ADB6-D9C93CAAB3DF}"><x14:dataValidations count="1"><x14:dataValidation type="whole"><xm:sqref>A1:A1</xm:sqref></x14:dataValidation></x14:dataValidations></ext><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}"><x14:conditionalFormattings count="1"><x14:conditionalFormatting><xm:sqref>B1:B1</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext></extLst>"#
                    .to_string(),
            ),
            preserved_namespace_attrs: vec![
                (
                    "x14".to_string(),
                    "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main".to_string(),
                ),
                (
                    "xm".to_string(),
                    "http://schemas.microsoft.com/office/excel/2006/main".to_string(),
                ),
            ],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"<c r="A1"><v>42</v></c>"#));
    assert!(sheet_xml
        .contains(r#"xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main""#));
    assert!(sheet_xml.contains(r#"xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main""#));
    assert!(sheet_xml.contains("<x14:dataValidations"));
    assert!(sheet_xml.contains("<x14:conditionalFormattings"));
    assert!(sheet_xml.contains("<xm:sqref>A1:A1</xm:sqref>"));
    assert!(sheet_xml.contains("<xm:sqref>B1:B1</xm:sqref>"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn relationship_bearing_x14_worksheet_ext_lst_is_dropped() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(
            0,
            0,
            DomainValue::Number(FiniteF64::new(7.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            ext_lst_xml: Some(
                r#"<extLst><ext uri="{CCE6A557-97BC-4B89-ADB6-D9C93CAAB3DF}"><x14:dataValidations count="1" r:id="rIdStale"/></ext></extLst>"#
                    .to_string(),
            ),
            preserved_namespace_attrs: vec![(
                "x14".to_string(),
                "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main".to_string(),
            )],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"<c r="A1"><v>7</v></c>"#));
    assert!(!sheet_xml.contains("<extLst"));
    assert!(!sheet_xml.contains("rIdStale"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_sheet_preserved_known_children_are_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_preserved_elements: vec![
                (
                    "worksheet\0after\0sheetData\0sheetProtection".to_string(),
                    r#"<sheetProtection sheet="1" password="STALE"/>"#.to_string(),
                ),
                (
                    "worksheet\0after\0sheetData\0autoFilter".to_string(),
                    r#"<autoFilter ref="A1:Z99"/>"#.to_string(),
                ),
                (
                    "worksheet\0after\0mergeCells\0dataValidations".to_string(),
                    r#"<dataValidations count="1"><dataValidation sqref="A1"/></dataValidations>"#
                        .to_string(),
                ),
            ],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!sheet_xml.contains("<sheetProtection"));
    assert!(!sheet_xml.contains("<autoFilter"));
    assert!(!sheet_xml.contains("<dataValidations"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn unknown_raw_worksheet_ext_lst_is_preserved_without_modeled_owner() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            ext_lst_xml: Some(r#"<extLst><ext uri="{vendor-extension}"/></extLst>"#.to_string()),
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"<extLst><ext uri="{vendor-extension}"/></extLst>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_row_roundtrip_hints_do_not_create_deleted_rows() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            row_spans: [(9, "1:99".to_string())].into_iter().collect(),
            row_thick_bot: vec![9],
            row_thick_top: vec![9],
            row_collapsed: [(9, true)].into_iter().collect(),
            row_hidden_explicit_false: vec![9],
            row_outline_level_zero: vec![9],
            bare_empty_rows: vec![9],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!sheet_xml.contains(r#"<row r="10""#));
    assert!(!sheet_xml.contains("spans=\"1:99\""));
    assert!(!sheet_xml.contains("thickBot"));
    assert!(!sheet_xml.contains("thickTop"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn row_roundtrip_hints_decorate_current_modeled_rows() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(
            0,
            0,
            DomainValue::Number(FiniteF64::new(1.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            row_spans: [(0, "1:1".to_string())].into_iter().collect(),
            row_thick_bot: vec![0],
            row_thick_top: vec![0],
            row_collapsed: [(0, false)].into_iter().collect(),
            row_hidden_explicit_false: vec![0],
            row_outline_level_zero: vec![0],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    let row_xml = sheet_xml
        .split("<row ")
        .find(|row| row.contains(r#"r="1""#))
        .expect("modeled row should be emitted");
    assert!(row_xml.contains(r#"spans="1:1""#));
    assert!(row_xml.contains(r#"hidden="0""#));
    assert!(row_xml.contains(r#"outlineLevel="0""#));
    assert!(row_xml.contains(r#"collapsed="0""#));
    assert!(row_xml.contains(r#"thickTop="1""#));
    assert!(row_xml.contains(r#"thickBot="1""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
