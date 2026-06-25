use super::chart_auxiliary;
use crate::domain::charts::chart_ex::chart_ex_title_text;
use crate::write::write_error::WriteError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum StandardChartExportPlan {
    ReplayImportedChartSpace,
    ReconstructFromModel,
}

pub(super) fn standard_chart_export_plan(
    chart_spec: &domain_types::ChartSpec,
) -> StandardChartExportPlan {
    if can_replay_current_imported_chart_space(chart_spec) {
        StandardChartExportPlan::ReplayImportedChartSpace
    } else {
        StandardChartExportPlan::ReconstructFromModel
    }
}

pub(super) fn should_reconstruct_chart_space(chart_spec: &domain_types::ChartSpec) -> bool {
    matches!(
        standard_chart_export_plan(chart_spec),
        StandardChartExportPlan::ReconstructFromModel
    )
}

pub(super) fn should_complete_sources_for_xlsx_export(
    chart_spec: &domain_types::ChartSpec,
) -> bool {
    !chart_spec.is_chart_ex
        && has_live_chart_source_refs(chart_spec)
        && matches!(
            standard_chart_export_plan(chart_spec),
            StandardChartExportPlan::ReconstructFromModel
        )
}

fn can_replay_current_imported_chart_space(chart_spec: &domain_types::ChartSpec) -> bool {
    if !matches!(
        chart_spec.definition,
        Some(domain_types::ChartDefinition::Chart(_))
    ) {
        return false;
    }

    let Some(provenance) = chart_spec.standard_chart_provenance.as_ref() else {
        return false;
    };
    let Some(authority) = chart_spec.standard_chart_export_authority.as_ref() else {
        return false;
    };
    if authority.schema_version == 0
        || !matches!(
            authority.validity,
            domain_types::chart::StandardChartAuthorityValidity::Current
        )
        || !authority.relationship_closure_current
        || !authority.invalidated_owner_ids.is_empty()
    {
        return false;
    }

    if provenance.projection_schema_version != STANDARD_CHART_PROJECTION_SCHEMA_VERSION {
        return false;
    }
    if provenance.original_path.as_deref() != authority.package_owner.as_deref() {
        return false;
    }
    let current_fingerprint = standard_chart_projection_fingerprint(chart_spec);
    provenance.projection_fingerprint.as_deref() == Some(current_fingerprint.as_str())
        && authority.projection_fingerprint.as_deref() == Some(current_fingerprint.as_str())
}

fn has_live_chart_source_refs(chart_spec: &domain_types::ChartSpec) -> bool {
    chart_spec
        .data_range
        .as_deref()
        .is_some_and(|range| !range.trim().is_empty())
        || chart_spec.series.iter().any(series_has_live_source_refs)
}

fn series_has_live_source_refs(series: &domain_types::chart::ChartSeriesData) -> bool {
    live_source_ref(series.values.as_deref(), series.value_source_kind)
        || live_source_ref(series.categories.as_deref(), series.category_source_kind)
        || live_source_ref(
            series.bubble_size.as_deref(),
            series.bubble_size_source_kind,
        )
}

