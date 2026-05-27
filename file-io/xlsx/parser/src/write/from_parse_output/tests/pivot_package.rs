use super::*;
use crate::write::REL_PIVOT_CACHE;

#[test]
fn pivot_package_generation_filters_stale_original_parts_and_rels() {
    let output = pivot_package_output(vec![make_pivot_config(
        "pivot-1",
        "PivotTable1",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    let mut ctx = domain_types::RoundTripContext {
        sheets: vec![
            domain_types::SheetRoundTripContext::default(),
            domain_types::SheetRoundTripContext::default(),
        ],
        content_type_overrides: vec![
            (
                "/xl/pivotTables/pivotTable7.xml".to_string(),
                CT_PIVOT_TABLE.to_string(),
            ),
            (
                "/xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                CT_PIVOT_CACHE.to_string(),
            ),
            (
                "/xl/pivotCache/pivotCacheRecords7.xml".to_string(),
                CT_PIVOT_CACHE_RECORDS.to_string(),
            ),
        ],
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId2".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet2.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: REL_PIVOT_CACHE.to_string(),
                target: "pivotCache/pivotCacheDefinition7.xml".to_string(),
                target_mode: None,
            },
        ],
        sheet_workbook_r_ids: vec!["rId1".to_string(), "rId2".to_string()],
        binary_blobs: vec![
            domain_types::BlobPart {
                path: "xl/pivotTables/pivotTable7.xml".to_string(),
                data: b"stale pivot table".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                data: b"stale cache".to_vec(),
            },
        ],
        ..Default::default()
    };
    ctx.sheets[1].sheet_opc_rels = vec![
        domain_types::OpcRelationship {
            id: "rId1".to_string(),
            rel_type: REL_HYPERLINK.to_string(),
            target: "https://example.com".to_string(),
            target_mode: Some("External".to_string()),
        },
        domain_types::OpcRelationship {
            id: "rId7".to_string(),
            rel_type: REL_PIVOT_TABLE.to_string(),
            target: "../pivotTables/pivotTable7.xml".to_string(),
            target_mode: None,
        },
    ];
    ctx.sheets[1].sheet_preserved_elements = vec![(
        "worksheet\0after\0sheetData\0pivotTableDefinition".to_string(),
        r#"<pivotTableDefinition r:id="rId7"/>"#.to_string(),
    )];

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet2.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet2.xml").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(workbook_xml.contains("<pivotCaches>"));
    assert!(workbook_xml.contains("cacheId=\"11\""));
    assert!(workbook_rels.contains("pivotCache/pivotCacheDefinition1.xml"));
    assert!(!workbook_rels.contains("pivotCacheDefinition7.xml"));
    assert!(sheet_rels.contains("../pivotTables/pivotTable1.xml"));
    assert!(!sheet_rels.contains("../pivotTables/pivotTable7.xml"));
    let pivot_r_id = sheet_rels
        .split("<Relationship ")
        .find(|rel| rel.contains("../pivotTables/pivotTable1.xml"))
        .and_then(|rel| rel.split("Id=\"").nth(1))
        .and_then(|rel| rel.split('"').next())
        .expect("generated pivot relationship should have an r:id");
    assert!(sheet_xml.contains(&format!("<pivotTableDefinition r:id=\"{pivot_r_id}\"/>")));
    assert!(content_types.contains("PartName=\"/xl/pivotTables/pivotTable1.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheDefinition1.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheRecords1.xml\""));
    assert!(!content_types.contains("pivotTable7.xml"));
    assert!(!archive.contains("xl/pivotTables/pivotTable7.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheDefinition7.xml"));
    assert!(archive.contains("xl/pivotTables/pivotTable1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheRecords1.xml"));
}

#[test]
fn workbook_pivot_caches_are_not_replayed_twice() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext::default()],
        workbook_preserved_elements: vec![(
            "workbook\0after\0calcPr\0pivotCaches".to_string(),
            r#"<pivotCaches><pivotCache cacheId="999" r:id="rIdOld"/></pivotCaches>"#.to_string(),
        )],
        pivot_package: domain_types::PivotPackageRoundTrip {
            workbook_cache_entries: vec![domain_types::PivotWorkbookCacheEntry {
                cache_id: 77,
                relationship_id: "rId99".to_string(),
                relationship_target: "pivotCache/pivotCacheDefinition7.xml".to_string(),
                definition_path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                order: 0,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            cache_definitions: vec![domain_types::PivotCacheDefinitionPackage {
                cache_id: 77,
                definition_path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                definition_rels_path: None,
                source_kind: domain_types::PivotCacheSourceKind::Worksheet,
                raw_definition_xml: br#"<pivotCacheDefinition cacheId="77"/>"#.to_vec(),
                raw_relationships: Vec::new(),
                records_relationship_id: None,
                records_relationship_target: None,
                records_path: None,
                raw_records_xml: None,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            content_type_overrides: vec![domain_types::PivotPackageContentType {
                part_name: "/xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                content_type: CT_PIVOT_CACHE.to_string(),
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            ..Default::default()
        },
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
            data: br#"<pivotCacheDefinition cacheId="77"/>"#.to_vec(),
        }],
        opaque_package_subgraphs: vec![domain_types::OpaquePackageSubgraph {
            owner: domain_types::OpaquePackageOwner::Workbook,
            owner_relationship: domain_types::OpaquePackageRelationship {
                owner: domain_types::OpaquePackageOwner::Workbook,
                relationship_type:
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"
                        .to_string(),
                target: domain_types::OpaqueRelationshipTarget::InternalPart {
                    path: "customXml/dirty.xml".to_string(),
                },
                relationship_id_hint: Some("rIdDirty".to_string()),
            },
            parts: Vec::new(),
            relationships: Vec::new(),
            ownership: domain_types::OpaquePackageOwnership::DirtyImported,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert_eq!(workbook_xml.matches("<pivotCaches>").count(), 1);
    assert!(workbook_xml.contains("cacheId=\"77\" r:id=\"rId99\""));
    assert!(!workbook_xml.contains("cacheId=\"999\""));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition7.xml"));
}

#[test]
fn pivot_package_preserves_orphan_workbook_cache_relationships_for_clean_parts() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext::default()],
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId40".to_string(),
                rel_type: REL_PIVOT_CACHE.to_string(),
                target: "pivotCache/pivotCacheDefinition5.xml".to_string(),
                target_mode: None,
            },
        ],
        sheet_workbook_r_ids: vec!["rId1".to_string()],
        pivot_package: domain_types::PivotPackageRoundTrip {
            workbook_cache_entries: vec![domain_types::PivotWorkbookCacheEntry {
                cache_id: 999,
                relationship_id: "rId40".to_string(),
                relationship_target: "pivotCache/pivotCacheDefinition5.xml".to_string(),
                definition_path: "xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
                order: 0,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            cache_definitions: vec![domain_types::PivotCacheDefinitionPackage {
                cache_id: 999,
                definition_path: "xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
                definition_rels_path: None,
                source_kind: domain_types::PivotCacheSourceKind::Worksheet,
                raw_definition_xml: br#"<pivotCacheDefinition cacheId="999"/>"#.to_vec(),
                raw_relationships: Vec::new(),
                records_relationship_id: None,
                records_relationship_target: None,
                records_path: None,
                raw_records_xml: None,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            content_type_overrides: vec![domain_types::PivotPackageContentType {
                part_name: "/xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
                content_type: CT_PIVOT_CACHE.to_string(),
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            ..Default::default()
        },
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
            data: br#"<pivotCacheDefinition cacheId="999"/>"#.to_vec(),
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();

    assert!(workbook_rels.contains("Id=\"rId40\""));
    assert!(workbook_rels.contains("pivotCache/pivotCacheDefinition5.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition5.xml"));
}

#[test]
fn pivot_cache_relationship_requires_typed_pivot_package_entry() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext::default()],
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rId40".to_string(),
            rel_type: REL_PIVOT_CACHE.to_string(),
            target: "pivotCache/pivotCacheDefinition5.xml".to_string(),
            target_mode: None,
        }],
        pivot_package: domain_types::PivotPackageRoundTrip {
            cache_definitions: vec![domain_types::PivotCacheDefinitionPackage {
                cache_id: 999,
                definition_path: "xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
                definition_rels_path: None,
                source_kind: domain_types::PivotCacheSourceKind::Worksheet,
                raw_definition_xml: br#"<pivotCacheDefinition cacheId="999"/>"#.to_vec(),
                raw_relationships: Vec::new(),
                records_relationship_id: None,
                records_relationship_target: None,
                records_path: None,
                raw_records_xml: None,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            content_type_overrides: vec![domain_types::PivotPackageContentType {
                part_name: "/xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
                content_type: CT_PIVOT_CACHE.to_string(),
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            ..Default::default()
        },
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
            data: br#"<pivotCacheDefinition cacheId="999"/>"#.to_vec(),
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();

    assert!(!workbook_xml.contains("<pivotCaches"));
    assert!(!workbook_rels.contains("Id=\"rId40\""));
    assert!(!workbook_rels.contains("pivotCache/pivotCacheDefinition5.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition5.xml"));
}

#[test]
fn generated_pivot_preserves_clean_imported_pivot_package_contract() {
    let output = pivot_package_output(vec![make_pivot_config(
        "pivot-generated",
        "GeneratedPivot",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    let imported_content_types = vec![
        (
            "/xl/pivotTables/pivotTable7.xml".to_string(),
            CT_PIVOT_TABLE.to_string(),
        ),
        (
            "/xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
            CT_PIVOT_CACHE.to_string(),
        ),
        (
            "/xl/pivotCache/pivotCacheRecords7.xml".to_string(),
            CT_PIVOT_CACHE_RECORDS.to_string(),
        ),
    ];
    let mut ctx = domain_types::RoundTripContext {
        sheets: vec![
            domain_types::SheetRoundTripContext::default(),
            domain_types::SheetRoundTripContext::default(),
        ],
        content_type_overrides: imported_content_types.clone(),
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId2".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet2.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: REL_PIVOT_CACHE.to_string(),
                target: "pivotCache/pivotCacheDefinition7.xml".to_string(),
                target_mode: None,
            },
        ],
        sheet_workbook_r_ids: vec!["rId1".to_string(), "rId2".to_string()],
        binary_blobs: vec![
            domain_types::BlobPart {
                path: "xl/pivotTables/pivotTable7.xml".to_string(),
                data: br#"<pivotTableDefinition name="ImportedPivot" cacheId="77"/>"#.to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotTables/_rels/pivotTable7.xml.rels".to_string(),
                data: b"imported pivot table rels".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                data: b"imported cache definition".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/_rels/pivotCacheDefinition7.xml.rels".to_string(),
                data: b"imported cache rels".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/pivotCacheRecords7.xml".to_string(),
                data: b"imported cache records".to_vec(),
            },
        ],
        pivot_package: domain_types::PivotPackageRoundTrip {
            workbook_cache_entries: vec![domain_types::PivotWorkbookCacheEntry {
                cache_id: 77,
                relationship_id: "rId99".to_string(),
                relationship_target: "pivotCache/pivotCacheDefinition7.xml".to_string(),
                definition_path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                order: 0,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            cache_definitions: vec![domain_types::PivotCacheDefinitionPackage {
                cache_id: 77,
                definition_path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                definition_rels_path: Some(
                    "xl/pivotCache/_rels/pivotCacheDefinition7.xml.rels".to_string(),
                ),
                source_kind: domain_types::PivotCacheSourceKind::External,
                raw_definition_xml: b"imported cache definition".to_vec(),
                raw_relationships: vec![domain_types::OpcRelationship {
                    id: "rId1".to_string(),
                    rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords".to_string(),
                    target: "pivotCacheRecords7.xml".to_string(),
                    target_mode: None,
                }],
                records_relationship_id: Some("rId1".to_string()),
                records_relationship_target: Some("pivotCacheRecords7.xml".to_string()),
                records_path: Some("xl/pivotCache/pivotCacheRecords7.xml".to_string()),
                raw_records_xml: Some(b"imported cache records".to_vec()),
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            pivot_tables: vec![domain_types::PivotTablePackage {
                sheet_index: 1,
                sheet_name: "Pivot".to_string(),
                sheet_relationship_id: "rId7".to_string(),
                sheet_relationship_target: "../pivotTables/pivotTable7.xml".to_string(),
                table_path: "xl/pivotTables/pivotTable7.xml".to_string(),
                table_rels_path: Some("xl/pivotTables/_rels/pivotTable7.xml.rels".to_string()),
                pivot_name: Some("ImportedPivot".to_string()),
                raw_table_xml: br#"<pivotTableDefinition name="ImportedPivot" cacheId="77"/>"#
                    .to_vec(),
                raw_relationships: vec![domain_types::OpcRelationship {
                    id: "rId1".to_string(),
                    rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition".to_string(),
                    target: "../pivotCache/pivotCacheDefinition7.xml".to_string(),
                    target_mode: None,
                }],
                referenced_cache_id: 77,
                order: 0,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            content_type_overrides: imported_content_types
                .iter()
                .map(|(part_name, content_type)| domain_types::PivotPackageContentType {
                    part_name: part_name.clone(),
                    content_type: content_type.clone(),
                    ownership: domain_types::PivotPackageOwnership::CleanImported,
                })
                .collect(),
            orphan_parts: Vec::new(),
        },
        ..Default::default()
    };
    ctx.sheets[1].sheet_opc_rels = vec![
        domain_types::OpcRelationship {
            id: "rId1".to_string(),
            rel_type: REL_HYPERLINK.to_string(),
            target: "https://example.com".to_string(),
            target_mode: Some("External".to_string()),
        },
        domain_types::OpcRelationship {
            id: "rId7".to_string(),
            rel_type: REL_PIVOT_TABLE.to_string(),
            target: "../pivotTables/pivotTable7.xml".to_string(),
            target_mode: None,
        },
    ];
    ctx.sheets[1].sheet_preserved_elements = vec![(
        "worksheet\0after\0sheetData\0pivotTableDefinition".to_string(),
        r#"<pivotTableDefinition r:id="rId7"/>"#.to_string(),
    )];

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet2.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet2.xml").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(workbook_xml.contains("cacheId=\"77\" r:id=\"rId99\""));
    assert!(workbook_xml.contains("cacheId=\"11\""));
    assert!(workbook_rels.contains("pivotCache/pivotCacheDefinition7.xml"));
    assert!(workbook_rels.contains("pivotCache/pivotCacheDefinition1.xml"));
    assert!(sheet_rels.contains("../pivotTables/pivotTable7.xml"));
    assert!(sheet_rels.contains("../pivotTables/pivotTable1.xml"));
    assert!(sheet_xml.contains("<pivotTableDefinition r:id=\"rId7\"/>"));
    let generated_pivot_r_id = sheet_rels
        .split("<Relationship ")
        .find(|rel| rel.contains("../pivotTables/pivotTable1.xml"))
        .and_then(|rel| rel.split("Id=\"").nth(1))
        .and_then(|rel| rel.split('"').next())
        .expect("generated pivot relationship should have an r:id");
    assert!(sheet_xml.contains(&format!(
        "<pivotTableDefinition r:id=\"{generated_pivot_r_id}\"/>"
    )));
    assert!(content_types.contains("PartName=\"/xl/pivotTables/pivotTable7.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheDefinition7.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheRecords7.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotTables/pivotTable1.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheDefinition1.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheRecords1.xml\""));
    assert!(archive.contains("xl/pivotTables/pivotTable7.xml"));
    assert!(archive.contains("xl/pivotTables/_rels/pivotTable7.xml.rels"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition7.xml"));
    assert!(archive.contains("xl/pivotCache/_rels/pivotCacheDefinition7.xml.rels"));
    assert!(archive.contains("xl/pivotCache/pivotCacheRecords7.xml"));
    assert!(archive.contains("xl/pivotTables/pivotTable1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheRecords1.xml"));
}

#[test]
fn dangling_clean_pivot_package_does_not_reserve_generated_part_paths() {
    let output = pivot_package_output(vec![make_pivot_config(
        "pivot-generated",
        "GeneratedPivot",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![
            domain_types::SheetRoundTripContext::default(),
            domain_types::SheetRoundTripContext::default(),
        ],
        pivot_package: domain_types::PivotPackageRoundTrip {
            cache_definitions: vec![domain_types::PivotCacheDefinitionPackage {
                cache_id: 77,
                definition_path: "xl/pivotCache/pivotCacheDefinition1.xml".to_string(),
                definition_rels_path: Some(
                    "xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels".to_string(),
                ),
                source_kind: domain_types::PivotCacheSourceKind::External,
                raw_definition_xml: b"stale cache definition".to_vec(),
                raw_relationships: vec![domain_types::OpcRelationship {
                    id: "rIdDangling".to_string(),
                    rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords".to_string(),
                    target: "missingRecords.xml".to_string(),
                    target_mode: None,
                }],
                records_relationship_id: Some("rIdDangling".to_string()),
                records_relationship_target: Some("missingRecords.xml".to_string()),
                records_path: None,
                raw_records_xml: None,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            content_type_overrides: vec![domain_types::PivotPackageContentType {
                part_name: "/xl/pivotCache/pivotCacheDefinition1.xml".to_string(),
                content_type: CT_PIVOT_CACHE.to_string(),
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            ..Default::default()
        },
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    assert!(archive.contains("xl/pivotTables/pivotTable1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheRecords1.xml"));
    assert!(!archive.contains("xl/pivotTables/pivotTable2.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheDefinition2.xml"));
    assert!(!workbook_rels.contains("rIdDangling"));
    assert!(workbook_rels.contains("pivotCache/pivotCacheDefinition1.xml"));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheDefinition1.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn dangling_clean_pivot_package_does_not_emit_opaque_stale_parts() {
    let output = pivot_package_output(vec![make_pivot_config(
        "pivot-generated",
        "GeneratedPivot",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    let mut ctx = domain_types::RoundTripContext {
        sheets: vec![
            domain_types::SheetRoundTripContext::default(),
            domain_types::SheetRoundTripContext::default(),
        ],
        pivot_package: domain_types::PivotPackageRoundTrip {
            workbook_cache_entries: vec![domain_types::PivotWorkbookCacheEntry {
                cache_id: 77,
                relationship_id: "rId77".to_string(),
                relationship_target: "pivotCache/missingDefinition7.xml".to_string(),
                definition_path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                order: 0,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            cache_definitions: vec![domain_types::PivotCacheDefinitionPackage {
                cache_id: 77,
                definition_path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                definition_rels_path: Some(
                    "xl/pivotCache/_rels/pivotCacheDefinition7.xml.rels".to_string(),
                ),
                source_kind: domain_types::PivotCacheSourceKind::Worksheet,
                raw_definition_xml: br#"<pivotCacheDefinition cacheId="77"/>"#.to_vec(),
                raw_relationships: vec![domain_types::OpcRelationship {
                    id: "rIdRecords".to_string(),
                    rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords".to_string(),
                    target: "pivotCacheRecords7.xml".to_string(),
                    target_mode: None,
                }],
                records_relationship_id: Some("rIdRecords".to_string()),
                records_relationship_target: Some("pivotCacheRecords7.xml".to_string()),
                records_path: Some("xl/pivotCache/pivotCacheRecords7.xml".to_string()),
                raw_records_xml: Some(br#"<pivotCacheRecords count="0"/>"#.to_vec()),
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            pivot_tables: vec![domain_types::PivotTablePackage {
                sheet_index: 1,
                sheet_name: "Pivot".to_string(),
                sheet_relationship_id: "rId7".to_string(),
                sheet_relationship_target: "../pivotTables/pivotTable7.xml".to_string(),
                table_path: "xl/pivotTables/pivotTable7.xml".to_string(),
                table_rels_path: None,
                pivot_name: Some("StalePivot".to_string()),
                raw_table_xml: br#"<pivotTableDefinition name="StalePivot" cacheId="77"/>"#
                    .to_vec(),
                raw_relationships: Vec::new(),
                referenced_cache_id: 77,
                order: 0,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            content_type_overrides: vec![
                domain_types::PivotPackageContentType {
                    part_name: "/xl/pivotTables/pivotTable7.xml".to_string(),
                    content_type: CT_PIVOT_TABLE.to_string(),
                    ownership: domain_types::PivotPackageOwnership::CleanImported,
                },
                domain_types::PivotPackageContentType {
                    part_name: "/xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                    content_type: CT_PIVOT_CACHE.to_string(),
                    ownership: domain_types::PivotPackageOwnership::CleanImported,
                },
                domain_types::PivotPackageContentType {
                    part_name: "/xl/pivotCache/pivotCacheRecords7.xml".to_string(),
                    content_type: CT_PIVOT_CACHE_RECORDS.to_string(),
                    ownership: domain_types::PivotPackageOwnership::CleanImported,
                },
            ],
            ..Default::default()
        },
        ..Default::default()
    };
    ctx.sheets[1].sheet_opc_rels = vec![domain_types::OpcRelationship {
        id: "rId7".to_string(),
        rel_type: REL_PIVOT_TABLE.to_string(),
        target: "../pivotTables/pivotTable7.xml".to_string(),
        target_mode: None,
    }];
    ctx.sheets[1].sheet_preserved_elements = vec![(
        "worksheet\0after\0sheetData\0pivotTableDefinition".to_string(),
        r#"<pivotTableDefinition r:id="rId7"/>"#.to_string(),
    )];

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    assert!(archive.contains("xl/pivotTables/pivotTable1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheRecords1.xml"));
    assert!(!archive.contains("xl/pivotTables/pivotTable7.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheDefinition7.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheRecords7.xml"));
    assert!(!content_types.contains("pivotTable7.xml"));
    assert!(!content_types.contains("pivotCacheDefinition7.xml"));
    assert!(!content_types.contains("pivotCacheRecords7.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn dangling_matching_pivot_package_does_not_suppress_generated_pivot() {
    let output = pivot_package_output(vec![make_pivot_config(
        "pivot-generated",
        "GeneratedPivot",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    let mut ctx = domain_types::RoundTripContext {
        sheets: vec![
            domain_types::SheetRoundTripContext::default(),
            domain_types::SheetRoundTripContext::default(),
        ],
        pivot_package: domain_types::PivotPackageRoundTrip {
            cache_definitions: vec![domain_types::PivotCacheDefinitionPackage {
                cache_id: 11,
                definition_path: "xl/pivotCache/pivotCacheDefinition1.xml".to_string(),
                definition_rels_path: Some(
                    "xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels".to_string(),
                ),
                source_kind: domain_types::PivotCacheSourceKind::External,
                raw_definition_xml: b"stale cache definition".to_vec(),
                raw_relationships: vec![domain_types::OpcRelationship {
                    id: "rIdDangling".to_string(),
                    rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords".to_string(),
                    target: "missingRecords.xml".to_string(),
                    target_mode: None,
                }],
                records_relationship_id: Some("rIdDangling".to_string()),
                records_relationship_target: Some("missingRecords.xml".to_string()),
                records_path: None,
                raw_records_xml: None,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            pivot_tables: vec![domain_types::PivotTablePackage {
                sheet_index: 1,
                sheet_name: "Pivot".to_string(),
                sheet_relationship_id: "rId7".to_string(),
                sheet_relationship_target: "../pivotTables/pivotTable1.xml".to_string(),
                table_path: "xl/pivotTables/pivotTable1.xml".to_string(),
                table_rels_path: Some("xl/pivotTables/_rels/pivotTable1.xml.rels".to_string()),
                pivot_name: Some("GeneratedPivot".to_string()),
                raw_table_xml: br#"<pivotTableDefinition name="GeneratedPivot" cacheId="11"/>"#
                    .to_vec(),
                raw_relationships: Vec::new(),
                referenced_cache_id: 11,
                order: 0,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            content_type_overrides: vec![
                domain_types::PivotPackageContentType {
                    part_name: "/xl/pivotTables/pivotTable1.xml".to_string(),
                    content_type: CT_PIVOT_TABLE.to_string(),
                    ownership: domain_types::PivotPackageOwnership::CleanImported,
                },
                domain_types::PivotPackageContentType {
                    part_name: "/xl/pivotCache/pivotCacheDefinition1.xml".to_string(),
                    content_type: CT_PIVOT_CACHE.to_string(),
                    ownership: domain_types::PivotPackageOwnership::CleanImported,
                },
            ],
            ..Default::default()
        },
        ..Default::default()
    };
    ctx.sheets[1].sheet_opc_rels = vec![domain_types::OpcRelationship {
        id: "rId7".to_string(),
        rel_type: REL_PIVOT_TABLE.to_string(),
        target: "../pivotTables/pivotTable1.xml".to_string(),
        target_mode: None,
    }];
    ctx.sheets[1].sheet_preserved_elements = vec![(
        "worksheet\0after\0sheetData\0pivotTableDefinition".to_string(),
        r#"<pivotTableDefinition r:id="rId7"/>"#.to_string(),
    )];

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet2.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet2.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(archive.contains("xl/pivotTables/pivotTable1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheRecords1.xml"));
    assert!(workbook_xml.contains("cacheId=\"11\""));
    assert!(workbook_rels.contains("pivotCache/pivotCacheDefinition1.xml"));
    assert!(sheet_rels.contains("../pivotTables/pivotTable1.xml"));
    let pivot_r_id = sheet_rels
        .split("<Relationship ")
        .find(|rel| rel.contains("../pivotTables/pivotTable1.xml"))
        .and_then(|rel| rel.split("Id=\"").nth(1))
        .and_then(|rel| rel.split('"').next())
        .expect("generated pivot relationship should have an r:id");
    assert!(sheet_xml.contains(&format!("<pivotTableDefinition r:id=\"{pivot_r_id}\"/>")));
    assert!(!workbook_rels.contains("rIdDangling"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn skipped_generated_pivot_does_not_replay_legacy_pivot_package_metadata() {
    let output = pivot_package_output(vec![make_pivot_config(
        "pivot-1",
        "PivotTable1",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Missing Pivot Sheet",
        Some(11),
    )]);
    let mut ctx = domain_types::RoundTripContext {
        sheets: vec![
            domain_types::SheetRoundTripContext::default(),
            domain_types::SheetRoundTripContext::default(),
        ],
        content_type_overrides: vec![
            (
                "/xl/pivotTables/pivotTable7.xml".to_string(),
                CT_PIVOT_TABLE.to_string(),
            ),
            (
                "/xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                CT_PIVOT_CACHE.to_string(),
            ),
            (
                "/xl/pivotCache/pivotCacheRecords7.xml".to_string(),
                CT_PIVOT_CACHE_RECORDS.to_string(),
            ),
        ],
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId2".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet2.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: REL_PIVOT_CACHE.to_string(),
                target: "pivotCache/pivotCacheDefinition7.xml".to_string(),
                target_mode: None,
            },
        ],
        sheet_workbook_r_ids: vec!["rId1".to_string(), "rId2".to_string()],
        binary_blobs: vec![
            domain_types::BlobPart {
                path: "xl/pivotTables/pivotTable7.xml".to_string(),
                data: b"original pivot table".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                data: b"original cache definition".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/pivotCacheRecords7.xml".to_string(),
                data: b"original cache records".to_vec(),
            },
        ],
        ..Default::default()
    };
    ctx.sheets[1].sheet_opc_rels = vec![domain_types::OpcRelationship {
        id: "rId7".to_string(),
        rel_type: REL_PIVOT_TABLE.to_string(),
        target: "../pivotTables/pivotTable7.xml".to_string(),
        target_mode: None,
    }];

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!workbook_rels.contains("pivotCache/pivotCacheDefinition7.xml"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet2.xml.rels"));
    assert!(!content_types.contains("PartName=\"/xl/pivotTables/pivotTable7.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/pivotCache/pivotCacheDefinition7.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/pivotCache/pivotCacheRecords7.xml\""));
    assert!(!archive.contains("xl/pivotTables/pivotTable7.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheDefinition7.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheRecords7.xml"));
    assert!(!archive.contains("xl/pivotTables/pivotTable1.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheDefinition1.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheRecords1.xml"));
}

#[test]
fn preserved_pivot_marker_without_clean_package_is_not_replayed() {
    let output = make_parse_output(vec![
        SheetData {
            name: "Data".to_string(),
            ..Default::default()
        },
        SheetData {
            name: "Pivot".to_string(),
            ..Default::default()
        },
    ]);
    let mut ctx = domain_types::RoundTripContext {
        sheets: vec![
            domain_types::SheetRoundTripContext::default(),
            domain_types::SheetRoundTripContext::default(),
        ],
        ..Default::default()
    };
    ctx.sheets[1].sheet_opc_rels = vec![domain_types::OpcRelationship {
        id: "rId7".to_string(),
        rel_type: REL_PIVOT_TABLE.to_string(),
        target: "../pivotTables/pivotTable7.xml".to_string(),
        target_mode: None,
    }];
    ctx.sheets[1].sheet_preserved_elements = vec![(
        "worksheet\0after\0sheetData\0pivotTableDefinition".to_string(),
        r#"<pivotTableDefinition r:id="rId7"/>"#.to_string(),
    )];

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet2.xml").unwrap()).unwrap();

    assert!(!sheet_xml.contains("pivotTableDefinition"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet2.xml.rels"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn missing_pivot_cache_ids_are_grouped_by_source_contract() {
    let output = pivot_package_output(vec![
        make_pivot_config(
            "pivot-1",
            "PivotTable1",
            "Data",
            cell_types::SheetRange::new(0, 0, 2, 1),
            "Pivot",
            None,
        ),
        make_pivot_config(
            "pivot-2",
            "PivotTable2",
            "Data",
            cell_types::SheetRange::new(4, 0, 5, 1),
            "Pivot",
            None,
        ),
    ]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let pivot_table_1 =
        String::from_utf8(archive.read_file("xl/pivotTables/pivotTable1.xml").unwrap()).unwrap();
    let pivot_table_2 =
        String::from_utf8(archive.read_file("xl/pivotTables/pivotTable2.xml").unwrap()).unwrap();
    let pivot_table_1_rels = String::from_utf8(
        archive
            .read_file("xl/pivotTables/_rels/pivotTable1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let pivot_table_2_rels = String::from_utf8(
        archive
            .read_file("xl/pivotTables/_rels/pivotTable2.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert_eq!(workbook_xml.matches("<pivotCache ").count(), 2);
    assert!(workbook_xml.contains("cacheId=\"1\""));
    assert!(workbook_xml.contains("cacheId=\"2\""));
    assert!(pivot_table_1.contains("cacheId=\"1\""));
    assert!(pivot_table_2.contains("cacheId=\"2\""));
    assert!(pivot_table_1_rels.contains("../pivotCache/pivotCacheDefinition1.xml"));
    assert!(pivot_table_2_rels.contains("../pivotCache/pivotCacheDefinition2.xml"));
    assert!(archive.contains("xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels"));
    assert!(archive.contains("xl/pivotCache/_rels/pivotCacheDefinition2.xml.rels"));
}
