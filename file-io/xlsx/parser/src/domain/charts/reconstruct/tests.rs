use crate::domain::charts::write_canonical::serialize_chart_space;
use domain_types::ChartDefinition;
use domain_types::chart::{
    AnchorPosition, AxisData, ChartFormatData, ChartSeriesDimensionSourceKindData,
    ChartSeriesPointCacheData, ChartSeriesPointCachePointData, ChartSpec,
    ChartType as DomainChartType, DataLabelData, LegendData, ObjectSize, PivotChartOptionsData,
    SingleAxisData,
};
use domain_types::domain::drawings::{LayoutMode, LayoutTarget, ManualLayout};
use ooxml_types::charts::{AxisType, Chart, ChartAxis, ChartAxisPosition, ChartSpace, PlotArea};

use super::{ranges, reconstruct_chart_space};

fn minimal_chart_spec(chart_type: DomainChartType, data_range: Option<&str>) -> ChartSpec {
    ChartSpec {
        chart_type,
        title: Some("Revenue".to_string()),
        position: AnchorPosition::default(),
        size: ObjectSize::default(),
        z_index: 0,
        definition: None,
        series: Vec::new(),
        sub_type: None,
        legend: None,
        axes: None,
        data_labels: None,
        data_range: data_range.map(str::to_string),
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
        overlap: None,
        doughnut_hole_size: None,
        first_slice_angle: None,
        bubble_scale: None,
        show_neg_bubbles: None,
        size_represents: None,
        split_type: None,
        split_value: None,
        bar_shape: None,
        bubble_3d_effect: None,
        wireframe: None,
        surface_top_view: None,
        color_scheme: None,
        chart_style_context: None,
        category_label_level: None,
        series_name_level: None,
        show_all_field_buttons: None,
        second_plot_size: None,
        vary_by_categories: None,
        title_h_align: None,
        title_v_align: None,
        title_show_shadow: None,
        pivot_options: None,
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
        cnv_pr_descr: None,
        cnv_pr_title: None,
        cnv_pr_hidden: false,
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
    }
}

fn chart_xml(spec: &ChartSpec) -> String {
    String::from_utf8(serialize_chart_space(&reconstruct_chart_space(spec)))
        .expect("chart XML should be UTF-8")
}

fn with_original_axes(mut spec: ChartSpec, axes: Vec<ChartAxis>) -> ChartSpec {
    spec.definition = Some(ChartDefinition::Chart(ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                axes,
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    }));
    spec
}

#[test]
fn data_range_chart_reconstructs_series_and_axes() {
    let spec = minimal_chart_spec(DomainChartType::Column, Some("Data!A1:C4"));
    let xml = chart_xml(&spec);

    assert_eq!(xml.matches("<c:ser>").count(), 2);
    assert!(xml.contains("<c:cat>"));
    assert!(xml.contains("<c:f>Data!A2:A4</c:f>"));
    assert!(xml.contains("<c:f>Data!B2:B4</c:f>"));
    assert!(xml.contains("<c:f>Data!C2:C4</c:f>"));
    assert!(xml.contains("<c:catAx>"));
    assert!(xml.contains("<c:valAx>"));
    assert!(xml.contains("<c:crossAx val=\"222222222\"/>"));
    assert!(xml.contains("<c:crossAx val=\"111111111\"/>"));
}

#[test]
fn bubble_scalars_reconstruct_into_modeled_chart_group() {
    let mut spec = minimal_chart_spec(DomainChartType::Bubble, None);
    spec.bubble_scale = Some(175);
    spec.show_neg_bubbles = Some(true);
    spec.size_represents = Some("w".to_string());
    spec.bubble_3d_effect = Some(true);

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:bubbleChart>"), "{xml}");
    assert!(xml.contains("<c:bubbleScale val=\"175\"/>"), "{xml}");
    assert!(xml.contains("<c:showNegBubbles val=\"1\"/>"), "{xml}");
    assert!(xml.contains("<c:sizeRepresents val=\"w\"/>"), "{xml}");
    assert!(xml.contains("<c:bubble3D val=\"1\"/>"), "{xml}");
}