fn live_source_ref(
    formula: Option<&str>,
    source_kind: Option<domain_types::chart::ChartSeriesDimensionSourceKindData>,
) -> bool {
    formula.is_some_and(|formula| !formula.trim().is_empty())
        && matches!(
            source_kind,
            None | Some(domain_types::chart::ChartSeriesDimensionSourceKindData::Ref)
        )
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
        || chart_spec
            .series_range
            .as_deref()
            .is_some_and(|range| !range.is_empty())
        || chart_spec
            .category_range
            .as_deref()
            .is_some_and(|range| !range.is_empty())
        || chart_spec
            .colors
            .as_ref()
            .is_some_and(|colors| !colors.is_empty())
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
        || chart_spec.plot_layout.is_some()
        || chart_spec.title_layout.is_some()
        || chart_spec.display_blanks_as.is_some()
        || chart_spec.plot_visible_only.is_some()
        || chart_spec.sub_type.is_some()
        || chart_spec.gap_width.is_some()
        || chart_spec.gap_depth.is_some()
        || chart_spec.overlap.is_some()
        || chart_spec.doughnut_hole_size.is_some()
        || chart_spec.first_slice_angle.is_some()
        || chart_spec.bubble_scale.is_some()
        || chart_spec.show_neg_bubbles.is_some()
        || chart_spec.size_represents.is_some()
        || chart_spec.split_type.is_some()
        || chart_spec.split_value.is_some()
        || chart_spec.bar_shape.is_some()
        || chart_spec.bubble_3d_effect.is_some()
        || chart_spec.wireframe.is_some()
        || chart_spec.surface_top_view.is_some()
        || chart_spec.color_scheme.is_some()
        || chart_spec.chart_style_context.is_some()
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

pub(super) const STANDARD_CHART_PROJECTION_SCHEMA_VERSION: u32 = 6;

pub(super) fn standard_chart_projection_fingerprint(
    chart_spec: &domain_types::ChartSpec,
) -> String {
    let mut fingerprint = Fnv1a64::default();
    fingerprint.write_str(chart_spec.chart_type.as_str());
    fingerprint.write_json(&chart_spec.title);
    fingerprint.write_json(&chart_spec.series);
    fingerprint.write_json(&chart_spec.sub_type);
    fingerprint.write_json(&chart_spec.legend);
    fingerprint.write_json(&chart_spec.axes);
    fingerprint.write_json(&chart_spec.data_labels);
    fingerprint.write_json(&chart_spec.data_range);
    fingerprint.write_json(&chart_spec.series_range);
    fingerprint.write_json(&chart_spec.category_range);
    fingerprint.write_json(&chart_spec.colors);
    fingerprint.write_json(&chart_spec.style);
    fingerprint.write_json(&chart_spec.rounded_corners);
    fingerprint.write_json(&chart_spec.auto_title_deleted);
    fingerprint.write_json(&chart_spec.show_data_labels_over_max);
    fingerprint.write_json(&chart_spec.chart_format);
    fingerprint.write_json(&chart_spec.plot_format);
    fingerprint.write_json(&chart_spec.title_format);
    fingerprint.write_json(&chart_spec.title_rich_text);
    fingerprint.write_json(&chart_spec.title_formula);
    fingerprint.write_json(&chart_spec.plot_layout);
    fingerprint.write_json(&chart_spec.title_layout);
    fingerprint.write_json(&chart_spec.data_table);
    fingerprint.write_json(&chart_spec.drop_lines);
    fingerprint.write_json(&chart_spec.high_low_lines);
    fingerprint.write_json(&chart_spec.series_lines);
    fingerprint.write_json(&chart_spec.up_down_bars);
    fingerprint.write_json(&chart_spec.waterfall);
    fingerprint.write_json(&chart_spec.histogram);
    fingerprint.write_json(&chart_spec.boxplot);
    fingerprint.write_json(&chart_spec.hierarchy);
    fingerprint.write_json(&chart_spec.region_map);
    fingerprint.write_json(&chart_spec.display_blanks_as);
    fingerprint.write_json(&chart_spec.plot_visible_only);
    fingerprint.write_json(&chart_spec.gap_width);
    fingerprint.write_json(&chart_spec.gap_depth);
    fingerprint.write_json(&chart_spec.overlap);
    fingerprint.write_json(&chart_spec.doughnut_hole_size);
    fingerprint.write_json(&chart_spec.first_slice_angle);
    fingerprint.write_json(&chart_spec.bubble_scale);
    fingerprint.write_json(&chart_spec.show_neg_bubbles);
    fingerprint.write_json(&chart_spec.size_represents);
    fingerprint.write_json(&chart_spec.split_type);
    fingerprint.write_json(&chart_spec.split_value);
    fingerprint.write_json(&chart_spec.category_label_level);
    fingerprint.write_json(&chart_spec.series_name_level);
    fingerprint.write_json(&chart_spec.show_all_field_buttons);
    fingerprint.write_json(&chart_spec.second_plot_size);
    fingerprint.write_json(&chart_spec.vary_by_categories);
    fingerprint.write_json(&chart_spec.title_h_align);
    fingerprint.write_json(&chart_spec.title_v_align);
    fingerprint.write_json(&chart_spec.title_show_shadow);
    fingerprint.write_json(&chart_spec.pivot_options);
    fingerprint.write_json(&chart_spec.bar_shape);
    fingerprint.write_json(&chart_spec.bubble_3d_effect);
    fingerprint.write_json(&chart_spec.wireframe);
    fingerprint.write_json(&chart_spec.surface_top_view);
    fingerprint.write_json(&chart_spec.color_scheme);
    fingerprint.write_json(&chart_spec.chart_style_context);
    fingerprint.write_json(&chart_spec.view_3d);
    fingerprint.write_json(&chart_spec.floor_format);
    fingerprint.write_json(&chart_spec.side_wall_format);
    fingerprint.write_json(&chart_spec.back_wall_format);
    format!("{:016x}", fingerprint.finish())
}

#[derive(Clone, Copy)]
struct Fnv1a64(u64);

impl Default for Fnv1a64 {
    fn default() -> Self {
        Self(0xcbf29ce484222325)
    }
}

impl Fnv1a64 {
    fn write_json<T: serde::Serialize>(&mut self, value: &T) {
        match serde_json::to_vec(value) {
            Ok(bytes) => self.write_bytes(&bytes),
            Err(_) => self.write_bytes(b"<serde-error>"),
        }
        self.write_bytes(&[0xff]);
    }

    fn write_str(&mut self, value: &str) {
        self.write_bytes(value.as_bytes());
        self.write_bytes(&[0xff]);
    }

    fn write_bytes(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x100000001b3);
        }
    }

    fn finish(self) -> u64 {
        self.0
    }
}

