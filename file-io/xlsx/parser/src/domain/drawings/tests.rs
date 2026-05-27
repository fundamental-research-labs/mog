//! Unit tests for the drawings module.

use super::*;
use helpers::{parse_edit_as, parse_i64, parse_u32};
use images::parse_picture;
use ooxml_types::drawings::{
    StAngle, StDrawingElementId, StPositiveFixedPercentageDecimal, StTextFontSize,
};

// -------------------------------------------------------------------------
// Basic parsing tests
// -------------------------------------------------------------------------

#[test]
fn test_parse_empty_drawing() {
    let xml = br#"<?xml version="1.0"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">
</xdr:wsDr>"#;

    let drawing = parse_drawing(xml);
    assert_eq!(drawing.anchors.len(), 0);
}

#[test]
fn test_parse_two_cell_anchor_basic() {
    let xml = br#"<xdr:twoCellAnchor editAs="oneCell">
    <xdr:from>
        <xdr:col>1</xdr:col>
        <xdr:colOff>0</xdr:colOff>
        <xdr:row>2</xdr:row>
        <xdr:rowOff>0</xdr:rowOff>
    </xdr:from>
    <xdr:to>
        <xdr:col>5</xdr:col>
        <xdr:colOff>914400</xdr:colOff>
        <xdr:row>10</xdr:row>
        <xdr:rowOff>457200</xdr:rowOff>
    </xdr:to>
</xdr:twoCellAnchor>"#;

    let drawing = parse_drawing(xml);
    assert_eq!(drawing.anchors.len(), 1);

    if let Anchor::TwoCell(anchor) = &drawing.anchors[0] {
        assert_eq!(anchor.from.col, 1);
        assert_eq!(anchor.from.row, 2);
        assert_eq!(anchor.to.col, 5);
        assert_eq!(anchor.to.col_off, 914400);
        assert_eq!(anchor.to.row, 10);
        assert_eq!(anchor.to.row_off, 457200);
        assert_eq!(anchor.edit_as, Some(EditAs::OneCell));
    } else {
        panic!("Expected TwoCell anchor");
    }
}

#[test]
fn test_parse_one_cell_anchor() {
    let xml = br#"<xdr:oneCellAnchor>
    <xdr:from>
        <xdr:col>3</xdr:col>
        <xdr:colOff>100000</xdr:colOff>
        <xdr:row>5</xdr:row>
        <xdr:rowOff>50000</xdr:rowOff>
    </xdr:from>
    <xdr:ext cx="1000000" cy="500000"/>
</xdr:oneCellAnchor>"#;

    let drawing = parse_drawing(xml);
    assert_eq!(drawing.anchors.len(), 1);

    if let Anchor::OneCell(anchor) = &drawing.anchors[0] {
        assert_eq!(anchor.from.col, 3);
        assert_eq!(anchor.from.col_off, 100000);
        assert_eq!(anchor.from.row, 5);
        assert_eq!(anchor.from.row_off, 50000);
        assert_eq!(anchor.extent.cx, 1000000);
        assert_eq!(anchor.extent.cy, 500000);
    } else {
        panic!("Expected OneCell anchor");
    }
}

#[test]
fn test_parse_absolute_anchor() {
    let xml = br#"<xdr:absoluteAnchor>
    <xdr:pos x="1000000" y="2000000"/>
    <xdr:ext cx="3000000" cy="1500000"/>
</xdr:absoluteAnchor>"#;

    let drawing = parse_drawing(xml);
    assert_eq!(drawing.anchors.len(), 1);

    if let Anchor::Absolute(anchor) = &drawing.anchors[0] {
        assert_eq!(anchor.pos.x, 1000000);
        assert_eq!(anchor.pos.y, 2000000);
        assert_eq!(anchor.extent.cx, 3000000);
        assert_eq!(anchor.extent.cy, 1500000);
    } else {
        panic!("Expected Absolute anchor");
    }
}

// -------------------------------------------------------------------------
// Picture parsing tests
// -------------------------------------------------------------------------

