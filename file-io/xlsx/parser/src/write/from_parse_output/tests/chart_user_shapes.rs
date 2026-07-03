use super::*;

const USER_SHAPES_IMAGE_BYTES: &[u8] = b"\x89PNG\r\n\x1a\nchart user shapes image";

#[test]
fn imported_chart_user_shapes_nested_image_roundtrips_rels_and_media() {
    let input = chart_user_shapes_fixture_xlsx(Some(USER_SHAPES_IMAGE_BYTES));
    let (output, _diagnostics) =
        crate::parse_xlsx_to_output(&input).expect("chart userShapes fixture should parse");
    let chart = output.sheets[0]
        .charts
        .first()
        .expect("fixture should import chart");

    assert!(
        chart
            .chart_auxiliary_files
            .iter()
            .any(|(path, _)| path == "xl/drawings/userShapeDrawing1.xml")
    );
    assert!(
        chart
            .chart_auxiliary_files
            .iter()
            .any(|(path, _)| path == "xl/drawings/_rels/userShapeDrawing1.xml.rels")
    );
    assert!(chart.chart_auxiliary_files.iter().any(|(path, bytes)| {
        path == "xl/media/userShapeImage.png" && bytes == USER_SHAPES_IMAGE_BYTES
    }));
    assert_eq!(
        chart
            .standard_chart_export_authority
            .as_ref()
            .map(|authority| authority.relationship_closure_current),
        Some(true)
    );

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_rels = String::from_utf8(
        archive
            .read_file("xl/charts/_rels/chart1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let user_shapes_rels = String::from_utf8(
        archive
            .read_file("xl/drawings/_rels/userShapeDrawing1.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(chart_rels.contains(r#"Id="rIdUserShapes""#));
    assert!(chart_rels.contains(r#"Target="../drawings/userShapeDrawing1.xml""#));
    assert!(archive.contains("xl/drawings/userShapeDrawing1.xml"));
    assert!(user_shapes_rels.contains(r#"Id="rIdShapeImage""#));
    assert!(user_shapes_rels.contains(r#"Target="../media/userShapeImage.png""#));
    assert_eq!(
        archive.read_file("xl/media/userShapeImage.png").unwrap(),
        USER_SHAPES_IMAGE_BYTES
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_chart_user_shapes_with_missing_nested_media_exports_without_dangling_rels() {
    let input = chart_user_shapes_fixture_xlsx(None);
    let (output, _diagnostics) =
        crate::parse_xlsx_to_output(&input).expect("chart userShapes fixture should parse");
    let chart = output.sheets[0]
        .charts
        .first()
        .expect("fixture should import chart");

    assert_eq!(
        chart
            .standard_chart_export_authority
            .as_ref()
            .map(|authority| authority.relationship_closure_current),
        Some(false)
    );

    let bytes = write_xlsx_from_parse_output(&output).expect("export should not block");
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();
    let chart_rels = String::from_utf8(
        archive
            .read_file("xl/charts/_rels/chart1.xml.rels")
            .unwrap_or_default(),
    )
    .unwrap();

    assert!(!chart_xml.contains("userShapes"));
    assert!(!chart_rels.contains("chartUserShapes"));
    assert!(!archive.contains("xl/drawings/userShapeDrawing1.xml"));
    assert!(!archive.contains("xl/drawings/_rels/userShapeDrawing1.xml.rels"));
    assert!(!archive.contains("xl/media/userShapeImage.png"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_chart_user_shapes_with_unused_stale_nested_rel_preserves_referenced_overlay() {
    let input = chart_user_shapes_fixture_xlsx_with_nested_relationships(
        Some(USER_SHAPES_IMAGE_BYTES),
        &[
            (
                "rIdShapeImage",
                crate::infra::opc::REL_IMAGE,
                "../media/userShapeImage.png",
                None,
            ),
            (
                "rIdUnusedMissing",
                crate::infra::opc::REL_IMAGE,
                "../media/missing-unused.png",
                None,
            ),
        ],
    );
    let (output, _diagnostics) =
        crate::parse_xlsx_to_output(&input).expect("chart userShapes fixture should parse");
    let chart = output.sheets[0]
        .charts
        .first()
        .expect("fixture should import chart");

    assert_eq!(
        chart
            .standard_chart_export_authority
            .as_ref()
            .map(|authority| authority.relationship_closure_current),
        Some(true)
    );

    let bytes = write_xlsx_from_parse_output(&output).expect("export should succeed");
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();
    let user_shapes_rels = String::from_utf8(
        archive
            .read_file("xl/drawings/_rels/userShapeDrawing1.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(chart_xml.contains("userShapes"));
    assert!(archive.contains("xl/drawings/userShapeDrawing1.xml"));
    assert!(user_shapes_rels.contains(r#"Id="rIdShapeImage""#));
    assert!(!user_shapes_rels.contains("rIdUnusedMissing"));
    assert_eq!(
        archive.read_file("xl/media/userShapeImage.png").unwrap(),
        USER_SHAPES_IMAGE_BYTES
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn drawing_family_path_is_reserved_from_worksheet_drawing_allocator() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.definition = Some(domain_types::ChartDefinition::Chart(
        ooxml_types::charts::ChartSpace {
            user_shapes: Some("rIdUserShapes".to_string()),
            ..Default::default()
        },
    ));
    imported_chart.chart_relationships = vec![domain_types::chart::ChartRelationshipData {
        r_id: "rIdUserShapes".to_string(),
        relationship_type: Some(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartUserShapes"
                .to_string(),
        ),
        target: Some("../drawings/drawing2.xml".to_string()),
        target_mode: None,
    }];
    imported_chart.chart_auxiliary_files = vec![(
        "xl/drawings/drawing2.xml".to_string(),
        br#"<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>"#
            .to_vec(),
    )];

    let output = make_parse_output(vec![
        SheetData {
            name: "Data".to_string(),
            cells: vec![
                make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
                make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
                make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
                make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
            ],
            charts: vec![imported_chart],
            ..Default::default()
        },
        SheetData {
            name: "Other".to_string(),
            cells: vec![
                make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
                make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
                make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
                make_cell(1, 1, DomainValue::Number(FiniteF64::new(200.0).unwrap())),
            ],
            charts: vec![make_chart(ChartType::Line, "Other!A1:B2")],
            ..Default::default()
        },
    ]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_rels = String::from_utf8(
        archive
            .read_file("xl/charts/_rels/chart1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let sheet2_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet2.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(chart_rels.contains(r#"Target="../drawings/drawing2.xml""#));
    assert!(sheet2_rels.contains(r#"Target="../drawings/drawing3.xml""#));
    assert!(!sheet2_rels.contains(r#"Target="../drawings/drawing2.xml""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

fn chart_user_shapes_fixture_xlsx(media: Option<&[u8]>) -> Vec<u8> {
    chart_user_shapes_fixture_xlsx_with_nested_relationships(
        media,
        &[(
            "rIdShapeImage",
            crate::infra::opc::REL_IMAGE,
            "../media/userShapeImage.png",
            None,
        )],
    )
}

fn chart_user_shapes_fixture_xlsx_with_nested_relationships(
    media: Option<&[u8]>,
    nested_relationships: &[(&str, &str, &str, Option<&str>)],
) -> Vec<u8> {
    let mut zip =
        crate::write::ZipWriter::with_compression(crate::write::CompressionMethod::Deflate(1));
    zip.add_file(
        "[Content_Types].xml",
        chart_fixture_content_types_xml().into_bytes(),
    );
    zip.add_file(
        "_rels/.rels",
        rels_xml(&[(
            "rIdWorkbook",
            crate::infra::opc::REL_OFFICE_DOCUMENT,
            "xl/workbook.xml",
            None,
        )])
        .into_bytes(),
    );
    zip.add_file("xl/workbook.xml", chart_fixture_workbook_xml().into_bytes());
    zip.add_file(
        "xl/_rels/workbook.xml.rels",
        rels_xml(&[(
            "rIdSheet1",
            crate::infra::opc::REL_WORKSHEET,
            "worksheets/sheet1.xml",
            None,
        )])
        .into_bytes(),
    );
    zip.add_file(
        "xl/worksheets/sheet1.xml",
        chart_fixture_sheet_xml().into_bytes(),
    );
    zip.add_file(
        "xl/worksheets/_rels/sheet1.xml.rels",
        rels_xml(&[(
            "rIdDrawing",
            crate::infra::opc::REL_DRAWING,
            "../drawings/drawing1.xml",
            None,
        )])
        .into_bytes(),
    );
    zip.add_file(
        "xl/drawings/drawing1.xml",
        chart_fixture_drawing_xml().into_bytes(),
    );
    zip.add_file(
        "xl/drawings/_rels/drawing1.xml.rels",
        rels_xml(&[(
            "rIdChart",
            crate::infra::opc::REL_CHART,
            "../charts/chart1.xml",
            None,
        )])
        .into_bytes(),
    );
    zip.add_file(
        "xl/charts/chart1.xml",
        chart_fixture_chart_xml().into_bytes(),
    );
    zip.add_file(
        "xl/charts/_rels/chart1.xml.rels",
        rels_xml(&[(
            "rIdUserShapes",
            crate::infra::opc::REL_CHART_USER_SHAPES,
            "../drawings/userShapeDrawing1.xml",
            None,
        )])
        .into_bytes(),
    );
    zip.add_file(
        "xl/drawings/userShapeDrawing1.xml",
        chart_fixture_user_shapes_xml().into_bytes(),
    );
    zip.add_file(
        "xl/drawings/_rels/userShapeDrawing1.xml.rels",
        rels_xml(nested_relationships).into_bytes(),
    );
    if let Some(media) = media {
        zip.add_file("xl/media/userShapeImage.png", media.to_vec());
    }
    zip.finish().expect("fixture zip should build")
}

fn chart_fixture_content_types_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
  <Override PartName="/xl/drawings/userShapeDrawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
  <Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
</Types>"#
        .to_string()
}

fn chart_fixture_workbook_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rIdSheet1"/></sheets>
</workbook>"#
        .to_string()
}

fn chart_fixture_sheet_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData/>
  <drawing r:id="rIdDrawing"/>
</worksheet>"#
        .to_string()
}

fn chart_fixture_drawing_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>15</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rIdChart"/></a:graphicData></a:graphic></xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>"#
        .to_string()
}

fn chart_fixture_chart_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart><c:plotArea><c:layout/></c:plotArea><c:plotVisOnly val="1"/></c:chart>
  <c:userShapes r:id="rIdUserShapes"/>
</c:chartSpace>"#
        .to_string()
}

fn chart_fixture_user_shapes_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:oneCellAnchor>
    <xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:ext cx="762000" cy="762000"/>
    <xdr:pic><xdr:nvPicPr><xdr:cNvPr id="5" name="Overlay image"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdShapeImage"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"/></xdr:spPr></xdr:pic>
    <xdr:clientData/>
  </xdr:oneCellAnchor>
</xdr:wsDr>"#
        .to_string()
}

fn rels_xml(relationships: &[(&str, &str, &str, Option<&str>)]) -> String {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
    );
    for (id, rel_type, target, target_mode) in relationships {
        xml.push_str(&format!(
            r#"<Relationship Id="{id}" Type="{rel_type}" Target="{target}""#
        ));
        if let Some(target_mode) = target_mode {
            xml.push_str(&format!(r#" TargetMode="{target_mode}""#));
        }
        xml.push_str("/>");
    }
    xml.push_str("</Relationships>");
    xml
}