pub(super) fn chart_allows_current_auxiliary_replay(
    chart_spec: &domain_types::ChartSpec,
    chart_path: &str,
) -> bool {
    chart_auxiliary::chart_auxiliary_data(chart_spec).is_some()
        && chart_auxiliary::chart_frame_identity_matches_path(chart_spec, chart_path)
        && if chart_spec.is_chart_ex {
            chart_ex_allows_opaque_replay(chart_spec, chart_path)
        } else {
            matches!(
                standard_chart_export_plan(chart_spec),
                StandardChartExportPlan::ReplayImportedChartSpace
            )
        }
}

pub(super) fn standard_chart_original_number_with_current_auxiliary_replay(
    chart_spec: &domain_types::ChartSpec,
) -> Option<usize> {
    let aux = chart_auxiliary::chart_auxiliary_data(chart_spec)?;
    let original_number = chart_auxiliary::standard_chart_number(&aux)?;
    let chart_path = format!("xl/charts/chart{original_number}.xml");
    chart_allows_current_auxiliary_replay(chart_spec, &chart_path).then_some(original_number)
}

pub(super) fn chart_ex_original_number_with_current_replay(
    chart_spec: &domain_types::ChartSpec,
) -> Option<usize> {
    let original_number = chart_ex_original_number(chart_spec).or_else(|| {
        let aux = chart_auxiliary::chart_auxiliary_data(chart_spec)?;
        chart_auxiliary::chart_ex_number(&aux)
    })?;
    let chart_path = format!("xl/charts/chartEx{original_number}.xml");
    let current = if chart_spec.chart_ex_replay.is_some() {
        chart_ex_allows_opaque_replay(chart_spec, &chart_path)
    } else {
        chart_allows_current_auxiliary_replay(chart_spec, &chart_path)
    };
    current.then_some(original_number)
}

pub(super) fn chart_ex_allows_opaque_replay(
    chart_spec: &domain_types::ChartSpec,
    chart_path: &str,
) -> bool {
    if !chart_spec.is_chart_ex {
        return false;
    }
    if !matches!(
        chart_spec.definition,
        Some(domain_types::ChartDefinition::ChartEx(_))
    ) {
        return false;
    }
    let Some(replay) = chart_spec.chart_ex_replay.as_ref() else {
        return false;
    };
    if replay.original_xml.is_empty() || replay.original_path.trim_start_matches('/') != chart_path
    {
        return false;
    }
    if !chart_auxiliary::chart_frame_identity_matches_path(chart_spec, chart_path) {
        return false;
    }
    if !chart_ex_title_matches_import(chart_spec) {
        return false;
    }
    if !chart_ex_relationships_are_policy_allowed(chart_spec, chart_path) {
        return false;
    }
    if let Some(imported_fingerprint) = replay.projection_fingerprint.as_deref() {
        return imported_fingerprint == standard_chart_projection_fingerprint(chart_spec);
    }
    !has_modeled_chart_space_state_except_imported_title(chart_spec)
}

