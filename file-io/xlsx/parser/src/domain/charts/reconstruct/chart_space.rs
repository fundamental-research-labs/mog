use domain_types::{ChartDefinition, chart::ChartSpec};
use ooxml_types::charts::{ChartSpace, ExtensionEntry};

use super::{
    chart::build_chart,
    formatting::{build_shape_properties, build_text_body},
    text_body_fidelity::preserve_imported_text_body_properties,
};

// =============================================================================
// Top-level entry point
// =============================================================================

/// Reconstruct a ChartSpace from ChartSpec for XLSX export.
pub(super) fn build_chart_space(spec: &ChartSpec) -> ChartSpace {
    let imported = match spec.definition.as_ref() {
        Some(ChartDefinition::Chart(chart_space)) => Some(chart_space),
        _ => None,
    };

    let clr_map_ovr = spec
        .chart_style_context
        .as_ref()
        .and_then(|context| context.color_map_override.as_ref())
        .and_then(|color_map_override| color_map_override.to_ooxml())
        .or_else(|| imported.and_then(|chart_space| chart_space.clr_map_ovr.clone()));

    let mut sp_pr = spec.chart_format.as_ref().and_then(build_shape_properties);
    merge_imported_shape_properties(
        &mut sp_pr,
        imported.and_then(|chart_space| chart_space.sp_pr.as_ref()),
    );
    let mut tx_pr = spec.chart_format.as_ref().and_then(build_text_body);
    preserve_imported_text_body_properties(
        &mut tx_pr,
        imported.and_then(|chart_space| chart_space.tx_pr.as_ref()),
    );

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
        clr_map_ovr,
        protection: imported.and_then(|chart_space| chart_space.protection.clone()),
        chart: build_chart(spec),
        sp_pr,
        tx_pr,
        external_data: imported
            .and_then(|chart_space| chart_space.external_data.as_ref())
            .filter(|external_data| external_data_relationship_is_supported(spec, external_data))
            .cloned(),
        pivot_source: imported.and_then(|chart_space| chart_space.pivot_source.clone()),
        user_shapes: imported
            .and_then(|chart_space| chart_space.user_shapes.as_deref())
            .filter(|r_id| user_shapes_relationship_is_supported(spec, r_id))
            .map(str::to_string),
        print_settings: imported.and_then(|chart_space| chart_space.print_settings.clone()),
        extensions: imported
            .map(|chart_space| clean_chart_extensions(&chart_space.extensions))
            .unwrap_or_default(),
    }
}

/// Merge the complete imported chart-space shape properties behind the public
/// chart format projection. The domain model intentionally exposes only
/// ordinary fill/line values; relationship-backed picture fills, effects,
/// transforms, and future extension fields remain available on the imported
/// OOXML definition and must survive a modeled chart edit.
pub(super) fn merge_imported_shape_properties(
    target: &mut Option<ooxml_types::drawings::ShapeProperties>,
    imported: Option<&ooxml_types::drawings::ShapeProperties>,
) {
    let Some(imported) = imported else {
        return;
    };
    let Some(target) = target.as_mut() else {
        *target = Some(imported.clone());
        return;
    };

    if target.xfrm.is_none() {
        target.xfrm = imported.xfrm.clone();
    }
    if target.geometry.is_none() {
        target.geometry = imported.geometry.clone();
    }
    if target.fill.is_none() {
        target.fill = imported.fill.clone();
    }
    merge_imported_outline(&mut target.ln, imported.ln.as_ref());
    if target.effects.is_none() {
        target.effects = imported.effects.clone();
    }
    if target.scene3d.is_none() {
        target.scene3d = imported.scene3d.clone();
    }
    if target.sp3d.is_none() {
        target.sp3d = imported.sp3d.clone();
    }
    if target.bw_mode.is_none() {
        target.bw_mode = imported.bw_mode;
    }
    if target.ext_lst.is_none() {
        target.ext_lst = imported.ext_lst.clone();
    }
}

/// Preserve imported line properties that the public chart format does not
/// expose.  `ChartFormatData::line` currently models the ordinary width,
/// fill, and dash values, while cap/compound/alignment/join/arrowhead details
/// are still represented by the OOXML outline.  A modeled value wins when it
/// is present; each omitted field falls back independently to the imported
/// value instead of replacing the complete outline.
fn merge_imported_outline(
    target: &mut Option<ooxml_types::drawings::Outline>,
    imported: Option<&ooxml_types::drawings::Outline>,
) {
    let Some(imported) = imported else {
        return;
    };

    let Some(target) = target.as_mut() else {
        *target = Some(imported.clone());
        return;
    };

    if target.width.is_none() {
        target.width = imported.width;
    }
    if target.fill.is_none() {
        target.fill = imported.fill.clone();
    }
    if target.dash.is_none() {
        target.dash = imported.dash.clone();
    }
    if target.compound.is_none() {
        target.compound = imported.compound;
    }
    if target.cap.is_none() {
        target.cap = imported.cap;
    }
    if target.align.is_none() {
        target.align = imported.align;
    }
    if target.join.is_none() {
        target.join = imported.join.clone();
    }
    if target.head_end.is_none() {
        target.head_end = imported.head_end.clone();
    }
    if target.tail_end.is_none() {
        target.tail_end = imported.tail_end.clone();
    }
}

fn external_data_relationship_is_supported(
    spec: &ChartSpec,
    external_data: &ooxml_types::charts::ExternalData,
) -> bool {
    spec.chart_relationships.iter().any(|rel| {
        rel.r_id == external_data.r_id
            && rel.relationship_type.as_deref() == Some(crate::infra::opc::REL_EXTERNAL_LINK)
            && rel
                .target
                .as_deref()
                .is_some_and(|target| !target.trim().is_empty())
            && rel
                .target_mode
                .as_deref()
                .is_some_and(|mode| mode.eq_ignore_ascii_case("External"))
    })
}

fn user_shapes_relationship_is_supported(spec: &ChartSpec, r_id: &str) -> bool {
    if standard_chart_authority_blocks_user_shapes_replay(spec) {
        return false;
    }
    spec.chart_relationships.iter().any(|rel| {
        rel.r_id == r_id
            && rel.relationship_type.as_deref() == Some(crate::infra::opc::REL_CHART_USER_SHAPES)
            && rel.target_mode.is_none()
            && rel
                .target
                .as_deref()
                .is_some_and(|target| auxiliary_file_exists_for_target(target, spec))
    })
}

fn auxiliary_file_exists_for_target(target: &str, spec: &ChartSpec) -> bool {
    let file_name = target.rsplit('/').next().unwrap_or(target);
    !file_name.is_empty()
        && spec
            .chart_auxiliary_files
            .iter()
            .any(|(path, _)| path.rsplit('/').next().unwrap_or(path) == file_name)
}

fn standard_chart_authority_blocks_user_shapes_replay(spec: &ChartSpec) -> bool {
    spec.standard_chart_export_authority
        .as_ref()
        .is_some_and(|authority| {
            !matches!(
                authority.validity,
                domain_types::chart::StandardChartAuthorityValidity::Current
            ) || !authority.relationship_closure_current
                || !authority.invalidated_owner_ids.is_empty()
        })
}

pub(super) fn clean_chart_extensions(extensions: &[ExtensionEntry]) -> Vec<ExtensionEntry> {
    extensions
        .iter()
        .filter(|extension| !crate::infra::xml::raw_xml_contains_relationship_attr(&extension.xml))
        .cloned()
        .collect()
}
