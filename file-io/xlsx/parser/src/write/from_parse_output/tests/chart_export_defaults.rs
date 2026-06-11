use super::*;

#[test]
fn modeled_bar_chart_exports_visible_excel_compatible_defaults() {
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Month"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Jan"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(12.0).unwrap())),
            make_cell(2, 0, DomainValue::Text(Arc::from("Feb"))),
            make_cell(2, 1, DomainValue::Number(FiniteF64::new(28.0).unwrap())),
            make_cell(3, 0, DomainValue::Text(Arc::from("Mar"))),
            make_cell(3, 1, DomainValue::Number(FiniteF64::new(19.0).unwrap())),
        ],
        charts: vec![make_chart(ChartType::Bar, "Data!A1:B4")],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();

    assert!(chart_xml.contains("<c:barChart>"), "{chart_xml}");
    assert!(
        chart_xml.contains(r#"<a:srgbClr val="4472C4"/>"#),
        "{chart_xml}"
    );
    assert!(!chart_xml.contains(r#"<c:delete val="1"/>"#), "{chart_xml}");
    assert!(
        drawing_xml.contains(r#"<a:ext cx="6096000" cy="2857500"/>"#),
        "{drawing_xml}"
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_standard_chart_zero_graphic_frame_extents_are_preserved() {
    let mut chart = make_chart(ChartType::Column, "Data!A1:B3");
    let mut graphic_frame = ooxml_types::drawings::SpreadsheetGraphicFrame::default();
    graphic_frame.nv_graphic_frame_pr.c_nv_pr.id =
        ooxml_types::drawings::StDrawingElementId::new(77);
    graphic_frame.nv_graphic_frame_pr.c_nv_pr.name = "Standard Zero Extent".to_string();
    graphic_frame.xfrm = ooxml_types::drawings::Transform2D {
        offset: Some((0, 0)),
        extent: Some((0, 0)),
        rotation: None,
        flip_h: None,
        flip_v: None,
    };
    chart.chart_frame = Some(
        domain_types::domain::floating_object::ChartDrawingFrameOoxmlProps {
            graphic_frame,
            ..Default::default()
        },
    );

    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Month"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Jan"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(12.0).unwrap())),
            make_cell(2, 0, DomainValue::Text(Arc::from("Feb"))),
            make_cell(2, 1, DomainValue::Number(FiniteF64::new(28.0).unwrap())),
        ],
        charts: vec![chart],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();

    assert!(
        drawing_xml.contains("Standard Zero Extent"),
        "{drawing_xml}"
    );
    assert!(drawing_xml.contains(r#"<a:ext cx="0" cy="0"/>"#));
    assert!(!drawing_xml.contains(r#"<a:ext cx="6096000" cy="2857500"/>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn modeled_standard_chart_zero_one_cell_anchor_extents_fall_back_to_chart_size() {
    let mut chart = make_chart(ChartType::Column, "Data!A1:B3");
    chart.position.extent_cx = Some(0);
    chart.position.extent_cy = Some(0);

    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Month"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Jan"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(12.0).unwrap())),
            make_cell(2, 0, DomainValue::Text(Arc::from("Feb"))),
            make_cell(2, 1, DomainValue::Number(FiniteF64::new(28.0).unwrap())),
        ],
        charts: vec![chart],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();

    assert!(drawing_xml.contains("<xdr:oneCellAnchor>"), "{drawing_xml}");
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

#[test]
fn modeled_standard_chart_zero_absolute_anchor_extents_fall_back_to_chart_size() {
    let mut chart = make_chart(ChartType::Column, "Data!A1:B3");
    chart.position.absolute_x = Some(914400);
    chart.position.absolute_y = Some(457200);
    chart.position.extent_cx = Some(0);
    chart.position.extent_cy = Some(0);

    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Month"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Jan"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(12.0).unwrap())),
            make_cell(2, 0, DomainValue::Text(Arc::from("Feb"))),
            make_cell(2, 1, DomainValue::Number(FiniteF64::new(28.0).unwrap())),
        ],
        charts: vec![chart],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();

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

#[test]
fn modeled_line_chart_exports_qualified_refs_and_visible_strokes() {
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Month"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(0, 2, DomainValue::Text(Arc::from("Cost"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Jan"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(12.0).unwrap())),
            make_cell(1, 2, DomainValue::Number(FiniteF64::new(7.0).unwrap())),
            make_cell(2, 0, DomainValue::Text(Arc::from("Feb"))),
            make_cell(2, 1, DomainValue::Number(FiniteF64::new(28.0).unwrap())),
            make_cell(2, 2, DomainValue::Number(FiniteF64::new(13.0).unwrap())),
        ],
        charts: vec![make_chart(ChartType::Line, "A1:C3")],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();

    assert!(chart_xml.contains("<c:lineChart>"), "{chart_xml}");
    assert!(chart_xml.contains("<c:f>Data!B1</c:f>"), "{chart_xml}");
    assert!(chart_xml.contains("<c:f>Data!C1</c:f>"), "{chart_xml}");
    assert!(chart_xml.contains("<c:f>Data!A2:A3</c:f>"), "{chart_xml}");
    assert!(chart_xml.contains("<c:f>Data!B2:B3</c:f>"), "{chart_xml}");
    assert!(
        chart_xml.contains(r#"<a:ln w="28575"><a:solidFill><a:srgbClr val="4472C4"/>"#),
        "{chart_xml}"
    );
    assert!(
        chart_xml.contains(r#"<a:ln w="28575"><a:solidFill><a:srgbClr val="ED7D31"/>"#),
        "{chart_xml}"
    );
    assert!(!chart_xml.contains(r#"<c:delete val="1"/>"#), "{chart_xml}");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn modeled_bubble_chart_synthesizes_x_y_size_series_from_data_range() {
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Market size"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(0, 2, DomainValue::Text(Arc::from("Share"))),
            make_cell(1, 0, DomainValue::Number(FiniteF64::new(10.0).unwrap())),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(12.0).unwrap())),
            make_cell(1, 2, DomainValue::Number(FiniteF64::new(7.0).unwrap())),
            make_cell(2, 0, DomainValue::Number(FiniteF64::new(20.0).unwrap())),
            make_cell(2, 1, DomainValue::Number(FiniteF64::new(28.0).unwrap())),
            make_cell(2, 2, DomainValue::Number(FiniteF64::new(13.0).unwrap())),
        ],
        charts: vec![make_chart(ChartType::Bubble, "A1:C3")],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();

    assert!(chart_xml.contains("<c:bubbleChart>"), "{chart_xml}");
    assert!(
        chart_xml.contains("<c:xVal><c:numRef><c:f>Data!A2:A3</c:f>"),
        "{chart_xml}"
    );
    assert!(
        chart_xml.contains("<c:yVal><c:numRef><c:f>Data!B2:B3</c:f>"),
        "{chart_xml}"
    );
    assert!(
        chart_xml.contains("<c:bubbleSize><c:numRef><c:f>Data!C2:C3</c:f>"),
        "{chart_xml}"
    );
    assert!(
        chart_xml.contains(r#"<a:srgbClr val="4472C4"/>"#),
        "{chart_xml}"
    );
    assert!(!chart_xml.contains(r#"<c:delete val="1"/>"#), "{chart_xml}");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn modeled_pie_like_chart_synthesizes_single_category_value_series_from_data_range() {
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Segment"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(0, 2, DomainValue::Text(Arc::from("Cost"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Core"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(120.0).unwrap())),
            make_cell(1, 2, DomainValue::Number(FiniteF64::new(80.0).unwrap())),
            make_cell(2, 0, DomainValue::Text(Arc::from("Long tail"))),
            make_cell(2, 1, DomainValue::Number(FiniteF64::new(18.0).unwrap())),
            make_cell(2, 2, DomainValue::Number(FiniteF64::new(11.0).unwrap())),
        ],
        charts: vec![make_chart(ChartType::Pie, "A1:C3")],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();

    assert!(chart_xml.contains("<c:pieChart>"), "{chart_xml}");
    assert!(
        chart_xml.contains(r#"<c:varyColors val="1"/>"#),
        "{chart_xml}"
    );
    assert_eq!(chart_xml.matches("<c:ser>").count(), 1, "{chart_xml}");
    assert!(chart_xml.contains("<c:f>Data!B1</c:f>"), "{chart_xml}");
    assert!(chart_xml.contains("<c:f>Data!A2:A3</c:f>"), "{chart_xml}");
    assert!(chart_xml.contains("<c:f>Data!B2:B3</c:f>"), "{chart_xml}");
    assert!(!chart_xml.contains("Data!C2:C3"), "{chart_xml}");
    assert!(
        chart_xml.contains(r#"<a:srgbClr val="4472C4"/>"#),
        "{chart_xml}"
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn modeled_of_pie_chart_exports_no_dangling_axes() {
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Segment"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Core"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(120.0).unwrap())),
            make_cell(2, 0, DomainValue::Text(Arc::from("Long tail"))),
            make_cell(2, 1, DomainValue::Number(FiniteF64::new(18.0).unwrap())),
        ],
        charts: vec![make_chart(ChartType::OfPie, "A1:B3")],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();

    assert!(chart_xml.contains("<c:ofPieChart>"), "{chart_xml}");
    assert!(
        chart_xml.contains(r#"<c:varyColors val="1"/>"#),
        "{chart_xml}"
    );
    assert!(!chart_xml.contains("<c:axId"), "{chart_xml}");
    assert!(!chart_xml.contains("<c:catAx>"), "{chart_xml}");
    assert!(!chart_xml.contains("<c:valAx>"), "{chart_xml}");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn modeled_chart_explicit_empty_axes_default_to_visible() {
    let mut chart = make_chart(ChartType::Column, "A1:B3");
    chart.axes = Some(domain_types::chart::AxisData {
        category_axis: Some(domain_types::chart::SingleAxisData::default()),
        value_axis: Some(domain_types::chart::SingleAxisData::default()),
        secondary_category_axis: None,
        secondary_value_axis: None,
        series_axis: None,
    });
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Month"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Jan"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(12.0).unwrap())),
            make_cell(2, 0, DomainValue::Text(Arc::from("Feb"))),
            make_cell(2, 1, DomainValue::Number(FiniteF64::new(28.0).unwrap())),
        ],
        charts: vec![chart],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();

    assert!(chart_xml.contains("<c:catAx>"), "{chart_xml}");
    assert!(chart_xml.contains("<c:valAx>"), "{chart_xml}");
    assert!(!chart_xml.contains(r#"<c:delete val="1"/>"#), "{chart_xml}");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
