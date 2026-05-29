use super::*;

use std::collections::BTreeMap;
use std::sync::Arc;
use yrs::Any;

use crate::domain::floating_object::*;
use crate::domain::smartart::*;
use yrs::{Doc, Map, MapPrelim, Transact};

/// Macro to perform a Yrs round-trip test.
macro_rules! yrs_roundtrip {
    ($obj:expr) => {{
        let doc = Doc::new();
        let root = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            let entries = to_yrs_prelim($obj);
            let prelim: MapPrelim = entries.into_iter().collect();
            root.insert(&mut txn, "item", prelim);
        }
        let txn = doc.transact();
        let map_ref = root
            .get(&txn, "item")
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap();
        from_yrs_map(&map_ref, &txn).unwrap()
    }};
}

fn make_common(id: &str, sheet_id: &str) -> FloatingObjectCommon {
    FloatingObjectCommon {
        id: id.to_string(),
        sheet_id: sheet_id.to_string(),
        anchor: FloatingObjectAnchor {
            anchor_row: 5,
            anchor_col: 3,
            anchor_row_offset: 12700,
            anchor_col_offset: 25400,
            anchor_mode: AnchorMode::TwoCell,
            absolute_x: None,
            absolute_y: None,
            end_row: Some(20),
            end_col: Some(8),
            end_row_offset: Some(0),
            end_col_offset: Some(50800),
            extent_cx: None,
            extent_cy: None,
        },
        width: 600.5,
        height: 400.25,
        z_index: 3,
        rotation: 45.0,
        flip_h: true,
        flip_v: false,
        locked: true,
        visible: true,
        printable: true,
        opacity: 0.9,
        name: "Test Object".to_string(),
        created_at: 1700000000000,
        updated_at: 1700000001000,
        group_id: Some("group-1".to_string()),
        anchor_cell_id: Some("cell-A1".to_string()),
        to_anchor_cell_id: Some("cell-D10".to_string()),
        lock_aspect_ratio: None,
        alt_text_title: None,
        display_name: None,
        import_status: None,
    }
}

#[test]
fn test_to_yrs_prelim_writes_unit_explicit_anchor_keys() {
    let obj = FloatingObject {
        common: make_common("shape-1", "sheet-1"),
        data: FloatingObjectData::Shape(ShapeData {
            shape_type: "rect".to_string(),
            ..Default::default()
        }),
    };

    let entries = to_yrs_prelim(&obj);
    assert!(entries.iter().any(|(k, _)| k == KEY_ANCHOR_ROW_OFFSET_EMU));
    assert!(entries.iter().any(|(k, _)| k == KEY_ANCHOR_COL_OFFSET_EMU));
    assert!(entries.iter().any(|(k, _)| k == KEY_END_ROW_OFFSET_EMU));
    assert!(entries.iter().any(|(k, _)| k == KEY_END_COL_OFFSET_EMU));
    assert!(!entries.iter().any(|(k, _)| k == "anchorRowOffset"));
    assert!(!entries.iter().any(|(k, _)| k == "anchorColOffset"));
    assert!(!entries.iter().any(|(k, _)| k == "endRowOffset"));
    assert!(!entries.iter().any(|(k, _)| k == "endColOffset"));
}

