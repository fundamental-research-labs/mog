use super::*;

fn archive_for_empty_modeled_workbook() -> crate::XlsxArchive<'static> {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let leaked = Box::leak(bytes.into_boxed_slice());
    crate::XlsxArchive::new(leaked).expect("exported XLSX should be readable")
}

#[test]
fn package_graph_ownership_matrix_covers_round_6_feature_plans() {
    use crate::write::package_ownership::{
        PackageFeatureOwner, modeled_feature_part_must_not_be_opaque, ownership_contract,
    };

    for owner in [
        PackageFeatureOwner::ConnectionsAndQueryTables,
        PackageFeatureOwner::OleObjects,
        PackageFeatureOwner::RichData,
        PackageFeatureOwner::PivotTables,
        PackageFeatureOwner::SlicersAndTimelines,
        PackageFeatureOwner::ChartAuxiliary,
        PackageFeatureOwner::ExternalLinks,
        PackageFeatureOwner::DocumentProperties,
    ] {
        let contract = ownership_contract(owner);
        assert!(!contract.parts.is_empty());
        assert!(!contract.relationships.is_empty());
        assert!(!contract.content_types.is_empty());
        assert!(!contract.relationship_id_hints.is_empty());
        assert!(!contract.dirty_invalidation_triggers.is_empty());
    }

    for modeled_part in [
        "xl/connections.xml",
        "xl/queryTables/queryTable1.xml",
        "xl/embeddings/oleObject1.bin",
        "xl/richData/rdrichvalue.xml",
        "xl/pivotTables/pivotTable1.xml",
        "xl/slicerCaches/slicerCache1.xml",
        "xl/charts/style1.xml",
        "xl/externalLinks/externalLink1.xml",
        "docProps/custom.xml",
    ] {
        assert!(modeled_feature_part_must_not_be_opaque(modeled_part));
    }
}

#[test]
fn modeled_feature_package_subgraphs_require_typed_owner_state() {
    let archive = archive_for_empty_modeled_workbook();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();

    for absent_part in [
        "xl/connections.xml",
        "xl/queryTables/queryTable1.xml",
        "xl/embeddings/oleObject1.bin",
        "xl/richData/rdrichvalue.xml",
        "xl/pivotTables/pivotTable1.xml",
        "xl/pivotCache/pivotCacheDefinition1.xml",
        "xl/pivotCache/pivotCacheRecords1.xml",
        "xl/slicers/slicer1.xml",
        "xl/slicerCaches/slicerCache1.xml",
        "xl/charts/style1.xml",
        "xl/externalLinks/externalLink1.xml",
        "docProps/core.xml",
        "docProps/app.xml",
        "docProps/custom.xml",
        "docMetadata/LabelInfo.xml",
    ] {
        assert!(
            !archive.contains(absent_part),
            "{absent_part} must require typed owner state"
        );
        assert!(
            !content_types.contains(absent_part),
            "{absent_part} content type must require typed owner state"
        );
    }

    for absent_relationship in [
        "relationships/connections",
        "relationships/externalLink",
        "relationships/pivotCacheDefinition",
        "relationships/slicerCache",
        "relationships/core-properties",
        "relationships/extended-properties",
        "relationships/custom-properties",
    ] {
        assert!(
            !workbook_rels.contains(absent_relationship),
            "{absent_relationship} must require typed owner state"
        );
    }

    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn rich_data_relationship_closure_registers_owned_media_parts() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![DomainCellData {
                row: 0,
                col: 0,
                value: DomainValue::Text(Arc::from("image")),
                vm: Some(1),
                ..Default::default()
            }],
            ..Default::default()
        }],
        metadata: Some(domain_types::WorkbookMetadata {
            rich_data: Some(domain_types::WorkbookRichData {
                parts: vec![domain_types::RichDataPart {
                    path: "xl/richData/richValueRel.xml".to_string(),
                    content_type: "application/vnd.ms-excel.rdrichvaluerel+xml".to_string(),
                    data: br#"<rvRel xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel"/>"#.to_vec(),
                    relationships: vec![ooxml_types::shared::OpcRelationship {
                        id: "rId1".to_string(),
                        rel_type: crate::infra::opc::REL_IMAGE.to_string(),
                        target: "../media/image1.png".to_string(),
                        target_mode: None,
                    }],
                }],
                related_parts: vec![domain_types::RichDataRelatedPart {
                    path: "xl/media/image1.png".to_string(),
                    content_type: Some("image/png".to_string()),
                    data: vec![0x89, b'P', b'N', b'G'],
                }],
            }),
            ..Default::default()
        }),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let rels = String::from_utf8(
        archive
            .read_file("xl/richData/_rels/richValueRel.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(archive.contains("xl/media/image1.png"));
    assert!(rels.contains(r#"Id="rId1""#));
    assert!(rels.contains(r#"Target="../media/image1.png""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn worksheet_relationship_bearing_raw_ext_lst_is_not_replayed_without_owner_state() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        worksheet_ext_lst_xml: Some(
            r#"<extLst><ext uri="{7E03D99C-DC04-49d9-9315-930204A7B6E9}" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><x15:timelineRefs><x15:timelineRef r:id="rId6"/></x15:timelineRefs></ext></extLst>"#
                .to_string(),
        ),
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!sheet_xml.contains("timelineRef"));
    assert!(!sheet_xml.contains("rId6"));
    assert!(!sheet_xml.contains("<extLst></extLst>"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn worksheet_ext_lst_keeps_safe_entries_when_dropping_relationship_entries() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        worksheet_ext_lst_xml: Some(
            r#"<extLst><ext uri="{safe}"><safe:payload xmlns:safe="urn:safe"/></ext><ext uri="{unsafe}" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><x15:timelineRefs><x15:timelineRef r:id="rId6"/></x15:timelineRefs></ext></extLst>"#
                .to_string(),
        ),
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("safe:payload"));
    assert!(!sheet_xml.contains("timelineRef"));
    assert!(!sheet_xml.contains("rId6"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
