use super::common::*;

// -------------------------------------------------------------------------
// Connector writing tests
// -------------------------------------------------------------------------

/// Helper to create a minimal ConnectorProps for testing
fn minimal_connector(name: &str) -> ConnectorProps {
    ConnectorProps {
        original_id: None,
        name: name.to_string(),
        description: None,
        title: None,
        hidden: false,
        hlink_click: None,
        hlink_hover: None,
        nv_ext_lst: None,
        start_connection: None,
        end_connection: None,
        locks: DrawingLocking::default(),
        transform: Transform2D::default(),
        preset_geometry: Some(PresetGeometry {
            prst: ShapePreset::StraightConnector1,
            av_list: vec![],
        }),
        fill: None,
        outline: None,
        style: None,
        macro_name: None,
    }
}

#[test]
fn test_connector_minimal() {
    let mut writer = DrawingWriter::new();
    writer.add_connector(
        CellAnchor::default(),
        CellAnchor {
            col: 5,
            col_off: 0,
            row: 5,
            row_off: 0,
        },
        minimal_connector("Connector 1"),
    );

    assert_eq!(writer.len(), 1);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(
        xml_str.contains("<xdr:cxnSp>"),
        "Should contain cxnSp element"
    );
    assert!(xml_str.contains("</xdr:cxnSp>"), "Should close cxnSp");
    assert!(
        xml_str.contains("<xdr:nvCxnSpPr>"),
        "Should contain nvCxnSpPr"
    );
    assert!(
        xml_str.contains("name=\"Connector 1\""),
        "Should have name attribute"
    );
    assert!(xml_str.contains("<xdr:spPr>"), "Should contain spPr");
    assert!(
        xml_str.contains("prst=\"straightConnector1\""),
        "Should have preset geometry"
    );
    assert!(xml_str.contains("<a:avLst/>"), "Should have empty avLst");
    assert!(
        xml_str.contains("<xdr:cNvCxnSpPr/>"),
        "Should self-close empty cNvCxnSpPr"
    );
    assert!(
        xml_str.contains("<xdr:clientData/>"),
        "Should have clientData"
    );
}

#[test]
fn test_connector_with_connections() {
    let mut writer = DrawingWriter::new();
    let mut props = minimal_connector("Connected");
    props.start_connection = Some(Connection {
        shape_id: 3,
        idx: 0,
    });
    props.end_connection = Some(Connection {
        shape_id: 5,
        idx: 2,
    });

    writer.add_connector(CellAnchor::default(), CellAnchor::default(), props);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(
        xml_str.contains("<a:stCxn id=\"3\" idx=\"0\"/>"),
        "Should have start connection"
    );
    assert!(
        xml_str.contains("<a:endCxn id=\"5\" idx=\"2\"/>"),
        "Should have end connection"
    );
    assert!(
        xml_str.contains("<xdr:cNvCxnSpPr>"),
        "cNvCxnSpPr should have children"
    );
}

#[test]
fn test_connector_with_arrowheads() {
    let mut writer = DrawingWriter::new();
    let mut props = minimal_connector("Arrows");
    props.outline = Some(Outline {
        width: Some(25400),
        fill: Some(line_solid("000000")),
        head_end: Some(LineEndProperties {
            end_type: Some(LineEndType::Triangle),
            width: Some(LineEndSize::Medium),
            length: Some(LineEndSize::Medium),
        }),
        tail_end: Some(LineEndProperties {
            end_type: Some(LineEndType::Stealth),
            width: Some(LineEndSize::Large),
            length: Some(LineEndSize::Small),
        }),
        ..Default::default()
    });

    writer.add_connector(CellAnchor::default(), CellAnchor::default(), props);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(
        xml_str.contains("<a:headEnd type=\"triangle\" w=\"med\" len=\"med\"/>"),
        "Should have head end: {}",
        xml_str
    );
    assert!(
        xml_str.contains("<a:tailEnd type=\"stealth\" w=\"lg\" len=\"sm\"/>"),
        "Should have tail end: {}",
        xml_str
    );
}