#[test]
fn test_parse_picture() {
    let xml = br#"<xdr:twoCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:pic>
        <xdr:nvPicPr>
            <xdr:cNvPr id="2" name="Picture 1" descr="Test Image"/>
        </xdr:nvPicPr>
        <xdr:blipFill>
            <a:blip r:embed="rId1"/>
        </xdr:blipFill>
        <xdr:spPr>
            <a:xfrm>
                <a:off x="100" y="200"/>
                <a:ext cx="1000" cy="500"/>
            </a:xfrm>
        </xdr:spPr>
    </xdr:pic>
</xdr:twoCellAnchor>"#;

    let drawing = parse_drawing(xml);
    assert_eq!(drawing.anchors.len(), 1);

    if let Anchor::TwoCell(anchor) = &drawing.anchors[0] {
        if let DrawingContent::Picture(pic) = &anchor.content {
            assert_eq!(pic.nv_pic_pr.c_nv_pr.name, "Picture 1");
            assert_eq!(pic.nv_pic_pr.c_nv_pr.descr, Some("Test Image".to_string()));
            assert_eq!(pic.blip_fill.embed_id, Some("rId1".to_string()));
            assert_eq!(pic.nv_pic_pr.c_nv_pr.id, StDrawingElementId::new(2));
        } else {
            panic!("Expected Picture content");
        }
    } else {
        panic!("Expected TwoCell anchor");
    }
}

#[test]
fn test_parse_picture_with_linked_image() {
    let xml = br#"<xdr:pic>
    <xdr:nvPicPr>
        <xdr:cNvPr id="3" name="Linked Picture"/>
    </xdr:nvPicPr>
    <xdr:blipFill>
        <a:blip r:link="rId2" cstate="print"/>
    </xdr:blipFill>
</xdr:pic>"#;

    let pic = parse_picture(xml, 0).unwrap();
    assert_eq!(pic.blip_fill.link_id, Some("rId2".to_string()));
    assert_eq!(pic.blip_fill.compression, Some(CompressionState::Print));
}

// -------------------------------------------------------------------------
// Shape parsing tests
// -------------------------------------------------------------------------

#[test]
fn test_parse_shape_rectangle() {
    let xml = br#"<xdr:twoCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:sp>
        <xdr:nvSpPr>
            <xdr:cNvPr id="4" name="Rectangle 1"/>
        </xdr:nvSpPr>
        <xdr:spPr>
            <a:prstGeom prst="rect"/>
            <a:solidFill>
                <a:srgbClr val="FF0000"/>
            </a:solidFill>
        </xdr:spPr>
    </xdr:sp>
</xdr:twoCellAnchor>"#;

    let drawing = parse_drawing(xml);
    assert_eq!(drawing.anchors.len(), 1);

    if let Anchor::TwoCell(anchor) = &drawing.anchors[0] {
        if let DrawingContent::Shape(shape) = &anchor.content {
            assert_eq!(shape.nv_sp_pr.c_nv_pr.name, "Rectangle 1");
            assert_eq!(
                shape.sp_pr.geometry.as_ref().and_then(|g| match g {
                    ooxml_types::drawings::ShapeGeometry::Preset(p) => Some(p.prst),
                    _ => None,
                }),
                Some(ShapePreset::Rect)
            );

            if let Some(Fill::Solid(fill)) = &shape.sp_pr.fill {
                match &fill.color {
                    ooxml_types::drawings::DrawingColor::SrgbClr { val, .. } => {
                        assert_eq!(val, "FF0000")
                    }
                    other => panic!("Expected SrgbClr, got {other:?}"),
                }
            } else {
                panic!("Expected solid fill");
            }
        } else {
            panic!("Expected Shape content");
        }
    }
}

#[test]
fn test_parse_shape_ellipse() {
    let xml = br#"<xdr:sp>
    <xdr:nvSpPr>
        <xdr:cNvPr id="5" name="Oval 1"/>
    </xdr:nvSpPr>
    <xdr:spPr>
        <a:prstGeom prst="ellipse"/>
    </xdr:spPr>
</xdr:sp>"#;

    let shape = parse_shape(xml, 0).unwrap();
    assert_eq!(
        shape.sp_pr.geometry.as_ref().and_then(|g| match g {
            ooxml_types::drawings::ShapeGeometry::Preset(p) => Some(p.prst),
            _ => None,
        }),
        Some(ShapePreset::Ellipse)
    );
    assert_eq!(shape.nv_sp_pr.c_nv_pr.name, "Oval 1");
}

