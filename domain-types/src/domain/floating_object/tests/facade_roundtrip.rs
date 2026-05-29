use crate::domain::chart::ChartType;
use crate::domain::floating_object::{
    CameraData, ChartData, ConnectorBinding, ConnectorData, DiagramData, EquationData, FillType,
    FloatingObject, FloatingObjectData, FloatingObjectKind, FormControlData, InkPoint, InkStroke,
    InkTool, InkToolState, LineEnd, LineEndSize, LineEndType, OleObjectData, OutlineStyle,
    PictureCrop, PictureData, RecognitionResult, ShapeData, ShapeOutline, ShapeRecognitionParams,
    ShapeText, SlicerData, TextMargins, TextboxData, VerticalAlign,
};
use std::collections::BTreeMap;

use super::helpers::{make_common, minimal_data_variants};

#[test]
fn test_shape_round_trip() {
    let obj = FloatingObject {
        common: make_common("shape-1", "sheet-1"),
        data: FloatingObjectData::Shape(ShapeData {
            shape_type: "roundRect".to_string(),
            fill: Some(crate::domain::floating_object::ObjectFill {
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
        data: FloatingObjectData::Drawing(crate::domain::floating_object::DrawingData {
            strokes,
            tool_state: InkToolState::default(),
            recognitions,
            background_color: Some("#ffffff".to_string()),
            ooxml: None,
        }),
    };
    let json = serde_json::to_string(&obj).unwrap();
    let restored: FloatingObject = serde_json::from_str(&json).unwrap();
    assert_eq!(obj, restored);
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
fn test_kind_tags_match_data_variants() {
    for (expected_tag, data) in minimal_data_variants() {
        let kind = FloatingObjectKind::from(&data);
        assert_eq!(kind.as_str(), expected_tag);

        let obj = FloatingObject {
            common: make_common(expected_tag, "sheet-1"),
            data,
        };
        let json = serde_json::to_value(&obj).unwrap();
        assert_eq!(json.get("type").unwrap(), expected_tag);
        assert_eq!(obj.object_type(), expected_tag);
    }
}