#[test]
fn test_connector_with_locks() {
    let mut writer = DrawingWriter::new();
    let mut props = minimal_connector("Locked");
    props.locks = DrawingLocking {
        no_move: true,
        no_resize: true,
        no_change_shape_type: true,
        ..Default::default()
    };

    writer.add_connector(CellAnchor::default(), CellAnchor::default(), props);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<a:cxnSpLocks"), "Should have cxnSpLocks");
    assert!(xml_str.contains("noMove=\"1\""), "Should have noMove");
    assert!(xml_str.contains("noResize=\"1\""), "Should have noResize");
    assert!(
        xml_str.contains("noChangeShapeType=\"1\""),
        "Should have noChangeShapeType"
    );
    // Should NOT have locks that are false
    assert!(!xml_str.contains("noGrp="), "Should not have noGrp");
    assert!(!xml_str.contains("noSelect="), "Should not have noSelect");
}

#[test]
fn test_connector_with_style() {
    let mut writer = DrawingWriter::new();
    let mut props = minimal_connector("Styled");
    props.style = Some(ShapeStyle {
        line_ref: StyleRef {
            idx: StStyleMatrixColumnIndex::new(1),
            color: Some(rgb("FF0000")),
        },
        fill_ref: StyleRef {
            idx: StStyleMatrixColumnIndex::new(0),
            color: None,
        },
        effect_ref: StyleRef {
            idx: StStyleMatrixColumnIndex::new(0),
            color: None,
        },
        font_ref: ooxml_types::drawings::FontReference {
            idx: ooxml_types::drawings::FontCollectionIndex::None,
            color: None,
        },
    });

    writer.add_connector(CellAnchor::default(), CellAnchor::default(), props);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<xdr:style>"), "Should have style element");
    assert!(
        xml_str.contains("</xdr:style>"),
        "Should close style element"
    );
    assert!(
        xml_str.contains("<a:lnRef idx=\"1\">"),
        "Should have lnRef with children"
    );
    assert!(
        xml_str.contains("val=\"FF0000\""),
        "Should have color in lnRef"
    );
    assert!(
        xml_str.contains("<a:fillRef idx=\"0\"/>"),
        "Should have self-closing fillRef"
    );
    assert!(
        xml_str.contains("<a:effectRef idx=\"0\"/>"),
        "Should have effectRef"
    );
    assert!(
        xml_str.contains("<a:fontRef idx=\"none\"/>"),
        "Should have fontRef"
    );
}

#[test]
fn test_connector_with_full_outline() {
    let mut writer = DrawingWriter::new();
    let mut props = minimal_connector("Full Outline");
    props.outline = Some(Outline {
        width: Some(19050),
        fill: Some(line_solid("0070C0")),
        dash: Some(LineDash::Preset(DashStyle::Dash)),
        compound: Some(CompoundLine::Double),
        cap: Some(LineCap::Round),
        head_end: Some(LineEndProperties {
            end_type: Some(LineEndType::Arrow),
            width: None,
            length: None,
        }),
        tail_end: Some(LineEndProperties {
            end_type: Some(LineEndType::Diamond),
            width: Some(LineEndSize::Large),
            length: Some(LineEndSize::Large),
        }),
        join: Some(LineJoin::Round),
        align: Some(PenAlignment::Center),
    });

    writer.add_connector(CellAnchor::default(), CellAnchor::default(), props);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("w=\"19050\""), "Should have width");
    assert!(xml_str.contains("cap=\"rnd\""), "Should have cap");
    assert!(xml_str.contains("cmpd=\"dbl\""), "Should have compound");
    assert!(xml_str.contains("algn=\"ctr\""), "Should have alignment");
    assert!(xml_str.contains("val=\"0070C0\""), "Should have color");
    assert!(xml_str.contains("val=\"dash\""), "Should have dash style");
    assert!(xml_str.contains("<a:round/>"), "Should have round join");
    assert!(
        xml_str.contains("<a:headEnd type=\"arrow\"/>"),
        "Should have head end"
    );
    assert!(
        xml_str.contains("<a:tailEnd type=\"diamond\" w=\"lg\" len=\"lg\"/>"),
        "Should have tail end: {}",
        xml_str
    );
}

