use std::collections::BTreeSet;

use domain_types::chart::ChartRelationshipData;
use domain_types::{ChartDefinition, ChartSpec};

use crate::infra::opc::opc_target_to_zip_path;

const REL_CHART_STYLE: &str = "http://schemas.microsoft.com/office/2011/relationships/chartStyle";
const REL_CHART_COLOR_STYLE: &str =
    "http://schemas.microsoft.com/office/2011/relationships/chartColorStyle";
use crate::infra::opc::REL_CHART_USER_SHAPES;

pub(super) struct ChartAuxiliaryDataRef<'a> {
    pub(super) auxiliary_files: &'a [(String, Vec<u8>)],
    pub(super) chart_relationships: &'a [ChartRelationshipData],
    pub(super) original_path: String,
}

pub(super) struct ChartUserShapesDataRef<'a> {
    pub(super) path: String,
    pub(super) data: &'a [u8],
    pub(super) relationship_type: &'a str,
    pub(super) relationship_id_hint: &'a str,
}

pub(super) struct ChartUserShapesImageDataRef<'a> {
    pub(super) user_shapes_path: String,
    pub(super) image_path: String,
    pub(super) relationship_id_hint: String,
    pub(super) data: &'a [u8],
}

pub(super) struct GeneratedChartColorStyle {
    pub(super) path: String,
    pub(super) data: Vec<u8>,
    pub(super) relationship_type: &'static str,
    pub(super) relationship_id_hint: String,
}

pub(super) fn chart_auxiliary_data(chart_spec: &ChartSpec) -> Option<ChartAuxiliaryDataRef<'_>> {
    if chart_spec.chart_auxiliary_files.is_empty() || chart_spec.chart_relationships.is_empty() {
        return None;
    }
    Some(ChartAuxiliaryDataRef {
        auxiliary_files: chart_spec.chart_auxiliary_files.as_slice(),
        chart_relationships: chart_spec.chart_relationships.as_slice(),
        original_path: chart_identity_path(chart_spec)?,
    })
}

pub(super) fn chart_user_shapes_data<'a>(
    chart_spec: &'a ChartSpec,
    chart_path: &str,
) -> Option<ChartUserShapesDataRef<'a>> {
    if standard_chart_authority_blocks_user_shapes_replay(chart_spec) {
        return None;
    }
    let r_id = chart_user_shapes_relationship_id(chart_spec)?;
    let user_shapes = chart_spec
        .chart_relationships
        .iter()
        .find(|rel| rel.r_id == r_id)?;
    let relationship_type = user_shapes.relationship_type.as_deref()?;
    let target = user_shapes.target.as_deref()?;
    let target_path = crate::infra::opc::resolve_relationship_target(Some(chart_path), target)
        .ok()
        .map(|path| normalize_path(&path))?;
    let (_, data) = chart_spec
        .chart_auxiliary_files
        .iter()
        .find(|(path, _)| normalize_path(path) == target_path)?;

    Some(ChartUserShapesDataRef {
        path: target_path,
        data: data.as_slice(),
        relationship_type,
        relationship_id_hint: r_id,
    })
}

pub(super) fn chart_user_shapes_image_data<'a>(
    chart_spec: &'a ChartSpec,
    chart_path: &str,
) -> Vec<ChartUserShapesImageDataRef<'a>> {
    let Some(user_shapes) = chart_user_shapes_data(chart_spec, chart_path) else {
        return Vec::new();
    };
    let rels_path = relationships_path_for_part(&user_shapes.path);
    let Some((_, rels_bytes)) = chart_spec
        .chart_auxiliary_files
        .iter()
        .find(|(path, _)| normalize_path(path) == rels_path)
    else {
        return Vec::new();
    };

    crate::domain::workbook::read::parse_all_rels(rels_bytes)
        .iter()
        .filter_map(|rel| {
            if rel.rel_type != crate::infra::opc::REL_IMAGE
                || crate::write::package_graph::is_external_target_mode(rel.target_mode.as_deref())
            {
                return None;
            }
            let image_path = crate::infra::opc::resolve_relationship_target(
                Some(&user_shapes.path),
                &rel.target,
            )
            .ok()
            .map(|path| normalize_path(&path))?;
            let (_, data) = chart_spec
                .chart_auxiliary_files
                .iter()
                .find(|(path, _)| normalize_path(path) == image_path)?;
            Some(ChartUserShapesImageDataRef {
                user_shapes_path: user_shapes.path.clone(),
                image_path,
                relationship_id_hint: rel.id.clone(),
                data: data.as_slice(),
            })
        })
        .collect()
}

