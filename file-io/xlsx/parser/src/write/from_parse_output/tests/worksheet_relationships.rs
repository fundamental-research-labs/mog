use super::*;

#[test]
fn unmanaged_original_drawing_relationship_is_not_replayed() {
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
            drawing_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: "http://example.invalid/relationships/privateDrawingFeature".to_string(),
                target: "../private/privateDrawingFeature.xml".to_string(),
                target_mode: None,
            }],
            has_drawing_rels_file: true,
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");

    if archive.contains("xl/drawings/_rels/drawing1.xml.rels") {
        let drawing_rels = String::from_utf8(
            archive
                .read_file("xl/drawings/_rels/drawing1.xml.rels")
                .unwrap(),
        )
        .unwrap();
        assert!(!drawing_rels.contains("privateDrawingFeature"));
    }
    assert!(!archive.contains("xl/private/privateDrawingFeature.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn clean_imported_drawing_package_is_preserved_as_opaque_subgraph() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        opaque_package_subgraphs: vec![clean_opaque_drawing_subgraph()],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing7.xml").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(drawing_xml.contains("cleanDrawingSentinel"));
    assert!(sheet_rels.contains(r#"Id="rIdCleanDrawing""#));
    assert!(sheet_rels.contains(r#"Target="../drawings/drawing7.xml""#));
    assert!(sheet_rels.contains(REL_DRAWING));
    assert!(sheet_xml.contains(r#"<drawing r:id="rIdCleanDrawing"/>"#));
    assert!(content_types.contains(r#"PartName="/xl/drawings/drawing7.xml""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn opaque_worksheet_drawing_requires_closed_registered_subgraph() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let mut drawing_subgraph = clean_opaque_drawing_subgraph();
    drawing_subgraph.owner_relationship.target =
        domain_types::OpaqueRelationshipTarget::InternalPart {
            path: "xl/drawings/missingDrawing.xml".to_string(),
        };
    let ctx = domain_types::RoundTripContext {
        opaque_package_subgraphs: vec![drawing_subgraph],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!archive.contains("xl/drawings/drawing7.xml"));
    assert!(!archive.contains("xl/drawings/missingDrawing.xml"));
    assert!(!archive.contains("xl/media/staleOpaqueImage.png"));
    assert!(!sheet_xml.contains("<drawing "));
    assert!(!content_types.contains("/xl/drawings/drawing7.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn modeled_replacement_drawing_suppresses_clean_opaque_drawing_subgraph() {
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![make_chart(ChartType::Column, "Data!A1:B2")],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        opaque_package_subgraphs: vec![clean_opaque_drawing_subgraph()],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/drawings/drawing1.xml"));
    assert!(!archive.contains("xl/drawings/drawing7.xml"));
    assert!(!archive.contains("xl/media/staleOpaqueImage.png"));
    assert!(sheet_rels.contains(r#"Target="../drawings/drawing1.xml""#));
    assert!(!sheet_rels.contains("drawing7.xml"));
    assert!(content_types.contains(r#"PartName="/xl/drawings/drawing1.xml""#));
    assert!(!content_types.contains(r#"PartName="/xl/drawings/drawing7.xml""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

fn clean_opaque_drawing_subgraph() -> domain_types::OpaquePackageSubgraph {
    const REL_IMAGE: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
    let owner = domain_types::OpaquePackageOwner::Worksheet {
        index: 0,
        path: "xl/worksheets/sheet1.xml".to_string(),
    };
    domain_types::OpaquePackageSubgraph {
        owner: owner.clone(),
        owner_relationship: domain_types::OpaquePackageRelationship {
            owner,
            relationship_type: REL_DRAWING.to_string(),
            target: domain_types::OpaqueRelationshipTarget::InternalPart {
                path: "xl/drawings/drawing7.xml".to_string(),
            },
            relationship_id_hint: Some("rIdCleanDrawing".to_string()),
        },
        parts: vec![
            domain_types::OpaquePackagePart {
                part: domain_types::BlobPart {
                    path: "xl/drawings/drawing7.xml".to_string(),
                    data: br#"<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><cleanDrawingSentinel/></xdr:wsDr>"#.to_vec(),
                },
                content_type: Some(crate::write::CT_DRAWING.to_string()),
                default_extension: None,
                ownership: domain_types::OpaquePackageOwnership::CleanImported,
            },
            domain_types::OpaquePackagePart {
                part: domain_types::BlobPart {
                    path: "xl/media/staleOpaqueImage.png".to_string(),
                    data: b"stale opaque image".to_vec(),
                },
                content_type: Some("image/png".to_string()),
                default_extension: Some(("png".to_string(), "image/png".to_string())),
                ownership: domain_types::OpaquePackageOwnership::CleanImported,
            },
        ],
        relationships: vec![domain_types::OpaquePackageRelationship {
            owner: domain_types::OpaquePackageOwner::Part {
                path: "xl/drawings/drawing7.xml".to_string(),
            },
            relationship_type: REL_IMAGE.to_string(),
            target: domain_types::OpaqueRelationshipTarget::InternalPart {
                path: "xl/media/staleOpaqueImage.png".to_string(),
            },
            relationship_id_hint: Some("rIdStaleImage".to_string()),
        }],
        ownership: domain_types::OpaquePackageOwnership::CleanImported,
    }
}

fn clean_opaque_worksheet_custom_property_subgraph(
    relationship_id: &str,
) -> domain_types::OpaquePackageSubgraph {
    let owner = domain_types::OpaquePackageOwner::Worksheet {
        index: 0,
        path: "xl/worksheets/sheet1.xml".to_string(),
    };
    domain_types::OpaquePackageSubgraph {
        owner: owner.clone(),
        owner_relationship: domain_types::OpaquePackageRelationship {
            owner,
            relationship_type: worksheet_custom_properties::REL_WORKSHEET_CUSTOM_PROPERTY
                .to_string(),
            target: domain_types::OpaqueRelationshipTarget::InternalPart {
                path: "xl/customProperty/item1.xml".to_string(),
            },
            relationship_id_hint: Some(relationship_id.to_string()),
        },
        parts: vec![domain_types::OpaquePackagePart {
            part: domain_types::BlobPart {
                path: "xl/customProperty/item1.xml".to_string(),
                data: b"<customProperty/>".to_vec(),
            },
            content_type: Some(
                worksheet_custom_properties::CT_WORKSHEET_CUSTOM_PROPERTY.to_string(),
            ),
            default_extension: None,
            ownership: domain_types::OpaquePackageOwnership::CleanImported,
        }],
        relationships: Vec::new(),
        ownership: domain_types::OpaquePackageOwnership::CleanImported,
    }
}

fn clean_opaque_hf_vml_subgraph(
    vml_path: &str,
    vml_data: Vec<u8>,
    media_parts: Vec<(&str, Vec<u8>)>,
) -> domain_types::OpaquePackageSubgraph {
    let mut parts = vec![domain_types::OpaquePackagePart {
        part: domain_types::BlobPart {
            path: vml_path.to_string(),
            data: vml_data,
        },
        content_type: None,
        default_extension: Some((
            "vml".to_string(),
            "application/vnd.openxmlformats-officedocument.vmlDrawing".to_string(),
        )),
        ownership: domain_types::OpaquePackageOwnership::CleanImported,
    }];
    let media_relationships = media_parts
        .iter()
        .map(|(path, _)| domain_types::OpaquePackageRelationship {
            owner: domain_types::OpaquePackageOwner::Part {
                path: vml_path.to_string(),
            },
            relationship_type:
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
                    .to_string(),
            target: domain_types::OpaqueRelationshipTarget::InternalPart {
                path: (*path).to_string(),
            },
            relationship_id_hint: Some(hf_media_relationship_id(path)),
        })
        .collect();
    parts.extend(
        media_parts
            .into_iter()
            .map(|(path, data)| domain_types::OpaquePackagePart {
                part: domain_types::BlobPart {
                    path: path.to_string(),
                    data,
                },
                content_type: None,
                default_extension: Some(("png".to_string(), "image/png".to_string())),
                ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
            }),
    );
    domain_types::OpaquePackageSubgraph {
        owner: domain_types::OpaquePackageOwner::Part {
            path: vml_path.to_string(),
        },
        owner_relationship: domain_types::OpaquePackageRelationship {
            owner: domain_types::OpaquePackageOwner::Part {
                path: vml_path.to_string(),
            },
            relationship_type: String::new(),
            target: domain_types::OpaqueRelationshipTarget::InternalPath {
                target: String::new(),
            },
            relationship_id_hint: None,
        },
        parts,
        relationships: media_relationships,
        ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
    }
}

fn hf_media_relationship_id(path: &str) -> String {
    let digits = path
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if digits.is_empty() {
        "rId1".to_string()
    } else {
        format!("rId{digits}")
    }
}

fn clean_opaque_media_subgraph(path: &str, data: Vec<u8>) -> domain_types::OpaquePackageSubgraph {
    domain_types::OpaquePackageSubgraph {
        owner: domain_types::OpaquePackageOwner::Part {
            path: path.to_string(),
        },
        owner_relationship: domain_types::OpaquePackageRelationship {
            owner: domain_types::OpaquePackageOwner::Part {
                path: path.to_string(),
            },
            relationship_type: String::new(),
            target: domain_types::OpaqueRelationshipTarget::InternalPath {
                target: String::new(),
            },
            relationship_id_hint: None,
        },
        parts: vec![domain_types::OpaquePackagePart {
            part: domain_types::BlobPart {
                path: path.to_string(),
                data,
            },
            content_type: None,
            default_extension: Some(("png".to_string(), "image/png".to_string())),
            ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
        }],
        relationships: Vec::new(),
        ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
    }
}

#[test]
fn generated_drawing_relationship_uses_graph_registered_part() {
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![make_chart(ChartType::Column, "Data!A1:B2")],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId9".to_string(),
                rel_type: REL_DRAWING.to_string(),
                target: "../drawings/drawing9.xml".to_string(),
                target_mode: None,
            }],
            imported_drawing: Some(domain_types::ImportedDrawingPart {
                path: "xl/drawings/drawing9.xml".to_string(),
                data: br#"<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><rawSentinel/></xdr:wsDr>"#.to_vec(),
                rels: Some(domain_types::BlobPart {
                    path: "xl/drawings/_rels/drawing9.xml.rels".to_string(),
                    data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId99" Type="http://example.invalid/privateDrawingFeature" Target="https://example.invalid/private" TargetMode="External"/></Relationships>"#.to_vec(),
                }),
            }),
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/drawings/drawing9.xml".to_string(),
            crate::write::CT_DRAWING.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels_bytes = archive
        .read_file("xl/worksheets/_rels/sheet1.xml.rels")
        .unwrap();
    let sheet_rels = String::from_utf8(sheet_rels_bytes.clone()).unwrap();
    let rels = crate::domain::workbook::read::parse_all_rels(&sheet_rels_bytes);
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let drawing_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_DRAWING && rel.target == "../drawings/drawing1.xml")
        .expect("generated drawing relationship should target the graph-registered part");

    assert!(archive.contains("xl/drawings/drawing1.xml"));
    assert!(!archive.contains("xl/drawings/drawing9.xml"));
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();
    let drawing_rels = String::from_utf8(
        archive
            .read_file("xl/drawings/_rels/drawing1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    assert!(sheet_rels.contains("Target=\"../drawings/drawing1.xml\""));
    assert!(!sheet_rels.contains("drawing9.xml"));
    assert!(sheet_xml.contains(&format!(r#"<drawing r:id="{}"/>"#, drawing_rel.id)));
    assert!(!drawing_xml.contains("rawSentinel"));
    assert!(!drawing_rels.contains("privateDrawingFeature"));
    assert!(!drawing_rels.contains("rId99"));
    assert!(content_types.contains("PartName=\"/xl/drawings/drawing1.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/drawings/drawing9.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_drawing_ignores_stale_original_drawing_path_without_imported_identity() {
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![make_chart(ChartType::Column, "Data!A1:B2")],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId9".to_string(),
                rel_type: REL_DRAWING.to_string(),
                target: "../drawings/drawing9.xml".to_string(),
                target_mode: None,
            }],
            original_drawing_path: Some("xl/drawings/drawing9.xml".to_string()),
            imported_drawing: Some(domain_types::ImportedDrawingPart {
                path: "xl/drawings/drawing9.xml".to_string(),
                data: br#"<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><staleDrawing/></xdr:wsDr>"#
                    .to_vec(),
                rels: None,
            }),
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/drawings/drawing1.xml"));
    assert!(!archive.contains("xl/drawings/drawing9.xml"));
    assert!(sheet_rels.contains(r#"Target="../drawings/drawing1.xml""#));
    assert!(!sheet_rels.contains("drawing9.xml"));
    assert!(content_types.contains("PartName=\"/xl/drawings/drawing1.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/drawings/drawing9.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_picture_media_is_emitted_as_modeled_drawing_part() {
    let mut picture = ooxml_types::drawings::SpreadsheetPicture::default();
    picture.blip_fill.embed_id = Some("rId5".to_string());
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        floating_objects: vec![domain_types::domain::floating_object::FloatingObject {
            common: domain_types::domain::floating_object::FloatingObjectCommon {
                name: "Imported Picture".to_string(),
                anchor: domain_types::domain::floating_object::FloatingObjectAnchor {
                    anchor_mode: domain_types::domain::floating_object::AnchorMode::TwoCell,
                    end_row: Some(4),
                    end_col: Some(4),
                    end_row_offset: Some(0),
                    end_col_offset: Some(0),
                    ..Default::default()
                },
                width: 100.0,
                height: 80.0,
                ..Default::default()
            },
            data: domain_types::domain::floating_object::FloatingObjectData::Picture(
                domain_types::domain::floating_object::PictureData {
                    src: "data:image/png;base64,AQIDBA==".to_string(),
                    original_width: None,
                    original_height: None,
                    crop: None,
                    adjustments: None,
                    border: None,
                    color_type: None,
                    ooxml: Some(domain_types::domain::floating_object::PictureOoxmlProps {
                        picture,
                        image_path: Some("../media/image7.png".to_string()),
                        ..Default::default()
                    }),
                },
            ),
        }],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_rels = String::from_utf8(
        archive
            .read_file("xl/drawings/_rels/drawing1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert_eq!(
        archive.read_file("xl/media/image7.png").unwrap(),
        vec![1, 2, 3, 4]
    );
    assert!(drawing_rels.contains(r#"Id="rId5""#));
    assert!(drawing_rels.contains(r#"Target="../media/image7.png""#));
    assert!(content_types.contains(r#"Extension="png""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_drawing_without_child_relationships_drops_empty_imported_rels_file() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        floating_objects: vec![domain_types::domain::floating_object::FloatingObject {
            common: domain_types::domain::floating_object::FloatingObjectCommon {
                name: "Modeled Shape".to_string(),
                anchor: domain_types::domain::floating_object::FloatingObjectAnchor {
                    anchor_mode: domain_types::domain::floating_object::AnchorMode::TwoCell,
                    end_row: Some(4),
                    end_col: Some(4),
                    end_row_offset: Some(0),
                    end_col_offset: Some(0),
                    ..Default::default()
                },
                width: 100.0,
                height: 80.0,
                ..Default::default()
            },
            data: domain_types::domain::floating_object::FloatingObjectData::Shape(
                domain_types::domain::floating_object::ShapeData {
                    shape_type: "rect".to_string(),
                    ..Default::default()
                },
            ),
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId9".to_string(),
                rel_type: REL_DRAWING.to_string(),
                target: "../drawings/drawing1.xml".to_string(),
                target_mode: None,
            }],
            original_drawing_path: Some("xl/drawings/drawing1.xml".to_string()),
            has_drawing_rels_file: true,
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels_bytes = archive
        .read_file("xl/worksheets/_rels/sheet1.xml.rels")
        .unwrap();
    let sheet_rels = String::from_utf8(sheet_rels_bytes.clone()).unwrap();
    let rels = crate::domain::workbook::read::parse_all_rels(&sheet_rels_bytes);
    let drawing_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_DRAWING)
        .expect("generated drawing should have worksheet relationship");

    assert!(archive.contains("xl/drawings/drawing1.xml"));
    assert!(!archive.contains("xl/drawings/_rels/drawing1.xml.rels"));
    assert!(sheet_rels.contains("Target=\"../drawings/drawing1.xml\""));
    assert!(sheet_xml.contains(&format!(r#"<drawing r:id="{}"/>"#, drawing_rel.id)));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_threaded_comments_ignore_stale_original_threaded_comments_path() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        comments: vec![Comment {
            id: "generated-thread".to_string(),
            cell_ref: "A1".to_string(),
            author: "Tester".to_string(),
            content: Some("Generated threaded comment".to_string()),
            comment_type: CommentType::ThreadedComment,
            ..Default::default()
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rIdThreaded".to_string(),
                rel_type: REL_THREADED_COMMENT.to_string(),
                target: "../threadedComments/threadedComment9.xml".to_string(),
                target_mode: None,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/threadedComments/threadedComment1.xml"));
    assert!(!archive.contains("xl/threadedComments/threadedComment9.xml"));
    assert!(sheet_rels.contains(r#"Target="../threadedComments/threadedComment1.xml""#));
    assert!(!sheet_rels.contains("threadedComment9.xml"));
    assert!(content_types.contains("PartName=\"/xl/threadedComments/threadedComment1.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/threadedComments/threadedComment9.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_picture_embed_ids_match_graph_registered_media_relationships() {
    let mut imported_picture = ooxml_types::drawings::SpreadsheetPicture::default();
    imported_picture.blip_fill.embed_id = Some("rId5".to_string());
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        floating_objects: vec![
            domain_types::domain::floating_object::FloatingObject {
                common: domain_types::domain::floating_object::FloatingObjectCommon {
                    name: "Imported Picture".to_string(),
                    anchor: domain_types::domain::floating_object::FloatingObjectAnchor {
                        anchor_mode: domain_types::domain::floating_object::AnchorMode::TwoCell,
                        end_row: Some(4),
                        end_col: Some(4),
                        ..Default::default()
                    },
                    width: 100.0,
                    height: 80.0,
                    ..Default::default()
                },
                data: domain_types::domain::floating_object::FloatingObjectData::Picture(
                    domain_types::domain::floating_object::PictureData {
                        src: "data:image/png;base64,AQIDBA==".to_string(),
                        original_width: None,
                        original_height: None,
                        crop: None,
                        adjustments: None,
                        border: None,
                        color_type: None,
                        ooxml: Some(domain_types::domain::floating_object::PictureOoxmlProps {
                            picture: imported_picture,
                            image_path: Some("../media/image7.png".to_string()),
                            ..Default::default()
                        }),
                    },
                ),
            },
            domain_types::domain::floating_object::FloatingObject {
                common: domain_types::domain::floating_object::FloatingObjectCommon {
                    name: "Generated Picture".to_string(),
                    anchor: domain_types::domain::floating_object::FloatingObjectAnchor {
                        anchor_mode: domain_types::domain::floating_object::AnchorMode::TwoCell,
                        anchor_row: 5,
                        anchor_col: 5,
                        end_row: Some(9),
                        end_col: Some(9),
                        ..Default::default()
                    },
                    width: 100.0,
                    height: 80.0,
                    ..Default::default()
                },
                data: domain_types::domain::floating_object::FloatingObjectData::Picture(
                    domain_types::domain::floating_object::PictureData {
                        src: "data:image/png;base64,BQYHCA==".to_string(),
                        original_width: None,
                        original_height: None,
                        crop: None,
                        adjustments: None,
                        border: None,
                        color_type: None,
                        ooxml: None,
                    },
                ),
            },
        ],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml = String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap())
        .expect("drawing XML should be UTF-8");
    let drawing_rels_bytes = archive
        .read_file("xl/drawings/_rels/drawing1.xml.rels")
        .unwrap();
    let drawing_rels = crate::domain::workbook::read::parse_all_rels(&drawing_rels_bytes);
    let rel_ids: std::collections::HashSet<_> =
        drawing_rels.iter().map(|rel| rel.id.as_str()).collect();

    assert_eq!(
        archive.read_file("xl/media/image7.png").unwrap(),
        vec![1, 2, 3, 4]
    );
    assert_eq!(
        archive.read_file("xl/media/image2.png").unwrap(),
        vec![5, 6, 7, 8]
    );
    assert_eq!(
        drawing_rels
            .iter()
            .filter(|rel| {
                rel.rel_type
                    == "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
            })
            .count(),
        2
    );
    for embed_id in drawing_embed_ids(&drawing_xml) {
        assert!(
            rel_ids.contains(embed_id.as_str()),
            "drawing r:embed {embed_id} must have a matching drawing relationship"
        );
    }
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_worksheet_relationship_to_missing_modeled_part_is_not_exported_or_referenced() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId4".to_string(),
                rel_type: crate::write::REL_TABLE.to_string(),
                target: "../tables/table9.xml".to_string(),
                target_mode: None,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/tables/table9.xml"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!sheet_xml.contains("r:id=\"rId4\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_preserved_table_parts_are_not_replayed_when_modeled_tables_are_deleted() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId4".to_string(),
                rel_type: crate::write::REL_TABLE.to_string(),
                target: "../tables/table9.xml".to_string(),
                target_mode: None,
            }],
            sheet_preserved_elements: vec![(
                "worksheet\0after\0legacyDrawing\0tableParts".to_string(),
                r#"<tableParts count="1"><tablePart r:id="rId4"/></tableParts>"#.to_string(),
            )],
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/tables/table9.xml".to_string(),
            crate::write::CT_TABLE.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    assert!(!sheet_xml.contains("<tableParts"));
    assert!(!sheet_xml.contains("rId4"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!archive.contains("xl/tables/table9.xml"));
    assert!(!content_types.contains("PartName=\"/xl/tables/table9.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_preserved_relationship_bearing_sheet_xml_is_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rIdCustom".to_string(),
                rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customProperty"
                    .to_string(),
                target: "../customProperty/item1.xml".to_string(),
                target_mode: None,
            }],
            sheet_preserved_elements: vec![(
                "worksheet\0after\0colBreaks\0customProperties".to_string(),
                r#"<customProperties><customPr r:id="rIdCustom" name="StaleProperty"/></customProperties>"#
                    .to_string(),
            )],
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/customProperty/item1.xml".to_string(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.customProperty+xml"
                .to_string(),
        )],
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/customProperty/item1.xml".to_string(),
            data: b"<customProperty/>".to_vec(),
        }],
        opaque_package_subgraphs: vec![clean_opaque_worksheet_custom_property_subgraph(
            "rIdCustom",
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    assert!(!sheet_xml.contains("<customProperties"));
    assert!(!sheet_xml.contains("rIdCustom"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!archive.contains("xl/customProperty/item1.xml"));
    assert!(!content_types.contains("/xl/customProperty/item1.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn unknown_preserved_sheet_xml_with_raw_relationship_id_is_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_preserved_elements: vec![(
                "worksheet\0after\0sheetData\0vendorState".to_string(),
                r#"<vendor:state r:id = "rIdStale"/>"#.to_string(),
            )],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!sheet_xml.contains("vendor:state"));
    assert!(!sheet_xml.contains("rIdStale"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn clean_worksheet_custom_properties_use_graph_registered_parts_and_resolved_ids() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rIdCustom".to_string(),
                rel_type: worksheet_custom_properties::REL_WORKSHEET_CUSTOM_PROPERTY.to_string(),
                target: "../customProperty/item1.xml".to_string(),
                target_mode: None,
            }],
            custom_properties_xml: Some(
                r#"<customProperties><customPr r:id="rIdCustom" name="CleanProperty"/></customProperties>"#
                    .to_string(),
            ),
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/customProperty/item1.xml".to_string(),
            worksheet_custom_properties::CT_WORKSHEET_CUSTOM_PROPERTY.to_string(),
        )],
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/customProperty/item1.xml".to_string(),
            data: b"<customProperty/>".to_vec(),
        }],
        opaque_package_subgraphs: vec![clean_opaque_worksheet_custom_property_subgraph(
            "rIdCustom",
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    assert!(archive.contains("xl/customProperty/item1.xml"));
    assert!(sheet_xml.contains(
        r#"<customProperties><customPr r:id="rIdCustom" name="CleanProperty"/></customProperties>"#
    ));
    assert!(sheet_rels.contains(worksheet_custom_properties::REL_WORKSHEET_CUSTOM_PROPERTY));
    assert!(sheet_rels.contains(r#"Target="../customProperty/item1.xml""#));
    assert!(content_types.contains(r#"PartName="/xl/customProperty/item1.xml""#));
    assert!(content_types.contains(worksheet_custom_properties::CT_WORKSHEET_CUSTOM_PROPERTY));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn worksheet_custom_properties_require_closed_registered_subgraph() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let mut custom_property_subgraph = clean_opaque_worksheet_custom_property_subgraph("rIdCustom");
    custom_property_subgraph.owner_relationship.target =
        domain_types::OpaqueRelationshipTarget::InternalPart {
            path: "xl/customProperty/missing.xml".to_string(),
        };
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rIdCustom".to_string(),
                rel_type: worksheet_custom_properties::REL_WORKSHEET_CUSTOM_PROPERTY.to_string(),
                target: "../customProperty/missing.xml".to_string(),
                target_mode: None,
            }],
            custom_properties_xml: Some(
                r#"<customProperties><customPr r:id="rIdCustom" name="StaleProperty"/></customProperties>"#
                    .to_string(),
            ),
            ..Default::default()
        }],
        opaque_package_subgraphs: vec![custom_property_subgraph],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    assert!(!sheet_xml.contains("<customProperties"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!archive.contains("xl/customProperty/item1.xml"));
    assert!(!archive.contains("xl/customProperty/missing.xml"));
    assert!(!content_types.contains("/xl/customProperty/item1.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn worksheet_custom_properties_xml_uses_graph_resolved_relationship_id_after_collision() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        hyperlinks: vec![Hyperlink {
            cell_ref: "A1".to_string(),
            target: Some("https://example.com".to_string()),
            display: Some("Example".to_string()),
            ..Default::default()
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: worksheet_custom_properties::REL_WORKSHEET_CUSTOM_PROPERTY.to_string(),
                target: "../customProperty/item1.xml".to_string(),
                target_mode: None,
            }],
            custom_properties_xml: Some(
                r#"<customProperties><customPr r:id="rId1" name="CleanProperty"/></customProperties>"#
                    .to_string(),
            ),
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/customProperty/item1.xml".to_string(),
            worksheet_custom_properties::CT_WORKSHEET_CUSTOM_PROPERTY.to_string(),
        )],
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/customProperty/item1.xml".to_string(),
            data: b"<customProperty/>".to_vec(),
        }],
        opaque_package_subgraphs: vec![clean_opaque_worksheet_custom_property_subgraph("rId1")],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(sheet_xml.contains(r#"<hyperlink ref="A1" r:id="rId1""#));
    assert!(sheet_xml.contains(r#"<customPr r:id="rId2" name="CleanProperty"/>"#));
    assert!(sheet_rels.contains(r#"Id="rId1""#));
    assert!(sheet_rels.contains(r#"Target="https://example.com" TargetMode="External""#));
    assert!(sheet_rels.contains(r#"Id="rId2""#));
    assert!(sheet_rels.contains(r#"Target="../customProperty/item1.xml""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn external_worksheet_custom_property_relationship_is_not_rewritten_as_internal_part() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rIdCustom".to_string(),
                rel_type: worksheet_custom_properties::REL_WORKSHEET_CUSTOM_PROPERTY.to_string(),
                target: "../customProperty/item1.xml".to_string(),
                target_mode: Some("External".to_string()),
            }],
            custom_properties_xml: Some(
                r#"<customProperties><customPr r:id="rIdCustom" name="ExternalProperty"/></customProperties>"#
                    .to_string(),
            ),
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/customProperty/item1.xml".to_string(),
            worksheet_custom_properties::CT_WORKSHEET_CUSTOM_PROPERTY.to_string(),
        )],
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/customProperty/item1.xml".to_string(),
            data: b"<customProperty/>".to_vec(),
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    assert!(!sheet_xml.contains("<customProperties"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!archive.contains("xl/customProperty/item1.xml"));
    assert!(!content_types.contains("/xl/customProperty/item1.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_table_relationship_uses_graph_registered_part_and_resolved_id() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        tables: vec![TableSpec {
            id: 1,
            name: "Table1".to_string(),
            display_name: "Table1".to_string(),
            range_ref: "A1:B2".to_string(),
            has_headers: true,
            auto_filter_ref: Some("A1:B2".to_string()),
            columns: vec![
                TableColumnSpec {
                    name: "A".to_string(),
                    ..Default::default()
                },
                TableColumnSpec {
                    name: "B".to_string(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![
                domain_types::OpcRelationship {
                    id: "rId4".to_string(),
                    rel_type: crate::write::REL_TABLE.to_string(),
                    target: "../tables/table1.xml".to_string(),
                    target_mode: None,
                },
                domain_types::OpcRelationship {
                    id: "rId9".to_string(),
                    rel_type: crate::write::REL_TABLE.to_string(),
                    target: "../tables/table9.xml".to_string(),
                    target_mode: None,
                },
            ],
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/tables/table9.xml".to_string(),
            crate::write::CT_TABLE.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    let table_rel = crate::domain::workbook::read::parse_all_rels(sheet_rels.as_bytes())
        .into_iter()
        .find(|rel| rel.rel_type == crate::write::REL_TABLE)
        .expect("table relationship should be emitted");

    assert!(archive.contains("xl/tables/table1.xml"));
    assert!(!archive.contains("xl/tables/table9.xml"));
    assert_ne!(table_rel.id, "rId4");
    assert!(sheet_xml.contains(&format!("<tablePart r:id=\"{}\"/>", table_rel.id)));
    assert!(sheet_rels.contains("Target=\"../tables/table1.xml\""));
    assert!(!sheet_rels.contains("table9.xml"));
    assert!(content_types.contains("PartName=\"/xl/tables/table1.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/tables/table9.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn duplicate_original_worksheet_relationship_ids_do_not_leak_to_generated_relationships() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        comments: vec![Comment {
            cell_ref: "A1".to_string(),
            author: "Tester".to_string(),
            content: Some("Header comment".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        }],
        tables: vec![TableSpec {
            id: 1,
            name: "Table1".to_string(),
            display_name: "Table1".to_string(),
            range_ref: "A1:B2".to_string(),
            has_headers: true,
            auto_filter_ref: Some("A1:B2".to_string()),
            columns: vec![
                TableColumnSpec {
                    name: "A".to_string(),
                    ..Default::default()
                },
                TableColumnSpec {
                    name: "B".to_string(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![
                domain_types::OpcRelationship {
                    id: "rId4".to_string(),
                    rel_type: REL_COMMENTS.to_string(),
                    target: "../comments1.xml".to_string(),
                    target_mode: None,
                },
                domain_types::OpcRelationship {
                    id: "rId5".to_string(),
                    rel_type: REL_VML_DRAWING.to_string(),
                    target: "../drawings/vmlDrawing1.vml".to_string(),
                    target_mode: None,
                },
                domain_types::OpcRelationship {
                    id: "rId4".to_string(),
                    rel_type: REL_TABLE.to_string(),
                    target: "../tables/table1.xml".to_string(),
                    target_mode: None,
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels_bytes = archive
        .read_file("xl/worksheets/_rels/sheet1.xml.rels")
        .unwrap();
    let rels = crate::domain::workbook::read::parse_all_rels(&sheet_rels_bytes);
    let comments_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_COMMENTS && rel.target == "../comments1.xml")
        .expect("comments relationship should be emitted");
    let vml_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_VML_DRAWING && rel.target == "../drawings/vmlDrawing1.vml")
        .expect("VML relationship should be emitted");
    let table_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_TABLE && rel.target == "../tables/table1.xml")
        .expect("table relationship should be emitted");
    let unique_ids: std::collections::BTreeSet<_> = rels.iter().map(|rel| &rel.id).collect();

    assert_eq!(unique_ids.len(), rels.len());
    assert_eq!(comments_rel.id, "rId4");
    assert_ne!(table_rel.id, comments_rel.id);
    assert!(sheet_xml.contains(&format!("<legacyDrawing r:id=\"{}\"/>", vml_rel.id)));
    assert!(sheet_xml.contains(&format!("<tablePart r:id=\"{}\"/>", table_rel.id)));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_table_sidecar_relationships_are_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        tables: vec![TableSpec {
            id: 1,
            name: "Table1".to_string(),
            display_name: "Table1".to_string(),
            range_ref: "A1:B2".to_string(),
            has_headers: true,
            auto_filter_ref: Some("A1:B2".to_string()),
            columns: vec![
                TableColumnSpec {
                    name: "A".to_string(),
                    ..Default::default()
                },
                TableColumnSpec {
                    name: "B".to_string(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId4".to_string(),
                rel_type: crate::write::REL_TABLE.to_string(),
                target: "../tables/table1.xml".to_string(),
                target_mode: None,
            }],
            table_xml_passthroughs: vec![domain_types::BlobPart {
                path: "xl/tables/_rels/table1.xml.rels".to_string(),
                data: br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable" Target="../queryTables/queryTable1.xml"/>
</Relationships>"#
                    .to_vec(),
            }],
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/queryTables/queryTable1.xml".to_string(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml"
                .to_string(),
        )],
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/queryTables/queryTable1.xml".to_string(),
            data: b"stale query table".to_vec(),
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    assert!(archive.contains("xl/tables/table1.xml"));
    assert!(!archive.contains("xl/tables/_rels/table1.xml.rels"));
    assert!(!archive.contains("xl/queryTables/queryTable1.xml"));
    let table_rel = crate::domain::workbook::read::parse_all_rels(sheet_rels.as_bytes())
        .into_iter()
        .find(|rel| rel.rel_type == crate::write::REL_TABLE)
        .expect("table relationship should be emitted");

    assert_ne!(table_rel.id, "rId4");
    assert!(sheet_xml.contains(&format!("<tablePart r:id=\"{}\"/>", table_rel.id)));
    assert!(sheet_rels.contains("Target=\"../tables/table1.xml\""));
    assert!(!content_types.contains("queryTable+xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn mutated_table_spec_regenerates_table_package_parts_from_current_model() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        tables: vec![TableSpec {
            id: 1,
            name: "Table1".to_string(),
            display_name: "Table1".to_string(),
            range_ref: "A1:C4".to_string(),
            has_headers: true,
            auto_filter_ref: Some("A1:C4".to_string()),
            columns: vec![
                TableColumnSpec {
                    id: 1,
                    name: "A".to_string(),
                    ..Default::default()
                },
                TableColumnSpec {
                    id: 2,
                    name: "B".to_string(),
                    ..Default::default()
                },
                TableColumnSpec {
                    id: 3,
                    name: "C".to_string(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId4".to_string(),
                rel_type: crate::write::REL_TABLE.to_string(),
                target: "../tables/table9.xml".to_string(),
                target_mode: None,
            }],
            sheet_preserved_elements: vec![(
                "worksheet\0after\0legacyDrawing\0tableParts".to_string(),
                r#"<tableParts count="1"><tablePart r:id="rIdStale"/></tableParts>"#.to_string(),
            )],
            table_xml_passthroughs: vec![domain_types::BlobPart {
                path: "xl/tables/table9.xml".to_string(),
                data: br#"<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="9" name="Table1" displayName="Table1" ref="A1:B2"><autoFilter ref="A1:B2"/><tableColumns count="2"><tableColumn id="1" name="OldA"/><tableColumn id="2" name="OldB"/></tableColumns></table>"#
                    .to_vec(),
            }],
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/tables/table9.xml".to_string(),
            crate::write::CT_TABLE.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let table_xml = String::from_utf8(archive.read_file("xl/tables/table1.xml").unwrap()).unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    assert!(sheet_xml.contains("<tableParts count=\"1\"><tablePart r:id=\"rId1\"/></tableParts>"));
    assert!(sheet_rels.contains("Target=\"../tables/table1.xml\""));
    assert!(!sheet_rels.contains("table9.xml"));
    assert!(table_xml.contains("ref=\"A1:C4\""));
    assert!(table_xml.contains("<autoFilter ref=\"A1:C4\"/>"));
    assert!(table_xml.contains("<tableColumns count=\"3\">"));
    assert!(table_xml.contains("name=\"C\""));
    assert!(!table_xml.contains("A1:B2"));
    assert!(!table_xml.contains("OldA"));
    assert!(!archive.contains("xl/tables/table9.xml"));
    assert!(content_types.contains("PartName=\"/xl/tables/table1.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/tables/table9.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_comment_relationships_use_graph_registered_parts_and_resolved_ids() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        comments: vec![Comment {
            cell_ref: "A1".to_string(),
            author: "Tester".to_string(),
            content: Some("Header comment".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![
                domain_types::OpcRelationship {
                    id: "rId7".to_string(),
                    rel_type: REL_COMMENTS.to_string(),
                    target: "../comments1.xml".to_string(),
                    target_mode: None,
                },
                domain_types::OpcRelationship {
                    id: "rId8".to_string(),
                    rel_type: REL_VML_DRAWING.to_string(),
                    target: "../drawings/vmlDrawing1.vml".to_string(),
                    target_mode: None,
                },
                domain_types::OpcRelationship {
                    id: "rId9".to_string(),
                    rel_type: REL_COMMENTS.to_string(),
                    target: "../comments9.xml".to_string(),
                    target_mode: None,
                },
            ],
            legacy_drawing_r_id: Some("rId8".to_string()),
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing1.vml".to_string(),
                data: b"<xml><rawVmlSentinel/></xml>".to_vec(),
                rels: Some(domain_types::VmlRels {
                    path: "xl/drawings/_rels/vmlDrawing1.vml.rels".to_string(),
                    data: b"<Relationships><rawVmlRelsSentinel/></Relationships>".to_vec(),
                }),
            }],
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/comments9.xml".to_string(),
            crate::write::CT_COMMENTS.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let vml_xml =
        String::from_utf8(archive.read_file("xl/drawings/vmlDrawing1.vml").unwrap()).unwrap();

    assert!(archive.contains("xl/drawings/vmlDrawing1.vml"));
    assert!(!archive.contains("xl/drawings/_rels/vmlDrawing1.vml.rels"));
    assert!(!archive.contains("xl/comments9.xml"));
    assert!(sheet_rels.contains("Id=\"rId7\""));
    assert!(sheet_rels.contains("Target=\"../comments1.xml\""));
    assert!(sheet_rels.contains("Id=\"rId8\""));
    assert!(sheet_rels.contains("Target=\"../drawings/vmlDrawing1.vml\""));
    assert!(!sheet_rels.contains("comments9.xml"));
    assert!(sheet_xml.contains("<legacyDrawing r:id=\"rId8\"/>"));
    assert!(content_types.contains("PartName=\"/xl/comments1.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/comments9.xml\""));
    assert!(vml_xml.contains("ObjectType=\"Note\""));
    assert!(!vml_xml.contains("rawVmlSentinel"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_comment_does_not_reuse_stale_comment_sidecar_identity_by_sheet_index() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        comments: vec![Comment {
            cell_ref: "A1".to_string(),
            author: "Fresh Author".to_string(),
            content: Some("Fresh note".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![
                domain_types::OpcRelationship {
                    id: "rId7".to_string(),
                    rel_type: REL_COMMENTS.to_string(),
                    target: "../comments7.xml".to_string(),
                    target_mode: None,
                },
                domain_types::OpcRelationship {
                    id: "rId8".to_string(),
                    rel_type: REL_VML_DRAWING.to_string(),
                    target: "../drawings/vmlDrawing9.vml".to_string(),
                    target_mode: None,
                },
            ],
            legacy_drawing_r_id: Some("rId8".to_string()),
            comments_root_namespace_attrs: vec![
                (
                    "xmlns".to_string(),
                    "http://schemas.openxmlformats.org/spreadsheetml/2006/main".to_string(),
                ),
                (
                    "xmlns:stale".to_string(),
                    "http://example.invalid/stale-comments".to_string(),
                ),
                ("mc:Ignorable".to_string(), "stale".to_string()),
            ],
            comment_authors: vec!["Stale Author".to_string()],
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing9.vml".to_string(),
                data: b"<xml><staleCommentVml/></xml>".to_vec(),
                rels: None,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let comments_xml = String::from_utf8(archive.read_file("xl/comments1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(comments_xml.contains("<author>Fresh Author</author>"));
    assert!(!comments_xml.contains("Stale Author"));
    assert!(!comments_xml.contains("stale-comments"));
    assert!(!comments_xml.contains("mc:Ignorable=\"stale\""));
    assert!(archive.contains("xl/drawings/vmlDrawing1.vml"));
    assert!(!archive.contains("xl/drawings/vmlDrawing9.vml"));
    assert!(sheet_rels.contains("Target=\"../comments1.xml\""));
    assert!(sheet_rels.contains("Target=\"../drawings/vmlDrawing1.vml\""));
    assert!(!sheet_rels.contains("comments7.xml"));
    assert!(!sheet_rels.contains("vmlDrawing9.vml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_hyperlink_relationship_uses_graph_resolved_id() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        hyperlinks: vec![
            Hyperlink {
                cell_ref: "A1".to_string(),
                target: Some("https://example.com".to_string()),
                display: Some("Example".to_string()),
                ..Default::default()
            },
            Hyperlink {
                cell_ref: "A2".to_string(),
                target: Some("https://example.org".to_string()),
                display: Some("Example Org".to_string()),
                ..Default::default()
            },
        ],
        comments: vec![Comment {
            cell_ref: "B1".to_string(),
            author: "Tester".to_string(),
            content: Some("Header comment".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![
                domain_types::OpcRelationship {
                    id: "rId5".to_string(),
                    rel_type: REL_HYPERLINK.to_string(),
                    target: "https://example.com".to_string(),
                    target_mode: Some("External".to_string()),
                },
                domain_types::OpcRelationship {
                    id: "rId1".to_string(),
                    rel_type: REL_HYPERLINK.to_string(),
                    target: "https://stale.example".to_string(),
                    target_mode: Some("External".to_string()),
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(sheet_rels.contains("Id=\"rId5\""));
    assert!(sheet_rels.contains("Target=\"https://example.com\""));
    assert!(sheet_xml.contains("<hyperlink ref=\"A1\" r:id=\"rId5\""));
    assert!(sheet_rels.contains("Target=\"https://example.org\""));
    assert!(!sheet_rels.contains("stale.example"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn duplicate_same_target_hyperlinks_use_distinct_graph_resolved_ids() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        hyperlinks: vec![
            Hyperlink {
                cell_ref: "A1".to_string(),
                target: Some("https://example.com".to_string()),
                display: Some("First".to_string()),
                ..Default::default()
            },
            Hyperlink {
                cell_ref: "A2".to_string(),
                target: Some("https://example.com".to_string()),
                display: Some("Second".to_string()),
                ..Default::default()
            },
        ],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![
                domain_types::OpcRelationship {
                    id: "rId5".to_string(),
                    rel_type: REL_HYPERLINK.to_string(),
                    target: "https://example.com".to_string(),
                    target_mode: Some("External".to_string()),
                },
                domain_types::OpcRelationship {
                    id: "rId6".to_string(),
                    rel_type: REL_HYPERLINK.to_string(),
                    target: "https://example.com".to_string(),
                    target_mode: Some("External".to_string()),
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(sheet_xml.contains("<hyperlink ref=\"A1\" r:id=\"rId5\""));
    assert!(sheet_xml.contains("<hyperlink ref=\"A2\" r:id=\"rId6\""));
    assert_eq!(
        sheet_rels.matches("Target=\"https://example.com\"").count(),
        2
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn fragment_hyperlink_relationship_is_not_marked_external() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        hyperlinks: vec![Hyperlink {
            cell_ref: "A1".to_string(),
            target: Some("#Sheet2!A1".to_string()),
            display: Some("Jump".to_string()),
            ..Default::default()
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId3".to_string(),
                rel_type: REL_HYPERLINK.to_string(),
                target: "#Sheet2!A1".to_string(),
                target_mode: None,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(sheet_xml.contains("<hyperlink ref=\"A1\" r:id=\"rId3\""));
    assert!(sheet_rels.contains("Id=\"rId3\""));
    assert!(sheet_rels.contains("Target=\"#Sheet2!A1\""));
    assert!(!sheet_rels.contains("TargetMode=\"External\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_control_property_relationship_uses_graph_registered_part() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        floating_objects: vec![domain_types::domain::floating_object::FloatingObject {
            common: domain_types::domain::floating_object::FloatingObjectCommon {
                name: "Check Box 1".to_string(),
                anchor: domain_types::domain::floating_object::FloatingObjectAnchor {
                    anchor_row: 0,
                    anchor_col: 0,
                    end_row: Some(2),
                    end_col: Some(2),
                    ..Default::default()
                },
                ..Default::default()
            },
            data: domain_types::domain::floating_object::FloatingObjectData::FormControl(
                domain_types::domain::floating_object::FormControlData {
                    control_type: "CheckBox".to_string(),
                    cell_link: Some("$A$1".to_string()),
                    input_range: None,
                    ooxml: Some(
                        domain_types::domain::floating_object::FormControlOoxmlProps {
                            shape_id: 1025,
                            checked: Some("Checked".to_string()),
                            anchor_source: "Modern".to_string(),
                            ..Default::default()
                        },
                    ),
                },
            ),
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![
                domain_types::OpcRelationship {
                    id: "rId9".to_string(),
                    rel_type: REL_CTRL_PROP.to_string(),
                    target: "../ctrlProps/ctrlProp9.xml".to_string(),
                    target_mode: None,
                },
                domain_types::OpcRelationship {
                    id: "rId10".to_string(),
                    rel_type: REL_VML_DRAWING.to_string(),
                    target: "../drawings/vmlDrawing1.vml".to_string(),
                    target_mode: None,
                },
            ],
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing1.vml".to_string(),
                data: b"<xml><rawFormControlVmlSentinel/></xml>".to_vec(),
                rels: Some(domain_types::VmlRels {
                    path: "xl/drawings/_rels/vmlDrawing1.vml.rels".to_string(),
                    data: b"<Relationships><rawFormControlVmlRelsSentinel/></Relationships>"
                        .to_vec(),
                }),
            }],
            worksheet_controls_xml: Some(
                r#"<mc:AlternateContent><controls><control shapeId="1025" r:id="rId99" name="Raw Control"/></controls><rawControlsSentinel/></mc:AlternateContent>"#
                    .to_string(),
            ),
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/ctrlProps/ctrlProp9.xml".to_string(),
            "application/vnd.ms-excel.controlproperties+xml".to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels_bytes = archive
        .read_file("xl/worksheets/_rels/sheet1.xml.rels")
        .unwrap();
    let sheet_rels = String::from_utf8(sheet_rels_bytes.clone()).unwrap();
    let rels = crate::domain::workbook::read::parse_all_rels(&sheet_rels_bytes);
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let vml_xml =
        String::from_utf8(archive.read_file("xl/drawings/vmlDrawing1.vml").unwrap()).unwrap();
    let ctrl_prop_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_CTRL_PROP && rel.target == "../ctrlProps/ctrlProp1.xml")
        .expect("generated ctrlProp relationship should target the graph-registered part");
    let vml_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_VML_DRAWING && rel.target == "../drawings/vmlDrawing1.vml")
        .expect("generated form-control VML relationship should target the graph-registered part");

    assert!(archive.contains("xl/ctrlProps/ctrlProp1.xml"));
    assert!(!archive.contains("xl/ctrlProps/ctrlProp9.xml"));
    assert!(archive.contains("xl/drawings/vmlDrawing1.vml"));
    assert!(!archive.contains("xl/drawings/_rels/vmlDrawing1.vml.rels"));
    assert!(!archive.contains("xl/drawings/vmlDrawing9.vml"));
    assert!(sheet_rels.contains("Target=\"../ctrlProps/ctrlProp1.xml\""));
    assert!(sheet_rels.contains("Target=\"../drawings/vmlDrawing1.vml\""));
    assert!(!sheet_rels.contains("ctrlProp9.xml"));
    assert!(!sheet_rels.contains("vmlDrawing9.vml"));
    assert_ne!(ctrl_prop_rel.id, "rId9");
    assert_ne!(vml_rel.id, "rId10");
    assert!(sheet_xml.contains(&format!(r#"r:id="{}""#, ctrl_prop_rel.id)));
    assert!(!sheet_xml.contains("rawControlsSentinel"));
    assert!(!sheet_xml.contains("r:id=\"rId99\""));
    assert!(sheet_xml.contains(&format!(r#"<legacyDrawing r:id="{}"/>"#, vml_rel.id)));
    assert!(content_types.contains("PartName=\"/xl/ctrlProps/ctrlProp1.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/ctrlProps/ctrlProp9.xml\""));
    assert!(!vml_xml.contains("rawFormControlVmlSentinel"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn comments_and_form_controls_share_generated_vml_without_raw_replay() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        comments: vec![Comment {
            cell_ref: "A1".to_string(),
            author: "Tester".to_string(),
            content: Some("Header comment".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        }],
        floating_objects: vec![domain_types::domain::floating_object::FloatingObject {
            common: domain_types::domain::floating_object::FloatingObjectCommon {
                name: "Check Box 1".to_string(),
                anchor: domain_types::domain::floating_object::FloatingObjectAnchor {
                    anchor_row: 1,
                    anchor_col: 1,
                    end_row: Some(3),
                    end_col: Some(3),
                    ..Default::default()
                },
                ..Default::default()
            },
            data: domain_types::domain::floating_object::FloatingObjectData::FormControl(
                domain_types::domain::floating_object::FormControlData {
                    control_type: "CheckBox".to_string(),
                    cell_link: Some("$B$2".to_string()),
                    input_range: None,
                    ooxml: Some(
                        domain_types::domain::floating_object::FormControlOoxmlProps {
                            shape_id: 1025,
                            checked: Some("Checked".to_string()),
                            anchor_source: "Modern".to_string(),
                            ..Default::default()
                        },
                    ),
                },
            ),
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId9".to_string(),
                rel_type: REL_VML_DRAWING.to_string(),
                target: "../drawings/vmlDrawing9.vml".to_string(),
                target_mode: None,
            }],
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing9.vml".to_string(),
                data: b"<xml><rawCombinedVmlSentinel/></xml>".to_vec(),
                rels: None,
            }],
            worksheet_controls_xml: Some(
                r#"<mc:AlternateContent><controls><control shapeId="1025" r:id="rId99" name="Raw Control"/></controls><rawControlsSentinel/></mc:AlternateContent>"#
                    .to_string(),
            ),
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels_bytes = archive
        .read_file("xl/worksheets/_rels/sheet1.xml.rels")
        .unwrap();
    let rels = crate::domain::workbook::read::parse_all_rels(&sheet_rels_bytes);
    let vml_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_VML_DRAWING)
        .expect("shared VML relationship should be emitted");
    let vml_xml =
        String::from_utf8(archive.read_file("xl/drawings/vmlDrawing1.vml").unwrap()).unwrap();

    assert_eq!(
        rels.iter()
            .filter(|rel| rel.rel_type == REL_VML_DRAWING)
            .count(),
        1
    );
    assert!(sheet_xml.contains(&format!(r#"<legacyDrawing r:id="{}"/>"#, vml_rel.id)));
    assert!(sheet_xml.contains(r#"shapeId="1026""#));
    assert!(!sheet_xml.contains("rawControlsSentinel"));
    assert!(!sheet_xml.contains(r#"shapeId="1025" r:id="rId99""#));
    assert!(vml_xml.contains("ObjectType=\"Note\""));
    assert!(vml_xml.contains("ObjectType=\"Checkbox\""));
    assert!(vml_xml.contains("id=\"_x0000_s1025\""));
    assert!(vml_xml.contains("id=\"_x0000_s1026\""));
    assert!(!vml_xml.contains("rawCombinedVmlSentinel"));
    assert!(!archive.contains("xl/drawings/vmlDrawing9.vml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn header_footer_vml_relationship_uses_graph_registered_part() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        hf_images: vec![domain_types::domain::print::HeaderFooterImageInfo {
            position: domain_types::domain::print::HfImagePosition::LeftHeader,
            src: "../media/image1.png".to_string(),
            title: "LH".to_string(),
            width_pt: 46.0,
            height_pt: 46.0,
        }],
        ..Default::default()
    }]);
    let hf_image = crate::domain::print::hf_images::HeaderFooterImage {
        position: crate::domain::print::hf_images::HfImagePosition::LeftHeader,
        image_rel_id: "rId1".to_string(),
        title: "LH".to_string(),
        width_pt: 46.0,
        height_pt: 46.0,
    };
    let hf_vml = crate::domain::print::hf_images::write_hf_images_vml(&[hf_image], "1", 13313);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId7".to_string(),
                rel_type: REL_VML_DRAWING.to_string(),
                target: "../drawings/vmlDrawing9.vml".to_string(),
                target_mode: None,
            }],
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing9.vml".to_string(),
                data: hf_vml.clone(),
                rels: Some(domain_types::VmlRels {
                    path: "xl/drawings/_rels/vmlDrawing9.vml.rels".to_string(),
                    data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#
                        .to_vec(),
                }),
            }],
            ..Default::default()
        }],
        opaque_package_subgraphs: vec![clean_opaque_hf_vml_subgraph(
            "xl/drawings/vmlDrawing9.vml",
            hf_vml,
            vec![("xl/media/image1.png", b"png bytes".to_vec())],
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels_bytes = archive
        .read_file("xl/worksheets/_rels/sheet1.xml.rels")
        .unwrap();
    let sheet_rels = String::from_utf8(sheet_rels_bytes.clone()).unwrap();
    let rels = crate::domain::workbook::read::parse_all_rels(&sheet_rels_bytes);
    let hf_vml_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_VML_DRAWING && rel.target == "../drawings/vmlDrawing9.vml")
        .expect("header/footer VML relationship should target the emitted VML part");
    let vml_rels = String::from_utf8(
        archive
            .read_file("xl/drawings/_rels/vmlDrawing9.vml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(archive.contains("xl/drawings/vmlDrawing9.vml"));
    assert!(archive.contains("xl/media/image1.png"));
    assert!(sheet_rels.contains("Target=\"../drawings/vmlDrawing9.vml\""));
    assert_ne!(hf_vml_rel.id, "rId7");
    assert!(vml_rels.contains("Id=\"rId1\""));
    assert!(vml_rels.contains("Target=\"../media/image1.png\""));
    assert!(sheet_xml.contains(&format!(r#"<legacyDrawingHF r:id="{}"/>"#, hf_vml_rel.id)));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn comments_after_high_number_header_footer_vml_use_graph_registered_vml_path() {
    let hf_image = crate::domain::print::hf_images::HeaderFooterImage {
        position: crate::domain::print::hf_images::HfImagePosition::LeftHeader,
        image_rel_id: "rId1".to_string(),
        title: "LH".to_string(),
        width_pt: 46.0,
        height_pt: 46.0,
    };
    let hf_vml = crate::domain::print::hf_images::write_hf_images_vml(&[hf_image], "1", 13313);
    let output = make_parse_output(vec![
        SheetData {
            name: "Sheet1".to_string(),
            hf_images: vec![domain_types::domain::print::HeaderFooterImageInfo {
                position: domain_types::domain::print::HfImagePosition::LeftHeader,
                src: "../media/image1.png".to_string(),
                title: "LH".to_string(),
                width_pt: 46.0,
                height_pt: 46.0,
            }],
            ..Default::default()
        },
        SheetData {
            name: "Sheet2".to_string(),
            comments: vec![Comment {
                cell_ref: "A1".to_string(),
                author: "Tester".to_string(),
                content: Some("Generated note".to_string()),
                comment_type: CommentType::Note,
                ..Default::default()
            }],
            ..Default::default()
        },
    ]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![
            domain_types::SheetRoundTripContext {
                sheet_opc_rels: vec![domain_types::OpcRelationship {
                    id: "rId7".to_string(),
                    rel_type: REL_VML_DRAWING.to_string(),
                    target: "../drawings/vmlDrawing9.vml".to_string(),
                    target_mode: None,
                }],
                raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                    path: "xl/drawings/vmlDrawing9.vml".to_string(),
                    data: hf_vml.clone(),
                    rels: Some(domain_types::VmlRels {
                        path: "xl/drawings/_rels/vmlDrawing9.vml.rels".to_string(),
                        data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#
                            .to_vec(),
                    }),
                }],
                ..Default::default()
            },
            domain_types::SheetRoundTripContext::default(),
        ],
        opaque_package_subgraphs: vec![clean_opaque_hf_vml_subgraph(
            "xl/drawings/vmlDrawing9.vml",
            hf_vml,
            vec![("xl/media/image1.png", b"png bytes".to_vec())],
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet2_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet2.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(archive.contains("xl/drawings/vmlDrawing9.vml"));
    assert!(archive.contains("xl/drawings/vmlDrawing10.vml"));
    assert!(!archive.contains("xl/drawings/vmlDrawing1.vml"));
    assert!(sheet2_rels.contains("Target=\"../drawings/vmlDrawing10.vml\""));
    assert!(!sheet2_rels.contains("vmlDrawing1.vml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn header_footer_vml_requires_clean_opaque_vml_part() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        hf_images: vec![domain_types::domain::print::HeaderFooterImageInfo {
            position: domain_types::domain::print::HfImagePosition::LeftHeader,
            src: "../media/image1.png".to_string(),
            title: "LH".to_string(),
            width_pt: 46.0,
            height_pt: 46.0,
        }],
        ..Default::default()
    }]);
    let hf_image = crate::domain::print::hf_images::HeaderFooterImage {
        position: crate::domain::print::hf_images::HfImagePosition::LeftHeader,
        image_rel_id: "rId1".to_string(),
        title: "LH".to_string(),
        width_pt: 46.0,
        height_pt: 46.0,
    };
    let hf_vml = crate::domain::print::hf_images::write_hf_images_vml(&[hf_image], "1", 13313);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId7".to_string(),
                rel_type: REL_VML_DRAWING.to_string(),
                target: "../drawings/vmlDrawing9.vml".to_string(),
                target_mode: None,
            }],
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing9.vml".to_string(),
                data: hf_vml.clone(),
                rels: Some(domain_types::VmlRels {
                    path: "xl/drawings/_rels/vmlDrawing9.vml.rels".to_string(),
                    data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#
                        .to_vec(),
                }),
            }],
            ..Default::default()
        }],
        opaque_package_subgraphs: vec![clean_opaque_media_subgraph(
            "xl/media/image1.png",
            b"png bytes".to_vec(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/drawings/vmlDrawing9.vml"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!sheet_xml.contains("legacyDrawingHF"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_header_footer_vml_is_dropped_without_modeled_hf_images() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let hf_image = crate::domain::print::hf_images::HeaderFooterImage {
        position: crate::domain::print::hf_images::HfImagePosition::LeftHeader,
        image_rel_id: "rId1".to_string(),
        title: "LH".to_string(),
        width_pt: 46.0,
        height_pt: 46.0,
    };
    let hf_vml = crate::domain::print::hf_images::write_hf_images_vml(&[hf_image], "1", 13313);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId7".to_string(),
                rel_type: REL_VML_DRAWING.to_string(),
                target: "../drawings/vmlDrawing9.vml".to_string(),
                target_mode: None,
            }],
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing9.vml".to_string(),
                data: hf_vml.clone(),
                rels: None,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/drawings/vmlDrawing9.vml"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!sheet_xml.contains("legacyDrawingHF"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn header_footer_vml_drops_images_without_graph_registered_media() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        hf_images: vec![domain_types::domain::print::HeaderFooterImageInfo {
            position: domain_types::domain::print::HfImagePosition::LeftHeader,
            src: "../media/image1.png".to_string(),
            title: "LH".to_string(),
            width_pt: 46.0,
            height_pt: 46.0,
        }],
        ..Default::default()
    }]);
    let hf_images = vec![
        crate::domain::print::hf_images::HeaderFooterImage {
            position: crate::domain::print::hf_images::HfImagePosition::LeftHeader,
            image_rel_id: "rId1".to_string(),
            title: "LH".to_string(),
            width_pt: 46.0,
            height_pt: 46.0,
        },
        crate::domain::print::hf_images::HeaderFooterImage {
            position: crate::domain::print::hf_images::HfImagePosition::RightHeader,
            image_rel_id: "rId9".to_string(),
            title: "RH".to_string(),
            width_pt: 46.0,
            height_pt: 46.0,
        },
    ];
    let hf_vml = crate::domain::print::hf_images::write_hf_images_vml(&hf_images, "1", 13313);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId7".to_string(),
                rel_type: REL_VML_DRAWING.to_string(),
                target: "../drawings/vmlDrawing9.vml".to_string(),
                target_mode: None,
            }],
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing9.vml".to_string(),
                data: hf_vml.clone(),
                rels: Some(domain_types::VmlRels {
                    path: "xl/drawings/_rels/vmlDrawing9.vml.rels".to_string(),
                    data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image9.png"/></Relationships>"#.to_vec(),
                }),
            }],
            ..Default::default()
        }],
        opaque_package_subgraphs: vec![clean_opaque_hf_vml_subgraph(
            "xl/drawings/vmlDrawing9.vml",
            hf_vml,
            vec![("xl/media/image1.png", b"png bytes".to_vec())],
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let vml_xml =
        String::from_utf8(archive.read_file("xl/drawings/vmlDrawing9.vml").unwrap()).unwrap();
    let vml_rels = String::from_utf8(
        archive
            .read_file("xl/drawings/_rels/vmlDrawing9.vml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(archive.contains("xl/media/image1.png"));
    assert!(!archive.contains("xl/media/image9.png"));
    assert!(vml_xml.contains("id=\"LH\""));
    assert!(!vml_xml.contains("id=\"RH\""));
    assert!(vml_rels.contains("Id=\"rId1\""));
    assert!(!vml_rels.contains("Id=\"rId9\""));
    assert!(!vml_rels.contains("image9.png"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn header_footer_vml_drops_media_from_dirty_opaque_subgraph() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        hf_images: vec![domain_types::domain::print::HeaderFooterImageInfo {
            position: domain_types::domain::print::HfImagePosition::LeftHeader,
            src: "../media/image1.png".to_string(),
            title: "LH".to_string(),
            width_pt: 46.0,
            height_pt: 46.0,
        }],
        ..Default::default()
    }]);
    let hf_image = crate::domain::print::hf_images::HeaderFooterImage {
        position: crate::domain::print::hf_images::HfImagePosition::LeftHeader,
        image_rel_id: "rId1".to_string(),
        title: "LH".to_string(),
        width_pt: 46.0,
        height_pt: 46.0,
    };
    let hf_vml = crate::domain::print::hf_images::write_hf_images_vml(&[hf_image], "1", 13313);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId7".to_string(),
                rel_type: REL_VML_DRAWING.to_string(),
                target: "../drawings/vmlDrawing9.vml".to_string(),
                target_mode: None,
            }],
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing9.vml".to_string(),
                data: hf_vml.clone(),
                rels: Some(domain_types::VmlRels {
                    path: "xl/drawings/_rels/vmlDrawing9.vml.rels".to_string(),
                    data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#
                        .to_vec(),
                }),
            }],
            ..Default::default()
        }],
        opaque_package_subgraphs: vec![
            clean_opaque_hf_vml_subgraph("xl/drawings/vmlDrawing9.vml", hf_vml, Vec::new()),
            domain_types::OpaquePackageSubgraph {
                owner: domain_types::OpaquePackageOwner::Part {
                    path: "xl/media/image1.png".to_string(),
                },
                owner_relationship: domain_types::OpaquePackageRelationship {
                    owner: domain_types::OpaquePackageOwner::Part {
                        path: "xl/media/image1.png".to_string(),
                    },
                    relationship_type: String::new(),
                    target: domain_types::OpaqueRelationshipTarget::InternalPath {
                        target: String::new(),
                    },
                    relationship_id_hint: None,
                },
                parts: vec![domain_types::OpaquePackagePart {
                    part: domain_types::BlobPart {
                        path: "xl/media/image1.png".to_string(),
                        data: b"dirty png bytes".to_vec(),
                    },
                    content_type: None,
                    default_extension: Some(("png".to_string(), "image/png".to_string())),
                    ownership: domain_types::OpaquePackageOwnership::CleanImported,
                }],
                relationships: Vec::new(),
                ownership: domain_types::OpaquePackageOwnership::DirtyImported,
            },
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/drawings/vmlDrawing9.vml"));
    assert!(!archive.contains("xl/media/image1.png"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!sheet_xml.contains("legacyDrawingHF"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn header_footer_vml_requires_closed_opaque_subgraph() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        hf_images: vec![domain_types::domain::print::HeaderFooterImageInfo {
            position: domain_types::domain::print::HfImagePosition::LeftHeader,
            src: "../media/image1.png".to_string(),
            title: "LH".to_string(),
            width_pt: 46.0,
            height_pt: 46.0,
        }],
        ..Default::default()
    }]);
    let hf_image = crate::domain::print::hf_images::HeaderFooterImage {
        position: crate::domain::print::hf_images::HfImagePosition::LeftHeader,
        image_rel_id: "rId1".to_string(),
        title: "LH".to_string(),
        width_pt: 46.0,
        height_pt: 46.0,
    };
    let hf_vml = crate::domain::print::hf_images::write_hf_images_vml(&[hf_image], "1", 13313);
    let mut opaque_subgraph = clean_opaque_hf_vml_subgraph(
        "xl/drawings/vmlDrawing9.vml",
        hf_vml.clone(),
        vec![("xl/media/image1.png", b"png bytes".to_vec())],
    );
    opaque_subgraph.parts.push(domain_types::OpaquePackagePart {
        part: domain_types::BlobPart {
            path: "xl/drawings/_rels/vmlDrawing9.vml.rels".to_string(),
            data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/><Relationship Id="rIdDangling" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/missing.png"/></Relationships>"#
                .to_vec(),
        },
        content_type: None,
        default_extension: Some((
            "rels".to_string(),
            "application/vnd.openxmlformats-package.relationships+xml".to_string(),
        )),
        ownership: domain_types::OpaquePackageOwnership::CleanImported,
    });
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId7".to_string(),
                rel_type: REL_VML_DRAWING.to_string(),
                target: "../drawings/vmlDrawing9.vml".to_string(),
                target_mode: None,
            }],
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing9.vml".to_string(),
                data: hf_vml.clone(),
                rels: Some(domain_types::VmlRels {
                    path: "xl/drawings/_rels/vmlDrawing9.vml.rels".to_string(),
                    data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#
                        .to_vec(),
                }),
            }],
            ..Default::default()
        }],
        opaque_package_subgraphs: vec![opaque_subgraph],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/drawings/vmlDrawing9.vml"));
    assert!(!archive.contains("xl/media/image1.png"));
    assert!(!archive.contains("xl/media/missing.png"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!sheet_xml.contains("legacyDrawingHF"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn header_footer_vml_drops_clean_media_without_modeled_image() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        hf_images: vec![domain_types::domain::print::HeaderFooterImageInfo {
            position: domain_types::domain::print::HfImagePosition::LeftHeader,
            src: "../media/image1.png".to_string(),
            title: "Modeled LH".to_string(),
            width_pt: 52.0,
            height_pt: 53.0,
        }],
        ..Default::default()
    }]);
    let hf_images = vec![
        crate::domain::print::hf_images::HeaderFooterImage {
            position: crate::domain::print::hf_images::HfImagePosition::LeftHeader,
            image_rel_id: "rId1".to_string(),
            title: "Raw LH".to_string(),
            width_pt: 46.0,
            height_pt: 46.0,
        },
        crate::domain::print::hf_images::HeaderFooterImage {
            position: crate::domain::print::hf_images::HfImagePosition::RightHeader,
            image_rel_id: "rId9".to_string(),
            title: "Raw RH".to_string(),
            width_pt: 46.0,
            height_pt: 46.0,
        },
    ];
    let hf_vml = crate::domain::print::hf_images::write_hf_images_vml(&hf_images, "1", 13313);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId7".to_string(),
                rel_type: REL_VML_DRAWING.to_string(),
                target: "../drawings/vmlDrawing9.vml".to_string(),
                target_mode: None,
            }],
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing9.vml".to_string(),
                data: hf_vml.clone(),
                rels: Some(domain_types::VmlRels {
                    path: "xl/drawings/_rels/vmlDrawing9.vml.rels".to_string(),
                    data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image9.png"/></Relationships>"#.to_vec(),
                }),
            }],
            ..Default::default()
        }],
        opaque_package_subgraphs: vec![clean_opaque_hf_vml_subgraph(
            "xl/drawings/vmlDrawing9.vml",
            hf_vml,
            vec![
                ("xl/media/image1.png", b"png bytes 1".to_vec()),
                ("xl/media/image9.png", b"png bytes 9".to_vec()),
            ],
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let vml_xml =
        String::from_utf8(archive.read_file("xl/drawings/vmlDrawing9.vml").unwrap()).unwrap();
    let vml_rels = String::from_utf8(
        archive
            .read_file("xl/drawings/_rels/vmlDrawing9.vml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(archive.contains("xl/media/image1.png"));
    assert!(archive.contains("xl/media/image9.png"));
    assert!(vml_xml.contains("id=\"LH\""));
    assert!(vml_xml.contains("o:title=\"Modeled LH\""));
    assert!(vml_xml.contains("width:52pt;height:53pt"));
    assert!(!vml_xml.contains("id=\"RH\""));
    assert!(!vml_xml.contains("Raw RH"));
    assert!(vml_rels.contains("Id=\"rId1\""));
    assert!(!vml_rels.contains("Id=\"rId9\""));
    assert!(!vml_rels.contains("image9.png"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn printer_settings_relationship_requires_graph_registered_binary_part() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        print_settings: Some(domain_types::PrintSettings {
            r_id: Some("rId7".to_string()),
            imported_printer_settings: Some(domain_types::ImportedPrinterSettingsIdentity {
                path: "xl/printerSettings/printerSettings9.bin".to_string(),
                relationship_id: Some("rId7".to_string()),
                page_setup: domain_types::PrinterSettingsPageSetupFingerprint {
                    paper_size: Some(9),
                    has_page_setup: true,
                    ..Default::default()
                },
            }),
            has_page_setup: true,
            paper_size: Some(9),
            ..Default::default()
        }),
        ..Default::default()
    }]);
    let clean_printer_settings = domain_types::BlobPart {
        path: "xl/printerSettings/printerSettings9.bin".to_string(),
        data: b"clean printer settings".to_vec(),
    };
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![
                domain_types::OpcRelationship {
                    id: "rId7".to_string(),
                    rel_type: REL_PRINTER_SETTINGS.to_string(),
                    target: "../printerSettings/printerSettings9.bin".to_string(),
                    target_mode: None,
                },
                domain_types::OpcRelationship {
                    id: "rId9".to_string(),
                    rel_type: REL_PRINTER_SETTINGS.to_string(),
                    target: "../printerSettings/printerSettings1.bin".to_string(),
                    target_mode: None,
                },
            ],
            ..Default::default()
        }],
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/printerSettings/printerSettings1.bin".to_string(),
            data: b"stale printer settings".to_vec(),
        }],
        opaque_package_subgraphs: vec![domain_types::OpaquePackageSubgraph {
            owner: domain_types::OpaquePackageOwner::Part {
                path: clean_printer_settings.path.clone(),
            },
            owner_relationship: domain_types::OpaquePackageRelationship {
                owner: domain_types::OpaquePackageOwner::Part {
                    path: clean_printer_settings.path.clone(),
                },
                relationship_type: String::new(),
                target: domain_types::OpaqueRelationshipTarget::InternalPath {
                    target: String::new(),
                },
                relationship_id_hint: None,
            },
            parts: vec![domain_types::OpaquePackagePart {
                part: clean_printer_settings,
                content_type: None,
                default_extension: Some((
                    "bin".to_string(),
                    crate::write::CT_PRINTER_SETTINGS.to_string(),
                )),
                ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
            }],
            relationships: Vec::new(),
            ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/printerSettings/printerSettings9.bin"));
    assert!(!archive.contains("xl/printerSettings/printerSettings1.bin"));
    assert!(sheet_xml.contains("<pageSetup"));
    assert!(sheet_xml.contains("r:id=\"rId7\""));
    assert!(sheet_rels.contains("Id=\"rId7\""));
    assert!(sheet_rels.contains("Target=\"../printerSettings/printerSettings9.bin\""));
    assert!(!sheet_rels.contains("printerSettings1.bin"));
    assert!(content_types.contains(r#"Extension="bin""#));
    assert!(content_types.contains(crate::write::CT_PRINTER_SETTINGS));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn printer_settings_without_imported_identity_does_not_wire_clean_orphan_binary() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        print_settings: Some(domain_types::PrintSettings {
            r_id: Some("rIdStalePrinter".to_string()),
            has_page_setup: true,
            paper_size: Some(9),
            ..Default::default()
        }),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rIdStalePrinter".to_string(),
                rel_type: REL_PRINTER_SETTINGS.to_string(),
                target: "../printerSettings/printerSettings1.bin".to_string(),
                target_mode: None,
            }],
            ..Default::default()
        }],
        opaque_package_subgraphs: vec![domain_types::OpaquePackageSubgraph {
            owner: domain_types::OpaquePackageOwner::Part {
                path: "xl/printerSettings/printerSettings1.bin".to_string(),
            },
            owner_relationship: domain_types::OpaquePackageRelationship {
                owner: domain_types::OpaquePackageOwner::Part {
                    path: "xl/printerSettings/printerSettings1.bin".to_string(),
                },
                relationship_type: String::new(),
                target: domain_types::OpaqueRelationshipTarget::InternalPath {
                    target: String::new(),
                },
                relationship_id_hint: None,
            },
            parts: vec![domain_types::OpaquePackagePart {
                part: domain_types::BlobPart {
                    path: "xl/printerSettings/printerSettings1.bin".to_string(),
                    data: b"orphan printer settings".to_vec(),
                },
                content_type: None,
                default_extension: Some((
                    "bin".to_string(),
                    crate::write::CT_PRINTER_SETTINGS.to_string(),
                )),
                ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
            }],
            relationships: Vec::new(),
            ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(archive.contains("xl/printerSettings/printerSettings1.bin"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(sheet_xml.contains("<pageSetup"));
    assert!(!sheet_xml.contains("r:id="));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn mutated_printer_settings_do_not_reuse_imported_binary_identity() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        print_settings: Some(domain_types::PrintSettings {
            r_id: Some("rId7".to_string()),
            imported_printer_settings: Some(domain_types::ImportedPrinterSettingsIdentity {
                path: "xl/printerSettings/printerSettings9.bin".to_string(),
                relationship_id: Some("rId7".to_string()),
                page_setup: domain_types::PrinterSettingsPageSetupFingerprint {
                    paper_size: Some(9),
                    has_page_setup: true,
                    ..Default::default()
                },
            }),
            has_page_setup: true,
            paper_size: Some(9),
            orientation: Some("landscape".to_string()),
            ..Default::default()
        }),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId7".to_string(),
                rel_type: REL_PRINTER_SETTINGS.to_string(),
                target: "../printerSettings/printerSettings9.bin".to_string(),
                target_mode: None,
            }],
            ..Default::default()
        }],
        opaque_package_subgraphs: vec![domain_types::OpaquePackageSubgraph {
            owner: domain_types::OpaquePackageOwner::Part {
                path: "xl/printerSettings/printerSettings9.bin".to_string(),
            },
            owner_relationship: domain_types::OpaquePackageRelationship {
                owner: domain_types::OpaquePackageOwner::Part {
                    path: "xl/printerSettings/printerSettings9.bin".to_string(),
                },
                relationship_type: String::new(),
                target: domain_types::OpaqueRelationshipTarget::InternalPath {
                    target: String::new(),
                },
                relationship_id_hint: None,
            },
            parts: vec![domain_types::OpaquePackagePart {
                part: domain_types::BlobPart {
                    path: "xl/printerSettings/printerSettings9.bin".to_string(),
                    data: b"stale printer settings".to_vec(),
                },
                content_type: None,
                default_extension: Some((
                    "bin".to_string(),
                    crate::write::CT_PRINTER_SETTINGS.to_string(),
                )),
                ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
            }],
            relationships: Vec::new(),
            ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/printerSettings/printerSettings9.bin"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(sheet_xml.contains("<pageSetup"));
    assert!(sheet_xml.contains(r#"orientation="landscape""#));
    assert!(!sheet_xml.contains("r:id="));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn printer_settings_relationship_requires_package_graph_registered_part() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        print_settings: Some(domain_types::PrintSettings {
            r_id: Some("rId7".to_string()),
            has_page_setup: true,
            paper_size: Some(9),
            ..Default::default()
        }),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId7".to_string(),
                rel_type: REL_PRINTER_SETTINGS.to_string(),
                target: "../printerSettings/printerSettings9.bin".to_string(),
                target_mode: None,
            }],
            ..Default::default()
        }],
        opaque_package_subgraphs: vec![domain_types::OpaquePackageSubgraph {
            owner: domain_types::OpaquePackageOwner::Part {
                path: "xl/printerSettings/printerSettings9.bin".to_string(),
            },
            owner_relationship: domain_types::OpaquePackageRelationship {
                owner: domain_types::OpaquePackageOwner::Part {
                    path: "xl/printerSettings/printerSettings9.bin".to_string(),
                },
                relationship_type: String::new(),
                target: domain_types::OpaqueRelationshipTarget::InternalPath {
                    target: String::new(),
                },
                relationship_id_hint: None,
            },
            parts: vec![domain_types::OpaquePackagePart {
                part: domain_types::BlobPart {
                    path: "xl/printerSettings/printerSettings9.bin".to_string(),
                    data: b"dirty printer settings".to_vec(),
                },
                content_type: None,
                default_extension: Some((
                    "bin".to_string(),
                    crate::write::CT_PRINTER_SETTINGS.to_string(),
                )),
                ownership: domain_types::OpaquePackageOwnership::CleanImported,
            }],
            relationships: Vec::new(),
            ownership: domain_types::OpaquePackageOwnership::DirtyImported,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/printerSettings/printerSettings9.bin"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(sheet_xml.contains("<pageSetup"));
    assert!(!sheet_xml.contains("r:id="));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn duplicate_original_workbook_relationship_ids_do_not_leak_to_generated_relationships() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(0, 0, DomainValue::Text(Arc::from("hello")))],
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
                id: "rId1".to_string(),
                rel_type: crate::write::REL_SHARED_STRINGS.to_string(),
                target: "sharedStrings.xml".to_string(),
                target_mode: None,
            },
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels = archive.read_file("xl/_rels/workbook.xml.rels").unwrap();
    let rels = crate::domain::workbook::read::parse_all_rels(&workbook_rels);
    let mut ids = std::collections::HashSet::new();

    for rel in rels {
        assert!(ids.insert(rel.id), "relationship IDs must be unique");
    }
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

fn drawing_embed_ids(xml: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut rest = xml;
    while let Some(pos) = rest.find("r:embed=\"") {
        rest = &rest[pos + "r:embed=\"".len()..];
        let Some(end) = rest.find('"') else {
            break;
        };
        ids.push(rest[..end].to_string());
        rest = &rest[end..];
    }
    ids
}