#[test]
fn test_parse_shape_with_transform() {
    let xml = br#"<xdr:sp>
    <xdr:spPr>
        <a:xfrm rot="5400000" flipH="1">
            <a:off x="1000000" y="2000000"/>
            <a:ext cx="500000" cy="300000"/>
        </a:xfrm>
        <a:prstGeom prst="triangle"/>
    </xdr:spPr>
</xdr:sp>"#;

    let shape = parse_shape(xml, 0).unwrap();
    let transform = shape.sp_pr.xfrm.unwrap();
    assert_eq!(transform.rot(), StAngle::new(5400000));
    assert!(transform.is_flip_h());
    assert!(!transform.is_flip_v());
    assert_eq!(transform.off_x(), 1000000);
    assert_eq!(transform.off_y(), 2000000);
    assert_eq!(transform.ext_cx(), 500000);
    assert_eq!(transform.ext_cy(), 300000);
}

// -------------------------------------------------------------------------
// Text box tests
// -------------------------------------------------------------------------

#[test]
fn test_parse_text_box() {
    let xml = br#"<xdr:sp>
    <xdr:nvSpPr>
        <xdr:cNvPr id="6" name="TextBox 1"/>
    </xdr:nvSpPr>
    <xdr:spPr>
        <a:prstGeom prst="textBox"/>
    </xdr:spPr>
    <xdr:txBody>
        <a:bodyPr wrap="square" anchor="ctr"/>
        <a:p>
            <a:pPr algn="ctr"/>
            <a:r>
                <a:rPr sz="1200" b="1"/>
                <a:t>Hello World</a:t>
            </a:r>
        </a:p>
    </xdr:txBody>
</xdr:sp>"#;

    let shape = parse_shape(xml, 0).unwrap();
    assert_eq!(
        shape.sp_pr.geometry.as_ref().and_then(|g| match g {
            ooxml_types::drawings::ShapeGeometry::Preset(p) => Some(p.prst),
            _ => None,
        }),
        Some(ShapePreset::TextBox)
    );

    let text_body = shape.tx_body.unwrap();
    assert_eq!(text_body.body_props.wrap, Some(TextWrap::Square));
    assert_eq!(text_body.body_props.anchor, Some(TextAnchor::Center));

    assert_eq!(text_body.paragraphs.len(), 1);
    let para = &text_body.paragraphs[0];
    assert_eq!(para.props.align, Some(TextAlign::Center));

    assert_eq!(para.runs.len(), 1);
    if let types::TextRunContent::Run(run) = &para.runs[0] {
        assert_eq!(run.text, "Hello World");
        assert_eq!(run.props.size, Some(StTextFontSize::new_unchecked(1200)));
        assert_eq!(run.props.bold, Some(true));
    } else {
        panic!("Expected TextRunContent::Run");
    }
}

#[test]
fn test_parse_text_with_xml_entities() {
    let xml = br#"<xdr:sp>
    <xdr:txBody>
        <a:p>
            <a:r>
                <a:t>A &amp; B &lt; C &gt; D</a:t>
            </a:r>
        </a:p>
    </xdr:txBody>
</xdr:sp>"#;

    let shape = parse_shape(xml, 0).unwrap();
    let text_body = shape.tx_body.unwrap();
    if let types::TextRunContent::Run(run) = &text_body.paragraphs[0].runs[0] {
        assert_eq!(run.text, "A & B < C > D");
    } else {
        panic!("Expected TextRunContent::Run");
    }
}

// -------------------------------------------------------------------------
// Group shape tests
// -------------------------------------------------------------------------

