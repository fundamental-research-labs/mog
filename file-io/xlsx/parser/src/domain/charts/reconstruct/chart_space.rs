use super::*;

// =============================================================================
// Top-level entry point
// =============================================================================

/// Reconstruct a ChartSpace from ChartSpec for XLSX export.
pub(super) fn build_chart_space(spec: &ChartSpec) -> ChartSpace {
    let rt = spec.rt.as_ref();

    ChartSpace {
        date1904: rt.and_then(|r| r.date1904),
        lang: rt.and_then(|r| r.lang.clone()),
        rounded_corners: spec.rounded_corners,
        style: spec.style,
        style_alternate_content: rt.and_then(|r| r.style_alternate_content.clone()),
        style_after_chart: rt.map(|r| r.style_after_chart).unwrap_or(false),
        clr_map_ovr: rt.and_then(|r| r.clr_map_ovr.map(Into::into)),
        protection: rt.and_then(|r| r.protection.clone().map(Into::into)),
        chart: build_chart(spec),
        sp_pr: spec.chart_format.as_ref().and_then(build_shape_properties),
        tx_pr: spec.chart_format.as_ref().and_then(build_text_body),
        // These nodes carry chart-owned r:ids. They are dropped until the XLSX
        // writer registers and resolves their target relationships through the
        // package graph.
        external_data: None,
        pivot_source: rt.and_then(|r| r.pivot_source.clone().map(Into::into)),
        user_shapes: None,
        print_settings: rt.and_then(|r| r.print_settings.clone().map(Into::into)),
        extensions: rt
            .map(|r| clean_chart_extensions(&r.chart_space_extensions))
            .unwrap_or_default(),
    }
}

// =============================================================================
// Chart
// =============================================================================

pub(super) fn build_chart(spec: &ChartSpec) -> charts::Chart {
    let rt = spec.rt.as_ref();

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
        pivot_fmts: rt
            .map(|r| r.pivot_fmts.iter().cloned().map(Into::into).collect())
            .unwrap_or_default(),
        extensions: rt
            .map(|r| clean_chart_extensions(&r.chart_extensions))
            .unwrap_or_default(),
        has_empty_ext_lst: rt.map(|r| r.has_empty_chart_ext_lst).unwrap_or(false),
    }
}

// =============================================================================
// Plot Area
// =============================================================================

pub(super) fn build_plot_area(spec: &ChartSpec) -> charts::PlotArea {
    let rt = spec.rt.as_ref();

    charts::PlotArea {
        layout: rt.and_then(|r| r.plot_area_layout.clone().map(Into::into)),
        chart_groups: build_chart_groups(spec),
        axes: build_axes(spec),
        d_table: spec.data_table.as_ref().map(build_data_table),
        sp_pr: spec.plot_format.as_ref().and_then(build_shape_properties),
        extensions: rt
            .map(|r| clean_chart_extensions(&r.plot_area_extensions))
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
