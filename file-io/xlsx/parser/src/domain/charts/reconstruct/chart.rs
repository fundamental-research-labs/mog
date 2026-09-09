use domain_types::{
    ChartDefinition,
    chart::{ChartSpec, normalize_explicit_display_blanks_as},
};
use ooxml_types::charts::{self, ChartText, DisplayBlanksAs};
use ooxml_types::drawings::TextRunContent;

use super::{
    axes::build_axes,
    chart_groups::{build_chart_groups, reconcile_chart_group_axis_ids},
    chart_space::clean_chart_extensions,
    chart_space::merge_imported_shape_properties,
    elements::{
        TitleTextSource, build_data_table, build_legend, build_surface, build_title, build_view_3d,
    },
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
    let imported_title = imported_chart.and_then(|chart| chart.title.as_ref());
    let imported_title_text =
        imported_title.and_then(crate::domain::charts::axes::extract_title_text);
    let title_was_cleared =
        imported_title_text.is_some() && spec.title.is_none() && spec.title_formula.is_none();
    let mut title = build_title(
        TitleTextSource {
            text: spec.title.as_deref(),
            formula: spec.title_formula.as_deref(),
        },
        spec.title_format.as_ref(),
        spec.title_rich_text.as_deref(),
        title_layout,
        spec.title_h_align.as_deref(),
        spec.title_v_align.as_deref(),
        spec.title_show_shadow,
    );
    if title_was_cleared {
        // Formatting and rich-text snapshots remain populated after a caller
        // clears only the public title text. Treat that transition as an
        // owner clear before importing the old title ShapeProperties, which
        // may contain a relationship-backed picture fill.
        title = None;
    }
    if title.is_none()
        && spec.title.is_none()
        && spec.title_formula.is_none()
        && spec.title_rich_text.is_none()
        && spec.auto_title_deleted != Some(true)
        && imported_title.is_some_and(|title| !title_has_visible_text(title))
    {
        let mut empty_title = charts::Title {
            layout: title_layout.cloned().map(Into::into),
            ..Default::default()
        };
        empty_title.tx = imported_title.and_then(|title| title.tx.clone());
        title = Some(empty_title);
    }
    if let Some(title) = title.as_mut() {
        if let Some(imported_title) = imported_title {
            preserve_imported_title_text_properties(title, Some(imported_title));
            merge_imported_shape_properties(&mut title.sp_pr, imported_title.sp_pr.as_ref());
            title.overlay = title.overlay.or(imported_title.overlay);
        }
    }
    let mut legend = spec.legend.as_ref().and_then(build_legend);
    if let (Some(legend), Some(imported_legend)) = (
        legend.as_mut(),
        imported_chart.and_then(|chart| chart.legend.as_ref()),
    ) {
        merge_imported_shape_properties(&mut legend.sp_pr, imported_legend.sp_pr.as_ref());
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

    let mut floor = build_surface(spec.floor_format.as_ref());
    preserve_imported_surface(
        &mut floor,
        imported_chart.and_then(|chart| chart.floor.as_ref()),
    );
    let mut side_wall = build_surface(spec.side_wall_format.as_ref());
    preserve_imported_surface(
        &mut side_wall,
        imported_chart.and_then(|chart| chart.side_wall.as_ref()),
    );
    let mut back_wall = build_surface(spec.back_wall_format.as_ref());
    preserve_imported_surface(
        &mut back_wall,
        imported_chart.and_then(|chart| chart.back_wall.as_ref()),
    );

    charts::Chart {
        title,
        auto_title_deleted: spec.auto_title_deleted,
        view_3d: spec.view_3d.as_ref().map(build_view_3d),
        floor,
        side_wall,
        back_wall,
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

fn preserve_imported_surface(
    target: &mut Option<charts::ChartSurface>,
    imported: Option<&charts::ChartSurface>,
) {
    let Some(imported) = imported else {
        return;
    };
    let Some(target) = target.as_mut() else {
        *target = Some(imported.clone());
        return;
    };
    if target.thickness.is_none() {
        target.thickness = imported.thickness.clone();
    }
    if target.picture_options.is_none() {
        target.picture_options = imported.picture_options.clone();
    }
    if target.extensions.is_empty() {
        target.extensions = imported.extensions.clone();
    }
    merge_imported_shape_properties(&mut target.sp_pr, imported.sp_pr.as_ref());
}

fn title_has_visible_text(title: &charts::Title) -> bool {
    match title.tx.as_ref() {
        Some(ChartText::Rich(body)) => body.paragraphs.iter().any(|paragraph| {
            paragraph.runs.iter().any(|run| match run {
                TextRunContent::Run(run) => !run.text.is_empty(),
                TextRunContent::Field { text, .. } => {
                    text.as_deref().is_some_and(|text| !text.is_empty())
                }
                TextRunContent::LineBreak { .. } => false,
            })
        }),
        Some(ChartText::StrRef(str_ref)) => {
            !str_ref.f.trim().is_empty()
                || str_ref
                    .str_cache
                    .as_ref()
                    .is_some_and(|cache| cache.pts.iter().any(|point| !point.v.is_empty()))
        }
        None => false,
    }
}

pub(super) fn build_plot_area(spec: &ChartSpec) -> charts::PlotArea {
    let imported_plot_area = match spec.definition.as_ref() {
        Some(ChartDefinition::Chart(chart_space)) => Some(&chart_space.chart.plot_area),
        _ => None,
    };

    let axes = build_axes(spec);
    let mut chart_groups = build_chart_groups(spec);
    reconcile_chart_group_axis_ids(&mut chart_groups, &axes, spec);

    let mut d_table = spec
        .data_table
        .as_ref()
        .filter(|data_table| data_table.visible != Some(false))
        .map(build_data_table);
    if let Some(imported_data_table) =
        imported_plot_area.and_then(|plot_area| plot_area.d_table.as_ref())
    {
        if let Some(d_table) = d_table.as_mut() {
            merge_imported_shape_properties(&mut d_table.sp_pr, imported_data_table.sp_pr.as_ref());
            preserve_imported_text_body_properties(
                &mut d_table.tx_pr,
                imported_data_table.tx_pr.as_ref(),
            );
            if d_table.extensions.is_empty() {
                d_table.extensions = imported_data_table.extensions.clone();
            }
        } else if !spec
            .data_table
            .as_ref()
            .is_some_and(|data_table| data_table.visible == Some(false))
        {
            d_table = Some(imported_data_table.clone());
        }
    }

    let mut sp_pr = spec.plot_format.as_ref().and_then(build_shape_properties);
    merge_imported_shape_properties(
        &mut sp_pr,
        imported_plot_area.and_then(|plot_area| plot_area.sp_pr.as_ref()),
    );

    charts::PlotArea {
        layout: spec
            .plot_layout
            .clone()
            .map(Into::into)
            .or_else(|| imported_plot_area.and_then(|plot_area| plot_area.layout.clone())),
        chart_groups,
        axes,
        d_table,
        sp_pr,
        extensions: imported_plot_area
            .map(|plot_area| clean_chart_extensions(&plot_area.extensions))
            .unwrap_or_default(),
    }
}
