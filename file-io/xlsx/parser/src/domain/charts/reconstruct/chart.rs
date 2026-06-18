use domain_types::{
    ChartDefinition,
    chart::{ChartSpec, normalize_explicit_display_blanks_as},
};
use ooxml_types::charts::{self, DisplayBlanksAs};

use super::{
    axes::build_axes,
    chart_groups::build_chart_groups,
    chart_space::clean_chart_extensions,
    elements::{build_data_table, build_legend, build_surface, build_title, build_view_3d},
    formatting::build_shape_properties,
    text_body_fidelity::{
        preserve_imported_text_body_properties, preserve_imported_title_text_properties,
    },
};

pub(super) fn build_chart(spec: &ChartSpec) -> charts::Chart {
    let imported_chart = match spec.definition.as_ref() {
        Some(ChartDefinition::Chart(chart_space)) => Some(&chart_space.chart),
        _ => None,
    };
    let imported_title_layout: Option<domain_types::domain::drawings::ManualLayout> =
        imported_chart
            .and_then(|chart| chart.title.as_ref())
            .and_then(|title| title.layout.as_ref())
            .map(Into::into);
    let title_layout = spec
        .title_layout
        .as_ref()
        .or(imported_title_layout.as_ref());
    let mut title = build_title(
        spec.title.as_deref(),
        spec.title_format.as_ref(),
        spec.title_rich_text.as_deref(),
        title_layout,
        spec.title_h_align.as_deref(),
        spec.title_v_align.as_deref(),
        spec.title_show_shadow,
    );
    if let Some(title) = title.as_mut() {
        preserve_imported_title_text_properties(
            title,
            imported_chart.and_then(|chart| chart.title.as_ref()),
        );
    }
    let mut legend = spec.legend.as_ref().and_then(build_legend);
    if let (Some(legend), Some(imported_legend)) = (
        legend.as_mut(),
        imported_chart.and_then(|chart| chart.legend.as_ref()),
    ) {
        preserve_imported_text_body_properties(&mut legend.tx_pr, imported_legend.tx_pr.as_ref());
        for entry in &mut legend.legend_entry {
            let imported_entry = imported_legend
                .legend_entry
                .iter()
                .find(|candidate| candidate.idx == entry.idx);
            if let Some(imported_entry) = imported_entry {
                preserve_imported_text_body_properties(
                    &mut entry.tx_pr,
                    imported_entry.tx_pr.as_ref(),
                );
            }
        }
    }

    charts::Chart {
        title,
        auto_title_deleted: spec.auto_title_deleted,
        view_3d: spec.view_3d.as_ref().map(build_view_3d),
        floor: build_surface(spec.floor_format.as_ref()),
        side_wall: build_surface(spec.side_wall_format.as_ref()),
        back_wall: build_surface(spec.back_wall_format.as_ref()),
        plot_area: build_plot_area(spec),
        legend,
        plot_vis_only: spec.plot_visible_only,
        disp_blanks_as: spec.display_blanks_as.as_deref().and_then(|value| {
            normalize_explicit_display_blanks_as(value)
                .map(|normalized| DisplayBlanksAs::from_ooxml(&normalized))
        }),
        show_d_lbls_over_max: spec.show_data_labels_over_max,
        show_all_field_buttons: spec
            .show_all_field_buttons
            .or_else(|| imported_chart.and_then(|chart| chart.show_all_field_buttons)),
        show_axis_field_buttons: spec
            .pivot_options
            .as_ref()
            .and_then(|options| options.show_axis_field_buttons)
            .or_else(|| imported_chart.and_then(|chart| chart.show_axis_field_buttons)),
        show_legend_field_buttons: spec
            .pivot_options
            .as_ref()
            .and_then(|options| options.show_legend_field_buttons)
            .or_else(|| imported_chart.and_then(|chart| chart.show_legend_field_buttons)),
        show_value_field_buttons: spec
            .pivot_options
            .as_ref()
            .and_then(|options| options.show_value_field_buttons)
            .or_else(|| imported_chart.and_then(|chart| chart.show_value_field_buttons)),
        show_report_filter_field_buttons: spec
            .pivot_options
            .as_ref()
            .and_then(|options| options.show_report_filter_field_buttons)
            .or_else(|| imported_chart.and_then(|chart| chart.show_report_filter_field_buttons)),
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
        layout: spec
            .plot_layout
            .clone()
            .map(Into::into)
            .or_else(|| imported_plot_area.and_then(|plot_area| plot_area.layout.clone())),
        chart_groups: build_chart_groups(spec),
        axes: build_axes(spec),
        d_table: spec
            .data_table
            .as_ref()
            .filter(|data_table| data_table.visible != Some(false))
            .map(build_data_table),
        sp_pr: spec.plot_format.as_ref().and_then(build_shape_properties),
        extensions: imported_plot_area
            .map(|plot_area| clean_chart_extensions(&plot_area.extensions))
            .unwrap_or_default(),
    }
}