#[test]
fn explicit_series_keep_distinct_default_idx_order() {
    let mut spec = minimal_chart_spec(DomainChartType::Line, None);
    spec.series = vec![
        ranges::chart_series_data(
            None,
            Some("A2:A4".to_string()),
            Some("B2:B4".to_string()),
            0,
        ),
        ranges::chart_series_data(
            None,
            Some("A2:A4".to_string()),
            Some("C2:C4".to_string()),
            1,
        ),
    ];
    spec.series[0].idx = None;
    spec.series[0].order = None;
    spec.series[1].idx = None;
    spec.series[1].order = None;

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:idx val=\"0\"/>"));
    assert!(xml.contains("<c:idx val=\"1\"/>"));
    assert!(xml.contains("<c:order val=\"0\"/>"));
    assert!(xml.contains("<c:order val=\"1\"/>"));
}

#[test]
fn literal_series_sources_reconstruct_from_imported_caches() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, None);
    let mut series = ranges::chart_series_data(None, None, None, 0);
    series.value_source_kind = Some(ChartSeriesDimensionSourceKindData::Literal);
    series.value_cache = Some(ChartSeriesPointCacheData {
        point_count: Some(2),
        format_code: Some("General".to_string()),
        points: vec![
            ChartSeriesPointCachePointData {
                idx: 0,
                value: "10".to_string(),
                format_code: None,
            },
            ChartSeriesPointCachePointData {
                idx: 1,
                value: "20".to_string(),
                format_code: None,
            },
        ],
    });
    series.category_source_kind = Some(ChartSeriesDimensionSourceKindData::Literal);
    series.category_cache = Some(ChartSeriesPointCacheData {
        point_count: Some(2),
        format_code: None,
        points: vec![
            ChartSeriesPointCachePointData {
                idx: 0,
                value: "North".to_string(),
                format_code: None,
            },
            ChartSeriesPointCachePointData {
                idx: 1,
                value: "South".to_string(),
                format_code: None,
            },
        ],
    });
    spec.series = vec![series];

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:strLit>"));
    assert!(xml.contains("<c:numLit>"));
    assert!(xml.contains("<c:formatCode>General</c:formatCode>"));
    assert!(xml.contains("<c:ptCount val=\"2\"/>"));
    assert!(xml.contains("<c:v>North</c:v>"));
    assert!(xml.contains("<c:v>20</c:v>"));
    assert!(!xml.contains("<c:f>"));
}

#[test]
fn scatter_data_range_uses_xy_axes_and_sources() {
    let spec = minimal_chart_spec(DomainChartType::Scatter, Some("'Sales Data'!A1:B4"));
    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:scatterChart>"));
    assert!(xml.contains("<c:xVal>"));
    assert!(xml.contains("<c:yVal>"));
    assert!(!xml.contains("<c:cat>"));
    assert_eq!(xml.matches("<c:valAx>").count(), 2);
    assert!(xml.contains("<c:f>'Sales Data'!A2:A4</c:f>"));
    assert!(xml.contains("<c:f>'Sales Data'!B2:B4</c:f>"));
}

#[test]
fn data_range_reversed_and_absolute_references_are_normalized() {
    let spec = minimal_chart_spec(DomainChartType::Column, Some("Data!$C$4:$A$1"));
    let xml = chart_xml(&spec);

    assert_eq!(xml.matches("<c:ser>").count(), 2);
    assert!(xml.contains("<c:f>Data!A2:A4</c:f>"));
    assert!(xml.contains("<c:f>Data!B2:B4</c:f>"));
    assert!(xml.contains("<c:f>Data!C2:C4</c:f>"));
}

#[test]
fn data_range_single_column_uses_values_without_categories() {
    let spec = minimal_chart_spec(DomainChartType::Line, Some("Data!A1:A4"));
    let xml = chart_xml(&spec);

    assert_eq!(xml.matches("<c:ser>").count(), 1);
    assert!(!xml.contains("<c:cat>"));
    assert!(xml.contains("<c:f>Data!A2:A4</c:f>"));
}

#[test]
fn data_range_single_row_emits_value_series_per_value_column() {
    let spec = minimal_chart_spec(DomainChartType::Line, Some("Data!A1:C1"));
    let xml = chart_xml(&spec);

    assert_eq!(xml.matches("<c:ser>").count(), 2);
    assert!(xml.contains("<c:f>Data!A1:A1</c:f>"));
    assert!(xml.contains("<c:f>Data!B1:B1</c:f>"));
    assert!(xml.contains("<c:f>Data!C1:C1</c:f>"));
}

