use super::*;
use crate::domain::chart::ChartType;
use std::collections::BTreeMap;

fn make_common(id: &str, sheet_id: &str) -> FloatingObjectCommon {
    FloatingObjectCommon {
        id: id.to_string(),
        sheet_id: sheet_id.to_string(),
        anchor: FloatingObjectAnchor {
            anchor_row: 0,
            anchor_col: 0,
            anchor_row_offset: 0,
            anchor_col_offset: 0,
            anchor_mode: AnchorMode::OneCell,
            end_row: None,
            end_col: None,
            end_row_offset: None,
            end_col_offset: None,
            extent_cx: Some(5000000),
            extent_cy: Some(3000000),
        },
        width: 100.0,
        height: 50.0,
        z_index: 1,
        rotation: 0.0,
        flip_h: false,
        flip_v: false,
        locked: false,
        visible: true,
        printable: true,
        opacity: 1.0,
        name: "Test Object".to_string(),
        created_at: 1700000000000,
        updated_at: 1700000001000,
        group_id: None,
        anchor_cell_id: None,
        to_anchor_cell_id: None,
        lock_aspect_ratio: None,
        alt_text_title: None,
        display_name: None,
        import_status: None,
    }
}

#[test]
fn test_shape_round_trip() {
    let obj = FloatingObject {
        common: make_common("shape-1", "sheet-1"),
        data: FloatingObjectData::Shape(ShapeData {
            shape_type: "roundRect".to_string(),
            fill: Some(ObjectFill {
                fill_type: FillType::Solid,
                color: Some("#ff0000".to_string()),
                gradient: None,
                transparency: None,
                pattern: None,
                blip: None,
            }),
            outline: Some(ShapeOutline {
                style: OutlineStyle::Solid,
                color: "#000000".to_string(),
                width: 1.5,
                head_end: None,
                tail_end: None,
                dash: None,
                transparency: None,
                compound: None,
                visible: None,
            }),
            text: Some(ShapeText {
                content: "Hello".to_string(),
                format: None,
                runs: None,
                vertical_align: Some(VerticalAlign::Middle),
                horizontal_align: None,
                margins: None,
                auto_size: None,
                orientation: None,
                reading_order: None,
                horizontal_overflow: None,
                vertical_overflow: None,
                text_body: None,
            }),
            shadow: None,
            adjustments: None,
            scene_3d: None,
            sp_3d: None,
            ooxml: None,
        }),
    };
    let json = serde_json::to_value(&obj).unwrap();
    let restored: FloatingObject = serde_json::from_value(json.clone()).unwrap();
    assert_eq!(restored.common.id, "shape-1");
    assert_eq!(restored.object_type(), "shape");
    if let FloatingObjectData::Shape(ref s) = restored.data {
        assert_eq!(s.shape_type, "roundRect");
        assert_eq!(s.fill.as_ref().unwrap().fill_type, FillType::Solid);
    } else {
        panic!("Expected Shape variant");
    }
}

#[test]
fn test_picture_round_trip() {
    let obj = FloatingObject {
        common: make_common("pic-1", "sheet-1"),
        data: FloatingObjectData::Picture(PictureData {
            src: "https://example.com/img.png".to_string(),
            original_width: Some(800.0),
            original_height: Some(600.0),
            crop: Some(PictureCrop {
                top: 0.1,
                right: 0.0,
                bottom: 0.1,
                left: 0.0,
            }),
            adjustments: None,
            border: None,
            color_type: None,
            ooxml: None,
        }),
    };
    let json = serde_json::to_value(&obj).unwrap();
    let restored: FloatingObject = serde_json::from_value(json).unwrap();
    assert_eq!(restored.object_type(), "picture");
    if let FloatingObjectData::Picture(ref p) = restored.data {
        assert_eq!(p.src, "https://example.com/img.png");
        assert_eq!(p.original_width, Some(800.0));
    } else {
        panic!("Expected Picture variant");
    }
}