#[test]
fn test_parse_group_shape() {
    let xml = br#"<xdr:twoCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:grpSp>
        <xdr:nvGrpSpPr>
            <xdr:cNvPr id="10" name="Group 1"/>
        </xdr:nvGrpSpPr>
        <xdr:grpSpPr>
            <a:xfrm>
                <a:off x="0" y="0"/>
                <a:ext cx="5000000" cy="5000000"/>
            </a:xfrm>
        </xdr:grpSpPr>
        <xdr:sp>
            <xdr:nvSpPr><xdr:cNvPr id="11" name="Shape 1"/></xdr:nvSpPr>
            <xdr:spPr><a:prstGeom prst="rect"/></xdr:spPr>
        </xdr:sp>
        <xdr:sp>
            <xdr:nvSpPr><xdr:cNvPr id="12" name="Shape 2"/></xdr:nvSpPr>
            <xdr:spPr><a:prstGeom prst="ellipse"/></xdr:spPr>
        </xdr:sp>
    </xdr:grpSp>
</xdr:twoCellAnchor>"#;

    let drawing = parse_drawing(xml);
    assert_eq!(drawing.anchors.len(), 1);

    if let Anchor::TwoCell(anchor) = &drawing.anchors[0] {
        if let DrawingContent::GroupShape(group) = &anchor.content {
            assert_eq!(group.nv_grp_sp_pr.c_nv_pr.name, "Group 1");
            assert_eq!(group.children.len(), 2);

            // Check first child shape
            if let DrawingContent::Shape(shape) = &group.children[0] {
                assert_eq!(
                    shape.sp_pr.geometry.as_ref().and_then(|g| match g {
                        ooxml_types::drawings::ShapeGeometry::Preset(p) => Some(p.prst),
                        _ => None,
                    }),
                    Some(ShapePreset::Rect)
                );
            }

            // Check second child shape
            if let DrawingContent::Shape(shape) = &group.children[1] {
                assert_eq!(
                    shape.sp_pr.geometry.as_ref().and_then(|g| match g {
                        ooxml_types::drawings::ShapeGeometry::Preset(p) => Some(p.prst),
                        _ => None,
                    }),
                    Some(ShapePreset::Ellipse)
                );
            }
        } else {
            panic!("Expected GroupShape content");
        }
    }
}

// -------------------------------------------------------------------------
// Connector tests
// -------------------------------------------------------------------------

#[test]
fn test_parse_connector() {
    let xml = br#"<xdr:twoCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:cxnSp>
        <xdr:nvCxnSpPr>
            <xdr:cNvPr id="20" name="Connector 1"/>
            <xdr:cNvCxnSpPr>
                <a:stCxn id="10" idx="2"/>
                <a:endCxn id="11" idx="0"/>
            </xdr:cNvCxnSpPr>
        </xdr:nvCxnSpPr>
        <xdr:spPr>
            <a:prstGeom prst="straightConnector1"/>
            <a:ln w="12700">
                <a:solidFill><a:srgbClr val="0000FF"/></a:solidFill>
            </a:ln>
        </xdr:spPr>
    </xdr:cxnSp>
</xdr:twoCellAnchor>"#;

    let drawing = parse_drawing(xml);
    assert_eq!(drawing.anchors.len(), 1);

    if let Anchor::TwoCell(anchor) = &drawing.anchors[0] {
        if let DrawingContent::Connector(connector) = &anchor.content {
            assert_eq!(connector.nv_cxn_sp_pr.c_nv_pr.name, "Connector 1");

            let start = connector.nv_cxn_sp_pr.st_cxn.as_ref().unwrap();
            assert_eq!(start.shape_id, 10);
            assert_eq!(start.idx, 2);

            let end = connector.nv_cxn_sp_pr.end_cxn.as_ref().unwrap();
            assert_eq!(end.shape_id, 11);
            assert_eq!(end.idx, 0);

            let outline = connector.sp_pr.ln.as_ref().unwrap();
            assert_eq!(outline.width, Some(12700));
        } else {
            panic!("Expected Connector content");
        }
    }
}

// -------------------------------------------------------------------------
// Fill style tests
// -------------------------------------------------------------------------

#[test]
fn test_parse_no_fill() {
    let xml = br#"<xdr:spPr>
    <a:noFill/>
</xdr:spPr>"#;

    let props = parse_shape_properties(xml);
    assert!(matches!(props.fill, Some(Fill::NoFill)));
}

