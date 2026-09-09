use super::*;

#[test]
fn authoritative_chart_replay_preserves_external_picture_link() {
    let mut chart = make_chart(ChartType::Line, "Data!A1:B2");
    chart.title = None;
    chart.data_range = None;
    chart.chart_frame = Some(
        domain_types::domain::floating_object::ChartDrawingFrameOoxmlProps {
            relationship_target: Some("../charts/chart9.xml".to_string()),
            relationship_id: Some("rId9".to_string()),
            ..Default::default()
        },
    );
    chart.chart_relationships = vec![domain_types::chart::ChartRelationshipData {
        r_id: "rIdExternalImage".to_string(),
        relationship_type: Some(crate::infra::opc::REL_IMAGE.to_string()),
        target: Some("https://cdn.example.test/chart-picture.png".to_string()),
        target_mode: Some("External".to_string()),
    }];
    let raw_chart_xml = br#"<?xml version="1.0" encoding="UTF-8"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart><c:plotArea><c:lineChart><c:marker val="1"/></c:lineChart></c:plotArea></c:chart><c:spPr><a:blipFill><a:blip r:link="rIdExternalImage"/></a:blipFill></c:spPr></c:chartSpace>"#;
    let mut chart = with_current_standard_chart_authority(chart);
    chart
        .standard_chart_provenance
        .as_mut()
        .expect("authority")
        .original_xml = Some(raw_chart_xml.to_vec());

    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![chart],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    assert_eq!(
        archive.read_file("xl/charts/chart9.xml").unwrap(),
        raw_chart_xml
    );
    let chart_rels = String::from_utf8(
        archive
            .read_file("xl/charts/_rels/chart9.xml.rels")
            .unwrap(),
    )
    .unwrap();
    assert!(chart_rels.contains(r#"Id="rIdExternalImage""#));
    assert!(chart_rels.contains(
        r#"Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image""#
    ));
    assert!(chart_rels.contains(r#"Target="https://cdn.example.test/chart-picture.png""#));
    assert!(chart_rels.contains(r#"TargetMode="External""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn reconstructed_chart_picture_aliases_keep_media_for_the_emitted_relationship() {
    use ooxml_types::drawings::{BlipFill, DrawingFill, ShapeProperties};

    let mut chart = make_chart(ChartType::Line, "Data!A1:B2");
    let mut chart_space = ooxml_types::charts::ChartSpace::default();
    chart_space.sp_pr = Some(ShapeProperties {
        fill: Some(DrawingFill::Blip(BlipFill {
            embed_id: Some("rIdSecondImage".to_string()),
            ..Default::default()
        })),
        ..Default::default()
    });
    chart.definition = Some(domain_types::ChartDefinition::Chart(chart_space));
    chart.chart_relationships = vec![
        domain_types::chart::ChartRelationshipData {
            r_id: "rIdFirstImage".to_string(),
            relationship_type: Some(crate::infra::opc::REL_IMAGE.to_string()),
            target: Some("../media/shared-chart-picture.png".to_string()),
            target_mode: None,
        },
        domain_types::chart::ChartRelationshipData {
            r_id: "rIdSecondImage".to_string(),
            relationship_type: Some(crate::infra::opc::REL_IMAGE.to_string()),
            target: Some("../media/shared-chart-picture.png".to_string()),
            target_mode: None,
        },
    ];
    chart.chart_auxiliary_files = vec![(
        "xl/media/shared-chart-picture.png".to_string(),
        b"shared-chart-picture".to_vec(),
    )];
    chart = with_chart_identity(chart, "../charts/chart1.xml");
    let mut chart = with_current_standard_chart_authority(chart);
    chart.title = Some("Edited chart title".to_string());

    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![chart],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    assert_eq!(
        archive
            .read_file("xl/media/shared-chart-picture.png")
            .unwrap(),
        b"shared-chart-picture"
    );
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap())
        .expect("chart XML should be UTF-8");
    assert!(chart_xml.contains("a:blip"));
    assert!(
        chart_xml.contains("r:embed=\"rIdFirstImage\"")
            || chart_xml.contains("r:embed=\"rIdSecondImage\"")
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