fn assert_common_eq(a: &FloatingObjectCommon, b: &FloatingObjectCommon) {
    assert_eq!(a.id, b.id);
    assert_eq!(a.sheet_id, b.sheet_id);
    assert_eq!(a.anchor.anchor_row, b.anchor.anchor_row);
    assert_eq!(a.anchor.anchor_col, b.anchor.anchor_col);
    assert_eq!(a.anchor.anchor_row_offset, b.anchor.anchor_row_offset);
    assert_eq!(a.anchor.anchor_col_offset, b.anchor.anchor_col_offset);
    assert_eq!(a.anchor.anchor_mode, b.anchor.anchor_mode);
    assert_eq!(a.anchor.absolute_x, b.anchor.absolute_x);
    assert_eq!(a.anchor.absolute_y, b.anchor.absolute_y);
    assert_eq!(a.anchor.end_row, b.anchor.end_row);
    assert_eq!(a.anchor.end_col, b.anchor.end_col);
    assert_eq!(a.anchor.end_row_offset, b.anchor.end_row_offset);
    assert_eq!(a.anchor.end_col_offset, b.anchor.end_col_offset);
    assert_eq!(a.anchor.extent_cx, b.anchor.extent_cx);
    assert_eq!(a.anchor.extent_cy, b.anchor.extent_cy);
    assert!((a.width - b.width).abs() < f64::EPSILON);
    assert!((a.height - b.height).abs() < f64::EPSILON);
    assert_eq!(a.z_index, b.z_index);
    assert!((a.rotation - b.rotation).abs() < f64::EPSILON);
    assert_eq!(a.flip_h, b.flip_h);
    assert_eq!(a.flip_v, b.flip_v);
    assert_eq!(a.locked, b.locked);
    assert_eq!(a.visible, b.visible);
    assert_eq!(a.printable, b.printable);
    assert!((a.opacity - b.opacity).abs() < f64::EPSILON);
    assert_eq!(a.name, b.name);
    assert_eq!(a.created_at, b.created_at);
    assert_eq!(a.updated_at, b.updated_at);
    assert_eq!(a.group_id, b.group_id);
    assert_eq!(a.anchor_cell_id, b.anchor_cell_id);
    assert_eq!(a.to_anchor_cell_id, b.to_anchor_cell_id);
    assert_eq!(a.lock_aspect_ratio, b.lock_aspect_ratio);
    assert_eq!(a.alt_text_title, b.alt_text_title);
    assert_eq!(a.display_name, b.display_name);
    assert_eq!(a.import_status, b.import_status);
}

#[test]
fn test_absolute_emu_roundtrip_and_legacy_read() {
    let mut common = make_common("abs-1", "sheet-1");
    common.anchor.absolute_x = Some(12345);
    common.anchor.absolute_y = Some(67890);
    let obj = FloatingObject {
        common,
        data: FloatingObjectData::Shape(ShapeData {
            shape_type: "rect".to_string(),
            ..Default::default()
        }),
    };

    let entries = to_yrs_prelim(&obj);
    assert!(entries.iter().any(|(k, v)| k == "absoluteXEmu"
        && matches!(v, Any::Number(n) if (*n - 12345.0).abs() < f64::EPSILON)));
    assert!(entries.iter().any(|(k, v)| k == "absoluteYEmu"
        && matches!(v, Any::Number(n) if (*n - 67890.0).abs() < f64::EPSILON)));

    let doc = Doc::new();
    let root = doc.get_or_insert_map("test");
    {
        let mut txn = doc.transact_mut();
        let prelim: MapPrelim = vec![
            ("type".to_string(), Any::String(Arc::from("shape"))),
            ("id".to_string(), Any::String(Arc::from("legacy-abs"))),
            ("sheetId".to_string(), Any::String(Arc::from("sheet-1"))),
            ("absoluteX".to_string(), Any::Number(11.0)),
            ("absoluteY".to_string(), Any::Number(22.0)),
        ]
        .into_iter()
        .collect();
        root.insert(&mut txn, "item", prelim);
    }
    let txn = doc.transact();
    let map_ref = root
        .get(&txn, "item")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let restored = from_yrs_map(&map_ref, &txn).unwrap();
    assert_eq!(restored.common.anchor.absolute_x, Some(11));
    assert_eq!(restored.common.anchor.absolute_y, Some(22));
}

#[test]
fn test_common_read_only_legacy_fields_hydrate() {
    let doc = Doc::new();
    let root = doc.get_or_insert_map("test");
    {
        let mut txn = doc.transact_mut();
        let prelim: MapPrelim = vec![
            ("type".to_string(), Any::String(Arc::from("shape"))),
            ("id".to_string(), Any::String(Arc::from("legacy-common"))),
            ("sheetId".to_string(), Any::String(Arc::from("sheet-1"))),
            ("lockAspectRatio".to_string(), Any::Bool(true)),
            (
                "altTextTitle".to_string(),
                Any::String(Arc::from("Alt title")),
            ),
            (
                "displayName".to_string(),
                Any::String(Arc::from("Display name")),
            ),
        ]
        .into_iter()
        .collect();
        root.insert(&mut txn, "item", prelim);
    }
    let txn = doc.transact();
    let map_ref = root
        .get(&txn, "item")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let restored = from_yrs_map(&map_ref, &txn).unwrap();
    assert_eq!(restored.common.lock_aspect_ratio, Some(true));
    assert_eq!(restored.common.alt_text_title.as_deref(), Some("Alt title"));
    assert_eq!(
        restored.common.display_name.as_deref(),
        Some("Display name")
    );
}