#[test]
fn test_parse_gradient_fill() {
    let xml = br#"<xdr:spPr>
    <a:gradFill>
        <a:gsLst>
            <a:gs pos="0">
                <a:srgbClr val="FF0000"/>
            </a:gs>
            <a:gs pos="100000">
                <a:srgbClr val="0000FF"/>
            </a:gs>
        </a:gsLst>
        <a:lin ang="5400000"/>
    </a:gradFill>
</xdr:spPr>"#;

    let props = parse_shape_properties(xml);
    if let Some(Fill::Gradient(grad)) = props.fill {
        assert_eq!(grad.lin_ang, Some(StAngle::new(5_400_000))); // 90 degrees in 60000ths
        assert_eq!(grad.stops.len(), 2);
        assert_eq!(
            grad.stops[0].position,
            StPositiveFixedPercentageDecimal::new_unchecked(0)
        );
        match &grad.stops[0].color {
            ooxml_types::drawings::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
            other => panic!("Expected SrgbClr, got {other:?}"),
        }
        assert_eq!(
            grad.stops[1].position,
            StPositiveFixedPercentageDecimal::new_unchecked(100000)
        );
        match &grad.stops[1].color {
            ooxml_types::drawings::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "0000FF"),
            other => panic!("Expected SrgbClr, got {other:?}"),
        }
    } else {
        panic!("Expected gradient fill");
    }
}

#[test]
fn test_parse_pattern_fill() {
    let xml = br#"<xdr:spPr>
    <a:pattFill prst="diagStripe">
        <a:fgClr><a:srgbClr val="FF0000"/></a:fgClr>
        <a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr>
    </a:pattFill>
</xdr:spPr>"#;

    let props = parse_shape_properties(xml);
    if let Some(Fill::Pattern(patt)) = props.fill {
        assert_eq!(patt.preset, None); // "diagStripe" is not a recognized PresetPatternVal
        match patt.fg_color.as_ref().unwrap() {
            ooxml_types::drawings::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
            other => panic!("Expected SrgbClr, got {other:?}"),
        }
        match patt.bg_color.as_ref().unwrap() {
            ooxml_types::drawings::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FFFFFF"),
            other => panic!("Expected SrgbClr, got {other:?}"),
        }
    } else {
        panic!("Expected pattern fill");
    }
}

// -------------------------------------------------------------------------
// Line/outline tests
// -------------------------------------------------------------------------

#[test]
fn test_parse_outline_with_dash() {
    let xml = br#"<a:ln w="25400">
    <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
    <a:prstDash val="dash"/>
</a:ln>"#;

    let outline = parse_outline(xml).unwrap();
    assert_eq!(outline.width, Some(25400));
    assert_eq!(
        outline.dash,
        Some(ooxml_types::drawings::LineDash::Preset(DashStyle::Dash))
    );
    match &outline.fill {
        Some(ooxml_types::drawings::LineFill::Solid(sf)) => match &sf.color {
            ooxml_types::drawings::DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "000000"),
            other => panic!("Expected SrgbClr, got {other:?}"),
        },
        other => panic!("Expected LineFill::Solid, got {other:?}"),
    }
}

// -------------------------------------------------------------------------
// Theme color tests
// -------------------------------------------------------------------------

#[test]
fn test_parse_theme_color() {
    let xml = br#"<a:solidFill>
    <a:schemeClr val="accent1">
        <a:lumMod val="75000"/>
        <a:lumOff val="25000"/>
    </a:schemeClr>
</a:solidFill>"#;

    let color = parse_color(xml);
    match &color {
        ooxml_types::drawings::DrawingColor::SchemeClr { val, transforms } => {
            assert_eq!(*val, ooxml_types::drawings::SchemeColor::Accent1);
            assert_eq!(transforms.len(), 2);
            assert_eq!(
                transforms[0],
                ooxml_types::drawings::ColorTransform::LumMod { val: 75000 }
            );
            assert_eq!(
                transforms[1],
                ooxml_types::drawings::ColorTransform::LumOff { val: 25000 }
            );
        }
        other => panic!("Expected SchemeClr, got {other:?}"),
    }
}

// -------------------------------------------------------------------------
// Edit behavior tests
// -------------------------------------------------------------------------