pub(super) fn chart_ex_original_number(chart_spec: &domain_types::ChartSpec) -> Option<usize> {
    let replay = chart_spec.chart_ex_replay.as_ref()?;
    original_chart_number(&replay.original_path, "chartEx")
}

pub(super) fn chart_ex_allows_raw_anchor_replay(
    chart_spec: &domain_types::ChartSpec,
    chart_path: &str,
    relationship_id: &str,
) -> bool {
    chart_ex_raw_anchor_replay_xml(chart_spec, chart_path, relationship_id).is_some()
}

pub(super) fn chart_ex_raw_anchor_replay_xml(
    chart_spec: &domain_types::ChartSpec,
    chart_path: &str,
    relationship_id: &str,
) -> Option<String> {
    if !chart_ex_allows_opaque_replay(chart_spec, chart_path) {
        return None;
    }
    if !chart_spec
        .chart_ex_replay
        .as_ref()
        .is_some_and(|replay| replay.original_position == chart_spec.position)
    {
        return None;
    }
    let frame = chart_spec.chart_frame.as_ref()?;
    if !chart_frame_props_match_spec(chart_spec, frame) {
        return None;
    }

    let raw_xml = frame.raw_alternate_content.as_ref()?;
    let relationship_values = crate::infra::xml::relationship_attr_values(raw_xml);
    let Some(imported_relationship_id) = frame.relationship_id.as_deref() else {
        return relationship_values.is_empty().then(|| raw_xml.clone());
    };
    if !relationship_values.is_empty()
        && !relationship_values
            .iter()
            .any(|value| value == imported_relationship_id)
    {
        return None;
    }
    if imported_relationship_id == relationship_id {
        return Some(raw_xml.clone());
    }
    if relationship_values
        .iter()
        .any(|value| value == relationship_id)
    {
        return None;
    }

    let mut relationship_ids = std::collections::HashMap::new();
    relationship_ids.insert(
        imported_relationship_id.to_string(),
        relationship_id.to_string(),
    );
    Some(crate::infra::xml::remap_relationship_attrs(
        raw_xml,
        &relationship_ids,
    ))
}

fn chart_frame_props_match_spec(
    chart_spec: &domain_types::ChartSpec,
    frame: &domain_types::domain::floating_object::ChartDrawingFrameOoxmlProps,
) -> bool {
    let gf = &frame.graphic_frame;
    let nv = &gf.nv_graphic_frame_pr;
    let cnv = &nv.c_nv_pr;
    let name = (!cnv.name.is_empty()).then(|| cnv.name.clone());
    let id = (cnv.id.value() != 0).then_some(cnv.id.value());
    let xfrm = gf.has_explicit_xfrm().then_some(&gf.xfrm);
    let current_frame = chart_spec.chart_frame.as_ref();
    let current_gf = current_frame.map(|current| &current.graphic_frame);
    let current_xfrm = current_gf.and_then(|gf| gf.has_explicit_xfrm().then_some(&gf.xfrm));
    chart_spec.cnv_pr_name == name
        && chart_spec.cnv_pr_id == id
        && chart_spec.cnv_pr_descr.as_ref() == cnv.descr.as_ref()
        && chart_spec.cnv_pr_title.as_ref() == cnv.title.as_ref()
        && chart_spec.cnv_pr_hidden == cnv.hidden
        && chart_spec.anchor_edit_as.as_ref() == frame.edit_as.as_ref()
        && chart_spec.macro_name.as_ref() == gf.macro_name.as_ref()
        && chart_spec.no_change_aspect
            == nv
                .no_change_aspect_explicit
                .or_else(|| nv.c_nv_graphic_frame_pr.no_change_aspect.then_some(true))
        && chart_spec.has_graphic_frame_locks == nv.has_graphic_frame_locks
        && chart_spec.xfrm_off_x == xfrm.map_or(0, |xfrm| xfrm.off_x())
        && chart_spec.xfrm_off_y == xfrm.map_or(0, |xfrm| xfrm.off_y())
        && chart_spec.xfrm_ext_cx == xfrm.map_or(0, |xfrm| xfrm.ext_cx() as i64)
        && chart_spec.xfrm_ext_cy == xfrm.map_or(0, |xfrm| xfrm.ext_cy() as i64)
        && chart_spec.client_data_locks_with_sheet == frame.client_data_locks_with_sheet
        && chart_spec.client_data_prints_with_sheet == frame.client_data_prints_with_sheet
        && current_frame.and_then(|current| current.relationship_id.as_deref())
            == frame.relationship_id.as_deref()
        && current_frame.and_then(|current| current.relationship_target.as_deref())
            == frame.relationship_target.as_deref()
        && current_gf.map(|current| current.has_explicit_xfrm()) == Some(gf.has_explicit_xfrm())
        && current_xfrm.and_then(|xfrm| xfrm.rotation) == xfrm.and_then(|xfrm| xfrm.rotation)
        && current_xfrm.and_then(|xfrm| xfrm.flip_h) == xfrm.and_then(|xfrm| xfrm.flip_h)
        && current_xfrm.and_then(|xfrm| xfrm.flip_v) == xfrm.and_then(|xfrm| xfrm.flip_v)
        && current_frame.and_then(|current| current.raw_alternate_content.as_deref())
            == frame.raw_alternate_content.as_deref()
}

