use super::common::*;

// -------------------------------------------------------------------------
// EMU conversion tests
// -------------------------------------------------------------------------

#[test]
fn test_inches_to_emu() {
    assert_eq!(inches_to_emu(1.0), 914400);
    assert_eq!(inches_to_emu(2.0), 1828800);
    assert_eq!(inches_to_emu(0.5), 457200);
}

#[test]
fn test_cm_to_emu() {
    assert_eq!(cm_to_emu(1.0), 360000);
    assert_eq!(cm_to_emu(2.54), 914400); // ~1 inch
}

#[test]
fn test_pixels_to_emu() {
    // At 96 DPI, 96 pixels = 1 inch = 914400 EMUs
    assert_eq!(pixels_to_emu(96, 96), 914400);
    // At 72 DPI, 72 pixels = 1 inch
    assert_eq!(pixels_to_emu(72, 72), 914400);
}

#[test]
fn test_points_to_emu() {
    // 1 point = 12700 EMUs
    assert_eq!(points_to_emu(1.0), 12700);
    assert_eq!(points_to_emu(72.0), 914400); // 72 points = 1 inch
}

#[test]
fn test_emu_to_inches() {
    assert!((emu_to_inches(914400) - 1.0).abs() < 0.0001);
    assert!((emu_to_inches(1828800) - 2.0).abs() < 0.0001);
}

#[test]
fn test_emu_to_cm() {
    assert!((emu_to_cm(360000) - 1.0).abs() < 0.0001);
}

// -------------------------------------------------------------------------
// Edit behavior tests
// -------------------------------------------------------------------------

#[test]
fn test_edit_as_to_ooxml() {
    assert_eq!(EditAs::TwoCell.to_ooxml(), "twoCell");
    assert_eq!(EditAs::OneCell.to_ooxml(), "oneCell");
    assert_eq!(EditAs::Absolute.to_ooxml(), "absolute");
}

#[test]
fn test_edit_as_default() {
    let edit: EditAs = Default::default();
    assert_eq!(edit, EditAs::TwoCell);
}

// -------------------------------------------------------------------------
// Preset shape tests
// -------------------------------------------------------------------------

#[test]
fn test_preset_shape_str() {
    assert_eq!(ShapePreset::Rect.to_ooxml(), "rect");
    assert_eq!(ShapePreset::RoundRect.to_ooxml(), "roundRect");
    assert_eq!(ShapePreset::Ellipse.to_ooxml(), "ellipse");
    assert_eq!(ShapePreset::Triangle.to_ooxml(), "triangle");
    assert_eq!(ShapePreset::Diamond.to_ooxml(), "diamond");
    assert_eq!(ShapePreset::Star5.to_ooxml(), "star5");
}

// -------------------------------------------------------------------------
// Line dash tests
// -------------------------------------------------------------------------

#[test]
fn test_line_dash_str() {
    assert_eq!(DashStyle::Solid.to_ooxml(), "solid");
    assert_eq!(DashStyle::Dot.to_ooxml(), "dot");
    assert_eq!(DashStyle::Dash.to_ooxml(), "dash");
    assert_eq!(DashStyle::DashDot.to_ooxml(), "dashDot");
    assert_eq!(DashStyle::LongDash.to_ooxml(), "lgDash");
}

// -------------------------------------------------------------------------
// Drawing writer basic tests
// -------------------------------------------------------------------------

#[test]
fn test_empty_drawing() {
    let writer = DrawingWriter::new();
    assert!(writer.is_empty());
    assert_eq!(writer.len(), 0);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<?xml version"));
    assert!(xml_str.contains("<xdr:wsDr"));
    assert!(xml_str.contains("</xdr:wsDr>"));
    assert!(xml_str.contains("xmlns:xdr="));
    assert!(xml_str.contains("xmlns:a="));
    // Empty drawings should NOT include xmlns:r (no objects reference relationship IDs)
    assert!(!xml_str.contains("xmlns:r="));
}

