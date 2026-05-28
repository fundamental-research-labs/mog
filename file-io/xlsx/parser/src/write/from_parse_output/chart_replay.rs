use super::chart_auxiliary;
use crate::write::write_error::WriteError;

pub(super) fn should_reconstruct_chart_space(chart_spec: &domain_types::ChartSpec) -> bool {
    if has_modeled_chart_space_state(chart_spec) {
        return true;
    }

    if matches!(
        chart_spec.definition,
        Some(domain_types::ChartDefinition::Chart(_))
    ) {
        return false;
    }

    false
}

fn has_modeled_chart_space_state(chart_spec: &domain_types::ChartSpec) -> bool {
    chart_spec
        .title
        .as_deref()
        .is_some_and(|title| !title.is_empty())
        || !chart_spec.series.is_empty()
        || chart_spec
            .data_range
            .as_deref()
            .is_some_and(|range| !range.is_empty())
        || chart_spec.axes.is_some()
        || chart_spec.legend.is_some()
        || chart_spec.data_labels.is_some()
        || chart_spec.data_table.is_some()
        || chart_spec.style.is_some()
        || chart_spec.rounded_corners.is_some()
        || chart_spec.auto_title_deleted.is_some()
        || chart_spec.show_data_labels_over_max.is_some()
        || chart_spec.chart_format.is_some()
        || chart_spec.plot_format.is_some()
        || chart_spec.title_format.is_some()
        || chart_spec.title_rich_text.is_some()
        || chart_spec.title_formula.is_some()
        || chart_spec.display_blanks_as.is_some()
        || chart_spec.plot_visible_only.is_some()
        || chart_spec.sub_type.is_some()
        || chart_spec.gap_width.is_some()
        || chart_spec.overlap.is_some()
        || chart_spec.doughnut_hole_size.is_some()
        || chart_spec.first_slice_angle.is_some()
        || chart_spec.bubble_scale.is_some()
        || chart_spec.split_type.is_some()
        || chart_spec.split_value.is_some()
        || chart_spec.bar_shape.is_some()
        || chart_spec.bubble_3d_effect.is_some()
        || chart_spec.wireframe.is_some()
        || chart_spec.surface_top_view.is_some()
        || chart_spec.color_scheme.is_some()
        || chart_spec.category_label_level.is_some()
        || chart_spec.series_name_level.is_some()
        || chart_spec.show_all_field_buttons.is_some()
        || chart_spec.second_plot_size.is_some()
        || chart_spec.vary_by_categories.is_some()
        || chart_spec.title_h_align.is_some()
        || chart_spec.title_v_align.is_some()
        || chart_spec.title_show_shadow.is_some()
        || chart_spec.pivot_options.is_some()
        || chart_spec.view_3d.is_some()
        || chart_spec.floor_format.is_some()
        || chart_spec.side_wall_format.is_some()
        || chart_spec.back_wall_format.is_some()
}

pub(super) fn chart_allows_auxiliary_replay(chart_spec: &domain_types::ChartSpec) -> bool {
    chart_auxiliary::chart_auxiliary_data(chart_spec).is_some()
}

pub(super) fn register_chart_owned_external_relationships(
    package_graph_builder: &mut crate::write::package_graph::PackageGraphBuilder,
    chart_path: &str,
    chart_spec: &domain_types::ChartSpec,
) -> Result<(), WriteError> {
    if let Some((_, rel)) = chart_auxiliary::chart_external_data_relationship(chart_spec) {
        if rel.target_mode.as_deref() == Some("External")
            && let (Some(rel_type), Some(target)) =
                (rel.relationship_type.as_deref(), rel.target.as_deref())
        {
            crate::write::package_graph::register_chart_external_relationship(
                package_graph_builder,
                chart_path,
                rel_type,
                target,
                &rel.r_id,
            );
        }
    }

    if let Some(user_shapes) = chart_auxiliary::chart_user_shapes_data(chart_spec, chart_path) {
        crate::write::package_graph::register_chart_auxiliary_part(
            package_graph_builder,
            &user_shapes.path,
        )?;
        crate::write::package_graph::register_chart_auxiliary_relationship(
            package_graph_builder,
            chart_path,
            user_shapes.relationship_type,
            &user_shapes.path,
            user_shapes.relationship_id_hint,
        );
    }

    Ok(())
}
