//! Conversion from parsed Chart + anchor info into domain ChartSpec types.

use super::extraction::{
    chart_import_status_for_renderability, extract_axes, extract_chart_data_labels,
    extract_chart_series, extract_data_range, extract_legend, extract_sub_type,
    map_chart_type_to_ts,
};
use super::xml_parsing::ChartRefInfo;

/// Convert a parsed Chart + anchor info into a `ChartSpec` (domain type).
///
/// This builds the `ChartSpec` directly, embedding all the lossy import fields
/// (series, legend, axes, data labels, etc.) into the `ChartDefinition` JSON blob.
pub(super) fn convert_chart_to_chart_spec(
    chart: &crate::domain::charts::Chart,
    anchor: &ChartRefInfo,
) -> domain_types::ChartSpec {
    use domain_types::chart::{AnchorPosition, ObjectSize};
    use domain_types::{ChartDefinition, ChartSpec};

    // Map chart_type + config to TS chart type string
    let chart_type_str = map_chart_type_to_ts(chart);

    // Extract title text
    let title = chart
        .title
        .as_ref()
        .and_then(|t| crate::domain::charts::extract_chart_title_text(t));

    // Convert EMUs to pixels (1 pixel = 9525 EMUs)
    let width_px = (anchor.cx / 9525).max(100) as f64;
    let height_px = (anchor.cy / 9525).max(100) as f64;

    // Extract typed series data directly from OOXML types
    let series = extract_chart_series(chart);
    let sub_type = extract_chart_sub_type(chart);
    let legend = extract_legend(chart);
    let axes = extract_axes(chart);
    let chart_data_labels = extract_chart_data_labels(chart);
    let data_range = extract_data_range(chart);
    let import_status = chart_import_status_for_renderability(
        &series,
        data_range.as_deref(),
        chart.original_path.as_deref(),
        anchor.cnv_pr_name.as_deref(),
    );

    ChartSpec {
        chart_type: domain_types::ChartType::from_str(&chart_type_str),
        title,
        position: AnchorPosition {
            anchor_row: anchor.from_row,
            anchor_col: anchor.from_col,
            anchor_row_offset: anchor.from_row_off,
            anchor_col_offset: anchor.from_col_off,
            absolute_x: anchor.absolute_x,
            absolute_y: anchor.absolute_y,
            end_row: anchor.to_row,
            end_col: anchor.to_col,
            end_row_offset: anchor.to_row_off,
            end_col_offset: anchor.to_col_off,
            // For oneCellAnchor (no to_row), preserve the extent dimensions.
            extent_cx: if anchor.to_row.is_none() && anchor.cx > 0 {
                Some(anchor.cx)
            } else {
                None
            },
            extent_cy: if anchor.to_row.is_none() && anchor.cy > 0 {
                Some(anchor.cy)
            } else {
                None
            },
        },
        size: ObjectSize {
            width: width_px,
            height: height_px,
            ..Default::default()
        },
        z_index: 0,
        // Placeholder — this definition is always replaced by the lossless ChartSpace
        // in convert_parsed_charts_to_chart_specs (features.rs).
        definition: Some(ChartDefinition::Chart(
            ooxml_types::charts::ChartSpace::default(),
        )),
        series,
        sub_type,
        legend,
        axes,
        data_labels: chart_data_labels,
        data_range,
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
        cnv_pr_name: anchor.cnv_pr_name.clone(),
        cnv_pr_id: anchor.cnv_pr_id,
        cnv_pr_descr: anchor.cnv_pr_descr.clone(),
        cnv_pr_title: anchor.cnv_pr_title.clone(),
        cnv_pr_hidden: anchor.cnv_pr_hidden,
        no_change_aspect: anchor.no_change_aspect,
        has_graphic_frame_locks: anchor.has_graphic_frame_locks,
        xfrm_off_x: anchor.xfrm_off_x,
        xfrm_off_y: anchor.xfrm_off_y,
        xfrm_ext_cx: anchor.xfrm_ext_cx,
        xfrm_ext_cy: anchor.xfrm_ext_cy,
        cnv_pr_ext_lst: anchor.cnv_pr_ext_lst.clone(),
        anchor_edit_as: anchor.anchor_edit_as.clone(),
        macro_name: anchor.macro_name.clone(),
        client_data_locks_with_sheet: anchor.client_data_locks_with_sheet,
        client_data_prints_with_sheet: anchor.client_data_prints_with_sheet,
        anchor_index: anchor.anchor_index,
        import_status,
    }
}

/// Extract chart sub-type as a typed ChartSubType enum.
pub(super) fn extract_chart_sub_type(
    chart: &crate::domain::charts::Chart,
) -> Option<domain_types::chart::ChartSubType> {
    extract_sub_type(chart).map(|s| domain_types::chart::ChartSubType::from_str(&s))
}