#[test]
fn data_range_invalid_or_single_cell_emits_no_series() {
    let invalid = minimal_chart_spec(DomainChartType::Column, Some("not a range"));
    let single_cell = minimal_chart_spec(DomainChartType::Column, Some("Data!A1"));

    assert_eq!(chart_xml(&invalid).matches("<c:ser>").count(), 0);
    assert_eq!(chart_xml(&single_cell).matches("<c:ser>").count(), 0);
}

#[test]
fn data_range_preserves_quoted_sheet_names_and_escaped_quotes() {
    let spec = minimal_chart_spec(DomainChartType::Column, Some("'Bob''s Data'!A1:B3"));
    let xml = chart_xml(&spec);

    assert_eq!(xml.matches("<c:ser>").count(), 1);
    assert!(xml.contains("<c:f>'Bob''s Data'!A2:A3</c:f>"));
    assert!(xml.contains("<c:f>'Bob''s Data'!B2:B3</c:f>"));
}

#[test]
fn manual_layouts_reconstruct_for_chart_level_surfaces() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, Some("Data!A1:B3"));
    spec.plot_layout = Some(ManualLayout {
        layout_target: Some(LayoutTarget::Inner),
        x: Some(0.125),
        y: Some(0.25),
        w: Some(0.75),
        h: Some(0.5),
        ..Default::default()
    });
    spec.title_layout = Some(ManualLayout {
        x_mode: Some(LayoutMode::Edge),
        x: Some(0.375),
        y: Some(0.0625),
        ..Default::default()
    });
    spec.legend = Some(LegendData {
        show: true,
        position: "right".to_string(),
        visible: true,
        overlay: None,
        format: None,
        entries: None,
        custom_x: None,
        custom_y: None,
        layout: Some(ManualLayout {
            layout_target: Some(LayoutTarget::Outer),
            x: Some(0.875),
            y: Some(0.125),
            ..Default::default()
        }),
        shadow: None,
        show_shadow: None,
    });
    spec.data_labels = Some(DataLabelData {
        show: true,
        delete: None,
        position: None,
        format: None,
        show_value: Some(true),
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
        leader_lines_format: None,
        layout: Some(ManualLayout {
            y_mode: Some(LayoutMode::Edge),
            x: Some(0.3125),
            y: Some(0.4375),
            ..Default::default()
        }),
    });

    let xml = chart_xml(&spec);

    assert_eq!(xml.matches("<c:layout>").count(), 4);
    assert!(xml.contains("<c:layoutTarget val=\"inner\"/>"));
    assert!(xml.contains("<c:layoutTarget val=\"outer\"/>"));
    assert!(xml.contains("<c:xMode val=\"edge\"/>"));
    assert!(xml.contains("<c:yMode val=\"edge\"/>"));
    assert!(xml.contains("<c:x val=\"0.125\"/>"));
    assert!(xml.contains("<c:x val=\"0.375\"/>"));
    assert!(xml.contains("<c:x val=\"0.3125\"/>"));
    assert!(xml.contains("<c:x val=\"0.875\"/>"));
    assert!(xml.contains("<c:showVal val=\"1\"/>"));
}