#[test]
fn test_shape_roundtrip() {
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
            shadow: Some(OuterShadowEffect {
                blur_radius: 40000.0,
                distance: 20000.0,
                direction: 315.0,
                color: "#000000".to_string(),
                opacity: 0.4,
                ..Default::default()
            }),
            adjustments: None,
            scene_3d: None,
            sp_3d: None,
            ooxml: None,
        }),
    };

    let restored = yrs_roundtrip!(&obj);
    assert_common_eq(&obj.common, &restored.common);
    assert_eq!(restored.object_type(), "shape");
    if let FloatingObjectData::Shape(ref s) = restored.data {
        assert_eq!(s.shape_type, "roundRect");
        let fill = s.fill.as_ref().unwrap();
        assert_eq!(fill.fill_type, FillType::Solid);
        assert_eq!(fill.color.as_deref(), Some("#ff0000"));
        let outline = s.outline.as_ref().unwrap();
        assert_eq!(outline.style, OutlineStyle::Solid);
        assert_eq!(outline.color, "#000000");
        let text = s.text.as_ref().unwrap();
        assert_eq!(text.content, "Hello");
        assert_eq!(text.vertical_align, Some(VerticalAlign::Middle));
        let shadow = s.shadow.as_ref().unwrap();
        assert!((shadow.blur_radius - 40000.0).abs() < f64::EPSILON);
    } else {
        panic!("Expected Shape variant");
    }
}

#[test]
fn test_connector_roundtrip() {
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

    let restored = yrs_roundtrip!(&obj);
    assert_common_eq(&obj.common, &restored.common);
    assert_eq!(restored.object_type(), "connector");
    if let FloatingObjectData::Connector(ref c) = restored.data {
        assert_eq!(c.shape_type, "straightConnector1");
        assert_eq!(c.start_connection.as_ref().unwrap().shape_id, "shape-1");
        assert_eq!(c.end_connection.as_ref().unwrap().site_index, 0);
        let tail = c.outline.as_ref().unwrap().tail_end.as_ref().unwrap();
        assert_eq!(tail.end_type, LineEndType::Triangle);
    } else {
        panic!("Expected Connector variant");
    }
}

#[test]
fn test_picture_roundtrip() {
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
            adjustments: Some(PictureAdjustments {
                brightness: Some(0.1),
                contrast: Some(-0.2),
                transparency: None,
            }),
            border: None,
            color_type: Some(ImageColorType::GrayScale),
            ooxml: None,
        }),
    };

    let restored = yrs_roundtrip!(&obj);
    assert_common_eq(&obj.common, &restored.common);
    assert_eq!(restored.object_type(), "picture");
    if let FloatingObjectData::Picture(ref p) = restored.data {
        assert_eq!(p.src, "https://example.com/img.png");
        assert_eq!(p.original_width, Some(800.0));
        assert_eq!(p.original_height, Some(600.0));
        let crop = p.crop.as_ref().unwrap();
        assert!((crop.top - 0.1).abs() < f64::EPSILON);
        let adj = p.adjustments.as_ref().unwrap();
        assert_eq!(adj.brightness, Some(0.1));
        assert_eq!(p.color_type, Some(ImageColorType::GrayScale));
    } else {
        panic!("Expected Picture variant");
    }
}

