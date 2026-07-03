use super::*;

#[test]
fn drawing_export_preserves_distinct_image_relationships_to_same_media_part() {
    use domain_types::domain::floating_object::{
        AnchorMode, FloatingObject, FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData,
        PictureData, PictureOoxmlProps,
    };

    fn picture(id: &str, anchor_col: u32) -> FloatingObject {
        let mut picture = ooxml_types::drawings::SpreadsheetPicture::default();
        picture.blip_fill.embed_id = Some("rIdImported".to_string());
        FloatingObject {
            common: FloatingObjectCommon {
                id: id.to_string(),
                name: id.to_string(),
                width: 100.0,
                height: 40.0,
                anchor: FloatingObjectAnchor {
                    anchor_col,
                    end_col: Some(anchor_col + 1),
                    end_row: Some(1),
                    anchor_mode: AnchorMode::TwoCell,
                    ..Default::default()
                },
                ..Default::default()
            },
            data: FloatingObjectData::Picture(PictureData {
                src: "data:image/png;base64,AQIDBA==".to_string(),
                original_width: None,
                original_height: None,
                crop: None,
                adjustments: None,
                border: None,
                color_type: None,
                ooxml: Some(PictureOoxmlProps {
                    picture,
                    image_path: Some("../media/image1.png".to_string()),
                    ..Default::default()
                }),
            }),
        }
    }

    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        floating_objects: vec![picture("Picture 1", 0), picture("Picture 2", 2)],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();
    let drawing_rels = crate::domain::workbook::read::parse_all_rels(
        &archive
            .read_file("xl/drawings/_rels/drawing1.xml.rels")
            .unwrap(),
    );

    assert!(drawing_xml.contains(r#"r:embed="rId1""#));
    assert!(drawing_xml.contains(r#"r:embed="rId2""#));
    let image_rels: Vec<_> = drawing_rels
        .iter()
        .filter(|rel| rel.rel_type == crate::infra::opc::REL_IMAGE)
        .collect();
    assert_eq!(image_rels.len(), 2);
    assert!(image_rels.iter().any(|rel| rel.id == "rId1"));
    assert!(image_rels.iter().any(|rel| rel.id == "rId2"));
    assert!(
        image_rels
            .iter()
            .all(|rel| rel.target == "../media/image1.png")
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn drawing_picture_external_link_relationship_is_registered_from_owner_state() {
    use domain_types::domain::floating_object::{
        AnchorMode, FloatingObject, FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData,
        PictureData, PictureOoxmlProps,
    };

    let mut picture = ooxml_types::drawings::SpreadsheetPicture::default();
    picture.blip_fill.embed_id = Some("rIdImported".to_string());
    picture.blip_fill.link_id = Some("rId2".to_string());

    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        floating_objects: vec![FloatingObject {
            common: FloatingObjectCommon {
                id: "Picture 1".to_string(),
                name: "Picture 1".to_string(),
                width: 100.0,
                height: 40.0,
                anchor: FloatingObjectAnchor {
                    end_col: Some(1),
                    end_row: Some(1),
                    anchor_mode: AnchorMode::TwoCell,
                    ..Default::default()
                },
                ..Default::default()
            },
            data: FloatingObjectData::Picture(PictureData {
                src: "data:image/png;base64,AQIDBA==".to_string(),
                original_width: None,
                original_height: None,
                crop: None,
                adjustments: None,
                border: None,
                color_type: None,
                ooxml: Some(PictureOoxmlProps {
                    picture,
                    image_path: Some("../media/image1.png".to_string()),
                    relationships: vec![ooxml_types::shared::OpcRelationship {
                        id: "rId2".to_string(),
                        rel_type: crate::infra::opc::REL_IMAGE.to_string(),
                        target: "cid:linked-image".to_string(),
                        target_mode: Some("External".to_string()),
                    }],
                    ..Default::default()
                }),
            }),
        }],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();
    let drawing_rels = crate::domain::workbook::read::parse_all_rels(
        &archive
            .read_file("xl/drawings/_rels/drawing1.xml.rels")
            .unwrap(),
    );

    assert!(drawing_xml.contains(r#"r:link="rId2""#));
    assert!(drawing_rels.iter().any(|rel| {
        rel.id == "rId2"
            && rel.rel_type == crate::infra::opc::REL_IMAGE
            && rel.target == "cid:linked-image"
            && rel.target_mode.as_deref() == Some("External")
    }));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn drawing_picture_without_current_payload_drops_internal_embed_relationship() {
    let mut picture = imported_picture_with_media("Picture 1", "../media/image1.png");
    if let domain_types::domain::floating_object::FloatingObjectData::Picture(data) =
        &mut picture.data
    {
        data.src = "../media/image1.png".to_string();
        data.ooxml.as_mut().unwrap().relationships = vec![ooxml_types::shared::OpcRelationship {
            id: "rIdImported".to_string(),
            rel_type: crate::infra::opc::REL_IMAGE.to_string(),
            target: "../media/image1.png".to_string(),
            target_mode: None,
        }];
    }

    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        floating_objects: vec![picture],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();

    assert!(!drawing_xml.contains("r:embed="));
    assert!(archive.read_file("xl/media/image1.png").is_err());
    if let Ok(rels_bytes) = archive.read_file("xl/drawings/_rels/drawing1.xml.rels") {
        let drawing_rels = crate::domain::workbook::read::parse_all_rels(&rels_bytes);
        assert!(
            drawing_rels
                .iter()
                .all(|rel| rel.rel_type != crate::infra::opc::REL_IMAGE)
        );
    }
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn drawing_picture_absolute_media_target_writes_payload_to_resolved_part() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        floating_objects: vec![imported_picture_with_media(
            "Picture 1",
            "/xl/media/image1.png",
        )],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();
    let drawing_rels = crate::domain::workbook::read::parse_all_rels(
        &archive
            .read_file("xl/drawings/_rels/drawing1.xml.rels")
            .unwrap(),
    );
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(drawing_xml.contains(r#"r:embed="rId1""#));
    assert_eq!(
        archive.read_file("xl/media/image1.png").unwrap(),
        vec![1, 2, 3, 4]
    );
    assert!(drawing_rels.iter().any(|rel| {
        rel.id == "rId1"
            && rel.rel_type == crate::infra::opc::REL_IMAGE
            && rel.target == "../media/image1.png"
            && rel.target_mode.is_none()
    }));
    assert!(content_types.contains(r#"Extension="png" ContentType="image/png""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn drawing_picture_current_payload_replaces_imported_embedded_media() {
    let mut picture = imported_picture_with_media("Picture 1", "../media/image1.png");
    if let domain_types::domain::floating_object::FloatingObjectData::Picture(data) =
        &mut picture.data
    {
        data.src = "data:image/png;base64,CQgHBg==".to_string();
    }

    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        floating_objects: vec![picture],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");

    assert_eq!(
        archive.read_file("xl/media/image1.png").unwrap(),
        vec![9, 8, 7, 6]
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn opaque_graphic_frame_missing_internal_target_is_omitted_without_dangling_rels() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        floating_objects: vec![opaque_graphic_frame(
            "rIdOpaque",
            "http://example.invalid/relationships/opaqueFrame",
            "../customXml/missing-frame.xml",
        )],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).expect("stale frame target must not block");
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();

    assert!(!drawing_xml.contains("rIdOpaque"));
    assert!(!drawing_xml.contains("custom:payload"));
    assert!(!archive.contains("xl/customXml/missing-frame.xml"));
    if let Ok(rels_bytes) = archive.read_file("xl/drawings/_rels/drawing1.xml.rels") {
        let drawing_rels = crate::domain::workbook::read::parse_all_rels(&rels_bytes);
        assert!(drawing_rels.iter().all(|rel| rel.id != "rIdOpaque"));
    }
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn opaque_graphic_frame_valid_imported_closure_is_preserved() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        floating_objects: vec![opaque_graphic_frame(
            "rIdOpaque",
            "http://example.invalid/relationships/opaqueFrame",
            "../customXml/frame1.xml",
        )],
        ..Default::default()
    }]);
    output.package_fidelity = Some(domain_types::PackageFidelityMetadata {
        opaque_parts: vec![
            domain_types::OpaquePackagePartHint {
                path: "xl/customXml/frame1.xml".to_string(),
                bytes: br#"<custom:frame xmlns:custom="urn:mog:test" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdChild"/>"#.to_vec(),
                content_type: Some("application/xml".to_string()),
                relationships: vec![domain_types::PackageRelationshipHint {
                    id: "rIdChild".to_string(),
                    relationship_type: "http://example.invalid/relationships/frameChild"
                        .to_string(),
                    target: "frame-child.xml".to_string(),
                    target_mode: None,
                }],
            },
            domain_types::OpaquePackagePartHint {
                path: "xl/customXml/frame-child.xml".to_string(),
                bytes: br#"<custom:child xmlns:custom="urn:mog:test"/>"#.to_vec(),
                content_type: Some("application/xml".to_string()),
                relationships: Vec::new(),
            },
        ],
        ..Default::default()
    });

    let bytes = write_xlsx_from_parse_output(&output).expect("valid frame closure should export");
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();
    let drawing_rels = crate::domain::workbook::read::parse_all_rels(
        &archive
            .read_file("xl/drawings/_rels/drawing1.xml.rels")
            .unwrap(),
    );
    let frame_rels = crate::domain::workbook::read::parse_all_rels(
        &archive
            .read_file("xl/customXml/_rels/frame1.xml.rels")
            .unwrap(),
    );

    assert!(drawing_xml.contains(r#"r:id="rIdOpaque""#));
    assert!(archive.contains("xl/customXml/frame1.xml"));
    assert!(archive.contains("xl/customXml/frame-child.xml"));
    assert!(drawing_rels.iter().any(|rel| {
        rel.id == "rIdOpaque"
            && rel.rel_type == "http://example.invalid/relationships/opaqueFrame"
            && rel.target == "../customXml/frame1.xml"
            && rel.target_mode.is_none()
    }));
    assert!(frame_rels.iter().any(|rel| {
        rel.id == "rIdChild"
            && rel.rel_type == "http://example.invalid/relationships/frameChild"
            && rel.target == "frame-child.xml"
            && rel.target_mode.is_none()
    }));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

fn opaque_graphic_frame(
    relationship_id: &str,
    relationship_type: &str,
    target: &str,
) -> domain_types::domain::floating_object::FloatingObject {
    use domain_types::domain::floating_object::{
        AnchorMode, DrawingData, DrawingObjectOoxml, DrawingObjectOoxmlProps, FloatingObject,
        FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData,
    };

    let raw_xml = format!(
        r#"<xdr:graphicFrame xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:nvGraphicFramePr><xdr:cNvPr id="7" name="Opaque Frame"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></xdr:xfrm><a:graphic><a:graphicData uri="urn:mog:test"><custom:payload xmlns:custom="urn:mog:test" r:id="{relationship_id}"/></a:graphicData></a:graphic></xdr:graphicFrame>"#
    );
    let mut graphic_frame = ooxml_types::drawings::SpreadsheetGraphicFrame::default();
    graphic_frame.graphic_xml = Some(raw_xml);

    FloatingObject {
        common: FloatingObjectCommon {
            id: "opaque-frame".to_string(),
            name: "Opaque Frame".to_string(),
            width: 100.0,
            height: 50.0,
            anchor: FloatingObjectAnchor {
                end_col: Some(2),
                end_row: Some(3),
                anchor_mode: AnchorMode::TwoCell,
                ..Default::default()
            },
            ..Default::default()
        },
        data: FloatingObjectData::Drawing(DrawingData {
            ooxml: Some(DrawingObjectOoxmlProps {
                object: DrawingObjectOoxml::GraphicFrame { graphic_frame },
                anchor_index: Some(0),
                extent_emu_cx: Some(914400),
                extent_emu_cy: Some(457200),
                relationships: vec![ooxml_types::shared::OpcRelationship {
                    id: relationship_id.to_string(),
                    rel_type: relationship_type.to_string(),
                    target: target.to_string(),
                    target_mode: None,
                }],
                ..Default::default()
            }),
            ..Default::default()
        }),
    }
}
