use super::*;

#[test]
fn imported_chart_ex_zero_graphic_frame_extents_are_preserved() {
    let mut chart_ex = make_chart(ChartType::Waterfall, "");
    chart_ex.title = None;
    chart_ex.data_range = None;
    chart_ex.is_chart_ex = true;
    chart_ex.definition = Some(domain_types::ChartDefinition::ChartEx(
        ooxml_types::chart_ex::ChartExSpace::default(),
    ));
    chart_ex.cnv_pr_name = Some("ChartEx Zero Extent".to_string());
    chart_ex.cnv_pr_id = Some(77);

    let mut graphic_frame = ooxml_types::drawings::SpreadsheetGraphicFrame::default();
    graphic_frame.nv_graphic_frame_pr.c_nv_pr.id =
        ooxml_types::drawings::StDrawingElementId::new(77);
    graphic_frame.nv_graphic_frame_pr.c_nv_pr.name = "ChartEx Zero Extent".to_string();
    graphic_frame.xfrm = ooxml_types::drawings::Transform2D {
        offset: Some((0, 0)),
        extent: Some((0, 0)),
        rotation: None,
        flip_h: None,
        flip_v: None,
    };
    chart_ex.chart_frame = Some(
        domain_types::domain::floating_object::ChartDrawingFrameOoxmlProps {
            graphic_frame,
            ..Default::default()
        },
    );

    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        charts: vec![chart_ex],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();

    assert!(archive.contains("xl/charts/chartEx1.xml"));
    assert!(drawing_xml.contains("ChartEx Zero Extent"), "{drawing_xml}");
    assert!(drawing_xml.contains(r#"<a:ext cx="0" cy="0"/>"#));
    assert!(!drawing_xml.contains(r#"<a:ext cx="6096000" cy="2857500"/>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn chart_ex_zero_absolute_anchor_extents_fall_back_to_chart_size() {
    let mut chart_ex = make_chart(ChartType::Waterfall, "");
    chart_ex.title = None;
    chart_ex.data_range = None;
    chart_ex.is_chart_ex = true;
    chart_ex.definition = Some(domain_types::ChartDefinition::ChartEx(
        ooxml_types::chart_ex::ChartExSpace::default(),
    ));
    chart_ex.cnv_pr_name = Some("ChartEx Absolute Zero Extent".to_string());
    chart_ex.cnv_pr_id = Some(78);
    chart_ex.position.absolute_x = Some(914400);
    chart_ex.position.absolute_y = Some(457200);
    chart_ex.position.extent_cx = Some(0);
    chart_ex.position.extent_cy = Some(0);

    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        charts: vec![chart_ex],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();

    assert!(archive.contains("xl/charts/chartEx1.xml"));
    assert!(
        drawing_xml.contains("<xdr:absoluteAnchor>"),
        "{drawing_xml}"
    );
    assert!(!drawing_xml.contains(r#"<xdr:ext cx="0" cy="0"/>"#));
    assert!(!drawing_xml.contains(r#"<a:ext cx="0" cy="0"/>"#));
    assert!(
        drawing_xml.contains(r#"<xdr:ext cx="6096000" cy="2857500"/>"#),
        "{drawing_xml}"
    );
    assert!(
        drawing_xml.contains(r#"<a:ext cx="6096000" cy="2857500"/>"#),
        "{drawing_xml}"
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