#[test]
fn test_textbox_roundtrip() {
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
            fill: Some(ObjectFill {
                fill_type: FillType::Solid,
                color: Some("#ffffff".to_string()),
                gradient: None,
                transparency: None,
                pattern: None,
                blip: None,
            }),
            border: None,
            text_effects: None,
            ooxml: None,
        }),
    };

    let restored = yrs_roundtrip!(&obj);
    assert_common_eq(&obj.common, &restored.common);
    assert_eq!(restored.object_type(), "textbox");
    if let FloatingObjectData::Textbox(ref t) = restored.data {
        let text = t.text.as_ref().unwrap();
        assert_eq!(text.content, "Hello world");
        assert_eq!(text.vertical_align, Some(VerticalAlign::Top));
        let fill = t.fill.as_ref().unwrap();
        assert_eq!(fill.fill_type, FillType::Solid);
        let margins = text.margins.as_ref().unwrap();
        assert!((margins.top - 5.0).abs() < f64::EPSILON);
    } else {
        panic!("Expected Textbox variant");
    }
}

#[test]
fn test_chart_roundtrip() {
    use crate::domain::chart::{
        ChartFormatStringData, ChartSubType, ChartType, PivotChartOptionsData, SeriesOrientation,
    };
    use crate::domain::conditional_format::CellIdRange;

    let obj = FloatingObject {
        common: make_common("chart-1", "sheet-1"),
        data: FloatingObjectData::Chart(ChartData {
            chart_type: ChartType::Bar,
            sub_type: Some(ChartSubType::Clustered),
            series_orientation: Some(SeriesOrientation::Columns),
            data_range: Some("A1:D10".to_string()),
            data_range_identity: Some(CellIdRange {
                top_left_cell_id: "id-a1".to_string(),
                bottom_right_cell_id: "id-d10".to_string(),
            }),
            series_range: Some("B1:B10".to_string()),
            series_range_identity: Some(CellIdRange {
                top_left_cell_id: "id-b1".to_string(),
                bottom_right_cell_id: "id-b10".to_string(),
            }),
            category_range: Some("A1:A10".to_string()),
            category_range_identity: Some(CellIdRange {
                top_left_cell_id: "id-a1".to_string(),
                bottom_right_cell_id: "id-a10".to_string(),
            }),
            title: Some("My Chart".to_string()),
            subtitle: None,
            legend: None,
            axis: None,
            colors: Some(vec!["#ff0000".to_string()]),
            series: Some(vec![crate::domain::chart::ChartSeriesData {
                name: Some("Revenue".to_string()),
                r#type: None,
                color: None,
                values: None,
                categories: None,
                bubble_size: None,
                smooth: None,
                explosion: None,
                invert_if_negative: None,
                y_axis_index: None,
                show_markers: None,
                marker_size: None,
                marker_style: None,
                line_width: None,
                points: None,
                data_labels: None,
                trendlines: None,
                error_bars: None,
                x_error_bars: None,
                y_error_bars: None,
                idx: None,
                order: None,
                format: None,
                bar_shape: None,
                invert_color: None,
                marker_background_color: None,
                marker_foreground_color: None,
                filtered: None,
                show_shadow: None,
                show_connector_lines: None,
                leader_line_format: None,
                show_leader_lines: None,
            }]),
            data_labels: None,
            pie_slice: None,
            trendline: None,
            show_lines: Some(true),
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
            pivot_options: Some(PivotChartOptionsData {
                show_axis_field_buttons: Some(true),
                show_legend_field_buttons: Some(false),
                show_report_filter_field_buttons: Some(true),
                show_value_field_buttons: Some(false),
            }),
            bar_shape: None,
            // Bubble / Surface / Theming
            bubble_3d_effect: None,
            wireframe: None,
            surface_top_view: None,
            color_scheme: None,
            // Position in points
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
            title_rich_text: Some(vec![ChartFormatStringData {
                text: "Rich title".to_string(),
                font: None,
            }]),
            title_formula: None,
            data_table: None,
            view_3d: None,
            floor_format: None,
            side_wall_format: None,
            back_wall_format: None,
            source_table_id: Some("table-1".to_string()),
            table_data_columns: Some(vec!["Revenue".to_string(), "Cost".to_string()]),
            table_category_column: None,
            use_table_column_names_as_labels: None,
            table_column_names: Some(vec!["Quarter".to_string(), "Amount".to_string()]),
            width_cells: Some(8.0),
            height_cells: Some(15.0),
            ooxml: Some(ChartOoxmlProps {
                chart_relationships: Vec::new(),
                chart_auxiliary_files: vec![(
                    "xl/charts/style9.xml".to_string(),
                    br#"<c:style xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>"#
                        .to_vec(),
                )],
                ..Default::default()
            }),
        }),
    };

    let restored = yrs_roundtrip!(&obj);
    assert_common_eq(&obj.common, &restored.common);
    assert_eq!(restored.object_type(), "chart");
    if let FloatingObjectData::Chart(ref c) = restored.data {
        assert_eq!(c.chart_type, ChartType::Bar);
        assert_eq!(c.sub_type, Some(ChartSubType::Clustered));
        assert_eq!(c.series_orientation, Some(SeriesOrientation::Columns));
        assert_eq!(c.data_range.as_deref(), Some("A1:D10"));
        assert_eq!(
            c.data_range_identity,
            Some(CellIdRange {
                top_left_cell_id: "id-a1".to_string(),
                bottom_right_cell_id: "id-d10".to_string()
            })
        );
        assert_eq!(c.title.as_deref(), Some("My Chart"));
        assert_eq!(c.colors.as_ref().map(|v| v.len()), Some(1));
        assert_eq!(c.show_lines, Some(true));
        assert_eq!(
            c.pivot_options
                .as_ref()
                .and_then(|opts| opts.show_axis_field_buttons),
            Some(true)
        );
        assert_eq!(
            c.title_rich_text
                .as_ref()
                .and_then(|runs| runs.first())
                .map(|run| run.text.as_str()),
            Some("Rich title")
        );
        assert_eq!(c.source_table_id.as_deref(), Some("table-1"));
        assert_eq!(
            c.table_data_columns
                .as_ref()
                .map(|cols| cols.iter().map(String::as_str).collect::<Vec<_>>()),
            Some(vec!["Revenue", "Cost"])
        );
        assert_eq!(
            c.table_column_names
                .as_ref()
                .map(|cols| cols.iter().map(String::as_str).collect::<Vec<_>>()),
            Some(vec!["Quarter", "Amount"])
        );
        assert_eq!(c.width_cells, Some(8.0));
        assert_eq!(c.height_cells, Some(15.0));
        let ooxml = c.ooxml.as_ref().expect("chart OOXML data");
        assert_eq!(ooxml.chart_auxiliary_files.len(), 1);
        assert_eq!(
            ooxml
                .chart_auxiliary_files
                .first()
                .map(|(path, _)| path.as_str()),
            Some("xl/charts/style9.xml")
        );
        assert!(c.series.is_some());
    } else {
        panic!("Expected Chart variant");
    }
}