#[test]
fn test_parse_edit_as() {
    assert_eq!(parse_edit_as(b"twoCell"), Some(EditAs::TwoCell));
    assert_eq!(parse_edit_as(b"oneCell"), Some(EditAs::OneCell));
    assert_eq!(parse_edit_as(b"absolute"), Some(EditAs::Absolute));
    assert_eq!(parse_edit_as(b"invalid"), None);
}

// -------------------------------------------------------------------------
// Shape preset tests
// -------------------------------------------------------------------------

#[test]
fn test_parse_shape_presets() {
    assert_eq!(parse_shape_preset(b"rect"), Some(ShapePreset::Rect));
    assert_eq!(
        parse_shape_preset(b"roundRect"),
        Some(ShapePreset::RoundRect)
    );
    assert_eq!(parse_shape_preset(b"ellipse"), Some(ShapePreset::Ellipse));
    assert_eq!(parse_shape_preset(b"triangle"), Some(ShapePreset::Triangle));
    assert_eq!(parse_shape_preset(b"line"), Some(ShapePreset::Line));
    assert_eq!(
        parse_shape_preset(b"rightArrow"),
        Some(ShapePreset::RightArrow)
    );
    assert_eq!(
        parse_shape_preset(b"flowChartProcess"),
        Some(ShapePreset::FlowChartProcess)
    );
    assert_eq!(parse_shape_preset(b"star5"), Some(ShapePreset::Star5));
    assert_eq!(parse_shape_preset(b"textBox"), Some(ShapePreset::TextBox));
    assert_eq!(parse_shape_preset(b"unknown"), None);
}

// -------------------------------------------------------------------------
// Multiple anchors test
// -------------------------------------------------------------------------

#[test]
fn test_parse_multiple_anchors() {
    let xml = br#"<xdr:wsDr>
    <xdr:twoCellAnchor>
        <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
        <xdr:to><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    </xdr:twoCellAnchor>
    <xdr:oneCellAnchor>
        <xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
        <xdr:ext cx="100" cy="100"/>
    </xdr:oneCellAnchor>
    <xdr:absoluteAnchor>
        <xdr:pos x="100" y="100"/>
        <xdr:ext cx="200" cy="200"/>
    </xdr:absoluteAnchor>
</xdr:wsDr>"#;

    let drawing = parse_drawing(xml);
    assert_eq!(drawing.anchors.len(), 3);

    assert!(matches!(drawing.anchors[0], Anchor::TwoCell(_)));
    assert!(matches!(drawing.anchors[1], Anchor::OneCell(_)));
    assert!(matches!(drawing.anchors[2], Anchor::Absolute(_)));
}

#[test]
fn test_anchor_geometry_uses_direct_child_extent() {
    let xml = br#"<xdr:oneCellAnchor>
    <xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:ext cx="100" cy="200"/>
    <xdr:pic>
        <xdr:nvPicPr><xdr:cNvPr id="2" name="Picture 1"/></xdr:nvPicPr>
        <xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill>
        <xdr:spPr><a:xfrm><a:ext cx="999" cy="999"/></a:xfrm></xdr:spPr>
    </xdr:pic>
</xdr:oneCellAnchor>"#;

    let drawing = parse_drawing(xml);
    assert_eq!(drawing.anchors.len(), 1);
    let Anchor::OneCell(anchor) = &drawing.anchors[0] else {
        panic!("Expected OneCell anchor");
    };
    assert_eq!(anchor.extent.cx, 100);
    assert_eq!(anchor.extent.cy, 200);
}