#[test]
fn pivot_field_buttons_reconstruct_from_modeled_spec() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, None);
    spec.show_all_field_buttons = Some(true);
    spec.pivot_options = Some(PivotChartOptionsData {
        show_axis_field_buttons: Some(false),
        show_legend_field_buttons: Some(true),
        show_report_filter_field_buttons: Some(false),
        show_value_field_buttons: Some(true),
    });

    let xml = chart_xml(&spec);

    assert!(xml.contains(r#"<c:showAllFieldButtons val="1"/>"#));
    assert!(xml.contains(r#"<c:showAxisFieldButtons val="0"/>"#));
    assert!(xml.contains(r#"<c:showLegendFieldButtons val="1"/>"#));
    assert!(xml.contains(r#"<c:showValueFieldButtons val="1"/>"#));
    assert!(xml.contains(r#"<c:showReportFilterFieldButtons val="0"/>"#));
}

#[test]
fn modeled_axes_reconstruct_render_contract_fields() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, None);
    spec.axes = Some(AxisData {
        category_axis: Some(SingleAxisData {
            visible: true,
            number_format: Some("0".to_string()),
            link_number_format: Some(true),
            tick_label_spacing: Some(2),
            tick_mark_spacing: Some(3),
            crosses_at: Some("min".to_string()),
            ..Default::default()
        }),
        value_axis: Some(SingleAxisData {
            visible: true,
            scale_type: Some("logarithmic".to_string()),
            crosses_at: Some("custom".to_string()),
            crosses_at_value: Some(7.5),
            custom_display_unit: Some(2500.0),
            display_unit_label: Some("Custom Units".to_string()),
            display_unit_label_layout: Some(ManualLayout {
                x: Some(0.25),
                ..Default::default()
            }),
            display_unit_label_format: Some(ChartFormatData {
                fill: None,
                line: None,
                font: None,
                text_rotation: Some(45.0),
                text_vertical_type: None,
                shadow: None,
            }),
            ..Default::default()
        }),
        secondary_category_axis: None,
        secondary_value_axis: None,
        series_axis: None,
    });

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:numFmt formatCode=\"0\" sourceLinked=\"1\"/>"));
    assert!(xml.contains("<c:tickLblSkip val=\"2\"/>"));
    assert!(xml.contains("<c:tickMarkSkip val=\"3\"/>"));
    assert!(xml.contains("<c:crosses val=\"min\"/>"));
    assert!(xml.contains("<c:logBase val=\"10\"/>"));
    assert!(xml.contains("<c:crossesAt val=\"7.5\"/>"));
    assert!(xml.contains("<c:custUnit val=\"2500\"/>"));
    assert!(xml.contains("<c:dispUnitsLbl>"));
    assert!(xml.contains("<c:x val=\"0.25\"/>"));
    assert!(xml.contains("<a:t>Custom Units</a:t>"));
    assert!(xml.contains("<a:bodyPr rot=\"2700000\"/>"));
}

#[test]
fn original_axis_types_ids_and_cross_axis_ids_are_preserved() {
    let mut spec = minimal_chart_spec(DomainChartType::Scatter, None);
    spec.axes = Some(AxisData {
        category_axis: None,
        value_axis: Some(SingleAxisData {
            visible: true,
            title: Some("X Values".to_string()),
            ..Default::default()
        }),
        secondary_category_axis: None,
        secondary_value_axis: Some(SingleAxisData {
            visible: true,
            title: Some("Y Values".to_string()),
            ..Default::default()
        }),
        series_axis: None,
    });
    let spec = with_original_axes(
        spec,
        vec![
            ChartAxis {
                axis_type: AxisType::Value,
                ax_id: 10,
                cross_ax: 20,
                ax_pos: ChartAxisPosition::Bottom,
                ..Default::default()
            },
            ChartAxis {
                axis_type: AxisType::Value,
                ax_id: 20,
                cross_ax: 10,
                ax_pos: ChartAxisPosition::Left,
                ..Default::default()
            },
        ],
    );

    let xml = chart_xml(&spec);

    assert_eq!(xml.matches("<c:valAx>").count(), 2);
    assert!(!xml.contains("<c:catAx>"));
    assert!(xml.contains("<c:axId val=\"10\"/>"));
    assert!(xml.contains("<c:axId val=\"20\"/>"));
    assert!(xml.contains("<c:crossAx val=\"20\"/>"));
    assert!(xml.contains("<c:crossAx val=\"10\"/>"));
}

#[test]
fn reversed_original_axis_order_keeps_role_data_by_axis_type_and_position() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, None);
    spec.axes = Some(AxisData {
        category_axis: Some(SingleAxisData {
            visible: true,
            number_format: Some("0".to_string()),
            ..Default::default()
        }),
        value_axis: Some(SingleAxisData {
            visible: true,
            scale_type: Some("logarithmic".to_string()),
            ..Default::default()
        }),
        secondary_category_axis: None,
        secondary_value_axis: None,
        series_axis: None,
    });
    let spec = with_original_axes(
        spec,
        vec![
            ChartAxis {
                axis_type: AxisType::Value,
                ax_id: 200,
                cross_ax: 100,
                ax_pos: ChartAxisPosition::Left,
                ..Default::default()
            },
            ChartAxis {
                axis_type: AxisType::Category,
                ax_id: 100,
                cross_ax: 200,
                ax_pos: ChartAxisPosition::Bottom,
                ..Default::default()
            },
        ],
    );

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:valAx><c:axId val=\"200\"/>"));
    assert!(xml.contains("<c:catAx><c:axId val=\"100\"/>"));
    assert!(xml.contains("<c:logBase val=\"10\"/>"));
    assert!(xml.contains("<c:numFmt formatCode=\"0\""));
    assert!(xml.contains("<c:crossAx val=\"100\"/>"));
    assert!(xml.contains("<c:crossAx val=\"200\"/>"));
}