fn has_modeled_chart_space_state_except_imported_title(
    chart_spec: &domain_types::ChartSpec,
) -> bool {
    let mut clone = chart_spec.clone();
    if chart_ex_title_matches_import(chart_spec) {
        clone.title = None;
    }
    has_modeled_chart_space_state(&clone)
}

fn chart_ex_title_matches_import(chart_spec: &domain_types::ChartSpec) -> bool {
    let Some(domain_types::ChartDefinition::ChartEx(chart_space)) = chart_spec.definition.as_ref()
    else {
        return false;
    };
    let imported_title = chart_space
        .chart
        .title
        .as_ref()
        .and_then(chart_ex_title_text);
    chart_spec.title.as_deref() == imported_title.as_deref()
}

fn chart_ex_relationships_are_policy_allowed(
    chart_spec: &domain_types::ChartSpec,
    chart_path: &str,
) -> bool {
    let relationships = chart_spec
        .chart_ex_replay
        .as_ref()
        .map(|replay| replay.relationships.as_slice())
        .unwrap_or(chart_spec.chart_relationships.as_slice());
    let auxiliary_files = chart_spec
        .chart_ex_replay
        .as_ref()
        .map(|replay| replay.auxiliary_files.as_slice())
        .unwrap_or(chart_spec.chart_auxiliary_files.as_slice());

    relationships.iter().all(|rel| {
        if crate::write::package_graph::is_external_target_mode(rel.target_mode.as_deref()) {
            return false;
        }
        let (Some(rel_type), Some(target)) =
            (rel.relationship_type.as_deref(), rel.target.as_deref())
        else {
            return false;
        };
        let Some(target_path) =
            crate::infra::opc::resolve_relationship_target(Some(chart_path), target)
                .ok()
                .map(|path| path.trim_start_matches('/').to_string())
        else {
            return false;
        };
        chart_auxiliary::is_supported_auxiliary_relationship(rel_type, &target_path)
            && auxiliary_files
                .iter()
                .any(|(path, _)| path.trim_start_matches('/') == target_path)
    })
}

fn original_chart_number(path: &str, prefix: &str) -> Option<usize> {
    let fname = path.rsplit('/').next()?;
    let num_str = fname.strip_prefix(prefix)?.strip_suffix(".xml")?;
    num_str.parse::<usize>().ok()
}

pub(super) fn register_chart_owned_external_relationships(
    package_graph_builder: &mut crate::write::package_graph::PackageGraphBuilder,
    chart_path: &str,
    chart_spec: &domain_types::ChartSpec,
) -> Result<(), WriteError> {
    if let Some((_, rel)) = chart_auxiliary::chart_external_data_relationship(chart_spec) {
        if chart_auxiliary::chart_external_data_relationship_is_supported(rel)
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