#[test]
fn test_chart_round_trip() {
    let obj = FloatingObject {
        common: make_common("chart-1", "sheet-1"),
        data: FloatingObjectData::Chart(ChartData {
            chart_type: ChartType::Bar,
            sub_type: None,
            series_orientation: None,
            data_range: None,
            data_range_identity: None,
            series_range: None,
            series_range_identity: None,
            category_range: None,
            category_range_identity: None,
            title: None,
            subtitle: None,
            legend: None,
            axis: None,
            colors: None,
            series: Some(vec![]),
            data_labels: None,
            pie_slice: None,
            trendline: None,
            show_lines: None,
            smooth_lines: None,
            radar_filled: None,
            radar_markers: None,
            waterfall: None,
            display_blanks_as: None,
            plot_visible_only: None,
            gap_width: None,
            overlap: None,
            doughnut_hole_size: None,
            first_slice_angle: None,
            bubble_scale: None,
            split_type: None,
            split_value: None,
            category_label_level: None,
            series_name_level: None,
            show_all_field_buttons: None,
            second_plot_size: None,
            vary_by_categories: None,
            title_h_align: None,
            title_v_align: None,
            title_show_shadow: None,
            pivot_options: None,
            bar_shape: None,
            bubble_3d_effect: None,
            wireframe: None,
            surface_top_view: None,
            color_scheme: None,
            height_pt: None,
            width_pt: None,
            left_pt: None,
            top_pt: None,
            style: None,
            rounded_corners: None,
            auto_title_deleted: None,
            show_data_labels_over_max: None,
            chart_format: None,
            plot_format: None,
            title_format: None,
            title_rich_text: None,
            title_formula: None,
            data_table: None,
            view_3d: None,
            floor_format: None,
            side_wall_format: None,
            back_wall_format: None,
            source_table_id: Some("table-1".to_string()),
            table_data_columns: None,
            table_category_column: None,
            use_table_column_names_as_labels: None,
            table_column_names: None,
            width_cells: Some(8.0),
            height_cells: Some(15.0),
            ooxml: None,
        }),
    };
    let json = serde_json::to_value(&obj).unwrap();
    let restored: FloatingObject = serde_json::from_value(json).unwrap();
    assert_eq!(restored.object_type(), "chart");
    if let FloatingObjectData::Chart(ref c) = restored.data {
        assert_eq!(c.chart_type, ChartType::Bar);
        assert_eq!(c.source_table_id.as_deref(), Some("table-1"));
    } else {
        panic!("Expected Chart variant");
    }
}

#[test]
fn test_connector_round_trip() {
    let obj = FloatingObject {
        common: make_common("conn-1", "sheet-1"),
        data: FloatingObjectData::Connector(ConnectorData {
            shape_type: "straightConnector1".to_string(),
            fill: None,
            outline: Some(ShapeOutline {
                style: OutlineStyle::Solid,
                color: "#000".to_string(),
                width: 1.0,
                head_end: None,
                tail_end: Some(LineEnd {
                    end_type: LineEndType::Triangle,
                    width: Some(LineEndSize::Med),
                    length: Some(LineEndSize::Med),
                }),
                dash: None,
                transparency: None,
                compound: None,
                visible: None,
            }),
            start_connection: Some(ConnectorBinding {
                shape_id: "shape-1".to_string(),
                site_index: 2,
            }),
            end_connection: Some(ConnectorBinding {
                shape_id: "shape-2".to_string(),
                site_index: 0,
            }),
            adjustments: None,
            ooxml: None,
        }),
    };
    let json = serde_json::to_value(&obj).unwrap();
    let restored: FloatingObject = serde_json::from_value(json).unwrap();
    assert_eq!(restored.object_type(), "connector");
    if let FloatingObjectData::Connector(ref c) = restored.data {
        assert_eq!(c.shape_type, "straightConnector1");
        assert_eq!(c.start_connection.as_ref().unwrap().shape_id, "shape-1");
    } else {
        panic!("Expected Connector variant");
    }
}