pub(super) fn generated_chart_color_style_data(
    chart_spec: &ChartSpec,
    chart_path: &str,
) -> Option<GeneratedChartColorStyle> {
    let data = crate::domain::charts::color_style::build_chart_color_style_xml(
        chart_spec.colors.as_deref(),
        chart_spec.color_scheme,
    )?;
    let number = chart_number(chart_path)?;
    let imported_identity = imported_chart_color_style(chart_spec, chart_path)
        .map(|(relationship, path, _)| (relationship.r_id.clone(), path));
    let (relationship_id_hint, path) = imported_identity.unwrap_or_else(|| {
        (
            "rIdChartColorStyle".to_string(),
            format!("xl/charts/colors{number}.xml"),
        )
    });
    Some(GeneratedChartColorStyle {
        path,
        data,
        relationship_type: REL_CHART_COLOR_STYLE,
        relationship_id_hint,
    })
}

pub(super) fn should_generate_chart_color_style(
    chart_spec: &ChartSpec,
    chart_path: &str,
    allows_current_auxiliary_replay: bool,
) -> bool {
    !allows_current_auxiliary_replay
        || matches!(
            imported_chart_color_style(chart_spec, chart_path).map(|(_, _, data)| {
                crate::domain::charts::color_style::chart_color_style_xml_is_replay_safe(data)
            }),
            Some(false)
        )
}

pub(super) fn standard_chart_number(aux: &ChartAuxiliaryDataRef<'_>) -> Option<usize> {
    original_chart_number(&aux.original_path, "chart")
}

pub(super) fn chart_ex_number(aux: &ChartAuxiliaryDataRef<'_>) -> Option<usize> {
    original_chart_number(&aux.original_path, "chartEx")
}

pub(super) fn chart_frame_identity_matches_path(chart_spec: &ChartSpec, chart_path: &str) -> bool {
    chart_identity_path(chart_spec).as_deref() == Some(&normalize_path(chart_path))
}

pub(super) fn supported_auxiliary_file_paths(
    aux: &ChartAuxiliaryDataRef<'_>,
    chart_path: &str,
) -> BTreeSet<String> {
    let relationship_targets: BTreeSet<_> =
        supported_auxiliary_relationship_targets(chart_path, aux.chart_relationships).collect();

    aux.auxiliary_files
        .iter()
        .map(|(path, _)| normalize_path(path))
        .filter(|path| relationship_targets.contains(path))
        .filter(|path| auxiliary_file_is_replay_safe(aux, path))
        .collect()
}

pub(super) fn auxiliary_file_paths_for_export(
    chart_spec: &ChartSpec,
    chart_path: &str,
    allows_current_auxiliary_replay: bool,
) -> BTreeSet<String> {
    let Some(aux) = chart_auxiliary_data(chart_spec) else {
        return BTreeSet::new();
    };
    let supported = supported_auxiliary_file_paths(&aux, chart_path);
    if allows_current_auxiliary_replay {
        return supported;
    }
    if chart_spec.is_chart_ex {
        return BTreeSet::new();
    }

    let generated_color_style = generated_chart_color_style_data(chart_spec, chart_path).is_some();
    supported
        .into_iter()
        .filter(|path| match auxiliary_kind(path) {
            Some(AuxiliaryKind::Style) => true,
            Some(AuxiliaryKind::ColorStyle) => !generated_color_style,
            Some(AuxiliaryKind::UserShapes) | None => false,
        })
        .collect()
}

fn auxiliary_file_is_replay_safe(aux: &ChartAuxiliaryDataRef<'_>, path: &str) -> bool {
    if !matches!(auxiliary_kind(path), Some(AuxiliaryKind::ColorStyle)) {
        return true;
    }
    aux.auxiliary_files
        .iter()
        .find(|(candidate, _)| normalize_path(candidate) == path)
        .is_some_and(|(_, data)| {
            crate::domain::charts::color_style::chart_color_style_xml_is_replay_safe(data)
        })
}

pub(super) fn supported_auxiliary_relationship_targets<'a>(
    chart_path: &'a str,
    relationships: &'a [ChartRelationshipData],
) -> impl Iterator<Item = String> + 'a {
    relationships.iter().filter_map(move |rel| {
        if crate::write::package_graph::is_external_target_mode(rel.target_mode.as_deref()) {
            return None;
        }
        let rel_type = rel.relationship_type.as_deref()?;
        let target = rel.target.as_deref()?;
        let target_path =
            crate::infra::opc::resolve_relationship_target(Some(chart_path), target).ok()?;
        let target_path = normalize_path(&target_path);
        is_supported_auxiliary_relationship(rel_type, &target_path).then_some(target_path)
    })
}

pub(super) fn is_supported_auxiliary_relationship(rel_type: &str, target_path: &str) -> bool {
    match auxiliary_kind(target_path) {
        Some(AuxiliaryKind::Style) => rel_type == REL_CHART_STYLE,
        Some(AuxiliaryKind::ColorStyle) => rel_type == REL_CHART_COLOR_STYLE,
        Some(AuxiliaryKind::UserShapes) => rel_type == REL_CHART_USER_SHAPES,
        None => false,
    }
}

