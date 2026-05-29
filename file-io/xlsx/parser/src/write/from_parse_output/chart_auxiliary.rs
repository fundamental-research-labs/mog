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
        .collect()
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

pub(super) fn chart_external_data_relationship<'a>(
    chart_spec: &'a ChartSpec,
) -> Option<(
    &'a ooxml_types::charts::ExternalData,
    &'a ChartRelationshipData,
)> {
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

fn chart_user_shapes_relationship_id(chart_spec: &ChartSpec) -> Option<&str> {
    match chart_spec.definition.as_ref()? {
        ChartDefinition::Chart(chart_space) => chart_space.user_shapes.as_deref(),
        ChartDefinition::ChartEx(_) => None,
    }
}

fn original_chart_number(path: &str, prefix: &str) -> Option<usize> {
    let fname = path.rsplit('/').next()?;
    let num_str = fname.strip_prefix(prefix)?.strip_suffix(".xml")?;
    num_str.parse::<usize>().ok()
}

fn normalize_path(path: &str) -> String {
    path.trim_start_matches('/').to_string()
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