#[test]
fn test_camera_roundtrip() {
    let obj = FloatingObject {
        common: make_common("cam-1", "sheet-1"),
        data: FloatingObjectData::Camera(CameraData {
            source_ref: "Sheet2!A1:D10".to_string(),
            error: Some("source not found".to_string()),
        }),
    };

    let restored = yrs_roundtrip!(&obj);
    assert_common_eq(&obj.common, &restored.common);
    assert_eq!(restored.object_type(), "camera");
    if let FloatingObjectData::Camera(ref c) = restored.data {
        assert_eq!(c.source_ref, "Sheet2!A1:D10");
        assert_eq!(c.error.as_deref(), Some("source not found"));
    } else {
        panic!("Expected Camera variant");
    }
}

#[test]
fn test_equation_roundtrip() {
    let obj = FloatingObject {
        common: make_common("eq-1", "sheet-1"),
        data: FloatingObjectData::Equation(EquationData {
            equation: "x^2 + y^2 = r^2".to_string(),
        }),
    };

    let restored = yrs_roundtrip!(&obj);
    assert_common_eq(&obj.common, &restored.common);
    assert_eq!(restored.object_type(), "equation");
    if let FloatingObjectData::Equation(ref e) = restored.data {
        assert_eq!(e.equation, "x^2 + y^2 = r^2");
    } else {
        panic!("Expected Equation variant");
    }
}

