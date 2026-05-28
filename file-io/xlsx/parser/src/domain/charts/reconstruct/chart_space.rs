use super::*;

// =============================================================================
// Top-level entry point
// =============================================================================

/// Reconstruct a ChartSpace from ChartSpec for XLSX export.
pub(super) fn build_chart_space(spec: &ChartSpec) -> ChartSpace {
    let imported = match spec.definition.as_ref() {
        Some(domain_types::ChartDefinition::Chart(chart_space)) => Some(chart_space),
        _ => None,
    };

    ChartSpace {
        date1904: imported.and_then(|chart_space| chart_space.date1904),
        lang: imported.and_then(|chart_space| chart_space.lang.clone()),
        rounded_corners: spec.rounded_corners,
        style: spec.style,
        style_alternate_content: imported
            .and_then(|chart_space| chart_space.style_alternate_content.clone()),
        style_after_chart: imported
            .map(|chart_space| chart_space.style_after_chart)
            .unwrap_or(false),
        clr_map_ovr: imported.and_then(|chart_space| chart_space.clr_map_ovr.clone()),
        protection: imported.and_then(|chart_space| chart_space.protection.clone()),
        chart: build_chart(spec),
        sp_pr: spec.chart_format.as_ref().and_then(build_shape_properties),
        tx_pr: spec.chart_format.as_ref().and_then(build_text_body),
        external_data: spec
            .definition
            .as_ref()
            .and_then(|definition| match definition {
                domain_types::ChartDefinition::Chart(chart_space) => {
                    chart_space.external_data.clone()
                }
                domain_types::ChartDefinition::ChartEx(_) => None,
            }),
        pivot_source: imported.and_then(|chart_space| chart_space.pivot_source.clone()),
        user_shapes: spec
            .definition
            .as_ref()
            .and_then(|definition| match definition {
                domain_types::ChartDefinition::Chart(chart_space) => {
                    chart_space.user_shapes.clone()
                }
                domain_types::ChartDefinition::ChartEx(_) => None,
            }),
        print_settings: imported.and_then(|chart_space| chart_space.print_settings.clone()),
        extensions: imported
            .map(|chart_space| clean_chart_extensions(&chart_space.extensions))
            .unwrap_or_default(),
    }
}

// =============================================================================
// Chart
// =============================================================================

pub(super) fn build_chart(spec: &ChartSpec) -> charts::Chart {
    let imported_chart = match spec.definition.as_ref() {
        Some(domain_types::ChartDefinition::Chart(chart_space)) => Some(&chart_space.chart),
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

// =============================================================================
// Plot Area
// =============================================================================

pub(super) fn build_plot_area(spec: &ChartSpec) -> charts::PlotArea {
    let imported_plot_area = match spec.definition.as_ref() {
        Some(domain_types::ChartDefinition::Chart(chart_space)) => {
            Some(&chart_space.chart.plot_area)
        }
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

pub(super) fn clean_chart_extensions(
    extensions: &[ooxml_types::charts::ExtensionEntry],
) -> Vec<ooxml_types::charts::ExtensionEntry> {
    extensions
        .iter()
        .filter(|extension| !crate::infra::xml::raw_xml_contains_relationship_attr(&extension.xml))
        .cloned()
        .collect()
}
