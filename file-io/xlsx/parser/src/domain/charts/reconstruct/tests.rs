use crate::domain::charts::write_canonical::serialize_chart_space;
use domain_types::chart::{AnchorPosition, ChartSpec, ChartType as DomainChartType, ObjectSize};

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
        data_table: None,
        display_blanks_as: None,
        plot_visible_only: None,
        gap_width: None,
        overlap: None,
        doughnut_hole_size: None,
        first_slice_angle: None,
        bubble_scale: None,
        split_type: None,
        split_value: None,
        bar_shape: None,
        bubble_3d_effect: None,
        wireframe: None,
        surface_top_view: None,
        color_scheme: None,
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
