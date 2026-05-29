use std::collections::{BTreeMap, HashMap};

use crate::ImportObjectStatus;
use crate::domain::chart::ChartType;
use crate::domain::floating_object::*;
use crate::domain::smartart::{SmartArtCategory, SmartArtDefinition};
use crate::domain::text_effects::{
    LineDash, TextEffectConfig, TextEffectFill, TextEffectOutline, TextWarpPreset,
};

pub(super) fn make_common(id: &str, sheet_id: &str) -> FloatingObjectCommon {
    FloatingObjectCommon {
        id: id.to_string(),
        sheet_id: sheet_id.to_string(),
        anchor: FloatingObjectAnchor {
            anchor_row: 0,
            anchor_col: 0,
            anchor_row_offset: 0,
            anchor_col_offset: 0,
            anchor_mode: AnchorMode::OneCell,
            absolute_x: None,
            absolute_y: None,
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

pub(super) fn maximal_common(id: &str, sheet_id: &str) -> FloatingObjectCommon {
    FloatingObjectCommon {
        group_id: Some("group-1".to_string()),
        anchor_cell_id: Some("cell-1".to_string()),
        to_anchor_cell_id: Some("cell-2".to_string()),
        lock_aspect_ratio: Some(true),
        alt_text_title: Some("Alt title".to_string()),
        display_name: Some("Display name".to_string()),
        import_status: Some(ImportObjectStatus::default()),
        ..make_common(id, sheet_id)
    }
}

pub(super) fn solid_fill(color: &str) -> ObjectFill {
    ObjectFill {
        fill_type: FillType::Solid,
        color: Some(color.to_string()),
        gradient: None,
        transparency: Some(0.25),
        pattern: None,
        blip: None,
    }
}

pub(super) fn outline() -> ShapeOutline {
    ShapeOutline {
        style: OutlineStyle::Solid,
        color: "#000000".to_string(),
        width: 1.5,
        head_end: Some(LineEnd {
            end_type: LineEndType::Triangle,
            width: Some(LineEndSize::Sm),
            length: Some(LineEndSize::Lg),
        }),
        tail_end: Some(LineEnd {
            end_type: LineEndType::Diamond,
            width: Some(LineEndSize::Med),
            length: Some(LineEndSize::Med),
        }),
        dash: Some(LineDash::Dash),
        transparency: Some(0.1),
        compound: Some(CompoundLineStyle::Single),
        visible: Some(true),
    }
}

pub(super) fn shape_text(content: &str) -> ShapeText {
    ShapeText {
        content: content.to_string(),
        format: None,
        runs: None,
        vertical_align: Some(VerticalAlign::Middle),
        horizontal_align: Some(HorizontalAlign::Center),
        margins: Some(TextMargins {
            top: 5.0,
            right: 5.0,
            bottom: 5.0,
            left: 5.0,
        }),
        auto_size: Some(TextAutoSize::ShapeToFitText),
        orientation: Some(TextOrientation::Horizontal),
        reading_order: Some(TextReadingOrder::LeftToRight),
        horizontal_overflow: Some(TextOverflow::Clip),
        vertical_overflow: Some(TextOverflow::Overflow),
        text_body: None,
    }
}

pub(super) fn shape_data_full() -> ShapeData {
    ShapeData {
        shape_type: "roundRect".to_string(),
        fill: Some(solid_fill("#ff0000")),
        outline: Some(outline()),
        text: Some(shape_text("Hello")),
        shadow: Some(OuterShadowEffect {
            blur_radius: 40000.0,
            distance: 20000.0,
            direction: 315.0,
            color: "#000000".to_string(),
            opacity: 0.4,
            scale_x: Some(1.0),
            scale_y: Some(1.0),
            skew_x: Some(0.0),
            skew_y: Some(0.0),
            alignment: Some(ShadowAlignment::BottomRight),
            rotate_with_shape: Some(true),
        }),
        adjustments: Some(HashMap::from([("adj".to_string(), 0.5)])),
        scene_3d: None,
        sp_3d: None,
        ooxml: Some(ShapeOoxmlProps::default()),
    }
}

pub(super) fn connector_data_full() -> ConnectorData {
    ConnectorData {
        shape_type: "straightConnector1".to_string(),
        fill: Some(solid_fill("#00ff00")),
        outline: Some(outline()),
        start_connection: Some(ConnectorBinding {
            shape_id: "shape-1".to_string(),
            site_index: 2,
        }),
        end_connection: Some(ConnectorBinding {
            shape_id: "shape-2".to_string(),
            site_index: 0,
        }),
        adjustments: Some(HashMap::from([("bend".to_string(), 1.0)])),
        ooxml: Some(ConnectorOoxmlProps::default()),
    }
}

pub(super) fn picture_data_full() -> PictureData {
    PictureData {
        src: "https://example.com/img.png".to_string(),
        original_width: Some(800.0),
        original_height: Some(600.0),
        crop: Some(PictureCrop {
            top: 0.1,
            right: 0.0,
            bottom: 0.1,
            left: 0.0,
        }),
        adjustments: Some(PictureAdjustments {
            brightness: Some(0.2),
            contrast: Some(0.3),
            transparency: Some(0.4),
        }),
        border: Some(outline()),
        color_type: Some(ImageColorType::GrayScale),
        ooxml: Some(PictureOoxmlProps::default()),
    }
}

pub(super) fn textbox_data_full() -> TextboxData {
    TextboxData {
        text: Some(shape_text("Hello world")),
        fill: Some(solid_fill("#ffffff")),
        border: Some(outline()),
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
        ooxml: Some(ShapeOoxmlProps::default()),
    }
}

pub(super) fn chart_data_with_optional_keys() -> ChartData {
    ChartData {
        chart_type: ChartType::Bar,
        sub_type: None,
        series_orientation: None,
        data_range: Some("Sheet1!A1:B2".to_string()),
        data_range_identity: None,
        series_range: Some("Sheet1!B1:B2".to_string()),
        series_range_identity: None,
        category_range: Some("Sheet1!A1:A2".to_string()),
        category_range_identity: None,
        title: Some("Chart".to_string()),
        subtitle: Some("Subtitle".to_string()),
        legend: None,
        axis: None,
        colors: Some(vec!["#ff0000".to_string(), "#00ff00".to_string()]),
        series: Some(vec![]),
        data_labels: None,
        pie_slice: None,
        trendline: Some(vec![]),
        show_lines: Some(true),
        smooth_lines: Some(false),
        radar_filled: Some(false),
        radar_markers: Some(true),
        waterfall: None,
        display_blanks_as: Some("gap".to_string()),
        plot_visible_only: Some(true),
        gap_width: Some(150),
        overlap: Some(0),
        doughnut_hole_size: Some(50),
        first_slice_angle: Some(0),
        bubble_scale: Some(100),
        split_type: Some("auto".to_string()),
        split_value: Some(1.0),
        category_label_level: Some(0),
        series_name_level: Some(0),
        show_all_field_buttons: Some(false),
        second_plot_size: Some(75),
        vary_by_categories: Some(true),
        title_h_align: Some("center".to_string()),
        title_v_align: Some("top".to_string()),
        title_show_shadow: Some(false),
        pivot_options: None,
        bar_shape: Some("box".to_string()),
        bubble_3d_effect: Some(false),
        wireframe: Some(false),
        surface_top_view: Some(false),
        color_scheme: Some(1),
        height_pt: Some(100.0),
        width_pt: Some(200.0),
        left_pt: Some(10.0),
        top_pt: Some(20.0),
        style: Some(2),
        rounded_corners: Some(true),
        auto_title_deleted: Some(false),
        show_data_labels_over_max: Some(false),
        chart_format: None,
        plot_format: None,
        title_format: None,
        title_rich_text: Some(vec![]),
        title_formula: Some("Sheet1!A1".to_string()),
        data_table: None,
        view_3d: None,
        floor_format: None,
        side_wall_format: None,
        back_wall_format: None,
        source_table_id: Some("table-1".to_string()),
        table_data_columns: Some(vec!["Amount".to_string()]),
        table_category_column: Some("Category".to_string()),
        use_table_column_names_as_labels: Some(true),
        table_column_names: Some(vec!["Category".to_string(), "Amount".to_string()]),
        width_cells: Some(8.0),
        height_cells: Some(15.0),
        ooxml: Some(ChartOoxmlProps::default()),
    }
}

pub(super) fn drawing_data_full() -> DrawingData {
    let mut strokes = BTreeMap::new();
    strokes.insert(
        "stroke-1".to_string(),
        InkStroke {
            id: "stroke-1".to_string(),
            points: vec![InkPoint {
                x: 10.0,
                y: 20.0,
                pressure: Some(0.5),
                tilt: Some(45.0),
                timestamp: Some(1000.0),
            }],
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
                corner_radius: Some(4.0),
            },
            source_stroke_ids: vec!["stroke-1".to_string()],
            confidence: 0.95,
            recognized_at: 1234567891.0,
        },
    );

    DrawingData {
        strokes,
        tool_state: InkToolState::default(),
        recognitions,
        background_color: Some("#ffffff".to_string()),
        ooxml: None,
    }
}

pub(super) fn diagram_data_with_category() -> DiagramData {
    DiagramData {
        definition: SmartArtDefinition {
            original_id: Some(42),
            dm_rel_id: Some("rId1".to_string()),
            lo_rel_id: Some("rId2".to_string()),
            data_xml: Some("<dgm:dataModel/>".to_string()),
            ..Default::default()
        },
        category: Some(SmartArtCategory::Hierarchy),
    }
}

pub(super) fn minimal_data_variants() -> Vec<(&'static str, FloatingObjectData)> {
    vec![
        ("shape", FloatingObjectData::Shape(shape_data_full())),
        (
            "connector",
            FloatingObjectData::Connector(connector_data_full()),
        ),
        ("picture", FloatingObjectData::Picture(picture_data_full())),
        ("textbox", FloatingObjectData::Textbox(textbox_data_full())),
        (
            "chart",
            FloatingObjectData::Chart(chart_data_with_optional_keys()),
        ),
        (
            "camera",
            FloatingObjectData::Camera(CameraData {
                source_ref: "Sheet2!A1:D10".to_string(),
                error: Some("#REF!".to_string()),
            }),
        ),
        (
            "equation",
            FloatingObjectData::Equation(EquationData {
                equation: "x^2 + y^2 = r^2".to_string(),
            }),
        ),
        (
            "diagram",
            FloatingObjectData::Diagram(diagram_data_with_category()),
        ),
        ("drawing", FloatingObjectData::Drawing(drawing_data_full())),
        (
            "oleObject",
            FloatingObjectData::OleObject(OleObjectData {
                prog_id: "Word.Document.12".to_string(),
                dv_aspect: "DVASPECT_CONTENT".to_string(),
                is_linked: false,
                is_embedded: true,
                preview_image_src: Some("preview.png".to_string()),
                alt_text: Some("Embedded Word document".to_string()),
                ooxml: Some(OleObjectOoxmlProps::default()),
            }),
        ),
        (
            "formControl",
            FloatingObjectData::FormControl(FormControlData {
                control_type: "CheckBox".to_string(),
                cell_link: Some("$A$1".to_string()),
                input_range: Some("$A$1:$A$5".to_string()),
                ooxml: Some(FormControlOoxmlProps::default()),
            }),
        ),
        ("slicer", FloatingObjectData::Slicer(SlicerData::default())),
    ]
}
