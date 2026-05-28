use domain_types::{ChartDefinition, chart::ChartSpec};
use ooxml_types::charts::{self, DisplayBlanksAs};

use super::{
    axes::build_axes,
    chart_groups::build_chart_groups,
    chart_space::clean_chart_extensions,
    elements::{build_data_table, build_legend, build_surface, build_title, build_view_3d},
    formatting::build_shape_properties,
};

pub(super) fn build_chart(spec: &ChartSpec) -> charts::Chart {
    let imported_chart = match spec.definition.as_ref() {
        Some(ChartDefinition::Chart(chart_space)) => Some(&chart_space.chart),
        _ => None,
    };

    charts::Chart {
        title: build_title(spec.title.as_deref(), spec.title_format.as_ref()),
        auto_title_deleted: spec.auto_title_deleted,
        view_3d: spec.view_3d.as_ref().map(build_view_3d),
        floor: build_surface(spec.floor_format.as_ref()),
        side_wall: build_surface(spec.side_wall_format.as_ref()),
        back_wall: build_surface(spec.back_wall_format.as_ref()),
        plot_area: build_plot_area(spec),
        legend: spec.legend.as_ref().and_then(build_legend),
        plot_vis_only: spec.plot_visible_only,
        disp_blanks_as: spec
            .display_blanks_as
            .as_deref()
            .map(DisplayBlanksAs::from_ooxml),
        show_d_lbls_over_max: spec.show_data_labels_over_max,
        pivot_fmts: imported_chart
            .map(|chart| chart.pivot_fmts.clone())
            .unwrap_or_default(),
        extensions: imported_chart
            .map(|chart| clean_chart_extensions(&chart.extensions))
            .unwrap_or_default(),
        has_empty_ext_lst: false,
    }
}

pub(super) fn build_plot_area(spec: &ChartSpec) -> charts::PlotArea {
    let imported_plot_area = match spec.definition.as_ref() {
        Some(ChartDefinition::Chart(chart_space)) => Some(&chart_space.chart.plot_area),
        _ => None,
    };

    charts::PlotArea {
        layout: imported_plot_area.and_then(|plot_area| plot_area.layout.clone()),
        chart_groups: build_chart_groups(spec),
        axes: build_axes(spec),
        d_table: spec.data_table.as_ref().map(build_data_table),
        sp_pr: spec.plot_format.as_ref().and_then(build_shape_properties),
        extensions: imported_plot_area
            .map(|plot_area| clean_chart_extensions(&plot_area.extensions))
            .unwrap_or_default(),
    }
}