#[test]
fn test_diagram_roundtrip() {
    let obj = FloatingObject {
        common: make_common("diagram-1", "sheet-1"),
        data: FloatingObjectData::Diagram(DiagramData {
            definition: SmartArtDefinition {
                dm_rel_id: Some("rId1".to_string()),
                data_xml: Some("<dgm:dataModel/>".to_string()),
                ..Default::default()
            },
            category: Some(SmartArtCategory::Hierarchy),
        }),
    };

    let restored = yrs_roundtrip!(&obj);
    assert_common_eq(&obj.common, &restored.common);
    assert_eq!(restored.object_type(), "diagram");
    if let FloatingObjectData::Diagram(ref s) = restored.data {
        assert_eq!(s.category, Some(SmartArtCategory::Hierarchy));
        assert_eq!(s.definition.dm_rel_id.as_deref(), Some("rId1"));
        assert_eq!(s.definition.data_xml.as_deref(), Some("<dgm:dataModel/>"));
    } else {
        panic!("Expected Diagram variant");
    }
}

#[test]
fn test_drawing_roundtrip() {
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
                    pressure: None,
                    tilt: None,
                    timestamp: None,
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
    strokes.insert(
        "stroke-2".to_string(),
        InkStroke {
            id: "stroke-2".to_string(),
            points: vec![InkPoint {
                x: 50.0,
                y: 60.0,
                pressure: None,
                tilt: None,
                timestamp: None,
            }],
            tool: InkTool::Highlighter,
            color: "#ffff00".to_string(),
            width: 8.0,
            opacity: 0.5,
            created_by: "user-2".to_string(),
            created_at: 1234567891.0,
        },
    );

    let obj = FloatingObject {
        common: make_common("dr-1", "sheet-1"),
        data: FloatingObjectData::Drawing(DrawingData {
            strokes,
            tool_state: InkToolState::default(),
            recognitions: BTreeMap::new(),
            background_color: Some("#ffffff".to_string()),
            ooxml: None,
        }),
    };

    let restored = yrs_roundtrip!(&obj);
    assert_common_eq(&obj.common, &restored.common);
    assert_eq!(restored.object_type(), "drawing");
    if let FloatingObjectData::Drawing(ref d) = restored.data {
        assert_eq!(d.strokes.len(), 2);
        assert!(d.strokes.contains_key("stroke-1"));
        assert!(d.strokes.contains_key("stroke-2"));
        assert_eq!(d.strokes["stroke-1"].color, "#000000");
        assert_eq!(d.strokes["stroke-1"].points.len(), 2);
        assert_eq!(d.strokes["stroke-1"].points[0].pressure, Some(0.5));
        assert_eq!(d.strokes["stroke-2"].tool, InkTool::Highlighter);
        assert_eq!(d.background_color, Some("#ffffff".to_string()));
        assert_eq!(d.tool_state, InkToolState::default());
        assert!(d.recognitions.is_empty());
    } else {
        panic!("Expected Drawing variant");
    }
}