fn imported_chart_color_style<'a>(
    chart_spec: &'a ChartSpec,
    chart_path: &str,
) -> Option<(&'a ChartRelationshipData, String, &'a [u8])> {
    let relationship = chart_spec.chart_relationships.iter().find(|relationship| {
        relationship.relationship_type.as_deref() == Some(REL_CHART_COLOR_STYLE)
            && !crate::write::package_graph::is_external_target_mode(
                relationship.target_mode.as_deref(),
            )
    })?;
    let target = relationship.target.as_deref()?;
    let path = crate::infra::opc::resolve_relationship_target(Some(chart_path), target)
        .ok()
        .map(|path| normalize_path(&path))?;
    let (_, data) = chart_spec
        .chart_auxiliary_files
        .iter()
        .find(|(candidate, _)| normalize_path(candidate) == path)?;
    Some((relationship, path, data.as_slice()))
}

fn chart_identity_path(chart_spec: &ChartSpec) -> Option<String> {
    let target = chart_spec
        .chart_frame
        .as_ref()?
        .relationship_target
        .as_deref()?;
    Some(normalize_path(&opc_target_to_zip_path(
        target,
        "xl/drawings",
    )))
}

pub(super) fn chart_external_data_relationship(
    chart_spec: &ChartSpec,
) -> Option<(&ooxml_types::charts::ExternalData, &ChartRelationshipData)> {
    let external_data = match chart_spec.definition.as_ref()? {
        ChartDefinition::Chart(chart_space) => chart_space.external_data.as_ref()?,
        ChartDefinition::ChartEx(_) => return None,
    };
    let relationship = chart_spec
        .chart_relationships
        .iter()
        .find(|rel| rel.r_id == external_data.r_id)?;
    Some((external_data, relationship))
}

pub(super) fn chart_external_data_relationship_is_supported(rel: &ChartRelationshipData) -> bool {
    rel.relationship_type.as_deref() == Some(crate::infra::opc::REL_EXTERNAL_LINK)
        && crate::write::package_graph::is_external_target_mode(rel.target_mode.as_deref())
        && rel
            .target
            .as_deref()
            .is_some_and(|target| !target.trim().is_empty())
}

fn chart_user_shapes_relationship_id(chart_spec: &ChartSpec) -> Option<&str> {
    match chart_spec.definition.as_ref()? {
        ChartDefinition::Chart(chart_space) => chart_space.user_shapes.as_deref(),
        ChartDefinition::ChartEx(_) => None,
    }
}

fn standard_chart_authority_blocks_user_shapes_replay(chart_spec: &ChartSpec) -> bool {
    chart_spec
        .standard_chart_export_authority
        .as_ref()
        .is_some_and(|authority| {
            !matches!(
                authority.validity,
                domain_types::chart::StandardChartAuthorityValidity::Current
            ) || !authority.relationship_closure_current
                || !authority.invalidated_owner_ids.is_empty()
        })
}

fn original_chart_number(path: &str, prefix: &str) -> Option<usize> {
    let fname = path.rsplit('/').next()?;
    let num_str = fname.strip_prefix(prefix)?.strip_suffix(".xml")?;
    num_str.parse::<usize>().ok()
}

fn chart_number(path: &str) -> Option<usize> {
    original_chart_number(path, "chart").or_else(|| original_chart_number(path, "chartEx"))
}

fn normalize_path(path: &str) -> String {
    path.trim_start_matches('/').to_string()
}

fn relationships_path_for_part(part_path: &str) -> String {
    let part_path = normalize_path(part_path);
    let Some((dir, file_name)) = part_path.rsplit_once('/') else {
        return format!("_rels/{part_path}.rels");
    };
    format!("{dir}/_rels/{file_name}.rels")
}

enum AuxiliaryKind {
    Style,
    ColorStyle,
    UserShapes,
}

fn auxiliary_kind(path: &str) -> Option<AuxiliaryKind> {
    let file_name = path.rsplit('/').next().unwrap_or(path);
    if path.starts_with("xl/charts/")
        && file_name.starts_with("style")
        && file_name.ends_with(".xml")
    {
        Some(AuxiliaryKind::Style)
    } else if path.starts_with("xl/charts/")
        && (file_name.starts_with("color") || file_name.starts_with("colors"))
        && file_name.ends_with(".xml")
    {
        Some(AuxiliaryKind::ColorStyle)
    } else if path.starts_with("xl/drawings/") && file_name.ends_with(".xml") {
        Some(AuxiliaryKind::UserShapes)
    } else {
        None
    }
}
