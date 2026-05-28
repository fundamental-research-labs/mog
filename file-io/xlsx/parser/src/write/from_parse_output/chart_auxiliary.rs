use std::collections::BTreeSet;

use domain_types::ChartSpec;

use crate::infra::opc::opc_target_to_zip_path;

const REL_CHART_STYLE: &str = "http://schemas.microsoft.com/office/2011/relationships/chartStyle";
const REL_CHART_COLOR_STYLE: &str =
    "http://schemas.microsoft.com/office/2011/relationships/chartColorStyle";
const REL_CHART_USER_SHAPES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartUserShapes";

pub(super) struct ChartAuxiliaryDataRef<'a> {
    pub(super) auxiliary_files: &'a [(String, Vec<u8>)],
    pub(super) chart_rels: &'a [u8],
    pub(super) original_path: String,
}

pub(super) struct ChartUserShapesDataRef<'a> {
    pub(super) path: String,
    pub(super) data: &'a [u8],
    pub(super) relationship_type: &'a str,
    pub(super) relationship_id_hint: &'a str,
}

pub(super) fn chart_auxiliary_data(chart_spec: &ChartSpec) -> Option<ChartAuxiliaryDataRef<'_>> {
    let rt = chart_spec.rt.as_ref()?;
    let (_, chart_rels) = rt.chart_rels_bytes.as_ref()?;
    if rt.auxiliary_files.is_empty() {
        return None;
    }
    Some(ChartAuxiliaryDataRef {
        auxiliary_files: rt.auxiliary_files.as_slice(),
        chart_rels: chart_rels.as_slice(),
        original_path: chart_identity_path(chart_spec)?,
    })
}

pub(super) fn chart_user_shapes_data<'a>(
    chart_spec: &'a ChartSpec,
    chart_path: &str,
) -> Option<ChartUserShapesDataRef<'a>> {
    let rt = chart_spec.rt.as_ref()?;
    let user_shapes = rt.user_shapes.as_ref()?;
    let relationship_type = user_shapes.relationship_type.as_deref()?;
    let target = user_shapes.target.as_deref()?;
    let target_path = crate::infra::opc::resolve_relationship_target(Some(chart_path), target)
        .ok()
        .map(|path| normalize_path(&path))?;
    let (_, data) = rt
        .auxiliary_files
        .iter()
        .find(|(path, _)| normalize_path(path) == target_path)?;

    Some(ChartUserShapesDataRef {
        path: target_path,
        data: data.as_slice(),
        relationship_type,
        relationship_id_hint: user_shapes.r_id.as_str(),
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
        supported_auxiliary_relationship_targets(chart_path, aux.chart_rels).collect();

    aux.auxiliary_files
        .iter()
        .map(|(path, _)| normalize_path(path))
        .filter(|path| relationship_targets.contains(path))
        .collect()
}

pub(super) fn supported_auxiliary_relationship_targets<'a>(
    chart_path: &'a str,
    rels_data: &'a [u8],
) -> impl Iterator<Item = String> + 'a {
    crate::domain::workbook::read::parse_all_rels(rels_data)
        .into_iter()
        .filter_map(move |rel| {
            if rel.target_mode.as_deref() == Some("External") {
                return None;
            }
            let target_path =
                crate::infra::opc::resolve_relationship_target(Some(chart_path), &rel.target)
                    .ok()?;
            let target_path = normalize_path(&target_path);
            is_supported_auxiliary_relationship(&rel.rel_type, &target_path).then_some(target_path)
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