#[test]
fn test_drawing_old_format_migration() {
    // Test reading old-format "data" blob and migrating to new typed fields
    let doc = yrs::Doc::new();
    let root = doc.get_or_insert_map("test");
    {
        let mut txn = doc.transact_mut();

        // Build the old format: common fields + a single "data" JSON blob
        let old_blob = serde_json::json!({
            "strokes": {
                "s1": {
                    "id": "s1",
                    "points": [{"x": 1.0, "y": 2.0}],
                    "tool": "pen",
                    "color": "#000",
                    "width": 2.0,
                    "opacity": 1.0,
                    "createdBy": "user1",
                    "createdAt": 100.0
                }
            },
            "toolState": {
                "activeTool": "pen",
                "toolSettings": {}
            },
            "backgroundColor": "#fff"
        });

        let data_json = serde_json::to_string(&old_blob).unwrap();
        let prelim: yrs::MapPrelim = vec![
            ("type".to_string(), Any::String(Arc::from("drawing"))),
            ("id".to_string(), Any::String(Arc::from("obj-1"))),
            ("sheetId".to_string(), Any::String(Arc::from("sheet-1"))),
            ("anchorRow".to_string(), Any::Number(0.0)),
            ("anchorCol".to_string(), Any::Number(0.0)),
            ("anchorRowOffset".to_string(), Any::Number(0.0)),
            ("anchorColOffset".to_string(), Any::Number(0.0)),
            ("anchorMode".to_string(), Any::String(Arc::from("oneCell"))),
            ("width".to_string(), Any::Number(100.0)),
            ("height".to_string(), Any::Number(100.0)),
            ("zIndex".to_string(), Any::Number(0.0)),
            ("rotation".to_string(), Any::Number(0.0)),
            ("flipH".to_string(), Any::Bool(false)),
            ("flipV".to_string(), Any::Bool(false)),
            ("locked".to_string(), Any::Bool(false)),
            ("visible".to_string(), Any::Bool(true)),
            ("printable".to_string(), Any::Bool(true)),
            ("opacity".to_string(), Any::Number(1.0)),
            ("name".to_string(), Any::String(Arc::from(""))),
            ("createdAt".to_string(), Any::Number(0.0)),
            ("updatedAt".to_string(), Any::Number(0.0)),
            (
                "data".to_string(),
                Any::String(Arc::from(data_json.as_str())),
            ),
        ]
        .into_iter()
        .collect();
        root.insert(&mut txn, "item", prelim);
    }

    let txn = doc.transact();
    let map_ref = root
        .get(&txn, "item")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let result = from_yrs_map(&map_ref, &txn);

    assert!(result.is_some(), "Should successfully read old format");
    let obj = result.unwrap();
    assert_eq!(obj.object_type(), "drawing");

    if let FloatingObjectData::Drawing(ref d) = obj.data {
        assert_eq!(d.strokes.len(), 1, "Should have migrated 1 stroke");
        assert!(d.strokes.contains_key("s1"));
        assert_eq!(d.strokes["s1"].color, "#000");
        assert_eq!(d.background_color, Some("#fff".to_string()));
    } else {
        panic!("Expected Drawing variant");
    }
}

#[test]
fn test_ole_object_roundtrip() {
    let obj = FloatingObject {
        common: make_common("ole-1", "sheet-1"),
        data: FloatingObjectData::OleObject(OleObjectData {
            prog_id: "Word.Document.12".to_string(),
            dv_aspect: "DVASPECT_CONTENT".to_string(),
            is_linked: false,
            is_embedded: true,
            preview_image_src: Some("preview.png".to_string()),
            alt_text: Some("Embedded document".to_string()),
            ooxml: None,
        }),
    };

    let restored = yrs_roundtrip!(&obj);
    assert_common_eq(&obj.common, &restored.common);
    assert_eq!(restored.object_type(), "oleObject");
    if let FloatingObjectData::OleObject(ref o) = restored.data {
        assert_eq!(o.prog_id, "Word.Document.12");
        assert_eq!(o.dv_aspect, "DVASPECT_CONTENT");
        assert!(!o.is_linked);
        assert!(o.is_embedded);
        assert_eq!(o.preview_image_src.as_deref(), Some("preview.png"));
        assert_eq!(o.alt_text.as_deref(), Some("Embedded document"));
    } else {
        panic!("Expected OleObject variant");
    }
}

#[test]
fn test_form_control_roundtrip() {
    let obj = FloatingObject {
        common: make_common("fc-1", "sheet-1"),
        data: FloatingObjectData::FormControl(FormControlData {
            control_type: "CheckBox".to_string(),
            cell_link: Some("$A$1".to_string()),
            input_range: Some("$B$1:$B$10".to_string()),
            ooxml: None,
        }),
    };

    let restored = yrs_roundtrip!(&obj);
    assert_common_eq(&obj.common, &restored.common);
    assert_eq!(restored.object_type(), "formControl");
    if let FloatingObjectData::FormControl(ref fc) = restored.data {
        assert_eq!(fc.control_type, "CheckBox");
        assert_eq!(fc.cell_link.as_deref(), Some("$A$1"));
        assert_eq!(fc.input_range.as_deref(), Some("$B$1:$B$10"));
    } else {
        panic!("Expected FormControl variant");
    }
}

