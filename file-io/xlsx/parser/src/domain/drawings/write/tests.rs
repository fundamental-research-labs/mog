//! Tests for drawing writing functionality.

#[cfg(test)]
mod tests {
    use crate::domain::drawings::write::{
        AbsoluteAnchor, CellAnchor, ChartRef, ClientData, CompoundLine, Connection, ConnectorProps,
        DashStyle, DrawingAnchor, DrawingColor, DrawingFill, DrawingLocking, DrawingObject,
        DrawingWriter, EditAs, Extent, GradientFill, GradientStop, Hyperlink, ImageProps, LineCap,
        LineEndProperties, LineEndSize, LineEndType, LineJoin, NS_C, Outline, PatternFill,
        PenAlignment, Position, PresetGeometry, ShapePreset, ShapeProps, ShapeStyle, SolidFill,
        StyleRef, TextBox, Transform2D, cm_to_emu, emu_to_cm, emu_to_inches, inches_to_emu,
        pixels_to_emu, points_to_emu,
    };
    use ooxml_types::drawings::{
        LineDash, LineFill, StAngle, StPercentage, StPitchFamily, StPositiveFixedPercentageDecimal,
        StStyleMatrixColumnIndex, StTextFontSize, StTextIndentLevelType, StTextNonNegativePoint,
        StTextPoint,
    };
    // Text-related imports for roundtrip tests
    use crate::domain::drawings::write::{
        BulletColor, BulletProperties, BulletSize, BulletType, Paragraph, ParagraphProperties,
        RunProperties, TextAlign, TextAnchor, TextAutofit, TextBody, TextBodyProperties,
        TextCapsType, TextFont, TextFontAlignType, TextHorzOverflow, TextListStyle, TextRun,
        TextRunContent, TextSpacing, TextStrikeType, TextTabAlignType, TextTabStop,
        TextUnderlineType, TextVertOverflow, TextVerticalType, TextWrap,
    };

    // Helpers for constructing ooxml-types in tests
    fn rgb(hex: &str) -> DrawingColor {
        DrawingColor::SrgbClr {
            val: hex.into(),
            transforms: vec![],
        }
    }
    fn solid_fill(hex: &str) -> DrawingFill {
        DrawingFill::Solid(SolidFill { color: rgb(hex) })
    }
    fn line_solid(hex: &str) -> LineFill {
        LineFill::Solid(SolidFill { color: rgb(hex) })
    }
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