#[test]
fn test_textbox_round_trip() {
    let obj = FloatingObject {
        common: make_common("tb-1", "sheet-1"),
        data: FloatingObjectData::Textbox(TextboxData {
            text: Some(ShapeText {
                content: "Hello world".to_string(),
                format: None,
                runs: None,
                vertical_align: Some(VerticalAlign::Top),
                horizontal_align: None,
                margins: Some(TextMargins {
                    top: 5.0,
                    right: 5.0,
                    bottom: 5.0,
                    left: 5.0,
                }),
                auto_size: None,
                orientation: None,
                reading_order: None,
                horizontal_overflow: None,
                vertical_overflow: None,
                text_body: None,
            }),
            fill: None,
            border: None,
            text_effects: None,
            ooxml: None,
        }),
    };
    let json = serde_json::to_value(&obj).unwrap();
    let restored: FloatingObject = serde_json::from_value(json).unwrap();
    assert_eq!(restored.object_type(), "textbox");
    if let FloatingObjectData::Textbox(ref t) = restored.data {
        assert_eq!(
            t.text.as_ref().map(|t| t.content.as_str()),
            Some("Hello world")
        );
    } else {
        panic!("Expected Textbox variant");
    }
}

#[test]
fn test_equation_round_trip() {
    let obj = FloatingObject {
        common: make_common("eq-1", "sheet-1"),
        data: FloatingObjectData::Equation(EquationData {
            equation: "x^2 + y^2 = r^2".to_string(),
        }),
    };
    let json = serde_json::to_value(&obj).unwrap();
    let restored: FloatingObject = serde_json::from_value(json).unwrap();
    assert_eq!(restored.object_type(), "equation");
}

#[test]
fn test_diagram_round_trip() {
    let obj = FloatingObject {
        common: make_common("diagram-1", "sheet-1"),
        data: FloatingObjectData::Diagram(DiagramData {
            definition: crate::domain::smartart::SmartArtDefinition {
                dm_rel_id: Some("rId1".to_string()),
                ..Default::default()
            },
            category: Some(crate::domain::smartart::SmartArtCategory::Hierarchy),
        }),
    };
    let json = serde_json::to_value(&obj).unwrap();
    let restored: FloatingObject = serde_json::from_value(json).unwrap();
    assert_eq!(restored.object_type(), "diagram");
}

#[test]
fn test_ole_object_round_trip() {
    let obj = FloatingObject {
        common: make_common("ole-1", "sheet-1"),
        data: FloatingObjectData::OleObject(OleObjectData {
            prog_id: "Word.Document.12".to_string(),
            dv_aspect: "DVASPECT_CONTENT".to_string(),
            is_linked: false,
            is_embedded: true,
            preview_image_src: Some("preview.png".to_string()),
            alt_text: None,
            ooxml: None,
        }),
    };
    let json = serde_json::to_value(&obj).unwrap();
    let restored: FloatingObject = serde_json::from_value(json).unwrap();
    assert_eq!(restored.object_type(), "oleObject");
}

#[test]
fn test_form_control_round_trip() {
    let obj = FloatingObject {
        common: make_common("fc-1", "sheet-1"),
        data: FloatingObjectData::FormControl(FormControlData {
            control_type: "CheckBox".to_string(),
            cell_link: Some("$A$1".to_string()),
            input_range: None,
            ooxml: None,
        }),
    };
    let json = serde_json::to_value(&obj).unwrap();
    let restored: FloatingObject = serde_json::from_value(json).unwrap();
    assert_eq!(restored.object_type(), "formControl");
}

#[test]
fn test_camera_round_trip() {
    let obj = FloatingObject {
        common: make_common("cam-1", "sheet-1"),
        data: FloatingObjectData::Camera(CameraData {
            source_ref: "Sheet2!A1:D10".to_string(),
            error: None,
        }),
    };
    let json = serde_json::to_value(&obj).unwrap();
    let restored: FloatingObject = serde_json::from_value(json).unwrap();
    assert_eq!(restored.object_type(), "camera");
}