#[test]
fn test_connector_with_macro() {
    let mut writer = DrawingWriter::new();
    let mut props = minimal_connector("Macro Connector");
    props.macro_name = Some("MyMacro".to_string());

    writer.add_connector(CellAnchor::default(), CellAnchor::default(), props);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(
        xml_str.contains("<xdr:cxnSp macro=\"MyMacro\">"),
        "Should have macro attribute: {}",
        xml_str
    );
}

#[test]
fn test_connector_with_transform() {
    let mut writer = DrawingWriter::new();
    let mut props = minimal_connector("Transformed");
    props.transform = Transform2D {
        offset: Some((100000, 200000)),
        extent: Some((500000, 300000)),
        rotation: Some(StAngle::new(5400000)),
        flip_h: Some(true),
        flip_v: Some(false),
    };

    writer.add_connector(CellAnchor::default(), CellAnchor::default(), props);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("rot=\"5400000\""), "Should have rotation");
    assert!(xml_str.contains("flipH=\"1\""), "Should have flipH");
    assert!(
        !xml_str.contains("flipV="),
        "Should not have flipV when false"
    );
    assert!(xml_str.contains("x=\"100000\""), "Should have x offset");
    assert!(xml_str.contains("y=\"200000\""), "Should have y offset");
    assert!(xml_str.contains("cx=\"500000\""), "Should have cx extent");
    assert!(xml_str.contains("cy=\"300000\""), "Should have cy extent");
}

#[test]
fn test_connector_with_hyperlinks() {
    let mut writer = DrawingWriter::new();
    let mut props = minimal_connector("Linked");
    props.hlink_click = Some(Hyperlink {
        r_id: Some("rId5".to_string()),
        action: Some("ppaction://hlinksldjump".to_string()),
        tooltip: Some("Click me".to_string()),
        ..Default::default()
    });
    props.hlink_hover = Some(Hyperlink {
        r_id: Some("rId6".to_string()),
        tooltip: Some("Hover text".to_string()),
        ..Default::default()
    });

    writer.add_connector(CellAnchor::default(), CellAnchor::default(), props);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(
        xml_str.contains("<a:hlinkClick r:id=\"rId5\""),
        "Should have hlinkClick: {}",
        xml_str
    );
    assert!(
        xml_str.contains("action=\"ppaction://hlinksldjump\""),
        "Should have action"
    );
    assert!(
        xml_str.contains("tooltip=\"Click me\""),
        "Should have tooltip"
    );
    assert!(
        xml_str.contains("<a:hlinkHover r:id=\"rId6\""),
        "Should have hlinkHover"
    );
    assert!(
        xml_str.contains("tooltip=\"Hover text\""),
        "Should have hover tooltip"
    );
    // cNvPr should NOT self-close when it has children
    assert!(
        xml_str.contains("</xdr:cNvPr>"),
        "cNvPr should have closing tag"
    );
}

#[test]
fn test_connector_with_description_title_hidden() {
    let mut writer = DrawingWriter::new();
    let mut props = minimal_connector("Described");
    props.description = Some("A connector line".to_string());
    props.title = Some("Line Title".to_string());
    props.hidden = true;

    writer.add_connector(CellAnchor::default(), CellAnchor::default(), props);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(
        xml_str.contains("descr=\"A connector line\""),
        "Should have description"
    );
    assert!(
        xml_str.contains("title=\"Line Title\""),
        "Should have title"
    );
    assert!(xml_str.contains("hidden=\"1\""), "Should have hidden");
}

#[test]
fn test_connector_miter_join() {
    let mut writer = DrawingWriter::new();
    let mut props = minimal_connector("Miter");
    props.outline = Some(Outline {
        width: Some(12700),
        join: Some(LineJoin::Miter {
            limit: Some(800000),
        }),
        ..Default::default()
    });

    writer.add_connector(CellAnchor::default(), CellAnchor::default(), props);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(
        xml_str.contains("<a:miter lim=\"800000\"/>"),
        "Should have miter with limit: {}",
        xml_str
    );
}

#[test]
fn test_connector_bevel_join() {
    let mut writer = DrawingWriter::new();
    let mut props = minimal_connector("Bevel");
    props.outline = Some(Outline {
        width: Some(12700),
        join: Some(LineJoin::Bevel),
        ..Default::default()
    });

    writer.add_connector(CellAnchor::default(), CellAnchor::default(), props);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<a:bevel/>"), "Should have bevel join");
}