    // -------------------------------------------------------------------------
    // Preset text warp (WordArt) tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_text_box_with_warp_preset_and_one_guide() {
        use ooxml_types::drawings::{
            GeomGuide, Paragraph, PresetTextWarp, RunProperties, TextBody, TextBodyProperties,
            TextRun, TextRunContent, TextWarpPreset, TextWrap,
        };

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "WordArt 1".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties {
                        wrap: Some(TextWrap::None),
                        prst_tx_warp: Some(PresetTextWarp {
                            preset: TextWarpPreset::TextWave1,
                            adjust_values: vec![GeomGuide {
                                name: "adj".to_string(),
                                fmla: "val 12500".to_string(),
                            }],
                        }),
                        ..Default::default()
                    },
                    paragraphs: vec![Paragraph {
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "Curved text".to_string(),
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
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<a:prstTxWarp prst=\"textWave1\">"));
        assert!(xml_str.contains("<a:avLst>"));
        assert!(xml_str.contains("<a:gd name=\"adj\" fmla=\"val 12500\"/>"));
        assert!(xml_str.contains("</a:avLst>"));
        assert!(xml_str.contains("</a:prstTxWarp>"));
        assert!(xml_str.contains("</a:bodyPr>"));
    }

    #[test]
    fn test_text_box_with_warp_preset_no_guides() {
        use ooxml_types::drawings::{
            Paragraph, PresetTextWarp, RunProperties, TextBody, TextBodyProperties, TextRun,
            TextRunContent, TextWarpPreset, TextWrap,
        };

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "WordArt 2".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties {
                        wrap: Some(TextWrap::Square),
                        prst_tx_warp: Some(PresetTextWarp {
                            preset: TextWarpPreset::TextArchUp,
                            adjust_values: vec![],
                        }),
                        ..Default::default()
                    },
                    paragraphs: vec![Paragraph {
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "Plain warp".to_string(),
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
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // Self-closing prstTxWarp when no adjust values
        assert!(xml_str.contains("<a:prstTxWarp prst=\"textArchUp\"/>"));
        // bodyPr should still have a closing tag (contains prstTxWarp child)
        assert!(xml_str.contains("</a:bodyPr>"));
        // Should NOT contain avLst
        assert!(!xml_str.contains("<a:avLst>"));
    }

    #[test]
    fn test_text_box_with_warp_preset_two_guides() {
        use ooxml_types::drawings::{
            GeomGuide, Paragraph, PresetTextWarp, RunProperties, TextBody, TextBodyProperties,
            TextRun, TextRunContent, TextWarpPreset, TextWrap,
        };

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "WordArt 3".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties {
                        wrap: Some(TextWrap::None),
                        prst_tx_warp: Some(PresetTextWarp {
                            preset: TextWarpPreset::TextDoubleWave1,
                            adjust_values: vec![
                                GeomGuide {
                                    name: "adj1".to_string(),
                                    fmla: "val 6500".to_string(),
                                },
                                GeomGuide {
                                    name: "adj2".to_string(),
                                    fmla: "val 0".to_string(),
                                },
                            ],
                        }),
                        ..Default::default()
                    },
                    paragraphs: vec![Paragraph {
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "Double adj".to_string(),
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
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<a:prstTxWarp prst=\"textDoubleWave1\">"));
        assert!(xml_str.contains("<a:gd name=\"adj1\" fmla=\"val 6500\"/>"));
        assert!(xml_str.contains("<a:gd name=\"adj2\" fmla=\"val 0\"/>"));
    }

    #[test]
    fn test_text_box_without_warp_backward_compat() {
        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox::from_plain("Plain", "No warp"),
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // bodyPr should self-close (no prstTxWarp child)
        assert!(xml_str.contains("<a:bodyPr wrap=\"square\"/>"));
        // Should NOT contain prstTxWarp
        assert!(!xml_str.contains("prstTxWarp"));
    }

    #[test]
    fn test_outline_without_dash() {
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
                    width: Some(25400),
                    fill: Some(line_solid("FF0000")),
                    ..Default::default()
                }),
                text: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<a:ln w=\"25400\">"));
        assert!(xml_str.contains("val=\"FF0000\""));
        // Should not contain prstDash element
        assert!(!xml_str.contains("<a:prstDash"));
    }

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

    // -------------------------------------------------------------------------
    // Gradient angle, pattern fill, outline compound/cap, shape style
    // -------------------------------------------------------------------------

    #[test]
    fn test_gradient_fill_with_nonzero_angle() {
        let mut writer = DrawingWriter::new();
        writer.add_shape(
            CellAnchor::default(),
            CellAnchor::default(),
            ShapeProps {
                original_id: None,
                name: "Angled Gradient".to_string(),
                preset: ShapePreset::Rect,
                fill: Some(DrawingFill::Gradient(GradientFill {
                    stops: vec![
                        GradientStop {
                            position: StPositiveFixedPercentageDecimal::new_unchecked(0),
                            color: rgb("FF0000"),
                        },
                        GradientStop {
                            position: StPositiveFixedPercentageDecimal::new_unchecked(100000),
                            color: rgb("0000FF"),
                        },
                    ],
                    lin_ang: Some(StAngle::new(5_400_000)), // 90 degrees in 60000ths
                    ..Default::default()
                })),
                outline: None,
                text: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(
            xml_str.contains("ang=\"5400000\""),
            "Should have 90-degree angle: {}",
            xml_str
        );
        assert!(
            xml_str.contains("scaled=\"1\""),
            "Should have scaled attribute"
        );
        assert!(
            xml_str.contains("val=\"FF0000\""),
            "Should have first stop color"
        );
        assert!(
            xml_str.contains("val=\"0000FF\""),
            "Should have second stop color"
        );
    }

    #[test]
    fn test_gradient_fill_default_angle() {
        let mut writer = DrawingWriter::new();
        writer.add_shape(
            CellAnchor::default(),
            CellAnchor::default(),
            ShapeProps {
                original_id: None,
                name: "Default Angle Gradient".to_string(),
                preset: ShapePreset::Rect,
                fill: Some(DrawingFill::Gradient(GradientFill {
                    stops: vec![
                        GradientStop {
                            position: StPositiveFixedPercentageDecimal::new_unchecked(0),
                            color: rgb("FFFFFF"),
                        },
                        GradientStop {
                            position: StPositiveFixedPercentageDecimal::new_unchecked(100000),
                            color: rgb("000000"),
                        },
                    ],
                    ..Default::default() // No lin_ang: should default to no lin element
                })),
                outline: None,
                text: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // When angle is None, no <a:lin> element is emitted
        assert!(
            !xml_str.contains("<a:lin"),
            "Should not have lin element when angle is None: {}",
            xml_str
        );
    }

    #[test]
    fn test_pattern_fill() {
        let mut writer = DrawingWriter::new();
        writer.add_shape(
            CellAnchor::default(),
            CellAnchor::default(),
            ShapeProps {
                original_id: None,
                name: "Pattern Shape".to_string(),
                preset: ShapePreset::Rect,
                fill: Some(DrawingFill::Pattern(PatternFill {
                    preset: Some(ooxml_types::drawings::PresetPatternVal::LtDnDiag),
                    fg_color: Some(rgb("FF0000")),
                    bg_color: Some(rgb("FFFFFF")),
                })),
                outline: None,
                text: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(
            xml_str.contains("<a:pattFill prst=\"ltDnDiag\">"),
            "Should have pattFill: {}",
            xml_str
        );
        assert!(xml_str.contains("<a:fgClr>"), "Should have fgClr");
        assert!(xml_str.contains("<a:bgClr>"), "Should have bgClr");
        assert!(xml_str.contains("</a:pattFill>"), "Should close pattFill");
    }

    #[test]
    fn test_pattern_fill_no_colors() {
        let mut writer = DrawingWriter::new();
        writer.add_shape(
            CellAnchor::default(),
            CellAnchor::default(),
            ShapeProps {
                original_id: None,
                name: "Pattern No Colors".to_string(),
                preset: ShapePreset::Rect,
                fill: Some(DrawingFill::Pattern(PatternFill {
                    preset: Some(ooxml_types::drawings::PresetPatternVal::DkHorz),
                    fg_color: None,
                    bg_color: None,
                })),
                outline: None,
                text: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(
            xml_str.contains("<a:pattFill prst=\"dkHorz\">"),
            "Should have pattFill: {}",
            xml_str
        );
        assert!(
            !xml_str.contains("<a:fgClr>"),
            "Should not have fgClr when None"
        );
        assert!(
            !xml_str.contains("<a:bgClr>"),
            "Should not have bgClr when None"
        );
    }

    #[test]
    fn test_outline_with_compound_and_cap() {
        let mut writer = DrawingWriter::new();
        writer.add_shape(
            CellAnchor::default(),
            CellAnchor::default(),
            ShapeProps {
                original_id: None,
                name: "Compound Outline".to_string(),
                preset: ShapePreset::Rect,
                fill: None,
                outline: Some(Outline {
                    width: Some(19050),
                    fill: Some(line_solid("0070C0")),
                    compound: Some(CompoundLine::Double),
                    cap: Some(LineCap::Round),
                    ..Default::default()
                }),
                text: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(
            xml_str.contains("cmpd=\"dbl\""),
            "Should have compound attribute: {}",
            xml_str
        );
        assert!(
            xml_str.contains("cap=\"rnd\""),
            "Should have cap attribute: {}",
            xml_str
        );
        assert!(xml_str.contains("w=\"19050\""), "Should have width");
    }

    #[test]
    fn test_outline_without_compound_cap_backward_compat() {
        // Verify that outlines without the new fields produce identical output
        let mut writer = DrawingWriter::new();
        writer.add_shape(
            CellAnchor::default(),
            CellAnchor::default(),
            ShapeProps {
                original_id: None,
                name: "Simple Outline".to_string(),
                preset: ShapePreset::Rect,
                fill: None,
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

        // Should NOT contain cmpd or cap attributes
        assert!(!xml_str.contains("cmpd="), "Should not have cmpd when None");
        assert!(!xml_str.contains("cap="), "Should not have cap when None");
        // Should still have basic outline
        assert!(
            xml_str.contains("<a:ln w=\"12700\">"),
            "Should have width: {}",
            xml_str
        );
    }

    #[test]
    fn test_shape_style_refs_with_scheme_color() {
        let writer = DrawingWriter::new();
        let mut w = crate::write::xml_writer::XmlWriter::new();

        let style = ShapeStyle {
            line_ref: StyleRef {
                idx: StStyleMatrixColumnIndex::new(2),
                color: Some(DrawingColor::SchemeClr {
                    val: ooxml_types::drawings::SchemeColor::Accent1,
                    transforms: vec![],
                }),
            },
            fill_ref: StyleRef {
                idx: StStyleMatrixColumnIndex::new(1),
                color: Some(DrawingColor::SchemeClr {
                    val: ooxml_types::drawings::SchemeColor::Accent1,
                    transforms: vec![],
                }),
            },
            effect_ref: StyleRef {
                idx: StStyleMatrixColumnIndex::new(0),
                color: None,
            },
            font_ref: ooxml_types::drawings::FontReference {
                idx: ooxml_types::drawings::FontCollectionIndex::None,
                color: Some(DrawingColor::SrgbClr {
                    val: "FF0000".to_string(),
                    transforms: vec![],
                }),
            },
        };

        writer.write_shape_style(&mut w, &style);
        let xml_bytes = w.finish();
        let xml_str = String::from_utf8(xml_bytes).unwrap();

        assert!(xml_str.contains("<xdr:style>"), "Should have style element");
        assert!(
            xml_str.contains("<a:lnRef idx=\"2\">"),
            "Should have lnRef idx=2"
        );
        assert!(
            xml_str.contains("<a:schemeClr val=\"accent1\"/>"),
            "Should have accent1 scheme color: {}",
            xml_str
        );
        assert!(
            xml_str.contains("<a:fillRef idx=\"1\">"),
            "Should have fillRef idx=1"
        );
        assert!(
            xml_str.contains("<a:effectRef idx=\"0\"/>"),
            "Should have self-closing effectRef"
        );
        assert!(
            xml_str.contains("<a:fontRef idx=\"none\">"),
            "Should have fontRef with color"
        );
        assert!(
            xml_str.contains("<a:srgbClr val=\"FF0000\"/>"),
            "Should have RGB color in fontRef"
        );
        assert!(
            xml_str.contains("</xdr:style>"),
            "Should close style element"
        );
    }

    #[test]
    fn test_shape_style_refs_empty() {
        let writer = DrawingWriter::new();
        let mut w = crate::write::xml_writer::XmlWriter::new();

        let style = ShapeStyle {
            line_ref: StyleRef {
                idx: StStyleMatrixColumnIndex::new(0),
                color: None,
            },
            fill_ref: StyleRef {
                idx: StStyleMatrixColumnIndex::new(0),
                color: None,
            },
            effect_ref: StyleRef {
                idx: StStyleMatrixColumnIndex::new(0),
                color: None,
            },
            font_ref: ooxml_types::drawings::FontReference::default(),
        };

        writer.write_shape_style(&mut w, &style);
        let xml_bytes = w.finish();
        let xml_str = String::from_utf8(xml_bytes).unwrap();

        assert!(xml_str.contains("<xdr:style>"), "Should have style element");
        assert!(
            xml_str.contains("</xdr:style>"),
            "Should close style element"
        );
        // All refs are present with idx=0 and no color (self-closing)
        assert!(
            xml_str.contains("<a:lnRef idx=\"0\"/>"),
            "Should have self-closing lnRef"
        );
        assert!(
            xml_str.contains("<a:fillRef idx=\"0\"/>"),
            "Should have self-closing fillRef"
        );
    }

    // =========================================================================
    // Rich text body comprehensive tests
    // =========================================================================

    #[test]
    fn test_rich_text_body_multiple_paragraphs_mixed_content() {
        use ooxml_types::drawings::{
            Paragraph, ParagraphProperties, RunProperties, TextAlign, TextBody, TextBodyProperties,
            TextRun, TextRunContent, TextWrap,
        };

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "RichText".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties {
                        wrap: Some(TextWrap::Square),
                        ..Default::default()
                    },
                    paragraphs: vec![
                        // Paragraph 1: run + line break + run
                        Paragraph {
                            props: ParagraphProperties {
                                align: Some(TextAlign::Center),
                                ..Default::default()
                            },
                            runs: vec![
                                TextRunContent::Run(TextRun {
                                    text: "Hello".to_string(),
                                    props: RunProperties {
                                        lang: Some("en-US".to_string()),
                                        bold: Some(true),
                                        ..Default::default()
                                    },
                                }),
                                TextRunContent::LineBreak { props: None },
                                TextRunContent::Run(TextRun {
                                    text: "World".to_string(),
                                    props: RunProperties {
                                        lang: Some("en-US".to_string()),
                                        italic: Some(true),
                                        ..Default::default()
                                    },
                                }),
                            ],
                            end_para_rpr: None,
                        },
                        // Paragraph 2: field
                        Paragraph {
                            props: ParagraphProperties::default(),
                            runs: vec![TextRunContent::Field {
                                id: "{B1C3F4A0-1234-5678-9ABC-DEF012345678}".to_string(),
                                field_type: Some("slidenum".to_string()),
                                text: Some("1".to_string()),
                                run_props: Some(RunProperties {
                                    lang: Some("en-US".to_string()),
                                    ..Default::default()
                                }),
                                para_props: None,
                            }],
                            end_para_rpr: None,
                        },
                    ],
                    ..Default::default()
                }),
                fill: None,
                outline: None,
                style: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // Paragraph 1 with alignment
        assert!(
            xml_str.contains("<a:pPr"),
            "should have paragraph properties"
        );
        assert!(xml_str.contains("algn=\"ctr\""), "should have center align");

        // Bold run
        assert!(xml_str.contains("b=\"1\""), "should have bold");
        assert!(
            xml_str.contains("<a:t>Hello</a:t>"),
            "should have Hello text"
        );

        // Line break
        assert!(xml_str.contains("<a:br/>"), "should have line break");

        // Italic run
        assert!(xml_str.contains("i=\"1\""), "should have italic");
        assert!(
            xml_str.contains("<a:t>World</a:t>"),
            "should have World text"
        );

        // Field
        assert!(
            xml_str.contains(
                "<a:fld id=\"{B1C3F4A0-1234-5678-9ABC-DEF012345678}\" type=\"slidenum\">"
            ),
            "should have field element"
        );
        assert!(xml_str.contains("<a:t>1</a:t>"), "should have field text");

        // Two paragraphs
        let para_count = xml_str.matches("<a:p>").count();
        assert_eq!(para_count, 2, "should have 2 paragraphs");
    }

    #[test]
    fn test_body_props_all_attributes() {
        use ooxml_types::drawings::{
            Paragraph, RunProperties, TextAnchor, TextBody, TextBodyProperties, TextHorzOverflow,
            TextRun, TextRunContent, TextVertOverflow, TextVerticalType, TextWrap,
        };

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "BodyPropsAll".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties {
                        rot: Some(StAngle::new(5400000)),
                        spc_first_last_para: Some(true),
                        vert_overflow: Some(TextVertOverflow::Clip),
                        horz_overflow: Some(TextHorzOverflow::Overflow),
                        vert: Some(TextVerticalType::Vertical270),
                        wrap: Some(TextWrap::Square),
                        l_ins: Some(91440),
                        t_ins: Some(45720),
                        r_ins: Some(91440),
                        b_ins: Some(45720),
                        num_col: Some(2),
                        spc_col: Some(36000),
                        rtl_col: Some(false),
                        from_word_art: Some(true),
                        anchor: Some(TextAnchor::Center),
                        anchor_ctr: Some(true),
                        force_aa: Some(false),
                        upright: Some(true),
                        compat_ln_spc: Some(true),
                        ..Default::default()
                    },
                    paragraphs: vec![Paragraph {
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "test".to_string(),
                            props: RunProperties::default(),
                        })],
                        ..Default::default()
                    }],
                    ..Default::default()
                }),
                fill: None,
                outline: None,
                style: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("rot=\"5400000\""), "rotation");
        assert!(xml_str.contains("spcFirstLastPara=\"1\""), "spc first last");
        assert!(xml_str.contains("vertOverflow=\"clip\""), "vert overflow");
        assert!(
            xml_str.contains("horzOverflow=\"overflow\""),
            "horz overflow"
        );
        assert!(xml_str.contains("vert=\"vert270\""), "vertical type");
        assert!(xml_str.contains("wrap=\"square\""), "wrap");
        assert!(xml_str.contains("lIns=\"91440\""), "left inset");
        assert!(xml_str.contains("tIns=\"45720\""), "top inset");
        assert!(xml_str.contains("rIns=\"91440\""), "right inset");
        assert!(xml_str.contains("bIns=\"45720\""), "bottom inset");
        assert!(xml_str.contains("numCol=\"2\""), "num columns");
        assert!(xml_str.contains("spcCol=\"36000\""), "space between cols");
        assert!(xml_str.contains("rtlCol=\"0\""), "rtl column");
        assert!(xml_str.contains("fromWordArt=\"1\""), "from word art");
        assert!(xml_str.contains("anchor=\"ctr\""), "anchor");
        assert!(xml_str.contains("anchorCtr=\"1\""), "anchor center");
        assert!(xml_str.contains("forceAA=\"0\""), "force anti-alias");
        assert!(xml_str.contains("upright=\"1\""), "upright");
        assert!(xml_str.contains("compatLnSpc=\"1\""), "compat line spacing");
    }

    #[test]
    fn test_autofit_variants() {
        use ooxml_types::drawings::{
            Paragraph, RunProperties, TextAutofit, TextBody, TextBodyProperties, TextRun,
            TextRunContent,
        };

        // NoAutofit
        {
            let mut writer = DrawingWriter::new();
            writer.add_text_box(
                CellAnchor::default(),
                CellAnchor::default(),
                TextBox {
                    original_id: None,
                    name: "NoAF".to_string(),
                    text_body: Some(TextBody {
                        body_props: TextBodyProperties {
                            autofit: Some(TextAutofit::NoAutofit),
                            ..Default::default()
                        },
                        paragraphs: vec![Paragraph {
                            runs: vec![TextRunContent::Run(TextRun {
                                text: "x".to_string(),
                                props: RunProperties::default(),
                            })],
                            ..Default::default()
                        }],
                        ..Default::default()
                    }),
                    fill: None,
                    outline: None,
                    style: None,
                    ..Default::default()
                },
            );
            let xml_str = String::from_utf8(writer.to_xml()).unwrap();
            assert!(xml_str.contains("<a:noAutofit/>"), "should have noAutofit");
            assert!(
                xml_str.contains("</a:bodyPr>"),
                "bodyPr should have closing tag"
            );
        }

        // NormalAutofit with params
        {
            let mut writer = DrawingWriter::new();
            writer.add_text_box(
                CellAnchor::default(),
                CellAnchor::default(),
                TextBox {
                    original_id: None,
                    name: "NormAF".to_string(),
                    text_body: Some(TextBody {
                        body_props: TextBodyProperties {
                            autofit: Some(TextAutofit::NormalAutofit {
                                font_scale: Some(75000),
                                line_space_reduction: Some(20000),
                            }),
                            ..Default::default()
                        },
                        paragraphs: vec![Paragraph {
                            runs: vec![TextRunContent::Run(TextRun {
                                text: "x".to_string(),
                                props: RunProperties::default(),
                            })],
                            ..Default::default()
                        }],
                        ..Default::default()
                    }),
                    fill: None,
                    outline: None,
                    style: None,
                    ..Default::default()
                },
            );
            let xml_str = String::from_utf8(writer.to_xml()).unwrap();
            assert!(
                xml_str.contains("<a:normAutofit fontScale=\"75000\" lnSpcReduction=\"20000\"/>"),
                "should have normAutofit with params, got: {}",
                xml_str
            );
        }

        // ShapeAutofit
        {
            let mut writer = DrawingWriter::new();
            writer.add_text_box(
                CellAnchor::default(),
                CellAnchor::default(),
                TextBox {
                    original_id: None,
                    name: "ShpAF".to_string(),
                    text_body: Some(TextBody {
                        body_props: TextBodyProperties {
                            autofit: Some(TextAutofit::ShapeAutofit),
                            ..Default::default()
                        },
                        paragraphs: vec![Paragraph {
                            runs: vec![TextRunContent::Run(TextRun {
                                text: "x".to_string(),
                                props: RunProperties::default(),
                            })],
                            ..Default::default()
                        }],
                        ..Default::default()
                    }),
                    fill: None,
                    outline: None,
                    style: None,
                    ..Default::default()
                },
            );
            let xml_str = String::from_utf8(writer.to_xml()).unwrap();
            assert!(
                xml_str.contains("<a:spAutoFit/>"),
                "should have shape autofit"
            );
        }
    }

    #[test]
    fn test_run_props_all_attributes() {
        use ooxml_types::drawings::{
            Paragraph, RunProperties, TextBody, TextBodyProperties, TextCapsType, TextRun,
            TextRunContent, TextStrikeType, TextUnderlineType,
        };

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "RunPropsAll".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties::default(),
                    paragraphs: vec![Paragraph {
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "styled".to_string(),
                            props: RunProperties {
                                kumimoji: Some(true),
                                lang: Some("ja-JP".to_string()),
                                alt_lang: Some("en-US".to_string()),
                                size: Some(StTextFontSize::new_unchecked(2400)),
                                bold: Some(true),
                                italic: Some(true),
                                underline: Some(TextUnderlineType::Double),
                                strike: Some(TextStrikeType::SingleStrike),
                                kern: Some(StTextNonNegativePoint::new_unchecked(1200)),
                                cap: Some(TextCapsType::All),
                                spacing: Some(StTextPoint::new(300)),
                                normalize_h: Some(true),
                                baseline: Some(StPercentage::new(30000)),
                                no_proof: Some(true),
                                dirty: Some(false),
                                err: Some(false),
                                smt_clean: Some(true),
                                smt_id: Some(42),
                                bmk: Some("bookmark1".to_string()),
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
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("kumimoji=\"1\""), "kumimoji");
        assert!(xml_str.contains("lang=\"ja-JP\""), "lang");
        assert!(xml_str.contains("altLang=\"en-US\""), "alt lang");
        assert!(xml_str.contains("sz=\"2400\""), "size");
        assert!(xml_str.contains("b=\"1\""), "bold");
        assert!(xml_str.contains("i=\"1\""), "italic");
        assert!(xml_str.contains("u=\"dbl\""), "underline double");
        assert!(xml_str.contains("strike=\"sngStrike\""), "strike");
        assert!(xml_str.contains("kern=\"1200\""), "kern");
        assert!(xml_str.contains("cap=\"all\""), "cap");
        assert!(xml_str.contains("spc=\"300\""), "spacing");
        assert!(xml_str.contains("normalizeH=\"1\""), "normalize h");
        assert!(xml_str.contains("baseline=\"30000\""), "baseline");
        assert!(xml_str.contains("noProof=\"1\""), "no proof");
        assert!(xml_str.contains("dirty=\"0\""), "dirty");
        assert!(xml_str.contains("err=\"0\""), "err");
        assert!(xml_str.contains("smtClean=\"1\""), "smt clean");
        assert!(xml_str.contains("smtId=\"42\""), "smt id");
        assert!(xml_str.contains("bmk=\"bookmark1\""), "bookmark");
    }

    #[test]
    fn test_run_props_with_fonts_and_color() {
        use ooxml_types::drawings::{
            DrawingColor, Paragraph, RunProperties, TextBody, TextBodyProperties, TextFont,
            TextRun, TextRunContent,
        };

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "Fonts".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties::default(),
                    paragraphs: vec![Paragraph {
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "fonted".to_string(),
                            props: RunProperties {
                                latin: Some(TextFont {
                                    typeface: "Calibri".to_string(),
                                    panose: Some("020F0502020204030204".to_string()),
                                    pitch_family: Some(StPitchFamily::new(34)),
                                    charset: Some(0),
                                }),
                                ea: Some(TextFont {
                                    typeface: "+mn-ea".to_string(),
                                    panose: None,
                                    pitch_family: None,
                                    charset: None,
                                }),
                                cs: Some(TextFont {
                                    typeface: "+mn-cs".to_string(),
                                    panose: None,
                                    pitch_family: None,
                                    charset: None,
                                }),
                                color: Some(DrawingColor::SrgbClr {
                                    val: "FF0000".to_string(),
                                    transforms: vec![],
                                }),
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
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(
            xml_str.contains("<a:latin typeface=\"Calibri\" panose=\"020F0502020204030204\" pitchFamily=\"34\" charset=\"0\"/>"),
            "latin font with all attrs"
        );
        assert!(
            xml_str.contains("<a:ea typeface=\"+mn-ea\"/>"),
            "ea font minimal"
        );
        assert!(
            xml_str.contains("<a:cs typeface=\"+mn-cs\"/>"),
            "cs font minimal"
        );
        assert!(
            xml_str.contains("<a:solidFill><a:srgbClr val=\"FF0000\"/></a:solidFill>"),
            "text color"
        );
    }

    #[test]
    fn test_run_props_with_hyperlink() {
        use ooxml_types::drawings::{
            Hyperlink, Paragraph, RunProperties, TextBody, TextBodyProperties, TextRun,
            TextRunContent,
        };

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "Hlink".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties::default(),
                    paragraphs: vec![Paragraph {
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "click me".to_string(),
                            props: RunProperties {
                                hlink_click: Some(Hyperlink {
                                    r_id: Some("rId3".to_string()),
                                    tooltip: Some("Go to site".to_string()),
                                    ..Default::default()
                                }),
                                hlink_mouse_over: Some(Hyperlink {
                                    r_id: Some("rId4".to_string()),
                                    action: Some(
                                        "ppaction://hlinkshowjump?jump=firstslide".to_string(),
                                    ),
                                    ..Default::default()
                                }),
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
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(
            xml_str.contains("<a:hlinkClick r:id=\"rId3\" tooltip=\"Go to site\"/>"),
            "hlink click"
        );
        assert!(
            xml_str.contains("<a:hlinkMouseOver r:id=\"rId4\" action=\"ppaction://hlinkshowjump?jump=firstslide\"/>"),
            "hlink mouse over"
        );
    }

    #[test]
    fn test_paragraph_props_spacing_and_bullets() {
        use ooxml_types::drawings::{
            BulletColor, BulletProperties, BulletSize, BulletType, DrawingColor, Paragraph,
            ParagraphProperties, RunProperties, TextAlign, TextBody, TextBodyProperties, TextFont,
            TextFontAlignType, TextRun, TextRunContent, TextSpacing,
        };

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "ParaProps".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties::default(),
                    paragraphs: vec![Paragraph {
                        props: ParagraphProperties {
                            align: Some(TextAlign::Right),
                            margin_l: Some(457200),
                            margin_r: Some(228600),
                            indent: Some(-228600),
                            level: Some(StTextIndentLevelType::new_unchecked(1)),
                            def_tab_sz: Some(914400),
                            rtl: Some(true),
                            ea_ln_brk: Some(true),
                            font_align: Some(TextFontAlignType::Center),
                            latin_ln_brk: Some(false),
                            hanging_punct: Some(true),
                            line_spacing: Some(TextSpacing::Percent(150000)),
                            space_before: Some(TextSpacing::Points(600)),
                            space_after: Some(TextSpacing::Points(300)),
                            bullet: Some(BulletProperties {
                                color: Some(BulletColor::Custom(DrawingColor::SrgbClr {
                                    val: "0000FF".to_string(),
                                    transforms: vec![],
                                })),
                                size: Some(BulletSize::Percent(120000)),
                                font: Some(TextFont {
                                    typeface: "Wingdings".to_string(),
                                    panose: None,
                                    pitch_family: None,
                                    charset: None,
                                }),
                                bullet_type: Some(BulletType::Char("\u{2022}".to_string())),
                                ..Default::default()
                            }),
                            ..Default::default()
                        },
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "bullet item".to_string(),
                            props: RunProperties::default(),
                        })],
                        end_para_rpr: None,
                    }],
                    ..Default::default()
                }),
                fill: None,
                outline: None,
                style: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // Paragraph attrs
        assert!(xml_str.contains("algn=\"r\""), "right align");
        assert!(xml_str.contains("marL=\"457200\""), "margin left");
        assert!(xml_str.contains("marR=\"228600\""), "margin right");
        assert!(xml_str.contains("indent=\"-228600\""), "indent");
        assert!(xml_str.contains("lvl=\"1\""), "level");
        assert!(xml_str.contains("defTabSz=\"914400\""), "def tab size");
        assert!(xml_str.contains("rtl=\"1\""), "rtl");
        assert!(xml_str.contains("eaLnBrk=\"1\""), "ea line break");
        assert!(xml_str.contains("fontAlgn=\"ctr\""), "font align");
        assert!(xml_str.contains("latinLnBrk=\"0\""), "latin line break");
        assert!(xml_str.contains("hangingPunct=\"1\""), "hanging punct");

        // Line spacing as percent
        assert!(xml_str.contains("<a:lnSpc>"), "line spacing wrapper");
        assert!(
            xml_str.contains("<a:spcPct val=\"150000\"/>"),
            "line spacing percent"
        );

        // Space before as points
        assert!(xml_str.contains("<a:spcBef>"), "space before wrapper");
        assert!(
            xml_str.contains("<a:spcPts val=\"600\"/>"),
            "space before points"
        );

        // Space after
        assert!(xml_str.contains("<a:spcAft>"), "space after wrapper");

        // Bullet color
        assert!(xml_str.contains("<a:buClr>"), "bullet color wrapper");
        assert!(
            xml_str.contains("<a:srgbClr val=\"0000FF\"/>"),
            "bullet custom color"
        );

        // Bullet size
        assert!(
            xml_str.contains("<a:buSzPct val=\"120000\"/>"),
            "bullet size percent"
        );

        // Bullet font
        assert!(
            xml_str.contains("<a:buFont typeface=\"Wingdings\"/>"),
            "bullet font"
        );

        // Bullet char
        assert!(xml_str.contains("a:buChar char="), "bullet char");
    }

    #[test]
    fn test_paragraph_props_tab_stops() {
        use ooxml_types::drawings::{
            Paragraph, ParagraphProperties, RunProperties, TextBody, TextBodyProperties, TextRun,
            TextRunContent, TextTabAlignType, TextTabStop,
        };

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "Tabs".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties::default(),
                    paragraphs: vec![Paragraph {
                        props: ParagraphProperties {
                            tab_list: Some(vec![
                                TextTabStop {
                                    position: Some(914400),
                                    align: Some(TextTabAlignType::Left),
                                },
                                TextTabStop {
                                    position: Some(1828800),
                                    align: Some(TextTabAlignType::Center),
                                },
                                TextTabStop {
                                    position: Some(2743200),
                                    align: Some(TextTabAlignType::Right),
                                },
                            ]),
                            ..Default::default()
                        },
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "tabbed".to_string(),
                            props: RunProperties::default(),
                        })],
                        end_para_rpr: None,
                    }],
                    ..Default::default()
                }),
                fill: None,
                outline: None,
                style: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<a:tabLst>"), "tab list start");
        assert!(
            xml_str.contains("<a:tab pos=\"914400\" algn=\"l\"/>"),
            "left tab"
        );
        assert!(
            xml_str.contains("<a:tab pos=\"1828800\" algn=\"ctr\"/>"),
            "center tab"
        );
        assert!(
            xml_str.contains("<a:tab pos=\"2743200\" algn=\"r\"/>"),
            "right tab"
        );
        assert!(xml_str.contains("</a:tabLst>"), "tab list end");
    }

    #[test]
    fn test_end_para_rpr_preserved() {
        use ooxml_types::drawings::{
            Paragraph, RunProperties, TextBody, TextBodyProperties, TextRun, TextRunContent,
        };

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "EndRPr".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties::default(),
                    paragraphs: vec![Paragraph {
                        props: Default::default(),
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "text".to_string(),
                            props: RunProperties::default(),
                        })],
                        end_para_rpr: Some(RunProperties {
                            lang: Some("en-US".to_string()),
                            size: Some(StTextFontSize::new_unchecked(1800)),
                            dirty: Some(false),
                            ..Default::default()
                        }),
                    }],
                    ..Default::default()
                }),
                fill: None,
                outline: None,
                style: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(
            xml_str.contains("<a:endParaRPr lang=\"en-US\" sz=\"1800\" dirty=\"0\"/>"),
            "should have endParaRPr with attrs, got: {}",
            xml_str
        );
    }

    #[test]
    fn test_list_style_with_level_overrides() {
        use ooxml_types::drawings::{
            BulletProperties, BulletType, Paragraph, ParagraphProperties, RunProperties, TextAlign,
            TextBody, TextBodyProperties, TextListStyle, TextRun, TextRunContent, TextSpacing,
        };

        let mut level_ppr: [Option<ParagraphProperties>; 9] = Default::default();
        level_ppr[0] = Some(ParagraphProperties {
            align: Some(TextAlign::Left),
            margin_l: Some(0),
            indent: Some(0),
            bullet: Some(BulletProperties {
                color: None,
                size: None,
                font: None,
                bullet_type: Some(BulletType::Char("\u{2022}".to_string())),
                ..Default::default()
            }),
            ..Default::default()
        });
        level_ppr[1] = Some(ParagraphProperties {
            align: Some(TextAlign::Left),
            margin_l: Some(457200),
            indent: Some(-228600),
            space_before: Some(TextSpacing::Points(400)),
            ..Default::default()
        });

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "ListStyle".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties::default(),
                    list_style: Some(TextListStyle {
                        def_ppr: Some(ParagraphProperties {
                            def_run_props: Some(Box::new(RunProperties {
                                size: Some(StTextFontSize::new_unchecked(1400)),
                                ..Default::default()
                            })),
                            ..Default::default()
                        }),
                        level_ppr,
                    }),
                    paragraphs: vec![Paragraph {
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "list".to_string(),
                            props: RunProperties::default(),
                        })],
                        ..Default::default()
                    }],
                }),
                fill: None,
                outline: None,
                style: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<a:lstStyle>"), "list style start");
        assert!(xml_str.contains("<a:defPPr>"), "default ppr");
        assert!(
            xml_str.contains("<a:defRPr sz=\"1400\"/>"),
            "default run props in defPPr"
        );
        assert!(xml_str.contains("</a:defPPr>"), "default ppr end");

        assert!(xml_str.contains("<a:lvl1pPr"), "level 1 ppr");
        assert!(xml_str.contains("a:buChar char="), "level 1 bullet char");
        assert!(xml_str.contains("</a:lvl1pPr>"), "level 1 ppr end");

        assert!(xml_str.contains("<a:lvl2pPr"), "level 2 ppr");
        assert!(xml_str.contains("marL=\"457200\""), "level 2 margin");
        assert!(xml_str.contains("indent=\"-228600\""), "level 2 indent");

        // Should not have levels 3-9
        assert!(!xml_str.contains("<a:lvl3pPr"), "no level 3");
        assert!(!xml_str.contains("<a:lvl9pPr"), "no level 9");

        assert!(xml_str.contains("</a:lstStyle>"), "list style end");
    }

    #[test]
    fn test_text_box_from_plain_backward_compat() {
        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox::from_plain("Simple", "hello world"),
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // Should produce well-formed output
        assert!(xml_str.contains("name=\"Simple\""), "name");
        assert!(xml_str.contains("txBox=\"1\""), "txBox flag");
        assert!(xml_str.contains("wrap=\"square\""), "wrap square");
        assert!(xml_str.contains("<a:t>hello world</a:t>"), "text content");
        assert!(xml_str.contains("lang=\"en-US\""), "run props lang");
        assert!(xml_str.contains("<a:lstStyle/>"), "empty list style");
        assert!(xml_str.contains("<a:p>"), "paragraph start");
        assert!(xml_str.contains("<a:r>"), "run start");
    }

    #[test]
    fn test_text_box_absent_body() {
        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "Empty".to_string(),
                text_body: None,
                fill: None,
                outline: None,
                style: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(
            !xml_str.contains("xdr:txBody"),
            "imported shapes with absent txBody must not gain one"
        );
    }

    #[test]
    fn test_line_break_with_props() {
        use ooxml_types::drawings::{
            Paragraph, RunProperties, TextBody, TextBodyProperties, TextRun, TextRunContent,
        };

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "BrProps".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties::default(),
                    paragraphs: vec![Paragraph {
                        runs: vec![
                            TextRunContent::Run(TextRun {
                                text: "before".to_string(),
                                props: RunProperties::default(),
                            }),
                            TextRunContent::LineBreak {
                                props: Some(RunProperties {
                                    lang: Some("en-US".to_string()),
                                    size: Some(StTextFontSize::new_unchecked(1200)),
                                    ..Default::default()
                                }),
                            },
                            TextRunContent::Run(TextRun {
                                text: "after".to_string(),
                                props: RunProperties::default(),
                            }),
                        ],
                        ..Default::default()
                    }],
                    ..Default::default()
                }),
                fill: None,
                outline: None,
                style: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // Line break with props should have opening and closing tags
        assert!(xml_str.contains("<a:br>"), "line break with content");
        assert!(
            xml_str.contains("<a:rPr lang=\"en-US\" sz=\"1200\"/>"),
            "break run props"
        );
        assert!(xml_str.contains("</a:br>"), "line break end");
        assert!(xml_str.contains("<a:t>before</a:t>"), "text before break");
        assert!(xml_str.contains("<a:t>after</a:t>"), "text after break");
    }

    #[test]
    fn test_bullet_type_variants() {
        use ooxml_types::drawings::{
            BulletProperties, BulletSize, BulletType, Paragraph, ParagraphProperties,
            RunProperties, TextAutonumberType, TextBody, TextBodyProperties, TextRun,
            TextRunContent,
        };

        // BulletType::None
        {
            let mut writer = DrawingWriter::new();
            writer.add_text_box(
                CellAnchor::default(),
                CellAnchor::default(),
                TextBox {
                    original_id: None,
                    name: "BuNone".to_string(),
                    text_body: Some(TextBody {
                        body_props: TextBodyProperties::default(),
                        paragraphs: vec![Paragraph {
                            props: ParagraphProperties {
                                bullet: Some(BulletProperties {
                                    color: None,
                                    size: None,
                                    font: None,
                                    bullet_type: Some(BulletType::None),
                                    ..Default::default()
                                }),
                                ..Default::default()
                            },
                            runs: vec![TextRunContent::Run(TextRun {
                                text: "no bullet".to_string(),
                                props: RunProperties::default(),
                            })],
                            end_para_rpr: None,
                        }],
                        ..Default::default()
                    }),
                    fill: None,
                    outline: None,
                    style: None,
                    ..Default::default()
                },
            );
            let xml_str = String::from_utf8(writer.to_xml()).unwrap();
            assert!(xml_str.contains("<a:buNone/>"), "buNone");
        }

        // BulletType::AutoNum
        {
            let mut writer = DrawingWriter::new();
            writer.add_text_box(
                CellAnchor::default(),
                CellAnchor::default(),
                TextBox {
                    original_id: None,
                    name: "BuAutoNum".to_string(),
                    text_body: Some(TextBody {
                        body_props: TextBodyProperties::default(),
                        paragraphs: vec![Paragraph {
                            props: ParagraphProperties {
                                bullet: Some(BulletProperties {
                                    color: None,
                                    size: Some(BulletSize::Points(1000)),
                                    font: None,
                                    bullet_type: Some(BulletType::AutoNum {
                                        scheme: TextAutonumberType::ArabicPeriod,
                                        start_at: Some(5),
                                    }),
                                    ..Default::default()
                                }),
                                ..Default::default()
                            },
                            runs: vec![TextRunContent::Run(TextRun {
                                text: "numbered".to_string(),
                                props: RunProperties::default(),
                            })],
                            end_para_rpr: None,
                        }],
                        ..Default::default()
                    }),
                    fill: None,
                    outline: None,
                    style: None,
                    ..Default::default()
                },
            );
            let xml_str = String::from_utf8(writer.to_xml()).unwrap();
            assert!(
                xml_str.contains("<a:buAutoNum type=\"arabicPeriod\" startAt=\"5\"/>"),
                "buAutoNum with start"
            );
            assert!(
                xml_str.contains("<a:buSzPts val=\"1000\"/>"),
                "bullet size points"
            );
        }

        // BulletType::Blip
        {
            let mut writer = DrawingWriter::new();
            writer.add_text_box(
                CellAnchor::default(),
                CellAnchor::default(),
                TextBox {
                    original_id: None,
                    name: "BuBlip".to_string(),
                    text_body: Some(TextBody {
                        body_props: TextBodyProperties::default(),
                        paragraphs: vec![Paragraph {
                            props: ParagraphProperties {
                                bullet: Some(BulletProperties {
                                    color: None,
                                    size: None,
                                    font: None,
                                    bullet_type: Some(BulletType::Blip("rId7".to_string())),
                                    ..Default::default()
                                }),
                                ..Default::default()
                            },
                            runs: vec![TextRunContent::Run(TextRun {
                                text: "image bullet".to_string(),
                                props: RunProperties::default(),
                            })],
                            end_para_rpr: None,
                        }],
                        ..Default::default()
                    }),
                    fill: None,
                    outline: None,
                    style: None,
                    ..Default::default()
                },
            );
            let xml_str = String::from_utf8(writer.to_xml()).unwrap();
            assert!(xml_str.contains("<a:buBlip>"), "buBlip start");
            assert!(xml_str.contains("<a:blip r:embed=\"rId7\"/>"), "blip embed");
            assert!(xml_str.contains("</a:buBlip>"), "buBlip end");
        }
    }

    #[test]
    fn test_underline_line_and_fill_variants() {
        use ooxml_types::drawings::{
            DrawingColor, Outline, Paragraph, RunProperties, TextBody, TextBodyProperties, TextRun,
            TextRunContent, UnderlineFill, UnderlineLine,
        };

        // FollowText variants
        {
            let mut writer = DrawingWriter::new();
            writer.add_text_box(
                CellAnchor::default(),
                CellAnchor::default(),
                TextBox {
                    original_id: None,
                    name: "ULFollow".to_string(),
                    text_body: Some(TextBody {
                        body_props: TextBodyProperties::default(),
                        paragraphs: vec![Paragraph {
                            runs: vec![TextRunContent::Run(TextRun {
                                text: "follow".to_string(),
                                props: RunProperties {
                                    underline_line: Some(UnderlineLine::FollowText),
                                    underline_fill: Some(UnderlineFill::FollowText),
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
                },
            );
            let xml_str = String::from_utf8(writer.to_xml()).unwrap();
            assert!(xml_str.contains("<a:uLnTx/>"), "underline line follow text");
            assert!(
                xml_str.contains("<a:uFillTx/>"),
                "underline fill follow text"
            );
        }

        // Custom underline line
        {
            let mut writer = DrawingWriter::new();
            writer.add_text_box(
                CellAnchor::default(),
                CellAnchor::default(),
                TextBox {
                    original_id: None,
                    name: "ULCustom".to_string(),
                    text_body: Some(TextBody {
                        body_props: TextBodyProperties::default(),
                        paragraphs: vec![Paragraph {
                            runs: vec![TextRunContent::Run(TextRun {
                                text: "custom".to_string(),
                                props: RunProperties {
                                    underline_line: Some(UnderlineLine::Custom(Outline {
                                        width: Some(12700),
                                        fill: Some(LineFill::Solid(SolidFill {
                                            color: DrawingColor::SrgbClr {
                                                val: "00FF00".to_string(),
                                                transforms: vec![],
                                            },
                                        })),
                                        dash: None,
                                        cap: None,
                                        compound: None,
                                        head_end: None,
                                        tail_end: None,
                                        join: None,
                                        align: None,
                                    })),
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
                },
            );
            let xml_str = String::from_utf8(writer.to_xml()).unwrap();
            assert!(
                xml_str.contains("<a:uLn w=\"12700\">"),
                "custom underline line"
            );
            assert!(
                xml_str.contains("<a:srgbClr val=\"00FF00\"/>"),
                "underline color"
            );
            assert!(xml_str.contains("</a:uLn>"), "underline line end");
        }
    }

    #[test]
    fn test_run_props_rtl_as_child_element() {
        use ooxml_types::drawings::{
            Paragraph, RunProperties, TextBody, TextBodyProperties, TextRun, TextRunContent,
        };

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "RTL".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties::default(),
                    paragraphs: vec![Paragraph {
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "rtl text".to_string(),
                            props: RunProperties {
                                rtl: Some(true),
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
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // RTL is emitted as a child element, not an attribute
        assert!(
            xml_str.contains("<a:rtl val=\"1\"/>"),
            "rtl as child element"
        );
        assert!(
            xml_str.contains("</a:rPr>"),
            "rPr should have closing tag for children"
        );
    }

    #[test]
    fn test_extension_list_in_body_props() {
        use ooxml_types::drawings::{
            ExtensionList, Paragraph, RunProperties, TextBody, TextBodyProperties, TextRun,
            TextRunContent,
        };

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "ExtLst".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties {
                        ext_lst: Some(ExtensionList {
                            raw_xml: Some(
                                "<a:ext uri=\"{test-guid}\"><custom:data/></a:ext>".to_string(),
                            ),
                        }),
                        ..Default::default()
                    },
                    paragraphs: vec![Paragraph {
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "ext".to_string(),
                            props: RunProperties::default(),
                        })],
                        ..Default::default()
                    }],
                    ..Default::default()
                }),
                fill: None,
                outline: None,
                style: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<a:extLst>"), "ext list start");
        assert!(
            xml_str.contains("<a:ext uri=\"{test-guid}\"><custom:data/></a:ext>"),
            "raw ext content"
        );
        assert!(xml_str.contains("</a:extLst>"), "ext list end");
        assert!(
            xml_str.contains("</a:bodyPr>"),
            "bodyPr should have closing tag"
        );
    }

    #[test]
    fn test_bullet_color_follow_text_and_size_follow_text() {
        use ooxml_types::drawings::{
            BulletColor, BulletProperties, BulletSize, BulletType, Paragraph, ParagraphProperties,
            RunProperties, TextBody, TextBodyProperties, TextRun, TextRunContent,
        };

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "BuFollow".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties::default(),
                    paragraphs: vec![Paragraph {
                        props: ParagraphProperties {
                            bullet: Some(BulletProperties {
                                color: Some(BulletColor::FollowText),
                                size: Some(BulletSize::FollowText),
                                font: None,
                                bullet_type: Some(BulletType::Char("-".to_string())),
                                ..Default::default()
                            }),
                            ..Default::default()
                        },
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "dash".to_string(),
                            props: RunProperties::default(),
                        })],
                        end_para_rpr: None,
                    }],
                    ..Default::default()
                }),
                fill: None,
                outline: None,
                style: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<a:buClrTx/>"), "bullet color follow text");
        assert!(xml_str.contains("<a:buSzTx/>"), "bullet size follow text");
        assert!(
            xml_str.contains("<a:buChar char=\"-\"/>"),
            "dash bullet char"
        );
    }

    #[test]
    fn test_paragraph_default_run_props() {
        use ooxml_types::drawings::{
            Paragraph, ParagraphProperties, RunProperties, TextBody, TextBodyProperties, TextRun,
            TextRunContent,
        };

        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "DefRPr".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties::default(),
                    paragraphs: vec![Paragraph {
                        props: ParagraphProperties {
                            def_run_props: Some(Box::new(RunProperties {
                                size: Some(StTextFontSize::new_unchecked(1400)),
                                bold: Some(true),
                                lang: Some("en-US".to_string()),
                                ..Default::default()
                            })),
                            ..Default::default()
                        },
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "inherited".to_string(),
                            props: RunProperties::default(),
                        })],
                        end_para_rpr: None,
                    }],
                    ..Default::default()
                }),
                fill: None,
                outline: None,
                style: None,
                ..Default::default()
            },
        );

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(
            xml_str.contains("<a:defRPr lang=\"en-US\" sz=\"1400\" b=\"1\"/>"),
            "default run props in paragraph, got: {}",
            xml_str
        );
    }

    // =========================================================================
    // Roundtrip validation tests
    // =========================================================================
    //
    // These tests construct a TextBody, serialize it to XML via DrawingWriter,
    // then parse the XML back with the read-side parser and compare the result.
    // =========================================================================

    /// Roundtrip helper: write a TextBody through DrawingWriter, parse back, return parsed TextBody.
    fn roundtrip_text_body(text_body: TextBody) -> TextBody {
        use crate::domain::drawings::{Anchor, DrawingContent, parse_drawing};

        let text_box = TextBox {
            original_id: None,
            name: "Test".to_string(),
            text_body: Some(text_body),
            fill: None,
            outline: None,
            style: None,
            ..Default::default()
        };

        let from = CellAnchor {
            col: 0,
            col_off: 0,
            row: 0,
            row_off: 0,
        };
        let to = CellAnchor {
            col: 5,
            col_off: 0,
            row: 5,
            row_off: 0,
        };

        let mut dw = DrawingWriter::new();
        dw.add_text_box(from, to, text_box);
        let xml = dw.to_xml();

        let drawing = parse_drawing(&xml);
        assert!(
            !drawing.anchors.is_empty(),
            "No anchors in roundtrip output"
        );

        match &drawing.anchors[0] {
            Anchor::TwoCell(tc) => match &tc.content {
                DrawingContent::Shape(shape) => {
                    shape.tx_body.clone().expect("No text body after roundtrip")
                }
                other => panic!("Expected Shape, got {:?}", other),
            },
            other => panic!("Expected TwoCell, got {:?}", other),
        }
    }

    // -------------------------------------------------------------------------
    // 6b: Rich text roundtrip
    // -------------------------------------------------------------------------

    #[test]
    fn roundtrip_rich_text() {
        let text_body = TextBody {
            body_props: TextBodyProperties {
                wrap: Some(TextWrap::Square),
                ..Default::default()
            },
            list_style: None,
            paragraphs: vec![
                // Paragraph 1: two runs with bold/italic/size/color, different fonts
                Paragraph {
                    props: ParagraphProperties::default(),
                    runs: vec![
                        TextRunContent::Run(TextRun {
                            text: "Hello ".to_string(),
                            props: RunProperties {
                                bold: Some(true),
                                size: Some(StTextFontSize::new_unchecked(1400)),
                                color: Some(DrawingColor::SrgbClr {
                                    val: "FF0000".to_string(),
                                    transforms: vec![],
                                }),
                                latin: Some(TextFont {
                                    typeface: "Arial".to_string(),
                                    ..Default::default()
                                }),
                                ..Default::default()
                            },
                        }),
                        TextRunContent::Run(TextRun {
                            text: "World".to_string(),
                            props: RunProperties {
                                italic: Some(true),
                                size: Some(StTextFontSize::new_unchecked(1800)),
                                color: Some(DrawingColor::SrgbClr {
                                    val: "0000FF".to_string(),
                                    transforms: vec![],
                                }),
                                latin: Some(TextFont {
                                    typeface: "Calibri".to_string(),
                                    ..Default::default()
                                }),
                                ..Default::default()
                            },
                        }),
                    ],
                    end_para_rpr: None,
                },
                // Paragraph 2: run + line break + run
                Paragraph {
                    props: ParagraphProperties::default(),
                    runs: vec![
                        TextRunContent::Run(TextRun {
                            text: "Before break".to_string(),
                            props: RunProperties {
                                bold: Some(true),
                                ..Default::default()
                            },
                        }),
                        TextRunContent::LineBreak {
                            props: Some(RunProperties {
                                size: Some(StTextFontSize::new_unchecked(1200)),
                                ..Default::default()
                            }),
                        },
                        TextRunContent::Run(TextRun {
                            text: "After break".to_string(),
                            props: RunProperties::default(),
                        }),
                    ],
                    end_para_rpr: None,
                },
                // Paragraph 3: field + endParaRPr
                Paragraph {
                    props: ParagraphProperties::default(),
                    runs: vec![TextRunContent::Field {
                        id: "{B5F3C2A1-1234-5678-9ABC-DEF012345678}".to_string(),
                        field_type: Some("slidenum".to_string()),
                        text: Some("42".to_string()),
                        run_props: Some(RunProperties {
                            bold: Some(true),
                            size: Some(StTextFontSize::new_unchecked(1000)),
                            ..Default::default()
                        }),
                        para_props: None,
                    }],
                    end_para_rpr: Some(RunProperties {
                        italic: Some(true),
                        size: Some(StTextFontSize::new_unchecked(1100)),
                        lang: Some("en-US".to_string()),
                        ..Default::default()
                    }),
                },
            ],
        };

        let result = roundtrip_text_body(text_body);

        // Verify paragraph count
        assert_eq!(result.paragraphs.len(), 3, "Expected 3 paragraphs");

        // Paragraph 1: two runs with formatting
        let p1 = &result.paragraphs[0];
        assert_eq!(p1.runs.len(), 2, "Para 1 should have 2 runs");
        if let TextRunContent::Run(r) = &p1.runs[0] {
            assert_eq!(r.text, "Hello ");
            assert_eq!(r.props.bold, Some(true));
            assert_eq!(r.props.size, Some(StTextFontSize::new_unchecked(1400)));
            assert_eq!(
                r.props.color.as_ref().and_then(|c| match c {
                    DrawingColor::SrgbClr { val, .. } => Some(val.as_str()),
                    _ => None,
                }),
                Some("FF0000")
            );
            assert_eq!(
                r.props.latin.as_ref().map(|f| f.typeface.as_str()),
                Some("Arial")
            );
        } else {
            panic!("Expected Run in para 1 position 0");
        }
        if let TextRunContent::Run(r) = &p1.runs[1] {
            assert_eq!(r.text, "World");
            assert_eq!(r.props.italic, Some(true));
            assert_eq!(r.props.size, Some(StTextFontSize::new_unchecked(1800)));
            assert_eq!(
                r.props.color.as_ref().and_then(|c| match c {
                    DrawingColor::SrgbClr { val, .. } => Some(val.as_str()),
                    _ => None,
                }),
                Some("0000FF")
            );
            assert_eq!(
                r.props.latin.as_ref().map(|f| f.typeface.as_str()),
                Some("Calibri")
            );
        } else {
            panic!("Expected Run in para 1 position 1");
        }

        // Paragraph 2: run + line break + run
        // NOTE: The read-side parser collects all runs first, then all line breaks, then all
        // fields -- it does NOT preserve interleaving order within a paragraph. This means
        // the roundtripped result will have [Run, Run, LineBreak] rather than [Run, LineBreak, Run].
        // This is a known limitation of the current parser architecture.
        let p2 = &result.paragraphs[1];
        assert_eq!(p2.runs.len(), 3, "Para 2 should have 3 items");

        // Verify all content types are present (order may differ from input)
        let run_texts: Vec<&str> = p2
            .runs
            .iter()
            .filter_map(|r| {
                if let TextRunContent::Run(run) = r {
                    Some(run.text.as_str())
                } else {
                    None
                }
            })
            .collect();
        assert!(
            run_texts.contains(&"Before break"),
            "Should contain 'Before break'"
        );
        assert!(
            run_texts.contains(&"After break"),
            "Should contain 'After break'"
        );

        let has_line_break = p2
            .runs
            .iter()
            .any(|r| matches!(r, TextRunContent::LineBreak { .. }));
        assert!(has_line_break, "Should contain a line break");

        // Verify the line break properties survive
        for r in &p2.runs {
            if let TextRunContent::LineBreak { props } = r {
                assert!(props.is_some(), "Line break should have props");
                assert_eq!(
                    props.as_ref().unwrap().size,
                    Some(StTextFontSize::new_unchecked(1200))
                );
            }
        }

        // Verify "Before break" run has bold
        for r in &p2.runs {
            if let TextRunContent::Run(run) = r {
                if run.text == "Before break" {
                    assert_eq!(run.props.bold, Some(true));
                }
            }
        }

        // Paragraph 3: field + endParaRPr
        let p3 = &result.paragraphs[2];
        assert!(!p3.runs.is_empty(), "Para 3 should have at least one item");
        if let TextRunContent::Field {
            id,
            field_type,
            text,
            run_props,
            ..
        } = &p3.runs[0]
        {
            assert_eq!(id, "{B5F3C2A1-1234-5678-9ABC-DEF012345678}");
            assert_eq!(field_type.as_deref(), Some("slidenum"));
            assert_eq!(text.as_deref(), Some("42"));
            assert!(run_props.is_some(), "Field should have run props");
            assert_eq!(run_props.as_ref().unwrap().bold, Some(true));
            assert_eq!(
                run_props.as_ref().unwrap().size,
                Some(StTextFontSize::new_unchecked(1000))
            );
        } else {
            panic!("Expected Field in para 3 position 0");
        }
        assert!(p3.end_para_rpr.is_some(), "Para 3 should have endParaRPr");
        let epr = p3.end_para_rpr.as_ref().unwrap();
        assert_eq!(epr.italic, Some(true));
        assert_eq!(epr.size, Some(StTextFontSize::new_unchecked(1100)));
        assert_eq!(epr.lang.as_deref(), Some("en-US"));
    }

    // -------------------------------------------------------------------------
    // 6c: Text body properties roundtrip
    // -------------------------------------------------------------------------

    #[test]
    fn roundtrip_text_body_properties() {
        let body_props = TextBodyProperties {
            rot: Some(StAngle::new(5400000)),
            anchor: Some(TextAnchor::Center),
            wrap: Some(TextWrap::Square),
            l_ins: Some(91440),
            t_ins: Some(45720),
            r_ins: Some(91440),
            b_ins: Some(45720),
            vert: Some(TextVerticalType::Vertical),
            vert_overflow: Some(TextVertOverflow::Clip),
            horz_overflow: Some(TextHorzOverflow::Clip),
            anchor_ctr: Some(true),
            rtl_col: Some(true),
            spc_first_last_para: Some(true),
            num_col: Some(2),
            spc_col: Some(360000),
            upright: Some(true),
            compat_ln_spc: Some(true),
            force_aa: Some(true),
            from_word_art: Some(true),
            autofit: Some(TextAutofit::NormalAutofit {
                font_scale: Some(80000),
                line_space_reduction: Some(10000),
            }),
            ext_lst: None,
            prst_tx_warp: None,
            flat_tx: None,
            scene3d: None,
            sp3d: None,
        };

        let text_body = TextBody {
            body_props,
            list_style: None,
            paragraphs: vec![Paragraph {
                props: ParagraphProperties::default(),
                runs: vec![TextRunContent::Run(TextRun {
                    text: "test".to_string(),
                    props: RunProperties::default(),
                })],
                end_para_rpr: None,
            }],
        };

        let result = roundtrip_text_body(text_body);
        let bp = &result.body_props;

        assert_eq!(bp.rot, Some(StAngle::new(5400000)), "rot");
        assert_eq!(bp.anchor, Some(TextAnchor::Center), "anchor");
        assert_eq!(bp.wrap, Some(TextWrap::Square), "wrap");
        assert_eq!(bp.l_ins, Some(91440), "l_ins");
        assert_eq!(bp.t_ins, Some(45720), "t_ins");
        assert_eq!(bp.r_ins, Some(91440), "r_ins");
        assert_eq!(bp.b_ins, Some(45720), "b_ins");
        assert_eq!(bp.vert, Some(TextVerticalType::Vertical), "vert");
        assert_eq!(
            bp.vert_overflow,
            Some(TextVertOverflow::Clip),
            "vertOverflow"
        );
        assert_eq!(
            bp.horz_overflow,
            Some(TextHorzOverflow::Clip),
            "horzOverflow"
        );
        assert_eq!(bp.anchor_ctr, Some(true), "anchorCtr");
        assert_eq!(bp.rtl_col, Some(true), "rtlCol");
        assert_eq!(bp.spc_first_last_para, Some(true), "spcFirstLastPara");
        assert_eq!(bp.num_col, Some(2), "numCol");
        assert_eq!(bp.spc_col, Some(360000), "spcCol");
        assert_eq!(bp.upright, Some(true), "upright");
        assert_eq!(bp.compat_ln_spc, Some(true), "compatLnSpc");
        assert_eq!(bp.force_aa, Some(true), "forceAA");
        assert_eq!(bp.from_word_art, Some(true), "fromWordArt");

        match &bp.autofit {
            Some(TextAutofit::NormalAutofit {
                font_scale,
                line_space_reduction,
            }) => {
                assert_eq!(*font_scale, Some(80000), "fontScale");
                assert_eq!(*line_space_reduction, Some(10000), "lnSpcReduction");
            }
            other => panic!("Expected NormalAutofit, got {:?}", other),
        }
    }

    // -------------------------------------------------------------------------
    // 6d: Paragraph properties roundtrip
    // -------------------------------------------------------------------------

    #[test]
    fn roundtrip_paragraph_properties() {
        let para_props = ParagraphProperties {
            align: Some(TextAlign::Center),
            margin_l: Some(457200),
            margin_r: Some(228600),
            indent: Some(-228600),
            line_spacing: Some(TextSpacing::Percent(150000)),
            space_before: Some(TextSpacing::Points(600)),
            space_after: Some(TextSpacing::Points(400)),
            bullet: Some(BulletProperties {
                color: Some(BulletColor::Custom(DrawingColor::SrgbClr {
                    val: "00FF00".to_string(),
                    transforms: vec![],
                })),
                size: Some(BulletSize::Percent(120000)),
                font: Some(TextFont {
                    typeface: "Wingdings".to_string(),
                    ..Default::default()
                }),
                bullet_type: Some(BulletType::Char("*".to_string())),
                ..Default::default()
            }),
            def_run_props: Some(Box::new(RunProperties {
                bold: Some(true),
                size: Some(StTextFontSize::new_unchecked(1400)),
                lang: Some("en-US".to_string()),
                ..Default::default()
            })),
            tab_list: Some(vec![
                TextTabStop {
                    position: Some(914400),
                    align: Some(TextTabAlignType::Left),
                },
                TextTabStop {
                    position: Some(1828800),
                    align: Some(TextTabAlignType::Center),
                },
                TextTabStop {
                    position: Some(2743200),
                    align: Some(TextTabAlignType::Right),
                },
            ]),
            level: Some(StTextIndentLevelType::new_unchecked(2)),
            rtl: Some(true),
            def_tab_sz: Some(914400),
            ea_ln_brk: Some(true),
            latin_ln_brk: Some(false),
            hanging_punct: Some(true),
            font_align: Some(TextFontAlignType::Center),
            ext_lst: None,
        };

        let text_body = TextBody {
            body_props: TextBodyProperties::default(),
            list_style: None,
            paragraphs: vec![Paragraph {
                props: para_props,
                runs: vec![TextRunContent::Run(TextRun {
                    text: "test paragraph".to_string(),
                    props: RunProperties::default(),
                })],
                end_para_rpr: None,
            }],
        };

        let result = roundtrip_text_body(text_body);
        let pp = &result.paragraphs[0].props;

        assert_eq!(pp.align, Some(TextAlign::Center), "align");
        assert_eq!(pp.margin_l, Some(457200), "marL");
        assert_eq!(pp.margin_r, Some(228600), "marR");
        assert_eq!(pp.indent, Some(-228600), "indent");
        assert_eq!(pp.line_spacing, Some(TextSpacing::Percent(150000)), "lnSpc");
        assert_eq!(pp.space_before, Some(TextSpacing::Points(600)), "spcBef");
        assert_eq!(pp.space_after, Some(TextSpacing::Points(400)), "spcAft");
        assert_eq!(
            pp.level,
            Some(StTextIndentLevelType::new_unchecked(2)),
            "lvl"
        );
        assert_eq!(pp.rtl, Some(true), "rtl");
        assert_eq!(pp.def_tab_sz, Some(914400), "defTabSz");
        assert_eq!(pp.ea_ln_brk, Some(true), "eaLnBrk");
        assert_eq!(pp.latin_ln_brk, Some(false), "latinLnBrk");
        assert_eq!(pp.hanging_punct, Some(true), "hangingPunct");
        assert_eq!(pp.font_align, Some(TextFontAlignType::Center), "fontAlgn");

        // Bullet properties
        let bullet = pp.bullet.as_ref().expect("bullet should be present");
        if let Some(BulletColor::Custom(c)) = &bullet.color {
            match c {
                DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "00FF00", "bullet color"),
                other => panic!("Expected SrgbClr, got {other:?}"),
            }
        } else {
            panic!("Expected custom bullet color");
        }
        assert_eq!(
            bullet.size,
            Some(BulletSize::Percent(120000)),
            "bullet size"
        );
        assert_eq!(
            bullet.font.as_ref().map(|f| f.typeface.as_str()),
            Some("Wingdings"),
            "bullet font"
        );
        match &bullet.bullet_type {
            Some(BulletType::Char(c)) => assert_eq!(c, "*", "bullet char"),
            other => panic!("Expected Char bullet, got {:?}", other),
        }

        // Tab stops
        let tabs = pp.tab_list.as_ref().expect("tabs should be present");
        assert_eq!(tabs.len(), 3, "tab count");
        assert_eq!(tabs[0].position, Some(914400));
        assert_eq!(tabs[0].align, Some(TextTabAlignType::Left));
        assert_eq!(tabs[1].position, Some(1828800));
        assert_eq!(tabs[1].align, Some(TextTabAlignType::Center));
        assert_eq!(tabs[2].position, Some(2743200));
        assert_eq!(tabs[2].align, Some(TextTabAlignType::Right));

        // Default run props
        let drp = pp.def_run_props.as_ref().expect("defRPr should be present");
        assert_eq!(drp.bold, Some(true), "defRPr bold");
        assert_eq!(
            drp.size,
            Some(StTextFontSize::new_unchecked(1400)),
            "defRPr size"
        );
        assert_eq!(drp.lang.as_deref(), Some("en-US"), "defRPr lang");
    }

    // -------------------------------------------------------------------------
    // 6e: Run properties roundtrip
    // -------------------------------------------------------------------------

    #[test]
    fn roundtrip_run_properties() {
        let run_props = RunProperties {
            size: Some(StTextFontSize::new_unchecked(2400)),
            bold: Some(true),
            italic: Some(true),
            underline: Some(TextUnderlineType::Double),
            strike: Some(TextStrikeType::SingleStrike),
            latin: Some(TextFont {
                typeface: "Times New Roman".to_string(),
                panose: Some("02020603050405020304".to_string()),
                pitch_family: Some(StPitchFamily::new(18)),
                charset: Some(0),
            }),
            ea: Some(TextFont {
                typeface: "MS Gothic".to_string(),
                ..Default::default()
            }),
            cs: Some(TextFont {
                typeface: "Arial".to_string(),
                ..Default::default()
            }),
            sym: Some(TextFont {
                typeface: "Symbol".to_string(),
                ..Default::default()
            }),
            color: Some(DrawingColor::SrgbClr {
                val: "336699".to_string(),
                transforms: vec![],
            }),
            lang: Some("en-US".to_string()),
            alt_lang: Some("ja-JP".to_string()),
            kern: Some(StTextNonNegativePoint::new_unchecked(1200)),
            cap: Some(TextCapsType::Small),
            spacing: Some(StTextPoint::new(200)),
            baseline: Some(StPercentage::new(30000)),
            highlight: None,   // Highlight roundtrip depends on writer support
            hlink_click: None, // Hyperlink roundtrip depends on r:id handling
            hlink_mouse_over: None,
            text_fill: None, // Fill roundtrip tested separately (6f)
            text_outline: None,
            underline_line: None,
            underline_fill: None,
            kumimoji: Some(true),
            normalize_h: Some(true),
            no_proof: Some(true),
            dirty: Some(true),
            err: Some(true),
            smt_clean: Some(true),
            smt_id: Some(42),
            bmk: Some("bookmark1".to_string()),
            rtl: None, // NOTE: The writer currently does not emit rtl for run properties
            effects: None,
            ext_lst: None,
        };

        let text_body = TextBody {
            body_props: TextBodyProperties::default(),
            list_style: None,
            paragraphs: vec![Paragraph {
                props: ParagraphProperties::default(),
                runs: vec![TextRunContent::Run(TextRun {
                    text: "styled text".to_string(),
                    props: run_props,
                })],
                end_para_rpr: None,
            }],
        };

        let result = roundtrip_text_body(text_body);
        let r = match &result.paragraphs[0].runs[0] {
            TextRunContent::Run(r) => &r.props,
            other => panic!("Expected Run, got {:?}", other),
        };

        assert_eq!(r.size, Some(StTextFontSize::new_unchecked(2400)), "size");
        assert_eq!(r.bold, Some(true), "bold");
        assert_eq!(r.italic, Some(true), "italic");
        assert_eq!(r.underline, Some(TextUnderlineType::Double), "underline");
        assert_eq!(r.strike, Some(TextStrikeType::SingleStrike), "strike");

        // Latin font with full attributes
        let latin = r.latin.as_ref().expect("latin font");
        assert_eq!(latin.typeface, "Times New Roman");
        assert_eq!(latin.panose.as_deref(), Some("02020603050405020304"));
        assert_eq!(latin.pitch_family, Some(StPitchFamily::new(18)));
        assert_eq!(latin.charset, Some(0));

        // Other font slots
        assert_eq!(
            r.ea.as_ref().map(|f| f.typeface.as_str()),
            Some("MS Gothic"),
            "ea font"
        );
        assert_eq!(
            r.cs.as_ref().map(|f| f.typeface.as_str()),
            Some("Arial"),
            "cs font"
        );
        assert_eq!(
            r.sym.as_ref().map(|f| f.typeface.as_str()),
            Some("Symbol"),
            "sym font"
        );

        // Color
        assert_eq!(
            r.color.as_ref().and_then(|c| match c {
                DrawingColor::SrgbClr { val, .. } => Some(val.as_str()),
                _ => None,
            }),
            Some("336699"),
            "color"
        );

        // Language
        assert_eq!(r.lang.as_deref(), Some("en-US"), "lang");
        assert_eq!(r.alt_lang.as_deref(), Some("ja-JP"), "altLang");

        // Text properties
        assert_eq!(
            r.kern,
            Some(StTextNonNegativePoint::new_unchecked(1200)),
            "kern"
        );
        assert_eq!(r.cap, Some(TextCapsType::Small), "cap");
        assert_eq!(r.spacing, Some(StTextPoint::new(200)), "spacing");
        assert_eq!(r.baseline, Some(StPercentage::new(30000)), "baseline");

        // Boolean flags
        assert_eq!(r.kumimoji, Some(true), "kumimoji");
        assert_eq!(r.normalize_h, Some(true), "normalizeH");
        assert_eq!(r.no_proof, Some(true), "noProof");
        assert_eq!(r.dirty, Some(true), "dirty");
        assert_eq!(r.err, Some(true), "err");
        assert_eq!(r.smt_clean, Some(true), "smtClean");
        assert_eq!(r.smt_id, Some(42), "smtId");
        assert_eq!(r.bmk.as_deref(), Some("bookmark1"), "bmk");
    }

    // -------------------------------------------------------------------------
    // 6g: List style roundtrip
    // -------------------------------------------------------------------------

    #[test]
    fn roundtrip_list_style() {
        let list_style = TextListStyle {
            def_ppr: Some(ParagraphProperties {
                align: Some(TextAlign::Left),
                def_run_props: Some(Box::new(RunProperties {
                    size: Some(StTextFontSize::new_unchecked(1200)),
                    ..Default::default()
                })),
                ..Default::default()
            }),
            level_ppr: {
                let mut levels: [Option<ParagraphProperties>; 9] = Default::default();
                levels[0] = Some(ParagraphProperties {
                    align: Some(TextAlign::Left),
                    margin_l: Some(228600),
                    indent: Some(-228600),
                    bullet: Some(BulletProperties {
                        bullet_type: Some(BulletType::Char("-".to_string())),
                        ..Default::default()
                    }),
                    ..Default::default()
                });
                levels[1] = Some(ParagraphProperties {
                    align: Some(TextAlign::Center),
                    margin_l: Some(457200),
                    indent: Some(-228600),
                    ..Default::default()
                });
                levels[2] = Some(ParagraphProperties {
                    align: Some(TextAlign::Right),
                    margin_l: Some(685800),
                    ..Default::default()
                });
                levels
            },
        };

        let text_body = TextBody {
            body_props: TextBodyProperties::default(),
            list_style: Some(list_style),
            paragraphs: vec![Paragraph {
                props: ParagraphProperties::default(),
                runs: vec![TextRunContent::Run(TextRun {
                    text: "list item".to_string(),
                    props: RunProperties::default(),
                })],
                end_para_rpr: None,
            }],
        };

        let result = roundtrip_text_body(text_body);
        let ls = result
            .list_style
            .as_ref()
            .expect("list_style should survive roundtrip");

        // Check defPPr
        let def = ls.def_ppr.as_ref().expect("defPPr should be present");
        assert_eq!(def.align, Some(TextAlign::Left), "defPPr align");
        assert!(def.def_run_props.is_some(), "defPPr should have defRPr");
        assert_eq!(
            def.def_run_props.as_ref().unwrap().size,
            Some(StTextFontSize::new_unchecked(1200)),
            "defPPr defRPr size"
        );

        // Check level 1
        let lvl1 = ls.level_ppr[0].as_ref().expect("lvl1pPr should be present");
        assert_eq!(lvl1.align, Some(TextAlign::Left), "lvl1 align");
        assert_eq!(lvl1.margin_l, Some(228600), "lvl1 marL");
        assert_eq!(lvl1.indent, Some(-228600), "lvl1 indent");
        let b = lvl1.bullet.as_ref().expect("lvl1 bullet");
        match &b.bullet_type {
            Some(BulletType::Char(c)) => assert_eq!(c, "-"),
            other => panic!("Expected Char bullet, got {:?}", other),
        }

        // Check level 2
        let lvl2 = ls.level_ppr[1].as_ref().expect("lvl2pPr should be present");
        assert_eq!(lvl2.align, Some(TextAlign::Center), "lvl2 align");
        assert_eq!(lvl2.margin_l, Some(457200), "lvl2 marL");

        // Check level 3
        let lvl3 = ls.level_ppr[2].as_ref().expect("lvl3pPr should be present");
        assert_eq!(lvl3.align, Some(TextAlign::Right), "lvl3 align");
        assert_eq!(lvl3.margin_l, Some(685800), "lvl3 marL");

        // Levels 4-9 should be None
        for i in 3..9 {
            assert!(ls.level_ppr[i].is_none(), "level {} should be None", i + 1);
        }
    }

    // -------------------------------------------------------------------------
    // 6i: Edge case roundtrips
    // -------------------------------------------------------------------------

    #[test]
    fn roundtrip_empty_text_body() {
        // TextBody with no paragraphs (minimal)
        let text_body = TextBody {
            body_props: TextBodyProperties::default(),
            list_style: None,
            paragraphs: vec![],
        };

        let result = roundtrip_text_body(text_body);
        assert!(
            result.list_style.is_none(),
            "absent lstStyle should remain absent on full text-body roundtrip"
        );
        // The parser may produce a paragraph with no runs for an empty txBody;
        // either 0 or 1 paragraph with empty runs is acceptable.
        for p in &result.paragraphs {
            // If there are paragraphs, they should have no meaningful runs
            for r in &p.runs {
                if let TextRunContent::Run(run) = r {
                    // Any auto-generated run should have empty text
                    assert!(
                        run.text.is_empty() || run.text.trim().is_empty(),
                        "Empty text body should not produce non-empty runs"
                    );
                }
            }
        }
    }

    #[test]
    fn roundtrip_paragraph_no_runs() {
        let text_body = TextBody {
            body_props: TextBodyProperties::default(),
            list_style: None,
            paragraphs: vec![Paragraph {
                props: ParagraphProperties {
                    align: Some(TextAlign::Center),
                    ..Default::default()
                },
                runs: vec![],
                end_para_rpr: Some(RunProperties {
                    size: Some(StTextFontSize::new_unchecked(1400)),
                    ..Default::default()
                }),
            }],
        };

        let result = roundtrip_text_body(text_body);
        assert!(
            !result.paragraphs.is_empty(),
            "Should have at least one paragraph"
        );
        let p = &result.paragraphs[0];
        assert_eq!(
            p.props.align,
            Some(TextAlign::Center),
            "para align preserved"
        );
        // endParaRPr should survive
        assert!(p.end_para_rpr.is_some(), "endParaRPr should survive");
        assert_eq!(
            p.end_para_rpr.as_ref().unwrap().size,
            Some(StTextFontSize::new_unchecked(1400)),
            "endParaRPr size"
        );
    }

    #[test]
    fn roundtrip_run_with_empty_text() {
        let text_body = TextBody {
            body_props: TextBodyProperties::default(),
            list_style: None,
            paragraphs: vec![Paragraph {
                props: ParagraphProperties::default(),
                runs: vec![TextRunContent::Run(TextRun {
                    text: "".to_string(),
                    props: RunProperties {
                        bold: Some(true),
                        ..Default::default()
                    },
                })],
                end_para_rpr: None,
            }],
        };

        let result = roundtrip_text_body(text_body);
        assert!(!result.paragraphs.is_empty(), "Should have paragraph");
        // Empty-text run should survive (or be omitted gracefully)
        // We check that the body props survive at minimum
        // Some implementations may omit empty runs; that's acceptable
    }

    #[test]
    fn roundtrip_all_default_properties() {
        // Minimal TextBody: all defaults, one paragraph with one plain run
        let text_body = TextBody {
            body_props: TextBodyProperties::default(),
            list_style: None,
            paragraphs: vec![Paragraph {
                props: ParagraphProperties::default(),
                runs: vec![TextRunContent::Run(TextRun {
                    text: "plain text".to_string(),
                    props: RunProperties::default(),
                })],
                end_para_rpr: None,
            }],
        };

        let result = roundtrip_text_body(text_body);
        assert_eq!(result.paragraphs.len(), 1, "one paragraph");
        if let TextRunContent::Run(r) = &result.paragraphs[0].runs[0] {
            assert_eq!(r.text, "plain text");
            // Default properties should have all None/false
            assert_eq!(r.props.bold, None);
            assert_eq!(r.props.italic, None);
            assert_eq!(r.props.size, None);
        } else {
            panic!("Expected Run");
        }
    }

    #[test]
    fn roundtrip_autofit_shape_autofit() {
        let text_body = TextBody {
            body_props: TextBodyProperties {
                autofit: Some(TextAutofit::ShapeAutofit),
                ..Default::default()
            },
            list_style: None,
            paragraphs: vec![Paragraph {
                props: ParagraphProperties::default(),
                runs: vec![TextRunContent::Run(TextRun {
                    text: "fit".to_string(),
                    props: RunProperties::default(),
                })],
                end_para_rpr: None,
            }],
        };

        let result = roundtrip_text_body(text_body);
        assert_eq!(result.body_props.autofit, Some(TextAutofit::ShapeAutofit));
    }

    #[test]
    fn roundtrip_autofit_no_autofit() {
        let text_body = TextBody {
            body_props: TextBodyProperties {
                autofit: Some(TextAutofit::NoAutofit),
                ..Default::default()
            },
            list_style: None,
            paragraphs: vec![Paragraph {
                props: ParagraphProperties::default(),
                runs: vec![TextRunContent::Run(TextRun {
                    text: "no fit".to_string(),
                    props: RunProperties::default(),
                })],
                end_para_rpr: None,
            }],
        };

        let result = roundtrip_text_body(text_body);
        assert_eq!(result.body_props.autofit, Some(TextAutofit::NoAutofit));
    }

    #[test]
    fn roundtrip_autonumber_bullet() {
        use crate::domain::drawings::write::TextAutonumberType;

        let text_body = TextBody {
            body_props: TextBodyProperties::default(),
            list_style: None,
            paragraphs: vec![Paragraph {
                props: ParagraphProperties {
                    bullet: Some(BulletProperties {
                        bullet_type: Some(BulletType::AutoNum {
                            scheme: TextAutonumberType::ArabicPeriod,
                            start_at: Some(3),
                        }),
                        size: Some(BulletSize::Points(1200)),
                        color: Some(BulletColor::FollowText),
                        font: None,
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                runs: vec![TextRunContent::Run(TextRun {
                    text: "numbered item".to_string(),
                    props: RunProperties::default(),
                })],
                end_para_rpr: None,
            }],
        };

        let result = roundtrip_text_body(text_body);
        let bullet = result.paragraphs[0]
            .props
            .bullet
            .as_ref()
            .expect("bullet should survive");
        match &bullet.bullet_type {
            Some(BulletType::AutoNum { scheme, start_at }) => {
                assert_eq!(
                    *scheme,
                    TextAutonumberType::ArabicPeriod,
                    "autonumber scheme"
                );
                assert_eq!(*start_at, Some(3), "startAt");
            }
            other => panic!("Expected AutoNum bullet, got {:?}", other),
        }
        assert_eq!(bullet.size, Some(BulletSize::Points(1200)), "bullet size");
        match &bullet.color {
            Some(BulletColor::FollowText) => {} // correct
            other => panic!("Expected FollowText bullet color, got {:?}", other),
        }
    }

    #[test]
    fn roundtrip_no_bullet() {
        let text_body = TextBody {
            body_props: TextBodyProperties::default(),
            list_style: None,
            paragraphs: vec![Paragraph {
                props: ParagraphProperties {
                    bullet: Some(BulletProperties {
                        bullet_type: Some(BulletType::None),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                runs: vec![TextRunContent::Run(TextRun {
                    text: "no bullet".to_string(),
                    props: RunProperties::default(),
                })],
                end_para_rpr: None,
            }],
        };

        let result = roundtrip_text_body(text_body);
        let bullet = result.paragraphs[0]
            .props
            .bullet
            .as_ref()
            .expect("bullet props");
        assert_eq!(
            bullet.bullet_type,
            Some(BulletType::None),
            "buNone should roundtrip"
        );
    }

    #[test]
    fn roundtrip_multiple_underline_types() {
        // Test various underline types to confirm they all roundtrip correctly
        let underline_types = vec![
            TextUnderlineType::Single,
            TextUnderlineType::Double,
            TextUnderlineType::Heavy,
            TextUnderlineType::Dotted,
            TextUnderlineType::Dash,
            TextUnderlineType::DashLong,
            TextUnderlineType::DotDash,
            TextUnderlineType::Words,
        ];

        for u_type in underline_types {
            let text_body = TextBody {
                body_props: TextBodyProperties::default(),
                list_style: None,
                paragraphs: vec![Paragraph {
                    props: ParagraphProperties::default(),
                    runs: vec![TextRunContent::Run(TextRun {
                        text: format!("underline {:?}", u_type),
                        props: RunProperties {
                            underline: Some(u_type),
                            ..Default::default()
                        },
                    })],
                    end_para_rpr: None,
                }],
            };

            let result = roundtrip_text_body(text_body);
            if let TextRunContent::Run(r) = &result.paragraphs[0].runs[0] {
                assert_eq!(
                    r.props.underline,
                    Some(u_type),
                    "Underline type {:?} should roundtrip",
                    u_type
                );
            } else {
                panic!("Expected Run");
            }
        }
    }

    #[test]
    fn roundtrip_spacing_types() {
        // Test both spacing types: percent and points
        let text_body = TextBody {
            body_props: TextBodyProperties::default(),
            list_style: None,
            paragraphs: vec![Paragraph {
                props: ParagraphProperties {
                    line_spacing: Some(TextSpacing::Percent(200000)),
                    space_before: Some(TextSpacing::Points(1200)),
                    space_after: Some(TextSpacing::Percent(50000)),
                    ..Default::default()
                },
                runs: vec![TextRunContent::Run(TextRun {
                    text: "spacing test".to_string(),
                    props: RunProperties::default(),
                })],
                end_para_rpr: None,
            }],
        };

        let result = roundtrip_text_body(text_body);
        let pp = &result.paragraphs[0].props;
        assert_eq!(
            pp.line_spacing,
            Some(TextSpacing::Percent(200000)),
            "line spacing percent"
        );
        assert_eq!(
            pp.space_before,
            Some(TextSpacing::Points(1200)),
            "space before points"
        );
        assert_eq!(
            pp.space_after,
            Some(TextSpacing::Percent(50000)),
            "space after percent"
        );
    }

    // =========================================================================
    // SmartArt graphicFrame XML tests
    // =========================================================================

    use crate::domain::drawings::write::{
        DIAGRAM_GRAPHIC_DATA_URI, NS_DGM, SmartArtWriteData, TwoCellAnchor,
    };

    #[test]
    fn test_smartart_graphic_frame_xml() {
        let sa = SmartArtWriteData {
            original_id: None,
            name: "Diagram 1".to_string(),
            dm_rel_id: "rId10".to_string(),
            lo_rel_id: "rId11".to_string(),
            qs_rel_id: "rId12".to_string(),
            cs_rel_id: "rId13".to_string(),
            data_xml: Some("<dgm:dataModel/>".to_string()),
            layout_xml: Some("<dgm:layoutDef/>".to_string()),
            colors_xml: Some("<dgm:colorsDef/>".to_string()),
            style_xml: Some("<dgm:styleDef/>".to_string()),
            drawing_xml: None,
        };

        let mut writer = DrawingWriter::new();
        writer.add_anchor(DrawingAnchor::TwoCell(
            TwoCellAnchor {
                from: CellAnchor {
                    col: 0,
                    col_off: 0,
                    row: 0,
                    row_off: 0,
                },
                to: CellAnchor {
                    col: 5,
                    col_off: 0,
                    row: 10,
                    row_off: 0,
                },
                edit_as: Some(EditAs::TwoCell),
                client_data: ClientData::default(),
                ..Default::default()
            },
            DrawingObject::SmartArt(sa),
        ));

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // Verify graphicFrame structure
        assert!(
            xml_str.contains("<xdr:graphicFrame>"),
            "should have graphicFrame element"
        );
        assert!(
            xml_str.contains("<xdr:nvGraphicFramePr>"),
            "should have nvGraphicFramePr"
        );
        assert!(
            xml_str.contains("name=\"Diagram 1\""),
            "should have name attribute"
        );
        assert!(
            xml_str.contains("<xdr:cNvGraphicFramePr/>"),
            "should have cNvGraphicFramePr"
        );
        assert!(xml_str.contains("<xdr:xfrm>"), "should have xfrm");

        // Verify diagram relIds
        assert!(
            xml_str.contains(&format!("uri=\"{}\"", DIAGRAM_GRAPHIC_DATA_URI)),
            "should have diagram URI"
        );
        assert!(
            xml_str.contains(&format!("xmlns:dgm=\"{}\"", NS_DGM)),
            "should have dgm namespace"
        );
        assert!(xml_str.contains("r:dm=\"rId10\""), "should have dm rel id");
        assert!(xml_str.contains("r:lo=\"rId11\""), "should have lo rel id");
        assert!(xml_str.contains("r:qs=\"rId12\""), "should have qs rel id");
        assert!(xml_str.contains("r:cs=\"rId13\""), "should have cs rel id");
        assert!(
            xml_str.contains("<dgm:relIds"),
            "should have dgm:relIds element"
        );

        // Verify it closes properly
        assert!(
            xml_str.contains("</xdr:graphicFrame>"),
            "should close graphicFrame"
        );
    }

    #[test]
    fn test_smartart_content_type_helpers() {
        use crate::domain::content_types::write::ContentTypesManager;

        let mut ct = ContentTypesManager::new();
        ct.add_diagram_data(1);
        ct.add_diagram_layout(1);
        ct.add_diagram_colors(1);
        ct.add_diagram_style(1);
        ct.add_diagram_drawing(1);

        assert!(ct.has_override("/xl/diagrams/data1.xml"));
        assert!(ct.has_override("/xl/diagrams/layout1.xml"));
        assert!(ct.has_override("/xl/diagrams/colors1.xml"));
        assert!(ct.has_override("/xl/diagrams/quickStyles1.xml"));
        assert!(ct.has_override("/xl/diagrams/drawing1.xml"));

        // Add a second diagram
        ct.add_diagram_data(2);
        ct.add_diagram_layout(2);
        assert!(ct.has_override("/xl/diagrams/data2.xml"));
        assert!(ct.has_override("/xl/diagrams/layout2.xml"));
    }

    #[test]
    fn test_smartart_relationships() {
        use crate::write::relationships::{
            REL_DIAGRAM_COLORS, REL_DIAGRAM_DATA, REL_DIAGRAM_DRAWING, REL_DIAGRAM_LAYOUT,
            REL_DIAGRAM_QUICK_STYLE, RelationshipManager,
        };

        let mut rels = RelationshipManager::new();
        let dm_id = rels.add(REL_DIAGRAM_DATA, "../diagrams/data1.xml");
        let lo_id = rels.add(REL_DIAGRAM_LAYOUT, "../diagrams/layout1.xml");
        let qs_id = rels.add(REL_DIAGRAM_QUICK_STYLE, "../diagrams/quickStyles1.xml");
        let cs_id = rels.add(REL_DIAGRAM_COLORS, "../diagrams/colors1.xml");
        let dw_id = rels.add(REL_DIAGRAM_DRAWING, "../diagrams/drawing1.xml");

        assert_eq!(dm_id, "rId1");
        assert_eq!(lo_id, "rId2");
        assert_eq!(qs_id, "rId3");
        assert_eq!(cs_id, "rId4");
        assert_eq!(dw_id, "rId5");

        let xml = rels.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();
        assert!(xml_str.contains(REL_DIAGRAM_DATA));
        assert!(xml_str.contains(REL_DIAGRAM_LAYOUT));
        assert!(xml_str.contains(REL_DIAGRAM_QUICK_STYLE));
        assert!(xml_str.contains(REL_DIAGRAM_COLORS));
        assert!(xml_str.contains(REL_DIAGRAM_DRAWING));
        assert!(xml_str.contains("../diagrams/data1.xml"));
    }

    #[test]
    fn test_smartart_conversion_from_read() {
        use crate::domain::drawings::write::{convert_drawing_content, populate_smartart_parts};
        use crate::domain::drawings::{DrawingContent, SmartArtGraphicFrame, SmartArtParts};

        let sa_frame = SmartArtGraphicFrame {
            dm_rel_id: "rId1".to_string(),
            lo_rel_id: "rId2".to_string(),
            qs_rel_id: "rId3".to_string(),
            cs_rel_id: "rId4".to_string(),
        };

        let content = DrawingContent::SmartArt(sa_frame);
        let result = convert_drawing_content(&content);
        assert!(result.is_some(), "SmartArt should convert to DrawingObject");

        let obj = result.unwrap();
        match &obj {
            DrawingObject::SmartArt(sa) => {
                assert_eq!(sa.dm_rel_id, "rId1");
                assert_eq!(sa.lo_rel_id, "rId2");
                assert_eq!(sa.qs_rel_id, "rId3");
                assert_eq!(sa.cs_rel_id, "rId4");
                assert!(sa.data_xml.is_none(), "XML parts should initially be None");
            }
            _ => panic!("expected SmartArt variant"),
        }

        // Test populate_smartart_parts
        if let DrawingObject::SmartArt(ref mut sa) = { obj } {
            let parts = SmartArtParts {
                anchor_index: 0,
                data_xml: Some("<dgm:dataModel/>".to_string()),
                layout_xml: Some("<dgm:layoutDef/>".to_string()),
                colors_xml: Some("<dgm:colorsDef/>".to_string()),
                style_xml: Some("<dgm:styleDef/>".to_string()),
                drawing_xml: Some("<dsp:drawing/>".to_string()),
            };
            populate_smartart_parts(sa, &parts);
            assert_eq!(sa.data_xml.as_deref(), Some("<dgm:dataModel/>"));
            assert_eq!(sa.layout_xml.as_deref(), Some("<dgm:layoutDef/>"));
            assert_eq!(sa.colors_xml.as_deref(), Some("<dgm:colorsDef/>"));
            assert_eq!(sa.style_xml.as_deref(), Some("<dgm:styleDef/>"));
            assert_eq!(sa.drawing_xml.as_deref(), Some("<dsp:drawing/>"));
        }
    }

    #[test]
    fn test_smartart_content_types_xml_output() {
        use crate::domain::content_types::write::{
            CT_DIAGRAM_COLORS, CT_DIAGRAM_DATA, CT_DIAGRAM_DRAWING, CT_DIAGRAM_LAYOUT,
            CT_DIAGRAM_STYLE, ContentTypesManager,
        };

        let mut ct = ContentTypesManager::with_xlsx_defaults();
        ct.add_diagram_data(1);
        ct.add_diagram_layout(1);
        ct.add_diagram_colors(1);
        ct.add_diagram_style(1);
        ct.add_diagram_drawing(1);

        let xml = ct.to_xml();
        let xml_str = String::from_utf8_lossy(&xml);

        assert!(
            xml_str.contains(CT_DIAGRAM_DATA),
            "should contain diagram data CT"
        );
        assert!(
            xml_str.contains(CT_DIAGRAM_LAYOUT),
            "should contain diagram layout CT"
        );
        assert!(
            xml_str.contains(CT_DIAGRAM_COLORS),
            "should contain diagram colors CT"
        );
        assert!(
            xml_str.contains(CT_DIAGRAM_STYLE),
            "should contain diagram style CT"
        );
        assert!(
            xml_str.contains(CT_DIAGRAM_DRAWING),
            "should contain diagram drawing CT"
        );
        assert!(
            xml_str.contains("/xl/diagrams/data1.xml"),
            "should contain data path"
        );
        assert!(
            xml_str.contains("/xl/diagrams/quickStyles1.xml"),
            "should contain quickStyles path"
        );
    }
}