#[test]
fn test_minimal_shape_roundtrip() {
    let obj = FloatingObject {
        common: FloatingObjectCommon {
            id: "min-1".to_string(),
            sheet_id: "sh-1".to_string(),
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
                extent_cx: None,
                extent_cy: None,
            },
            width: 0.0,
            height: 0.0,
            z_index: 0,
            rotation: 0.0,
            flip_h: false,
            flip_v: false,
            locked: false,
            visible: true,
            printable: true,
            opacity: 1.0,
            name: String::new(),
            created_at: 0,
            updated_at: 0,
            group_id: None,
            anchor_cell_id: None,
            to_anchor_cell_id: None,
            lock_aspect_ratio: None,
            alt_text_title: None,
            display_name: None,
            import_status: None,
        },
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

    let restored = yrs_roundtrip!(&obj);
    assert_eq!(restored.common.id, "min-1");
    assert_eq!(restored.object_type(), "shape");
    assert_eq!(restored.common.anchor.anchor_mode, AnchorMode::OneCell);
    assert!(restored.common.group_id.is_none());
    assert!(restored.common.anchor.end_row.is_none());
}

#[test]
fn test_known_fields_shape() {
    let (prims, subs) = known_fields("shape");
    assert!(prims.contains(&"absoluteXEmu"));
    assert!(prims.contains(&"absoluteYEmu"));
    assert!(prims.contains(&"lockAspectRatio"));
    assert!(prims.contains(&"altTextTitle"));
    assert!(prims.contains(&"displayName"));
    assert!(subs.contains(&"importStatus"));
    assert!(prims.contains(&"shapeType"));
    assert!(subs.contains(&"fill"));
    assert!(subs.contains(&"outline"));
    assert!(subs.contains(&"text"));
    assert!(subs.contains(&"shadow"));
}

#[test]
fn test_known_fields_picture() {
    let (_prims, subs) = known_fields("picture");
    assert!(subs.contains(&"colorType"));
}

#[test]
fn test_known_fields_chart() {
    let (prims, subs) = known_fields("chart");
    assert!(prims.contains(&"chartType"));
    assert!(prims.contains(&"subType"));
    assert!(prims.contains(&"seriesOrientation"));
    assert!(prims.contains(&"dataRange"));
    assert!(
        !prims.contains(&"dataRangeIdentity"),
        "dataRangeIdentity should be a sub_object"
    );
    assert!(subs.contains(&"dataRangeIdentity"));
    assert!(subs.contains(&"seriesRangeIdentity"));
    assert!(subs.contains(&"categoryRangeIdentity"));
    assert!(prims.contains(&"title"));
    assert!(prims.contains(&"sourceTableId"));
    assert!(prims.contains(&"widthCells"));
    assert!(prims.contains(&"showLines"));
    assert!(subs.contains(&"legend"));
    assert!(subs.contains(&"axis"));
    assert!(subs.contains(&"colors"));
    assert!(subs.contains(&"series"));
    assert!(subs.contains(&"definition"));
    assert!(subs.contains(&"ooxml"));
}

#[test]
fn test_extent_cx_cy_roundtrip() {
    let obj = FloatingObject {
        common: FloatingObjectCommon {
            id: "ext-1".to_string(),
            sheet_id: "sh-1".to_string(),
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
            z_index: 0,
            rotation: 0.0,
            flip_h: false,
            flip_v: false,
            locked: false,
            visible: true,
            printable: true,
            opacity: 1.0,
            name: String::new(),
            created_at: 0,
            updated_at: 0,
            group_id: None,
            anchor_cell_id: None,
            to_anchor_cell_id: None,
            lock_aspect_ratio: None,
            alt_text_title: None,
            display_name: None,
            import_status: None,
        },
        data: FloatingObjectData::Equation(EquationData {
            equation: "E=mc^2".to_string(),
        }),
    };

    let restored = yrs_roundtrip!(&obj);
    assert_eq!(restored.common.anchor.extent_cx, Some(5000000));
    assert_eq!(restored.common.anchor.extent_cy, Some(3000000));
}