#[test]
fn test_add_picture() {
    let mut writer = DrawingWriter::new();
    writer.add_picture(
        CellAnchor {
            col: 1,
            col_off: 0,
            row: 1,
            row_off: 0,
        },
        CellAnchor {
            col: 5,
            col_off: 914400,
            row: 10,
            row_off: 457200,
        },
        ImageProps {
            name: "Picture 1".to_string(),
            description: Some("Test image".to_string()),
            r_id: "rId1".to_string(),
            locks: DrawingLocking {
                no_change_aspect: true,
                ..Default::default()
            },
            ..Default::default()
        },
    );

    assert!(!writer.is_empty());
    assert_eq!(writer.len(), 1);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<xdr:twoCellAnchor>"));
    assert!(xml_str.contains("<xdr:from>"));
    assert!(xml_str.contains("<xdr:col>1</xdr:col>"));
    assert!(xml_str.contains("<xdr:row>1</xdr:row>"));
    assert!(xml_str.contains("<xdr:to>"));
    assert!(xml_str.contains("<xdr:col>5</xdr:col>"));
    assert!(xml_str.contains("<xdr:row>10</xdr:row>"));
    assert!(xml_str.contains("<xdr:colOff>914400</xdr:colOff>"));
    assert!(xml_str.contains("<xdr:rowOff>457200</xdr:rowOff>"));
    assert!(xml_str.contains("<xdr:pic>"));
    assert!(xml_str.contains("name=\"Picture 1\""));
    assert!(xml_str.contains("descr=\"Test image\""));
    assert!(xml_str.contains("r:embed=\"rId1\""));
    assert!(xml_str.contains("noChangeAspect=\"1\""));
    assert!(xml_str.contains("<xdr:clientData/>"));
}

