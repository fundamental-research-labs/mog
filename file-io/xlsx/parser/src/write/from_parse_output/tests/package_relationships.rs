use super::*;

#[test]
fn stale_content_type_override_for_missing_part_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        content_type_defaults: vec![("missing".to_string(), "application/x-missing".to_string())],
        content_type_overrides: vec![(
            "/xl/missingModeledPart.xml".to_string(),
            crate::write::CT_WORKSHEET.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/missingModeledPart.xml"));
    assert!(!content_types.contains("missingModeledPart.xml"));
    assert!(!content_types.contains("Extension=\"missing\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_root_relationship_to_missing_part_is_not_exported_or_reserved() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        root_relationships: vec![domain_types::OpcRelationship {
            id: "rId1".to_string(),
            rel_type: "http://example.invalid/relationships/privateRootFeature".to_string(),
            target: "/xl/private/rootFeature.xml".to_string(),
            target_mode: None,
        }],
        content_type_overrides: vec![(
            "/xl/private/rootFeature.xml".to_string(),
            "application/vnd.example.private+xml".to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let root_rels_bytes = archive.read_file("_rels/.rels").unwrap();
    let root_rels_xml = String::from_utf8(root_rels_bytes.clone()).unwrap();
    let root_rels = crate::domain::workbook::read::parse_all_rels(&root_rels_bytes);
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/private/rootFeature.xml"));
    assert!(!root_rels_xml.contains("privateRootFeature"));
    assert!(!root_rels_xml.contains("/xl/private/rootFeature.xml"));
    assert!(!content_types.contains("/xl/private/rootFeature.xml"));
    assert_eq!(
        root_rels
            .iter()
            .filter(|rel| rel.id == "rId1" && rel.rel_type == crate::write::REL_OFFICE_DOCUMENT)
            .count(),
        1,
        "stale root relationship ID must not reserve rId1 away from the generated officeDocument relationship",
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_workbook_relationship_to_missing_modeled_part_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheet_workbook_r_ids: vec!["rId1".to_string()],
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId8".to_string(),
                rel_type: crate::write::REL_SHARED_STRINGS.to_string(),
                target: "sharedStrings.xml".to_string(),
                target_mode: None,
            },
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/sharedStrings.xml"));
    assert!(!workbook_rels.contains(crate::write::REL_SHARED_STRINGS));
    assert!(!workbook_rels.contains("Target=\"sharedStrings.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/sharedStrings.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_sheet_workbook_relationship_ids_do_not_reserve_ids_or_change_sheet_paths() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheet_workbook_r_ids: vec!["rId44".to_string()],
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rId44".to_string(),
            rel_type: crate::write::REL_WORKSHEET.to_string(),
            target: "worksheets/sheet44.xml".to_string(),
            target_mode: None,
        }],
        content_type_overrides: vec![(
            "/xl/worksheets/sheet44.xml".to_string(),
            crate::write::CT_WORKSHEET.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels_bytes = archive.read_file("xl/_rels/workbook.xml.rels").unwrap();
    let workbook_rels_xml = String::from_utf8(workbook_rels_bytes.clone()).unwrap();
    let workbook_rels = crate::domain::workbook::read::parse_all_rels(&workbook_rels_bytes);
    let worksheet_rel = workbook_rels
        .iter()
        .find(|rel| rel.rel_type == crate::write::REL_WORKSHEET)
        .expect("generated workbook relationships should include Sheet1");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/worksheets/sheet1.xml"));
    assert!(!archive.contains("xl/worksheets/sheet44.xml"));
    assert_eq!(worksheet_rel.target, "worksheets/sheet1.xml");
    assert_ne!(worksheet_rel.id, "rId44");
    assert!(!workbook_rels_xml.contains("worksheets/sheet44.xml"));
    assert!(!content_types.contains("/xl/worksheets/sheet44.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn unmanaged_original_workbook_relationship_is_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rId99".to_string(),
            rel_type: "http://example.invalid/relationships/privateFeature".to_string(),
            target: "private/privateFeature.xml".to_string(),
            target_mode: None,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();

    assert!(!workbook_rels.contains("privateFeature"));
    assert!(!archive.contains("xl/private/privateFeature.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn unmanaged_original_worksheet_relationship_is_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: "http://example.invalid/relationships/privateSheetFeature".to_string(),
                target: "../private/privateSheetFeature.xml".to_string(),
                target_mode: None,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");

    if archive.contains("xl/worksheets/_rels/sheet1.xml.rels") {
        let sheet_rels = String::from_utf8(
            archive
                .read_file("xl/worksheets/_rels/sheet1.xml.rels")
                .unwrap(),
        )
        .unwrap();
        assert!(!sheet_rels.contains("privateSheetFeature"));
    }
    assert!(!archive.contains("xl/private/privateSheetFeature.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
