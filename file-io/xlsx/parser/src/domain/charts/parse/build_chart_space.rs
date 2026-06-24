//! Canonical chart-space assembly from the parsed chart model.

use super::super::*;

pub(super) fn build_chart_space(chart: &Chart) -> ooxml_types::charts::ChartSpace {
    use ooxml_types::charts as oc;

    // Use axes in original XML encounter order for lossless round-trip.
    let axes: Vec<oc::ChartAxis> = chart.plot_area.axes_ordered.clone();

    // Use axIds from the chart type element in their original order.
    // Fall back to axes_ordered if no chart-type axIds were parsed.
    let ax_ids: Vec<u32> = if chart.chart_type_ax_ids.is_empty() {
        axes.iter().map(|a| a.ax_id).collect()
    } else {
        chart.chart_type_ax_ids.clone()
    };

    let chart_groups = if !chart.chart_groups.is_empty() {
        // Combo chart: use pre-built groups directly (preserves per-group config/series/axIds).
        chart.chart_groups.clone()
    } else if let Some(config) = &chart.chart_type_config {
        // Single chart type: build one group from flat fields.
        vec![oc::ChartGroup {
            chart_type: chart.chart_type,
            config: config.clone(),
            series: chart.series.clone(),
            d_lbls: chart.data_labels.clone(),
            ax_id: ax_ids,
            raw_chart_type_attr: chart.raw_chart_type_attr.clone(),
            raw_chart_element_name: None,
            raw_chart_group_xml: None,
        }]
    } else {
        Vec::new()
    };

    oc::ChartSpace {
        // date1904 and rounded_corners use Option to preserve absence vs false.
        date1904: chart.date1904,
        lang: chart.lang.clone(),
        rounded_corners: chart.rounded_corners,
        style: chart.style.map(|s| s as u8),
        style_alternate_content: chart.style_alternate_content.clone(),
        style_after_chart: chart.style_after_chart,
        clr_map_ovr: chart.clr_map_ovr.clone(),
        protection: chart.protection.clone(),
        chart: oc::Chart {
            title: chart.title.clone(),
            auto_title_deleted: chart.auto_title_deleted,
            view_3d: chart.view_3d.clone(),
            floor: chart.floor.clone(),
            side_wall: chart.side_wall.clone(),
            back_wall: chart.back_wall.clone(),
            plot_area: oc::PlotArea {
                layout: chart.plot_area.layout.clone(),
                chart_groups,
                axes,
                d_table: chart.plot_area.data_table.clone(),
                sp_pr: chart.plot_area.sp_pr.clone(),
                extensions: chart.plot_area.extensions.clone(),
            },
            legend: chart.legend.clone(),
            plot_vis_only: chart.display_options.plot_vis_only,
            disp_blanks_as: chart.display_options.disp_blanks_as,
            show_d_lbls_over_max: chart.display_options.show_data_lbls_over_max,
            show_all_field_buttons: chart.show_all_field_buttons,
            show_axis_field_buttons: chart.show_axis_field_buttons,
            show_legend_field_buttons: chart.show_legend_field_buttons,
            show_value_field_buttons: chart.show_value_field_buttons,
            show_report_filter_field_buttons: chart.show_report_filter_field_buttons,
            pivot_fmts: chart.pivot_fmts.clone(),
            extensions: chart.chart_extensions.clone(),
            has_empty_ext_lst: chart.has_empty_chart_ext_lst,
        },
        sp_pr: chart.sp_pr.clone(),
        tx_pr: chart.tx_pr.clone(),
        external_data: chart.external_data.clone(),
        pivot_source: chart.pivot_source.clone(),
        user_shapes: chart.user_shapes.clone(),
        print_settings: chart.print_settings.clone(),
        extensions: chart.chart_space_extensions.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_chart_space_preserves_show_data_labels_over_max_absence() {
        let chart = Chart::default();

        let chart_space = build_chart_space(&chart);

        assert_eq!(chart_space.chart.show_d_lbls_over_max, None);
    }

    #[test]
    fn build_chart_space_preserves_plot_visible_only_absence() {
        let chart = Chart::default();

        let chart_space = build_chart_space(&chart);

        assert_eq!(chart_space.chart.plot_vis_only, None);
    }

    #[test]
    fn build_chart_space_preserves_plot_visible_only_explicit_false() {
        let mut chart = Chart::default();
        chart.display_options.plot_vis_only = Some(false);

        let chart_space = build_chart_space(&chart);

        assert_eq!(chart_space.chart.plot_vis_only, Some(false));
    }

    #[test]
    fn build_chart_space_preserves_show_data_labels_over_max_explicit_false() {
        let mut chart = Chart::default();
        chart.display_options.show_data_lbls_over_max = Some(false);

        let chart_space = build_chart_space(&chart);

        assert_eq!(chart_space.chart.show_d_lbls_over_max, Some(false));
    }
}