#[test]
fn test_add_picture_fixed() {
    let mut writer = DrawingWriter::new();
    writer.add_picture_fixed(
        CellAnchor {
            col: 2,
            col_off: 100000,
            row: 3,
            row_off: 50000,
        },
        inches_to_emu(2.0),
        inches_to_emu(1.5),
        ImageProps {
            name: "Fixed Image".to_string(),
            r_id: "rId2".to_string(),
            rotation: Some(5400000), // 90 degrees
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<xdr:oneCellAnchor>"));
    assert!(xml_str.contains("<xdr:from>"));
    assert!(xml_str.contains("<xdr:col>2</xdr:col>"));
    assert!(xml_str.contains("<xdr:colOff>100000</xdr:colOff>"));
    assert!(xml_str.contains("<xdr:ext cx=\"1828800\" cy=\"1371600\""));
    assert!(xml_str.contains("rot=\"5400000\""));
    // When no_change_aspect is false (default), the attribute is omitted per OOXML spec
    assert!(!xml_str.contains("noChangeAspect"));
}

#[test]
fn test_add_shape() {
    let mut writer = DrawingWriter::new();
    writer.add_shape(
        CellAnchor {
            col: 0,
            col_off: 0,
            row: 0,
            row_off: 0,
        },
        CellAnchor {
            col: 3,
            col_off: 0,
            row: 3,
            row_off: 0,
        },
        ShapeProps {
            original_id: None,
            name: "Rectangle 1".to_string(),
            preset: ShapePreset::Rect,
            fill: Some(solid_fill("FF0000")),
            outline: Some(Outline {
                width: Some(12700),
                fill: Some(line_solid("000000")),
                dash: Some(LineDash::Preset(DashStyle::Solid)),
                ..Default::default()
            }),
            text: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<xdr:twoCellAnchor>"));
    assert!(xml_str.contains("<xdr:sp>"));
    assert!(xml_str.contains("name=\"Rectangle 1\""));
    assert!(xml_str.contains("prst=\"rect\""));
    assert!(xml_str.contains("<a:solidFill>"));
    assert!(xml_str.contains("val=\"FF0000\""));
    assert!(xml_str.contains("<a:ln w=\"12700\">"));
    assert!(xml_str.contains("val=\"000000\""));
    assert!(xml_str.contains("val=\"solid\""));
}

#[test]
fn test_add_shape_with_text() {
    let mut writer = DrawingWriter::new();
    writer.add_shape(
        CellAnchor::default(),
        CellAnchor {
            col: 2,
            col_off: 0,
            row: 2,
            row_off: 0,
        },
        ShapeProps {
            original_id: None,
            name: "Shape with text".to_string(),
            preset: ShapePreset::Ellipse,
            fill: Some(DrawingFill::NoFill),
            outline: None,
            text: Some("Hello World".to_string()),
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("prst=\"ellipse\""));
    assert!(xml_str.contains("<a:noFill/>"));
    assert!(xml_str.contains("<xdr:txBody>"));
    assert!(xml_str.contains("<a:t>Hello World</a:t>"));
}

#[test]
fn test_add_shape_with_gradient() {
    let mut writer = DrawingWriter::new();
    writer.add_shape(
        CellAnchor::default(),
        CellAnchor {
            col: 4,
            col_off: 0,
            row: 4,
            row_off: 0,
        },
        ShapeProps {
            original_id: None,
            name: "Gradient Shape".to_string(),
            preset: ShapePreset::RoundRect,
            fill: Some(DrawingFill::Gradient(GradientFill {
                stops: vec![
                    GradientStop {
                        position: StPositiveFixedPercentageDecimal::new_unchecked(0),
                        color: rgb("FF0000"),
                    },
                    GradientStop {
                        position: StPositiveFixedPercentageDecimal::new_unchecked(50000),
                        color: rgb("00FF00"),
                    },
                    GradientStop {
                        position: StPositiveFixedPercentageDecimal::new_unchecked(100000),
                        color: rgb("0000FF"),
                    },
                ],
                ..Default::default()
            })),
            outline: None,
            text: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<a:gradFill>"));
    assert!(xml_str.contains("<a:gsLst>"));
    assert!(xml_str.contains("pos=\"0\""));
    assert!(xml_str.contains("val=\"FF0000\""));
    assert!(xml_str.contains("pos=\"50000\""));
    assert!(xml_str.contains("val=\"00FF00\""));
    assert!(xml_str.contains("pos=\"100000\""));
    assert!(xml_str.contains("val=\"0000FF\""));
    // When angle is None, no <a:lin> element is emitted
    assert!(!xml_str.contains("<a:lin"));
}

#[test]
fn test_add_chart() {
    let mut writer = DrawingWriter::new();
    writer.add_chart(
        CellAnchor {
            col: 5,
            col_off: 0,
            row: 1,
            row_off: 0,
        },
        CellAnchor {
            col: 12,
            col_off: 0,
            row: 15,
            row_off: 0,
        },
        ChartRef {
            original_id: None,
            name: "Chart 1".to_string(),
            r_id: "rId3".to_string(),
            macro_name: None,
            nv_ext_lst: None,
            graphic_frame_locks: Default::default(),
            has_graphic_frame_locks: false,
            no_change_aspect_explicit: None,
            no_drilldown: false,
            c_nv_graphic_frame_pr_ext_lst: None,
            xfrm_off_x: 0,
            xfrm_off_y: 0,
            xfrm_ext_cx: 0,
            xfrm_ext_cy: 0,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<xdr:graphicFrame>"));
    assert!(xml_str.contains("<xdr:nvGraphicFramePr>"));
    assert!(xml_str.contains("name=\"Chart 1\""));
    assert!(xml_str.contains("<xdr:xfrm>"));
    assert!(xml_str.contains("<a:graphic>"));
    assert!(xml_str.contains("<a:graphicData"));
    assert!(xml_str.contains(&format!("uri=\"{}\"", NS_C)));
    assert!(xml_str.contains("<c:chart"));
    assert!(xml_str.contains("r:id=\"rId3\""));
}

#[test]
fn chart_ex_preserves_cnvpr_ext_lst() {
    let mut writer = DrawingWriter::new();
    writer.add_anchor(DrawingAnchor::TwoCell(
        TwoCellAnchor {
            from: CellAnchor {
                col: 1,
                col_off: 0,
                row: 1,
                row_off: 0,
            },
            to: CellAnchor {
                col: 8,
                col_off: 0,
                row: 20,
                row_off: 0,
            },
            client_data: ClientData::default(),
            ..Default::default()
        },
        DrawingObject::ChartEx(ChartExRef {
            r_id: "rId1".to_string(),
            name: "Waterfall".to_string(),
            id: 4,
            xfrm_off_x: 4413250,
            xfrm_off_y: 1724025,
            xfrm_ext_cx: 4307417,
            xfrm_ext_cy: 2905125,
            macro_name: Some(String::new()),
            nv_ext_lst: Some(
                r#"<a:extLst><a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}"><a16:creationId xmlns:a16="http://schemas.microsoft.com/office/drawing/2014/main" id="{747C816B-D48A-63FE-35C7-CC1AE1ADA584}"/></a:ext></a:extLst>"#
                    .to_string(),
            ),
            graphic_frame_locks: Default::default(),
            has_graphic_frame_locks: true,
            no_change_aspect_explicit: Some(false),
            no_drilldown: false,
            c_nv_graphic_frame_pr_ext_lst: None,
        }),
    ));

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<mc:AlternateContent>"));
    assert!(xml_str.contains(&format!("uri=\"{}\"", NS_CX)));
    assert!(xml_str.contains("<xdr:cNvPr id=\"4\" name=\"Waterfall\">"));
    assert!(xml_str.contains("<a16:creationId"));
    assert!(xml_str.contains("id=\"{747C816B-D48A-63FE-35C7-CC1AE1ADA584}\""));
    assert!(xml_str.contains("</xdr:cNvPr>"));
    assert!(xml_str.contains("<a:graphicFrameLocks noChangeAspect=\"0\"/>"));
    assert!(xml_str.contains("<a:off x=\"4413250\" y=\"1724025\"/>"));
    assert!(xml_str.contains("<a:ext cx=\"4307417\" cy=\"2905125\"/>"));
}

#[test]
fn test_add_text_box() {
    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor {
            col: 0,
            col_off: 50000,
            row: 5,
            row_off: 25000,
        },
        CellAnchor {
            col: 4,
            col_off: 0,
            row: 8,
            row_off: 0,
        },
        {
            let mut tb = TextBox::from_plain("TextBox 1", "This is a text box");
            tb.fill = Some(solid_fill("FFFFFF"));
            tb.outline = Some(Outline {
                width: Some(9525),
                fill: Some(line_solid("333333")),
                dash: Some(LineDash::Preset(DashStyle::Dash)),
                ..Default::default()
            });
            tb
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<xdr:sp>"));
    assert!(xml_str.contains("name=\"TextBox 1\""));
    assert!(xml_str.contains("txBox=\"1\""));
    assert!(xml_str.contains("wrap=\"square\""));
    assert!(xml_str.contains("<a:t>This is a text box</a:t>"));
    assert!(xml_str.contains("val=\"FFFFFF\""));
    assert!(xml_str.contains("<a:ln w=\"9525\">"));
    assert!(xml_str.contains("val=\"dash\""));
}

#[test]
fn test_text_box_no_wrap() {
    let mut writer = DrawingWriter::new();
    writer.add_text_box(CellAnchor::default(), CellAnchor::default(), {
        use ooxml_types::drawings::{
            Paragraph, RunProperties, TextBody, TextBodyProperties, TextRun, TextRunContent,
            TextWrap,
        };
        TextBox {
            original_id: None,
            name: "NoWrap".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties {
                    wrap: Some(TextWrap::None),
                    ..Default::default()
                },
                paragraphs: vec![Paragraph {
                    runs: vec![TextRunContent::Run(TextRun {
                        text: "No wrap text".to_string(),
                        props: RunProperties {
                            lang: Some("en-US".to_string()),
                            ..Default::default()
                        },
                    })],
                    ..Default::default()
                }],
                ..Default::default()
            }),
            fill: None,
            outline: None,
            style: None,
            ..Default::default()
        }
    });

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("wrap=\"none\""));
}

#[test]
fn test_multiple_objects() {
    let mut writer = DrawingWriter::new();

    writer
        .add_picture(
            CellAnchor::default(),
            CellAnchor {
                col: 3,
                col_off: 0,
                row: 3,
                row_off: 0,
            },
            ImageProps {
                name: "Image 1".to_string(),
                r_id: "rId1".to_string(),
                locks: DrawingLocking {
                    no_change_aspect: true,
                    ..Default::default()
                },
                ..Default::default()
            },
        )
        .add_shape(
            CellAnchor {
                col: 4,
                col_off: 0,
                row: 0,
                row_off: 0,
            },
            CellAnchor {
                col: 6,
                col_off: 0,
                row: 2,
                row_off: 0,
            },
            ShapeProps {
                original_id: None,
                name: "Shape 1".to_string(),
                preset: ShapePreset::Star5,
                fill: Some(solid_fill("FFFF00")),
                outline: None,
                text: None,
                ..Default::default()
            },
        )
        .add_chart(
            CellAnchor {
                col: 0,
                col_off: 0,
                row: 5,
                row_off: 0,
            },
            CellAnchor {
                col: 8,
                col_off: 0,
                row: 20,
                row_off: 0,
            },
            ChartRef {
                original_id: None,
                name: "Chart 1".to_string(),
                r_id: "rId2".to_string(),
                macro_name: None,
                nv_ext_lst: None,
                graphic_frame_locks: Default::default(),
                has_graphic_frame_locks: false,
                no_drilldown: false,
                c_nv_graphic_frame_pr_ext_lst: None,
                ..Default::default()
            },
        );

    assert_eq!(writer.len(), 3);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    // Verify all three objects are present
    assert!(xml_str.contains("name=\"Image 1\""));
    assert!(xml_str.contains("name=\"Shape 1\""));
    assert!(xml_str.contains("name=\"Chart 1\""));

    // Verify IDs are sequential
    assert!(xml_str.contains("id=\"2\"")); // First object
    assert!(xml_str.contains("id=\"3\"")); // Second object
    assert!(xml_str.contains("id=\"4\"")); // Third object
}

#[test]
fn test_add_custom_anchor() {
    let mut writer = DrawingWriter::new();

    // Add absolute anchor
    writer.add_anchor(DrawingAnchor::Absolute(
        AbsoluteAnchor {
            pos: Position {
                x: 1000000,
                y: 2000000,
            },
            extent: Extent {
                cx: 3000000,
                cy: 1500000,
            },
            client_data: ClientData::default(),
        },
        DrawingObject::Shape(ShapeProps {
            original_id: None,
            name: "Absolute Shape".to_string(),
            preset: ShapePreset::Diamond,
            fill: None,
            outline: None,
            text: None,
            ..Default::default()
        }),
    ));

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<xdr:absoluteAnchor>"));
    assert!(xml_str.contains("x=\"1000000\""));
    assert!(xml_str.contains("y=\"2000000\""));
    assert!(xml_str.contains("cx=\"3000000\""));
    assert!(xml_str.contains("cy=\"1500000\""));
    assert!(xml_str.contains("prst=\"diamond\""));
}

#[test]
fn test_xml_structure_validity() {
    let mut writer = DrawingWriter::new();
    writer.add_picture(
        CellAnchor::default(),
        CellAnchor {
            col: 2,
            col_off: 0,
            row: 2,
            row_off: 0,
        },
        ImageProps {
            name: "Test".to_string(),
            r_id: "rId1".to_string(),
            locks: DrawingLocking {
                no_change_aspect: true,
                ..Default::default()
            },
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    // Count opening and closing tags to verify structure
    let open_tags: Vec<&str> = xml_str.matches("<xdr:").collect();
    let close_tags: Vec<&str> = xml_str.matches("</xdr:").collect();
    let self_close_tags: Vec<&str> = xml_str.matches("/>").collect();

    // Every opening tag should have a closing or self-closing counterpart
    // This is a basic structural check
    assert!(!open_tags.is_empty());
    assert!(!close_tags.is_empty() || !self_close_tags.is_empty());
}

#[test]
fn test_cell_anchor_zero_values() {
    let mut writer = DrawingWriter::new();
    writer.add_picture(
        CellAnchor {
            col: 0,
            col_off: 0,
            row: 0,
            row_off: 0,
        },
        CellAnchor {
            col: 0,
            col_off: 0,
            row: 0,
            row_off: 0,
        },
        ImageProps {
            name: "Zero".to_string(),
            r_id: "rId1".to_string(),
            locks: DrawingLocking {
                no_change_aspect: true,
                ..Default::default()
            },
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<xdr:col>0</xdr:col>"));
    assert!(xml_str.contains("<xdr:colOff>0</xdr:colOff>"));
    assert!(xml_str.contains("<xdr:row>0</xdr:row>"));
    assert!(xml_str.contains("<xdr:rowOff>0</xdr:rowOff>"));
}

#[test]
fn test_large_coordinates() {
    let mut writer = DrawingWriter::new();
    writer.add_picture(
        CellAnchor {
            col: 16383, // Max Excel column
            col_off: i64::MAX / 2,
            row: 1048575, // Max Excel row
            row_off: i64::MAX / 2,
        },
        CellAnchor {
            col: 16383,
            col_off: i64::MAX / 2,
            row: 1048575,
            row_off: i64::MAX / 2,
        },
        ImageProps {
            name: "Large".to_string(),
            r_id: "rId1".to_string(),
            locks: DrawingLocking {
                no_change_aspect: true,
                ..Default::default()
            },
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<xdr:col>16383</xdr:col>"));
    assert!(xml_str.contains("<xdr:row>1048575</xdr:row>"));
}

#[test]
fn test_special_characters_in_name() {
    let mut writer = DrawingWriter::new();
    writer.add_shape(
        CellAnchor::default(),
        CellAnchor::default(),
        ShapeProps {
            original_id: None,
            name: "Shape <with> \"special\" & 'chars'".to_string(),
            preset: ShapePreset::Rect,
            fill: None,
            outline: None,
            text: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    // XML should escape special characters
    assert!(xml_str.contains("&lt;with&gt;"));
    assert!(xml_str.contains("&quot;special&quot;"));
    assert!(xml_str.contains("&amp;"));
}

#[test]
fn test_special_characters_in_text() {
    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox::from_plain("Test", "Text with <tags> & \"quotes\""),
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("&lt;tags&gt;"));
    assert!(xml_str.contains("&amp;"));
}

#[test]
fn test_all_preset_shapes() {
    let presets = [
        ShapePreset::Rect,
        ShapePreset::RoundRect,
        ShapePreset::Ellipse,
        ShapePreset::Triangle,
        ShapePreset::RightTriangle,
        ShapePreset::Diamond,
        ShapePreset::Pentagon,
        ShapePreset::Hexagon,
        ShapePreset::Octagon,
        ShapePreset::RightArrow, // was PresetShape::Arrow -> "rightArrow"
        ShapePreset::Line,
        ShapePreset::Star5,
        ShapePreset::Star4,
        ShapePreset::Heart,
        ShapePreset::Cloud,
        ShapePreset::Plus,
        ShapePreset::RightArrow,
        ShapePreset::LeftArrow,
        ShapePreset::UpArrow,
        ShapePreset::DownArrow,
        ShapePreset::FlowChartProcess,
        ShapePreset::FlowChartDecision,
        ShapePreset::FlowChartTerminator,
        ShapePreset::TextBox,
    ];

    for preset in presets {
        let mut writer = DrawingWriter::new();
        writer.add_shape(
            CellAnchor::default(),
            CellAnchor::default(),
            ShapeProps {
                original_id: None,
                name: format!("Shape {:?}", preset),
                preset,
                fill: None,
                outline: None,
                text: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(
            xml_str.contains(&format!("prst=\"{}\"", preset.to_ooxml())),
            "Failed for preset {:?}",
            preset
        );
    }
}

#[test]
fn test_all_line_dashes() {
    let dashes = [
        DashStyle::Solid,
        DashStyle::Dot,
        DashStyle::Dash,
        DashStyle::DashDot,
        DashStyle::LongDash,
        DashStyle::LongDashDot,
        DashStyle::LongDashDotDot,
    ];

    for dash in dashes {
        let mut writer = DrawingWriter::new();
        writer.add_shape(
            CellAnchor::default(),
            CellAnchor::default(),
            ShapeProps {
                original_id: None,
                name: "Test".to_string(),
                preset: ShapePreset::Rect,
                fill: None,
                outline: Some(Outline {
                    width: Some(12700),
                    fill: Some(line_solid("000000")),
                    dash: Some(LineDash::Preset(dash.clone())),
                    ..Default::default()
                }),
                text: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(
            xml_str.contains(&format!("val=\"{}\"", dash.to_ooxml())),
            "Failed for dash {:?}",
            dash
        );
    }
}
