use super::floating_object::{
    AnchorMode, ChartData, FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData,
};
use super::*;

#[test]
fn chart_type_known_roundtrip() {
    let ct = ChartType::Bar;
    let json = serde_json::to_string(&ct).unwrap();
    assert_eq!(json, r#""bar""#);
    let back: ChartType = serde_json::from_str(&json).unwrap();
    assert_eq!(back, ChartType::Bar);
}

#[test]
fn chart_type_unknown_roundtrip() {
    let json = r#""unknownModernChart""#;
    let ct: ChartType = serde_json::from_str(json).unwrap();
    assert_eq!(ct, ChartType::Unknown("unknownModernChart".to_string()));
    let back = serde_json::to_string(&ct).unwrap();
    assert_eq!(back, json);
}

#[test]
fn chart_type_modern_statistical_roundtrip() {
    for (input, variant, canonical) in [
        ("histogram", ChartType::Histogram, "histogram"),
        ("pareto", ChartType::Pareto, "pareto"),
        ("paretoLine", ChartType::Pareto, "pareto"),
        ("boxplot", ChartType::Boxplot, "boxplot"),
        ("boxWhisker", ChartType::Boxplot, "boxplot"),
    ] {
        let ct = ChartType::from_str(input);
        assert_eq!(ct, variant);
        assert_eq!(ct.as_str(), canonical);
        let json = serde_json::to_string(&ct).unwrap();
        assert_eq!(json, format!(r#""{canonical}""#));
        let back: ChartType = serde_json::from_str(&json).unwrap();
        assert_eq!(back, variant);
    }
}

#[test]
fn chart_type_3d_variants_roundtrip() {
    // The domain ChartType is a strict superset of ooxml_types::charts::ChartType;
    // verify the new 3D / OfPie variants round-trip through serde.
    for (variant, expected_str) in [
        (ChartType::Bar3D, "bar3D"),
        (ChartType::Line3D, "line3D"),
        (ChartType::Pie3D, "pie3D"),
        (ChartType::Area3D, "area3D"),
        (ChartType::Surface3D, "surface3D"),
        (ChartType::OfPie, "ofPie"),
    ] {
        let json = serde_json::to_string(&variant).unwrap();
        assert_eq!(json, format!(r#""{expected_str}""#));
        let back: ChartType = serde_json::from_str(&json).unwrap();
        assert_eq!(back, variant);
    }
}

#[test]
fn chart_type_ooxml_superset_round_trips() {
    // Every OOXML chart-type variant must have a domain counterpart and
    // round-trip losslessly via `from_ooxml` / `to_ooxml`.
    use ooxml_types::charts::ChartType as Oct;
    let variants = [
        Oct::Bar,
        Oct::Bar3D,
        Oct::Line,
        Oct::Line3D,
        Oct::Pie,
        Oct::Pie3D,
        Oct::Doughnut,
        Oct::Area,
        Oct::Area3D,
        Oct::Scatter,
        Oct::Bubble,
        Oct::Radar,
        Oct::Surface,
        Oct::Surface3D,
        Oct::Stock,
        Oct::OfPie,
        Oct::Combo,
    ];
    for ooxml_variant in variants {
        let dom = ChartType::from_ooxml(ooxml_variant);
        let back = dom.to_ooxml();
        assert_eq!(
            ooxml_variant, back,
            "round-trip failed for {:?}",
            ooxml_variant
        );
    }
}

#[test]
fn chart_type_unknown_fold_round_trips() {
    // `Unknown(String)` is how the old `raw_chart_type_attr` sidecar folds
    // in (inventory row 2.21): the raw attribute value (e.g. Google Sheets'
    // `"comboChart"`) lands as `Unknown(...)` on parse and emits verbatim on
    // write.
    let raw = "comboChart";
    let dom = ChartType::from_str(raw);
    assert_eq!(dom, ChartType::Unknown("comboChart".to_string()));
    assert_eq!(dom.as_str(), raw);
}

#[test]
fn chart_sub_type_known_roundtrip() {
    for (st, wire) in [
        (ChartSubType::PercentStacked, "percentStacked"),
        (ChartSubType::Filled, "filled"),
        (ChartSubType::Markers, "markers"),
    ] {
        let json = serde_json::to_string(&st).unwrap();
        assert_eq!(json, format!(r#""{wire}""#));
        let back: ChartSubType = serde_json::from_str(&json).unwrap();
        assert_eq!(back, st);
    }
}

#[test]
fn stock_chart_sub_types_roundtrip() {
    for (sub_type, wire) in [
        (ChartSubType::Hlc, "hlc"),
        (ChartSubType::Ohlc, "ohlc"),
        (ChartSubType::VolumeHlc, "volume-hlc"),
        (ChartSubType::VolumeOhlc, "volume-ohlc"),
    ] {
        assert_eq!(sub_type.as_str(), wire);
        let json = serde_json::to_string(&sub_type).unwrap();
        assert_eq!(json, format!(r#""{wire}""#));
        let back: ChartSubType = serde_json::from_str(&json).unwrap();
        assert_eq!(back, sub_type);
    }
}

#[test]
fn chart_sub_type_unknown_roundtrip() {
    let json = r#""exploded""#;
    let st: ChartSubType = serde_json::from_str(json).unwrap();
    assert_eq!(st, ChartSubType::Unknown("exploded".to_string()));
    let back = serde_json::to_string(&st).unwrap();
    assert_eq!(back, json);
}

#[test]
fn series_orientation_roundtrip() {
    let so = SeriesOrientation::Columns;
    let json = serde_json::to_string(&so).unwrap();
    assert_eq!(json, r#""columns""#);
    let back: SeriesOrientation = serde_json::from_str(&json).unwrap();
    assert_eq!(back, SeriesOrientation::Columns);
}

fn sample_chart_style_context() -> ChartStyleContextData {
    ChartStyleContextData {
        color_map_override: Some(ChartColorMapOverrideData::Override {
            mapping: ChartColorMappingData {
                tx1: Some("Accent2".to_string()),
                ..Default::default()
            },
        }),
        owners: vec![ChartStyleOwnerData {
            owner_key: "title".to_string(),
            rich_text: Some(vec![ChartFormatStringData {
                text: "Revenue".to_string(),
                font: None,
            }]),
            ..Default::default()
        }],
        ..Default::default()
    }
}

#[test]
fn chart_spec_to_floating_object_preserves_fields() {
    use crate::domain::floating_object::{AnchorMode, FloatingObjectData};

    let spec = ChartSpec {
        chart_type: ChartType::Line,
        title: Some("Revenue".to_string()),
        position: AnchorPosition {
            anchor_row: 5,
            anchor_col: 2,
            anchor_row_offset: 100,
            anchor_col_offset: 200,
            absolute_x: None,
            absolute_y: None,
            end_row: Some(20),
            end_col: Some(10),
            end_row_offset: Some(300),
            end_col_offset: Some(400),
            extent_cx: None,
            extent_cy: None,
        },
        size: ObjectSize {
            width: 600.0,
            height: 400.0,
            height_pt: None,
            width_pt: None,
            left_pt: None,
            top_pt: None,
        },
        z_index: 3,
        definition: Some(ChartDefinition::ChartEx(
            ooxml_types::chart_ex::ChartExSpace::default(),
        )),
        series: vec![],
        sub_type: None,
        legend: None,
        axes: None,
        data_labels: None,
        data_range: None,
        style: None,
        rounded_corners: None,
        auto_title_deleted: None,
        show_data_labels_over_max: None,
        chart_format: None,
        plot_format: None,
        title_format: None,
        title_rich_text: None,
        title_formula: None,
        plot_layout: None,
        title_layout: None,
        data_table: None,
        drop_lines: None,
        high_low_lines: None,
        series_lines: None,
        up_down_bars: None,
        waterfall: None,
        histogram: None,
        boxplot: None,
        hierarchy: None,
        region_map: None,
        display_blanks_as: None,
        plot_visible_only: None,
        gap_width: None,
        gap_depth: None,
        overlap: None,
        doughnut_hole_size: None,
        first_slice_angle: None,
        bubble_scale: None,
        show_neg_bubbles: None,
        size_represents: None,
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
        pivot_projection: None,
        bar_shape: None,
        bubble_3d_effect: None,
        wireframe: None,
        surface_top_view: None,
        color_scheme: None,
        chart_style_context: Some(sample_chart_style_context()),
        view_3d: None,
        floor_format: None,
        side_wall_format: None,
        back_wall_format: None,
        chart_frame: None,
        chart_relationships: Vec::new(),
        chart_auxiliary_files: Vec::new(),
        chart_auxiliary_parts: Vec::new(),
        chart_ex_replay: None,
        standard_chart_provenance: None,
        standard_chart_export_authority: None,
        is_chart_ex: true,
        cnv_pr_name: Some("Chart 1".to_string()),
        cnv_pr_id: Some(42),
        no_change_aspect: Some(true),
        has_graphic_frame_locks: true,
        xfrm_off_x: 1000,
        xfrm_off_y: 2000,
        xfrm_ext_cx: 5000000,
        xfrm_ext_cy: 3000000,
        cnv_pr_ext_lst: Some("<a:ext/>".to_string()),
        anchor_edit_as: Some("twoCell".to_string()),
        macro_name: Some("MyMacro".to_string()),
        client_data_locks_with_sheet: Some(false),
        client_data_prints_with_sheet: Some(true),
        anchor_index: None,
        import_status: None,
        cnv_pr_descr: Some("Alt text".to_string()),
        cnv_pr_title: Some("Tooltip title".to_string()),
        cnv_pr_hidden: true,
    };

    let fo = spec.to_floating_object("sheet-abc", 7);

    // Common fields
    assert_eq!(fo.common.id, "chart-import-7");
    assert_eq!(fo.common.sheet_id, "sheet-abc");
    assert_eq!(fo.common.width, 600.0);
    assert_eq!(fo.common.height, 400.0);
    assert_eq!(fo.common.z_index, 3);
    assert_eq!(fo.common.name, "Chart 1");
    assert!(!fo.common.locked);
    assert!(!fo.common.visible);
    assert!(fo.common.printable);

    // Anchor
    assert_eq!(fo.common.anchor.anchor_row, 5);
    assert_eq!(fo.common.anchor.anchor_col, 2);
    assert_eq!(fo.common.anchor.anchor_row_offset, 100);
    assert_eq!(fo.common.anchor.anchor_col_offset, 200);
    assert_eq!(fo.common.anchor.anchor_mode, AnchorMode::TwoCell);
    assert_eq!(fo.common.anchor.end_row, Some(20));
    assert_eq!(fo.common.anchor.end_col, Some(10));
    assert_eq!(fo.common.anchor.end_row_offset, Some(300));
    assert_eq!(fo.common.anchor.end_col_offset, Some(400));

    // Chart data
    if let FloatingObjectData::Chart(ref cd) = fo.data {
        assert_eq!(cd.chart_type, ChartType::Line);
        assert_eq!(cd.title.as_deref(), Some("Revenue"));
        assert_eq!(cd.chart_style_context, spec.chart_style_context);
        let ooxml = cd.ooxml.as_ref().expect("ooxml should be Some");
        assert!(matches!(
            ooxml.definition,
            Some(ChartDefinition::ChartEx(_))
        ));
        assert!(ooxml.is_chart_ex);
        let frame = ooxml
            .drawing_frame
            .as_ref()
            .expect("drawing frame should be preserved");
        let nv = &frame.graphic_frame.nv_graphic_frame_pr;
        assert_eq!(nv.c_nv_pr.name, "Chart 1");
        assert_eq!(nv.c_nv_pr.id.value(), 42);
        assert_eq!(nv.c_nv_pr.descr.as_deref(), Some("Alt text"));
        assert_eq!(nv.c_nv_pr.title.as_deref(), Some("Tooltip title"));
        assert!(nv.c_nv_pr.hidden);
        assert_eq!(nv.no_change_aspect_explicit, Some(true));
        assert!(nv.has_graphic_frame_locks);
        assert_eq!(frame.graphic_frame.xfrm.off_x(), 1000);
        assert_eq!(frame.graphic_frame.xfrm.off_y(), 2000);
        assert_eq!(frame.graphic_frame.xfrm.ext_cx(), 5000000);
        assert_eq!(frame.graphic_frame.xfrm.ext_cy(), 3000000);
        assert_eq!(nv.c_nv_pr.ext_lst.as_deref(), Some("<a:ext/>"));
        assert_eq!(frame.edit_as.as_deref(), Some("twoCell"));
        assert_eq!(frame.graphic_frame.macro_name.as_deref(), Some("MyMacro"));
        assert_eq!(frame.client_data_locks_with_sheet, Some(false));
        assert_eq!(frame.client_data_prints_with_sheet, Some(true));
    } else {
        panic!("Expected FloatingObjectData::Chart");
    }

    let roundtripped = ChartSpec::from_floating_object(&fo).expect("chart spec from object");
    assert_eq!(roundtripped.cnv_pr_name.as_deref(), Some("Chart 1"));
    assert_eq!(roundtripped.cnv_pr_id, Some(42));
    assert_eq!(roundtripped.cnv_pr_descr.as_deref(), Some("Alt text"));
    assert_eq!(roundtripped.cnv_pr_title.as_deref(), Some("Tooltip title"));
    assert!(roundtripped.cnv_pr_hidden);
    assert_eq!(roundtripped.no_change_aspect, Some(true));
    assert!(roundtripped.has_graphic_frame_locks);
    assert_eq!(roundtripped.xfrm_off_x, 1000);
    assert_eq!(roundtripped.xfrm_off_y, 2000);
    assert_eq!(roundtripped.xfrm_ext_cx, 5000000);
    assert_eq!(roundtripped.xfrm_ext_cy, 3000000);
    assert_eq!(roundtripped.cnv_pr_ext_lst.as_deref(), Some("<a:ext/>"));
    assert_eq!(roundtripped.anchor_edit_as.as_deref(), Some("twoCell"));
    assert_eq!(roundtripped.macro_name.as_deref(), Some("MyMacro"));
    assert_eq!(roundtripped.client_data_locks_with_sheet, Some(false));
    assert_eq!(roundtripped.client_data_prints_with_sheet, Some(true));

    let mut edited = spec.to_floating_object("sheet-abc", 8);
    edited.common.rotation = 12.5;
    edited.common.flip_h = true;
    edited.common.flip_v = true;
    edited.common.locked = true;
    edited.common.visible = true;
    edited.common.printable = false;
    if let FloatingObjectData::Chart(ref mut cd) = edited.data {
        cd.ooxml
            .as_mut()
            .and_then(|ooxml| ooxml.drawing_frame.as_mut())
            .expect("drawing frame should be preserved")
            .raw_alternate_content = Some("<mc:AlternateContent/>".to_string());
    }

    let edited_roundtrip =
        ChartSpec::from_floating_object(&edited).expect("chart spec from edited object");
    let edited_frame = edited_roundtrip
        .chart_frame
        .as_ref()
        .expect("edited drawing frame should be preserved");
    assert_eq!(
        edited_frame
            .graphic_frame
            .xfrm
            .rotation
            .map(|rot| rot.value()),
        Some(750_000)
    );
    assert_eq!(edited_frame.graphic_frame.xfrm.flip_h, Some(true));
    assert_eq!(edited_frame.graphic_frame.xfrm.flip_v, Some(true));
    assert!(
        !edited_frame
            .graphic_frame
            .nv_graphic_frame_pr
            .c_nv_pr
            .hidden
    );
    assert_eq!(edited_frame.client_data_locks_with_sheet, None);
    assert_eq!(edited_frame.client_data_prints_with_sheet, Some(false));
    assert_eq!(edited_frame.raw_alternate_content, None);

    let mut unlocked = spec.to_floating_object("sheet-abc", 9);
    unlocked.common.locked = false;
    if let FloatingObjectData::Chart(ref mut cd) = unlocked.data {
        let frame = cd
            .ooxml
            .as_mut()
            .and_then(|ooxml| ooxml.drawing_frame.as_mut())
            .expect("drawing frame should be preserved");
        frame.raw_alternate_content = Some("<mc:AlternateContent/>".to_string());
        let nv = &mut frame.graphic_frame.nv_graphic_frame_pr;
        nv.c_nv_graphic_frame_pr.no_select = true;
        nv.c_nv_graphic_frame_pr.no_move = true;
        nv.no_drilldown = true;
        nv.no_change_aspect_explicit = Some(true);
        nv.c_nv_graphic_frame_pr.no_change_aspect = true;
        nv.has_graphic_frame_locks = true;
        nv.c_nv_graphic_frame_pr_ext_lst =
            Some(r#"<a:extLst><a:ext uri="{frame-locks}"/></a:extLst>"#.to_string());
    }

    let unlocked_roundtrip =
        ChartSpec::from_floating_object(&unlocked).expect("chart spec from unlocked object");
    let unlocked_frame = unlocked_roundtrip
        .chart_frame
        .as_ref()
        .expect("unlocked drawing frame should be preserved");
    let unlocked_nv = &unlocked_frame.graphic_frame.nv_graphic_frame_pr;
    assert_eq!(unlocked_frame.client_data_locks_with_sheet, Some(false));
    assert!(!unlocked_nv.c_nv_graphic_frame_pr.no_select);
    assert!(!unlocked_nv.c_nv_graphic_frame_pr.no_move);
    assert!(!unlocked_nv.no_drilldown);
    assert_eq!(unlocked_nv.no_change_aspect_explicit, Some(true));
    assert!(unlocked_nv.c_nv_graphic_frame_pr.no_change_aspect);
    assert!(unlocked_nv.has_graphic_frame_locks);
    assert_eq!(
        unlocked_nv.c_nv_graphic_frame_pr_ext_lst.as_deref(),
        Some(r#"<a:extLst><a:ext uri="{frame-locks}"/></a:extLst>"#)
    );
    assert_eq!(unlocked_frame.raw_alternate_content, None);
}

#[test]
fn chart_spec_to_floating_object_one_cell_anchor() {
    use crate::domain::floating_object::AnchorMode;

    let spec = ChartSpec {
        chart_type: ChartType::Pie,
        title: None,
        position: AnchorPosition {
            anchor_row: 0,
            anchor_col: 0,
            anchor_row_offset: 0,
            anchor_col_offset: 0,
            absolute_x: None,
            absolute_y: None,
            end_row: None,
            end_col: None,
            end_row_offset: None,
            end_col_offset: None,
            extent_cx: Some(5000000),
            extent_cy: Some(3000000),
        },
        size: ObjectSize {
            width: 400.0,
            height: 300.0,
            height_pt: None,
            width_pt: None,
            left_pt: None,
            top_pt: None,
        },
        z_index: 0,
        definition: Some(ChartDefinition::Chart(
            ooxml_types::charts::ChartSpace::default(),
        )),
        series: vec![],
        sub_type: None,
        legend: None,
        axes: None,
        data_labels: None,
        data_range: None,
        style: None,
        rounded_corners: None,
        auto_title_deleted: None,
        show_data_labels_over_max: None,
        chart_format: None,
        plot_format: None,
        title_format: None,
        title_rich_text: None,
        title_formula: None,
        plot_layout: None,
        title_layout: None,
        data_table: None,
        drop_lines: None,
        high_low_lines: None,
        series_lines: None,
        up_down_bars: None,
        waterfall: None,
        histogram: None,
        boxplot: None,
        hierarchy: None,
        region_map: None,
        display_blanks_as: None,
        plot_visible_only: None,
        gap_width: None,
        gap_depth: None,
        overlap: None,
        doughnut_hole_size: None,
        first_slice_angle: None,
        bubble_scale: None,
        show_neg_bubbles: None,
        size_represents: None,
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
        pivot_projection: None,
        bar_shape: None,
        bubble_3d_effect: None,
        wireframe: None,
        surface_top_view: None,
        color_scheme: None,
        chart_style_context: None,
        view_3d: None,
        floor_format: None,
        side_wall_format: None,
        back_wall_format: None,
        chart_frame: None,
        chart_relationships: Vec::new(),
        chart_auxiliary_files: Vec::new(),
        chart_auxiliary_parts: Vec::new(),
        chart_ex_replay: None,
        standard_chart_provenance: None,
        standard_chart_export_authority: None,
        is_chart_ex: false,
        cnv_pr_name: None,
        cnv_pr_id: None,
        no_change_aspect: None,
        has_graphic_frame_locks: false,
        xfrm_off_x: 0,
        xfrm_off_y: 0,
        xfrm_ext_cx: 0,
        xfrm_ext_cy: 0,
        cnv_pr_ext_lst: None,
        anchor_edit_as: None,
        macro_name: None,
        client_data_locks_with_sheet: None,
        client_data_prints_with_sheet: None,
        anchor_index: None,
        import_status: None,
        cnv_pr_descr: None,
        cnv_pr_title: None,
        cnv_pr_hidden: false,
    };

    let fo = spec.to_floating_object("sheet-1", 0);
    assert_eq!(fo.common.anchor.anchor_mode, AnchorMode::OneCell);
    assert_eq!(fo.common.anchor.extent_cx, Some(5000000));
    assert_eq!(fo.common.anchor.extent_cy, Some(3000000));

    if let FloatingObjectData::Chart(ref cd) = fo.data {
        let ooxml = cd.ooxml.as_ref().expect("ooxml should contain definition");
        assert!(matches!(ooxml.definition, Some(ChartDefinition::Chart(_))));
        assert!(ooxml.drawing_frame.is_none());
    } else {
        panic!("Expected FloatingObjectData::Chart");
    }
}

#[test]
fn chart_spec_roundtrip_via_floating_object() {
    // Full round-trip: ChartSpec -> FloatingObject -> ChartSpec
    let original = ChartSpec {
        chart_type: ChartType::Line,
        title: Some("Revenue".to_string()),
        position: AnchorPosition {
            anchor_row: 5,
            anchor_col: 2,
            anchor_row_offset: 100,
            anchor_col_offset: 200,
            absolute_x: None,
            absolute_y: None,
            end_row: Some(20),
            end_col: Some(10),
            end_row_offset: Some(300),
            end_col_offset: Some(400),
            extent_cx: None,
            extent_cy: None,
        },
        size: ObjectSize {
            width: 600.0,
            height: 400.0,
            height_pt: None,
            width_pt: None,
            left_pt: None,
            top_pt: None,
        },
        z_index: 3,
        definition: Some(ChartDefinition::ChartEx(
            ooxml_types::chart_ex::ChartExSpace::default(),
        )),
        series: vec![],
        sub_type: None,
        legend: None,
        axes: None,
        data_labels: None,
        data_range: None,
        style: None,
        rounded_corners: None,
        auto_title_deleted: None,
        show_data_labels_over_max: None,
        chart_format: None,
        plot_format: None,
        title_format: None,
        title_rich_text: None,
        title_formula: None,
        plot_layout: None,
        title_layout: None,
        data_table: None,
        drop_lines: None,
        high_low_lines: None,
        series_lines: None,
        up_down_bars: None,
        waterfall: None,
        histogram: None,
        boxplot: None,
        hierarchy: None,
        region_map: None,
        display_blanks_as: None,
        plot_visible_only: None,
        gap_width: None,
        gap_depth: None,
        overlap: None,
        doughnut_hole_size: None,
        first_slice_angle: None,
        bubble_scale: None,
        show_neg_bubbles: None,
        size_represents: None,
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
        pivot_projection: None,
        bar_shape: None,
        bubble_3d_effect: None,
        wireframe: None,
        surface_top_view: None,
        color_scheme: None,
        chart_style_context: Some(sample_chart_style_context()),
        view_3d: None,
        floor_format: None,
        side_wall_format: None,
        back_wall_format: None,
        chart_frame: None,
        chart_relationships: Vec::new(),
        chart_auxiliary_files: Vec::new(),
        chart_auxiliary_parts: Vec::new(),
        chart_ex_replay: None,
        standard_chart_provenance: None,
        standard_chart_export_authority: None,
        is_chart_ex: true,
        cnv_pr_name: Some("Chart 1".to_string()),
        cnv_pr_id: Some(42),
        no_change_aspect: Some(true),
        has_graphic_frame_locks: true,
        xfrm_off_x: 1000,
        xfrm_off_y: 2000,
        xfrm_ext_cx: 5000000,
        xfrm_ext_cy: 3000000,
        cnv_pr_ext_lst: Some("<a:ext/>".to_string()),
        anchor_edit_as: Some("twoCell".to_string()),
        macro_name: Some("MyMacro".to_string()),
        client_data_locks_with_sheet: Some(false),
        client_data_prints_with_sheet: Some(true),
        anchor_index: None,
        import_status: None,
        cnv_pr_descr: None,
        cnv_pr_title: None,
        cnv_pr_hidden: false,
    };

    let fo = original.to_floating_object("sheet-abc", 7);
    let recovered = ChartSpec::from_floating_object(&fo).expect("should convert back to ChartSpec");

    assert_eq!(recovered.chart_type, original.chart_type);
    assert_eq!(recovered.title, original.title);
    assert_eq!(recovered.position, original.position);
    assert_eq!(recovered.size, original.size);
    assert_eq!(recovered.z_index, original.z_index);
    assert_eq!(recovered.definition, original.definition);
    assert_eq!(recovered.series, original.series);
    assert_eq!(recovered.sub_type, original.sub_type);
    assert_eq!(recovered.legend, original.legend);
    assert_eq!(recovered.axes, original.axes);
    assert_eq!(recovered.data_labels, original.data_labels);
    assert_eq!(recovered.data_range, original.data_range);
    assert_eq!(recovered.chart_style_context, original.chart_style_context);
    assert_eq!(recovered.is_chart_ex, original.is_chart_ex);
    assert_eq!(recovered.cnv_pr_name, original.cnv_pr_name);
    assert_eq!(recovered.cnv_pr_id, original.cnv_pr_id);
    assert_eq!(recovered.no_change_aspect, original.no_change_aspect);
    assert_eq!(
        recovered.has_graphic_frame_locks,
        original.has_graphic_frame_locks
    );
    assert_eq!(recovered.xfrm_off_x, original.xfrm_off_x);
    assert_eq!(recovered.xfrm_off_y, original.xfrm_off_y);
    assert_eq!(recovered.xfrm_ext_cx, original.xfrm_ext_cx);
    assert_eq!(recovered.xfrm_ext_cy, original.xfrm_ext_cy);
    assert_eq!(recovered.cnv_pr_ext_lst, original.cnv_pr_ext_lst);
    assert_eq!(recovered.anchor_edit_as, original.anchor_edit_as);
    assert_eq!(recovered.macro_name, original.macro_name);
    assert_eq!(
        recovered.client_data_locks_with_sheet,
        original.client_data_locks_with_sheet
    );
    assert_eq!(
        recovered.client_data_prints_with_sheet,
        original.client_data_prints_with_sheet
    );
}

#[test]
fn chart_spec_roundtrip_minimal() {
    // Round-trip with minimal/default fields
    let original = ChartSpec {
        chart_type: ChartType::Pie,
        title: None,
        position: AnchorPosition::default(),
        size: ObjectSize {
            width: 400.0,
            height: 300.0,
            height_pt: None,
            width_pt: None,
            left_pt: None,
            top_pt: None,
        },
        z_index: 0,
        definition: Some(ChartDefinition::Chart(
            ooxml_types::charts::ChartSpace::default(),
        )),
        series: vec![],
        sub_type: None,
        legend: None,
        axes: None,
        data_labels: None,
        data_range: None,
        style: None,
        rounded_corners: None,
        auto_title_deleted: None,
        show_data_labels_over_max: None,
        chart_format: None,
        plot_format: None,
        title_format: None,
        title_rich_text: None,
        title_formula: None,
        plot_layout: None,
        title_layout: None,
        data_table: None,
        drop_lines: None,
        high_low_lines: None,
        series_lines: None,
        up_down_bars: None,
        waterfall: None,
        histogram: None,
        boxplot: None,
        hierarchy: None,
        region_map: None,
        display_blanks_as: None,
        plot_visible_only: None,
        gap_width: None,
        gap_depth: None,
        overlap: None,
        doughnut_hole_size: None,
        first_slice_angle: None,
        bubble_scale: None,
        show_neg_bubbles: None,
        size_represents: None,
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
        pivot_projection: None,
        bar_shape: None,
        bubble_3d_effect: None,
        wireframe: None,
        surface_top_view: None,
        color_scheme: None,
        chart_style_context: None,
        view_3d: None,
        floor_format: None,
        side_wall_format: None,
        back_wall_format: None,
        chart_frame: None,
        chart_relationships: Vec::new(),
        chart_auxiliary_files: Vec::new(),
        chart_auxiliary_parts: Vec::new(),
        chart_ex_replay: None,
        standard_chart_provenance: None,
        standard_chart_export_authority: None,
        is_chart_ex: false,
        cnv_pr_name: None,
        cnv_pr_id: None,
        no_change_aspect: None,
        has_graphic_frame_locks: false,
        xfrm_off_x: 0,
        xfrm_off_y: 0,
        xfrm_ext_cx: 0,
        xfrm_ext_cy: 0,
        cnv_pr_ext_lst: None,
        anchor_edit_as: None,
        macro_name: None,
        client_data_locks_with_sheet: None,
        client_data_prints_with_sheet: None,
        anchor_index: None,
        import_status: None,
        cnv_pr_descr: None,
        cnv_pr_title: None,
        cnv_pr_hidden: false,
    };

    let fo = original.to_floating_object("sheet-1", 0);
    let recovered = ChartSpec::from_floating_object(&fo).expect("should convert back to ChartSpec");

    assert_eq!(recovered, original);
}

#[test]
fn from_floating_object_returns_none_for_non_chart() {
    use crate::domain::floating_object::{FloatingObject, ShapeData};

    let fo = FloatingObject {
        common: FloatingObjectCommon {
            id: "shape-1".to_string(),
            sheet_id: "sheet-1".to_string(),
            anchor: FloatingObjectAnchor {
                anchor_row: 0,
                anchor_col: 0,
                anchor_row_offset: 0,
                anchor_col_offset: 0,
                anchor_mode: AnchorMode::TwoCell,
                absolute_x: None,
                absolute_y: None,
                end_row: Some(5),
                end_col: Some(5),
                end_row_offset: Some(0),
                end_col_offset: Some(0),
                extent_cx: None,
                extent_cy: None,
            },
            width: 100.0,
            height: 100.0,
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

    assert!(ChartSpec::from_floating_object(&fo).is_none());
}

#[test]
fn chart_data_serde_roundtrip() {
    use crate::domain::conditional_format::CellIdRange;

    let original = ChartData {
        chart_type: ChartType::Bar,
        sub_type: Some(ChartSubType::Stacked),
        series_orientation: Some(SeriesOrientation::Rows),
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
        title: Some("Sales Chart".to_string()),
        subtitle: Some("Q1 2026".to_string()),
        legend: Some(LegendData {
            show: false,
            position: "bottom".to_string(),
            visible: true,
            overlay: None,
            format: None,
            entries: None,
            custom_x: None,
            custom_y: None,
            shadow: None,
            show_shadow: None,
            layout: None,
        }),
        axis: Some(AxisData {
            category_axis: Some(SingleAxisData {
                title: Some("Month".to_string()),
                visible: true,
                ..Default::default()
            }),
            value_axis: None,
            secondary_category_axis: None,
            secondary_value_axis: None,
            series_axis: None,
        }),
        colors: Some(vec!["#ff0000".to_string(), "#00ff00".to_string()]),
        series: Some(vec![ChartSeriesData {
            name: Some("Revenue".to_string()),
            name_ref: None,
            r#type: None,
            color: None,
            stock_role: None,
            values: None,
            value_cache: None,
            value_source_kind: None,
            categories: None,
            x_role: None,
            category_cache: None,
            category_source_kind: None,
            category_levels: None,
            category_label_format: None,
            bubble_size: None,
            bubble_size_cache: None,
            bubble_size_source_kind: None,
            smooth: None,
            show_lines: None,
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
            source_series_index: None,
            source_series_key: None,
            visible_order: None,
            pivot_series_key: None,
            pivot_data_field_index: None,
            projection_authority: None,
            projection_diagnostics: Vec::new(),
            show_shadow: None,
            show_connector_lines: None,
            leader_line_format: None,
            show_leader_lines: None,
            bin_options: None,
            boxwhisker_options: None,
        }]),
        data_labels: Some(DataLabelData {
            show: true,
            delete: None,
            position: None,
            format: None,
            show_value: None,
            show_category_name: None,
            show_series_name: None,
            show_percentage: None,
            show_bubble_size: None,
            show_legend_key: None,
            separator: None,
            show_leader_lines: None,
            text: None,
            visual_format: None,
            number_format: None,
            text_orientation: None,
            rich_text: None,
            auto_text: None,
            horizontal_alignment: None,
            vertical_alignment: None,
            link_number_format: None,
            geometric_shape_type: None,
            formula: None,
            height: None,
            width: None,
            leader_lines_format: None,
            layout: None,
        }),
        pie_slice: None,
        trendline: None,
        show_lines: Some(true),
        smooth_lines: Some(false),
        radar_filled: None,
        radar_markers: None,
        waterfall: None,
        histogram: None,
        boxplot: None,
        hierarchy: None,
        region_map: None,
        display_blanks_as: None,
        plot_visible_only: None,
        gap_width: None,
        gap_depth: None,
        overlap: None,
        doughnut_hole_size: None,
        first_slice_angle: None,
        bubble_scale: None,
        show_neg_bubbles: None,
        size_represents: None,
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
        pivot_projection: None,
        bar_shape: None,
        bubble_3d_effect: None,
        wireframe: None,
        surface_top_view: None,
        color_scheme: None,
        chart_style_context: Some(sample_chart_style_context()),
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
        plot_layout: None,
        title_layout: None,
        data_table: None,
        drop_lines: None,
        high_low_lines: None,
        series_lines: None,
        up_down_bars: None,
        view_3d: None,
        floor_format: None,
        side_wall_format: None,
        back_wall_format: None,
        source_table_id: Some("table-42".to_string()),
        table_data_columns: Some(vec!["col1".to_string(), "col2".to_string()]),
        table_category_column: Some("category".to_string()),
        use_table_column_names_as_labels: Some(true),
        table_column_names: Some(vec!["Name".to_string(), "Value".to_string()]),
        width_cells: Some(10.0),
        height_cells: Some(20.0),
        ooxml: None,
    };

    // Serialize to JSON
    let json_val = serde_json::to_value(&original).expect("serialize ChartData");

    // Verify key camelCase field names
    assert_eq!(json_val["chartType"], serde_json::json!("bar"));
    assert_eq!(json_val["subType"], serde_json::json!("stacked"));
    assert_eq!(json_val["dataRange"], serde_json::json!("A1:D10"));
    assert_eq!(
        json_val["dataRangeIdentity"]["topLeftCellId"],
        serde_json::json!("id-a1")
    );
    assert_eq!(
        json_val["dataRangeIdentity"]["bottomRightCellId"],
        serde_json::json!("id-d10")
    );
    assert_eq!(json_val["sourceTableId"], serde_json::json!("table-42"));
    assert_eq!(
        json_val["chartStyleContext"]["colorMapOverride"]["type"],
        serde_json::json!("override")
    );

    // Verify typed fields serialize correctly
    assert_eq!(json_val["legend"]["position"], serde_json::json!("bottom"));
    assert_eq!(json_val["legend"]["visible"], serde_json::json!(true));
    assert_eq!(json_val["series"][0]["name"], serde_json::json!("Revenue"));
    assert_eq!(json_val["dataLabels"]["show"], serde_json::json!(true));

    // Deserialize back
    let recovered: ChartData = serde_json::from_value(json_val).expect("deserialize ChartData");

    assert_eq!(recovered.chart_type, original.chart_type);
    assert_eq!(recovered.sub_type, original.sub_type);
    assert_eq!(recovered.series_orientation, original.series_orientation);
    assert_eq!(recovered.data_range, original.data_range);
    assert_eq!(recovered.data_range_identity, original.data_range_identity);
    assert_eq!(recovered.series_range, original.series_range);
    assert_eq!(
        recovered.series_range_identity,
        original.series_range_identity
    );
    assert_eq!(recovered.category_range, original.category_range);
    assert_eq!(
        recovered.category_range_identity,
        original.category_range_identity
    );
    assert_eq!(recovered.title, original.title);
    assert_eq!(recovered.subtitle, original.subtitle);
    assert_eq!(recovered.legend, original.legend);
    assert_eq!(recovered.axis, original.axis);
    assert_eq!(recovered.series, original.series);
    assert_eq!(recovered.data_labels, original.data_labels);
    assert_eq!(recovered.colors, original.colors);
    assert_eq!(recovered.show_lines, original.show_lines);
    assert_eq!(recovered.smooth_lines, original.smooth_lines);
    assert_eq!(recovered.chart_style_context, original.chart_style_context);
    assert_eq!(recovered.source_table_id, original.source_table_id);
    assert_eq!(recovered.table_data_columns, original.table_data_columns);
    assert_eq!(recovered.width_cells, original.width_cells);
    assert_eq!(recovered.height_cells, original.height_cells);
}