#[test]
fn test_drawing_round_trip() {
    let mut strokes = BTreeMap::new();
    strokes.insert(
        "stroke-1".to_string(),
        InkStroke {
            id: "stroke-1".to_string(),
            points: vec![
                InkPoint {
                    x: 10.0,
                    y: 20.0,
                    pressure: Some(0.5),
                    tilt: None,
                    timestamp: Some(1000.0),
                },
                InkPoint {
                    x: 30.0,
                    y: 40.0,
                    pressure: Some(0.7),
                    tilt: None,
                    timestamp: Some(1001.0),
                },
            ],
            tool: InkTool::Pen,
            color: "#000000".to_string(),
            width: 2.0,
            opacity: 1.0,
            created_by: "user-1".to_string(),
            created_at: 1234567890.0,
        },
    );

    let mut recognitions = BTreeMap::new();
    recognitions.insert(
        "rec-1".to_string(),
        RecognitionResult::Shape {
            shape_type: "rectangle".to_string(),
            params: ShapeRecognitionParams::Rectangle {
                x: 10.0,
                y: 20.0,
                width: 100.0,
                height: 50.0,
                rotation: 0.0,
                corner_radius: None,
            },
            source_stroke_ids: vec!["stroke-1".to_string()],
            confidence: 0.95,
            recognized_at: 1234567891.0,
        },
    );

    let obj = FloatingObject {
        common: make_common("dr-1", "sheet-1"),
        data: FloatingObjectData::Drawing(DrawingData {
            strokes,
            tool_state: InkToolState::default(),
            recognitions,
            background_color: Some("#ffffff".to_string()),
        }),
    };
    let json = serde_json::to_string(&obj).unwrap();
    let restored: FloatingObject = serde_json::from_str(&json).unwrap();
    assert_eq!(obj, restored);
}

#[test]
fn test_flat_json_structure() {
    let obj = FloatingObject {
        common: make_common("shape-flat", "sheet-1"),
        data: FloatingObjectData::Shape(ShapeData {
            shape_type: "rect".to_string(),
            fill: None,
            outline: None,
            text: None,
            shadow: None,
            adjustments: None,
            scene_3d: None,
            sp_3d: None,
            ooxml: None,
        }),
    };
    let json = serde_json::to_value(&obj).unwrap();
    let map = json.as_object().unwrap();

    // Common fields at top level
    assert!(map.contains_key("id"));
    assert!(map.contains_key("sheetId"));
    assert!(map.contains_key("anchor"));
    assert!(map.contains_key("width"));
    assert!(map.contains_key("height"));
    assert!(map.contains_key("zIndex"));

    // Type tag at top level
    assert_eq!(map.get("type").unwrap(), "shape");

    // Data fields at top level
    assert!(map.contains_key("shapeType"));

    // No "common" or "data" wrapper keys
    assert!(!map.contains_key("common"));
    assert!(!map.contains_key("data"));
}