#[test]
fn test_alternate_content_graphic_frame_precedes_fallback_shape() {
    let xml = br#"<xdr:twoCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>8</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <mc:AlternateContent>
        <mc:Choice Requires="cx1">
            <xdr:graphicFrame>
                <xdr:nvGraphicFramePr><xdr:cNvPr id="3" name="ChartEx 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
                <xdr:xfrm/>
                <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chart r:id="rId5"/></a:graphicData></a:graphic>
            </xdr:graphicFrame>
        </mc:Choice>
        <mc:Fallback>
            <xdr:sp><xdr:nvSpPr><xdr:cNvPr id="4" name="Fallback Shape"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr/></xdr:sp>
        </mc:Fallback>
    </mc:AlternateContent>
    <xdr:clientData/>
</xdr:twoCellAnchor>"#;

    let drawing = parse_drawing(xml);
    assert_eq!(drawing.anchors.len(), 1);
    let Anchor::TwoCell(anchor) = &drawing.anchors[0] else {
        panic!("Expected TwoCell anchor");
    };
    assert!(anchor.mc_alternate_content.is_some());
    let DrawingContent::GraphicFrame(frame) = &anchor.content else {
        panic!("Expected GraphicFrame content");
    };
    let raw = frame.graphic_xml.as_deref().unwrap_or_default();
    assert!(raw.contains("<mc:AlternateContent>"));
    assert!(raw.contains("rId5"));
}

// -------------------------------------------------------------------------
// Malformed input tests
// -------------------------------------------------------------------------

#[test]
fn test_parse_malformed_missing_from() {
    let xml = br#"<xdr:twoCellAnchor>
    <xdr:to><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
</xdr:twoCellAnchor>"#;

    let drawing = parse_drawing(xml);
    // Should gracefully handle missing from element
    assert_eq!(drawing.anchors.len(), 0);
}

#[test]
fn test_parse_malformed_missing_extent() {
    let xml = br#"<xdr:oneCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
</xdr:oneCellAnchor>"#;

    let drawing = parse_drawing(xml);
    // Should gracefully handle missing extent
    assert_eq!(drawing.anchors.len(), 0);
}

#[test]
fn test_parse_empty_values() {
    let xml = br#"<xdr:twoCellAnchor>
    <xdr:from>
        <xdr:col></xdr:col>
        <xdr:colOff></xdr:colOff>
        <xdr:row></xdr:row>
        <xdr:rowOff></xdr:rowOff>
    </xdr:from>
    <xdr:to>
        <xdr:col>1</xdr:col>
        <xdr:colOff>0</xdr:colOff>
        <xdr:row>1</xdr:row>
        <xdr:rowOff>0</xdr:rowOff>
    </xdr:to>
</xdr:twoCellAnchor>"#;

    let drawing = parse_drawing(xml);
    // Should use defaults for empty values
    assert_eq!(drawing.anchors.len(), 1);

    if let Anchor::TwoCell(anchor) = &drawing.anchors[0] {
        assert_eq!(anchor.from.col, 0);
        assert_eq!(anchor.from.row, 0);
    }
}

// -------------------------------------------------------------------------
// Helper function tests
// -------------------------------------------------------------------------

#[test]
fn test_decode_xml_entities() {
    assert_eq!(decode_xml_entities(b"Hello"), "Hello");
    assert_eq!(decode_xml_entities(b"A &amp; B"), "A & B");
    assert_eq!(decode_xml_entities(b"&lt;tag&gt;"), "<tag>");
    assert_eq!(decode_xml_entities(b"&quot;quoted&quot;"), "\"quoted\"");
    assert_eq!(decode_xml_entities(b"it&apos;s"), "it's");
}

#[test]
fn test_scheme_name_to_index() {
    assert_eq!(scheme_name_to_index(b"dk1"), Some(0));
    assert_eq!(scheme_name_to_index(b"lt1"), Some(1));
    assert_eq!(scheme_name_to_index(b"accent1"), Some(4));
    assert_eq!(scheme_name_to_index(b"hlink"), Some(10));
    assert_eq!(scheme_name_to_index(b"invalid"), None);
}

#[test]
fn test_parse_u32() {
    assert_eq!(parse_u32(b"123"), Some(123));
    assert_eq!(parse_u32(b"  456  "), Some(456));
    assert_eq!(parse_u32(b"abc"), None);
    assert_eq!(parse_u32(b""), None);
}

#[test]
fn test_parse_i64() {
    assert_eq!(parse_i64(b"123456"), Some(123456));
    assert_eq!(parse_i64(b"-789"), Some(-789));
    assert_eq!(parse_i64(b"  100  "), Some(100));
    assert_eq!(parse_i64(b"not_a_number"), None);
}