#[test]
fn test_anchor_mode_serialization() {
    assert_eq!(
        serde_json::to_string(&AnchorMode::OneCell).unwrap(),
        r#""oneCell""#
    );
    assert_eq!(
        serde_json::to_string(&AnchorMode::TwoCell).unwrap(),
        r#""twoCell""#
    );
    assert_eq!(
        serde_json::to_string(&AnchorMode::Absolute).unwrap(),
        r#""absolute""#
    );

    let am: AnchorMode = serde_json::from_str(r#""twoCell""#).unwrap();
    assert_eq!(am, AnchorMode::TwoCell);
}

#[test]
fn test_field_name_uniqueness() {
    // Serialize FloatingObjectCommon to get its keys
    let common = make_common("test", "sheet");
    let common_val = serde_json::to_value(&common).unwrap();
    let common_keys: std::collections::HashSet<String> =
        common_val.as_object().unwrap().keys().cloned().collect();

    // Check ShapeData keys don't overlap with common keys (except "type" is only in data)
    let shape = ShapeData {
        shape_type: "rect".to_string(),
        fill: None,
        outline: None,
        text: None,
        shadow: None,
        adjustments: None,
        scene_3d: None,
        sp_3d: None,
        ooxml: None,
    };
    let shape_val = serde_json::to_value(&FloatingObjectData::Shape(shape)).unwrap();
    let shape_keys: std::collections::HashSet<String> = shape_val
        .as_object()
        .unwrap()
        .keys()
        .filter(|k| *k != "type")
        .cloned()
        .collect();
    let overlap: Vec<_> = common_keys.intersection(&shape_keys).collect();
    assert!(
        overlap.is_empty(),
        "Overlapping keys between common and shape: {:?}",
        overlap
    );

    // Check PictureData keys
    let pic = PictureData {
        src: "x".to_string(),
        original_width: None,
        original_height: None,
        crop: None,
        adjustments: None,
        border: None,
        color_type: None,
        ooxml: None,
    };
    let pic_val = serde_json::to_value(&FloatingObjectData::Picture(pic)).unwrap();
    let pic_keys: std::collections::HashSet<String> = pic_val
        .as_object()
        .unwrap()
        .keys()
        .filter(|k| *k != "type")
        .cloned()
        .collect();
    let overlap: Vec<_> = common_keys.intersection(&pic_keys).collect();
    assert!(
        overlap.is_empty(),
        "Overlapping keys between common and picture: {:?}",
        overlap
    );

    // Check ChartData keys
    let chart = ChartData {
        chart_type: ChartType::Bar,
        sub_type: None,
        series_orientation: None,
        data_range: None,
        data_range_identity: None,
        series_range: None,
        series_range_identity: None,
        category_range: None,
        category_range_identity: None,
        title: None,
        subtitle: None,
        legend: None,
        axis: None,
        colors: None,
        series: None,
        data_labels: None,
        pie_slice: None,
        trendline: None,
        show_lines: None,
        smooth_lines: None,
        radar_filled: None,
        radar_markers: None,
        waterfall: None,
        display_blanks_as: None,
        plot_visible_only: None,
        gap_width: None,
        overlap: None,
        doughnut_hole_size: None,
        first_slice_angle: None,
        bubble_scale: None,
        split_type: None,
        split_value: None,
        category_label_level: None,
        series_name_level: None,
        show_all_field_buttons: None,
        second_plot_size: None,
        vary_by_categories: None,
        title_h_align: None,
        title_v_align: None,
        title_show_shadow: None,
        pivot_options: None,
        bar_shape: None,
        bubble_3d_effect: None,
        wireframe: None,
        surface_top_view: None,
        color_scheme: None,
        height_pt: None,
        width_pt: None,
        left_pt: None,
        top_pt: None,
        style: None,
        rounded_corners: None,
        auto_title_deleted: None,
        show_data_labels_over_max: None,
        chart_format: None,
        plot_format: None,
        title_format: None,
        title_rich_text: None,
        title_formula: None,
        data_table: None,
        view_3d: None,
        floor_format: None,
        side_wall_format: None,
        back_wall_format: None,
        source_table_id: None,
        table_data_columns: None,
        table_category_column: None,
        use_table_column_names_as_labels: None,
        table_column_names: None,
        width_cells: None,
        height_cells: None,
        ooxml: None,
    };
    let chart_val = serde_json::to_value(&FloatingObjectData::Chart(chart)).unwrap();
    let chart_keys: std::collections::HashSet<String> = chart_val
        .as_object()
        .unwrap()
        .keys()
        .filter(|k| *k != "type")
        .cloned()
        .collect();
    let overlap: Vec<_> = common_keys.intersection(&chart_keys).collect();
    assert!(
        overlap.is_empty(),
        "Overlapping keys between common and chart: {:?}",
        overlap
    );

    // Check ConnectorData keys
    let conn = ConnectorData {
        shape_type: "x".to_string(),
        fill: None,
        outline: None,
        start_connection: None,
        end_connection: None,
        adjustments: None,
        ooxml: None,
    };
    let conn_val = serde_json::to_value(&FloatingObjectData::Connector(conn)).unwrap();
    let conn_keys: std::collections::HashSet<String> = conn_val
        .as_object()
        .unwrap()
        .keys()
        .filter(|k| *k != "type")
        .cloned()
        .collect();
    let overlap: Vec<_> = common_keys.intersection(&conn_keys).collect();
    assert!(
        overlap.is_empty(),
        "Overlapping keys between common and connector: {:?}",
        overlap
    );
}

#[test]
fn test_sub_types_match_snapshot_types() {
    // ObjectFill round-trip
    let json = r##"{"type":"solid","color":"#4285f4"}"##;
    let fill: ObjectFill = serde_json::from_str(json).unwrap();
    assert_eq!(fill.fill_type, FillType::Solid);
    assert_eq!(fill.color.as_deref(), Some("#4285f4"));
    let back = serde_json::to_string(&fill).unwrap();
    assert_eq!(back, json);

    // GradientFill round-trip
    let json = r##"{"type":"linear","stops":[{"offset":0.0,"color":"#ff0000"},{"offset":1.0,"color":"#0000ff"}],"angle":90.0}"##;
    let gf: GradientFill = serde_json::from_str(json).unwrap();
    assert_eq!(gf.gradient_type, GradientType::Linear);
    assert_eq!(gf.stops.len(), 2);
    let back = serde_json::to_string(&gf).unwrap();
    assert_eq!(back, json);

    // ShapeOutline round-trip
    let json = r##"{"style":"solid","color":"#000000","width":1.5}"##;
    let outline: ShapeOutline = serde_json::from_str(json).unwrap();
    assert_eq!(outline.style, OutlineStyle::Solid);
    let back = serde_json::to_string(&outline).unwrap();
    assert_eq!(back, json);

    // LineEnd round-trip
    let json = r#"{"type":"triangle","width":"sm","length":"lg"}"#;
    let le: LineEnd = serde_json::from_str(json).unwrap();
    assert_eq!(le.end_type, LineEndType::Triangle);
    let back = serde_json::to_string(&le).unwrap();
    assert_eq!(back, json);

    // ShapeText round-trip
    let json = r#"{"content":"Hello","verticalAlign":"middle"}"#;
    let text: ShapeText = serde_json::from_str(json).unwrap();
    assert_eq!(text.content, "Hello");
    let back = serde_json::to_string(&text).unwrap();
    assert_eq!(back, json);

    // OuterShadowEffect round-trip
    let json = r##"{"blurRadius":40000.0,"distance":20000.0,"direction":315.0,"color":"#000000","opacity":0.4}"##;
    let shadow: OuterShadowEffect = serde_json::from_str(json).unwrap();
    assert!((shadow.blur_radius - 40000.0).abs() < f64::EPSILON);
    let back = serde_json::to_string(&shadow).unwrap();
    assert_eq!(back, json);

    // ConnectorBinding round-trip
    let json = r#"{"shapeId":"shape-1","siteIndex":2}"#;
    let cb: ConnectorBinding = serde_json::from_str(json).unwrap();
    assert_eq!(cb.shape_id, "shape-1");
    let back = serde_json::to_string(&cb).unwrap();
    assert_eq!(back, json);

    // ShadowAlignment round-trip
    let sa: ShadowAlignment = serde_json::from_str(r#""ctr""#).unwrap();
    assert_eq!(sa, ShadowAlignment::Center);
    assert_eq!(
        serde_json::to_string(&ShadowAlignment::BottomRight).unwrap(),
        r#""br""#
    );
}

#[test]
fn test_slicer_round_trip() {
    let obj = FloatingObject {
        common: make_common("slicer-1", "sheet-1"),
        data: FloatingObjectData::Slicer(SlicerData::default()),
    };
    let json = serde_json::to_value(&obj).unwrap();
    // Verify the type tag is "slicer"
    assert_eq!(json.get("type").unwrap(), "slicer");
    let restored: FloatingObject = serde_json::from_value(json).unwrap();
    assert_eq!(restored.object_type(), "slicer");
    assert_eq!(restored.common.id, "slicer-1");
    assert!(matches!(restored.data, FloatingObjectData::Slicer(_)));
    // Verify round-trip stability
    let restored2: FloatingObject =
        serde_json::from_value(serde_json::to_value(&restored).unwrap()).unwrap();
    assert_eq!(restored, restored2);
}

#[test]
fn test_drawing_data_serde_round_trip() {
    let mut strokes = BTreeMap::new();
    strokes.insert(
        "s1".to_string(),
        InkStroke {
            id: "s1".to_string(),
            points: vec![
                InkPoint {
                    x: 0.0,
                    y: 0.0,
                    pressure: None,
                    tilt: None,
                    timestamp: None,
                },
                InkPoint {
                    x: 10.0,
                    y: 10.0,
                    pressure: Some(0.5),
                    tilt: Some(45.0),
                    timestamp: Some(100.0),
                },
            ],
            tool: InkTool::Highlighter,
            color: "#ff0000".to_string(),
            width: 5.0,
            opacity: 0.5,
            created_by: "user-a".to_string(),
            created_at: 999.0,
        },
    );

    let mut recognitions = BTreeMap::new();
    recognitions.insert(
        "r1".to_string(),
        RecognitionResult::Text {
            text: "Hello".to_string(),
            alternatives: vec![TextAlternative {
                text: "Hello".to_string(),
                confidence: 0.99,
            }],
            source_stroke_ids: vec!["s1".to_string()],
            bounds: RecognitionBounds {
                x: 0.0,
                y: 0.0,
                width: 50.0,
                height: 20.0,
            },
            recognized_at: 1000.0,
        },
    );

    let data = DrawingData {
        strokes,
        tool_state: InkToolState {
            active_tool: InkTool::Highlighter,
            tool_settings: {
                let mut m = BTreeMap::new();
                m.insert(
                    "highlighter".to_string(),
                    InkToolSettings {
                        width: 5.0,
                        opacity: 0.5,
                        color: "#ff0000".to_string(),
                        supports_pressure: false,
                    },
                );
                m
            },
        },
        recognitions,
        background_color: Some("#eee".to_string()),
    };

    let json = serde_json::to_string_pretty(&data).unwrap();
    let restored: DrawingData = serde_json::from_str(&json).unwrap();
    assert_eq!(data, restored);
}

#[test]
fn test_drawing_data_default() {
    let data = DrawingData::default();
    assert!(data.strokes.is_empty());
    assert!(data.recognitions.is_empty());
    assert_eq!(data.tool_state.active_tool, InkTool::Pen);
    assert!(data.background_color.is_none());

    // Default should round-trip through JSON
    let json = serde_json::to_string(&data).unwrap();
    let restored: DrawingData = serde_json::from_str(&json).unwrap();
    assert_eq!(data, restored);
}

// ── Typed-struct serde round-trip tests ─────────────────────

#[test]
fn test_shape_text_cellformat_roundtrip() {
    use crate::CellFormat;

    let st = ShapeText {
        content: "Bold text".to_string(),
        format: Some(CellFormat {
            bold: Some(true),
            italic: Some(false),
            font_family: Some("Calibri".to_string()),
            ..Default::default()
        }),
        runs: None,
        vertical_align: Some(VerticalAlign::Middle),
        horizontal_align: None,
        margins: None,
        auto_size: None,
        orientation: None,
        reading_order: None,
        horizontal_overflow: None,
        vertical_overflow: None,
        text_body: None,
    };
    let json = serde_json::to_string(&st).unwrap();
    let restored: ShapeText = serde_json::from_str(&json).unwrap();
    assert_eq!(st, restored);
    assert_eq!(restored.format.as_ref().unwrap().bold, Some(true));
    assert_eq!(
        restored.format.as_ref().unwrap().font_family.as_deref(),
        Some("Calibri"),
    );
}

#[test]
fn test_textbox_text_effects_config_roundtrip() {
    use crate::domain::text_effects::{
        LineDash, TextEffectConfig, TextEffectFill, TextEffectOutline, TextWarpPreset,
    };

    let tb = TextboxData {
        text: Some(ShapeText {
            content: "Art".to_string(),
            format: None,
            runs: None,
            vertical_align: None,
            horizontal_align: None,
            margins: None,
            auto_size: None,
            orientation: None,
            reading_order: None,
            horizontal_overflow: None,
            vertical_overflow: None,
            text_body: None,
        }),
        fill: None,
        border: None,
        text_effects: Some(TextEffectConfig {
            warp_preset: TextWarpPreset::TextArchUp,
            warp_adjustments: None,
            fill: TextEffectFill::Solid {
                color: "#ff0000".to_string(),
                opacity: Some(0.9),
            },
            outline: Some(TextEffectOutline {
                width: 2.0,
                color: "#000000".to_string(),
                opacity: None,
                dash: Some(LineDash::Solid),
                cap: None,
                join: None,
                miter_limit: None,
                compound: None,
            }),
            effects: None,
            follow_path: Some(true),
            anchor: None,
            text_direction: None,
            normalize_heights: None,
        }),
        ooxml: None,
    };
    let json = serde_json::to_string(&tb).unwrap();
    let restored: TextboxData = serde_json::from_str(&json).unwrap();
    assert_eq!(tb, restored);

    // Verify nested discriminated-union tag survives round-trip
    let val: serde_json::Value = serde_json::from_str(&json).unwrap();
    let text_effects = val.get("textEffects").unwrap();
    assert_eq!(text_effects["fill"]["type"], "solid");
    assert_eq!(text_effects["warpPreset"], "textArchUp");
}

#[test]
fn test_diagram_definition_roundtrip() {
    use crate::domain::smartart::{SmartArtCategory, SmartArtDefinition};

    let diagram = DiagramData {
        definition: SmartArtDefinition {
            original_id: Some(42),
            dm_rel_id: Some("rId1".to_string()),
            lo_rel_id: Some("rId2".to_string()),
            qs_rel_id: None,
            cs_rel_id: None,
            data_xml: Some("<dgm:dataModel/>".to_string()),
            layout_xml: None,
            colors_xml: None,
            style_xml: None,
            drawing_xml: None,
        },
        category: Some(SmartArtCategory::Hierarchy),
    };
    let json = serde_json::to_string(&diagram).unwrap();
    let restored: DiagramData = serde_json::from_str(&json).unwrap();
    assert_eq!(diagram, restored);
    assert_eq!(restored.definition.dm_rel_id.as_deref(), Some("rId1"));
    assert_eq!(restored.definition.original_id, Some(42));
    assert_eq!(restored.category, Some(SmartArtCategory::Hierarchy));
}

#[test]
fn test_diagram_data_roundtrip_with_category() {
    let json = r#"{"definition": {"dmRelId": "rId1", "loRelId": "rId2", "dataXml": "<dgm:dataModel/>"}, "category": "hierarchy"}"#;
    let diagram: DiagramData = serde_json::from_str(json).unwrap();

    assert_eq!(
        diagram.category,
        Some(crate::domain::smartart::SmartArtCategory::Hierarchy),
    );
    assert_eq!(diagram.definition.dm_rel_id.as_deref(), Some("rId1"));
    assert_eq!(diagram.definition.lo_rel_id.as_deref(), Some("rId2"));
    assert_eq!(
        diagram.definition.data_xml.as_deref(),
        Some("<dgm:dataModel/>"),
    );
    assert_eq!(diagram.definition.qs_rel_id, None);
    assert_eq!(diagram.definition.original_id, None);
}

#[test]
fn test_smartart_definition_default_serializes_empty() {
    let def = crate::domain::smartart::SmartArtDefinition::default();
    let json = serde_json::to_string(&def).unwrap();
    assert_eq!(json, "{}");
}
