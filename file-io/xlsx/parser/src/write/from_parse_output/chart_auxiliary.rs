use std::collections::BTreeSet;

use domain_types::{ChartAuxiliaryData, ChartSpec, SheetRoundTripContext};

use crate::infra::opc::opc_target_to_zip_path;

const REL_CHART_STYLE: &str = "http://schemas.microsoft.com/office/2011/relationships/chartStyle";
const REL_CHART_COLOR_STYLE: &str =
    "http://schemas.microsoft.com/office/2011/relationships/chartColorStyle";

pub(super) fn standard_chart_auxiliary_data<'a>(
    sheet_rt: Option<&'a SheetRoundTripContext>,
    chart_spec: &ChartSpec,
) -> Option<&'a ChartAuxiliaryData> {
    chart_auxiliary_data_by_identity(
        sheet_rt.and_then(|rt| (!rt.chart_auxiliary_data.is_empty()).then_some(rt)),
        chart_spec,
        |rt| rt.chart_auxiliary_data.as_slice(),
    )
}

pub(super) fn chart_ex_auxiliary_data<'a>(
    sheet_rt: Option<&'a SheetRoundTripContext>,
    chart_spec: &ChartSpec,
) -> Option<&'a ChartAuxiliaryData> {
    chart_auxiliary_data_by_identity(
        sheet_rt.and_then(|rt| (!rt.chart_ex_auxiliary_data.is_empty()).then_some(rt)),
        chart_spec,
        |rt| rt.chart_ex_auxiliary_data.as_slice(),
    )
}

pub(super) fn standard_chart_number(aux: &ChartAuxiliaryData) -> Option<usize> {
    original_chart_number(aux, "chart")
}

pub(super) fn chart_ex_number(aux: &ChartAuxiliaryData) -> Option<usize> {
    original_chart_number(aux, "chartEx")
}

pub(super) fn chart_frame_identity_matches_path(chart_spec: &ChartSpec, chart_path: &str) -> bool {
    chart_identity_path(chart_spec).as_deref() == Some(&normalize_path(chart_path))
}

pub(super) fn supported_auxiliary_file_paths(
    aux: &ChartAuxiliaryData,
    chart_path: &str,
) -> BTreeSet<String> {
    let Some(rels_data) = aux.chart_rels.as_ref() else {
        return BTreeSet::new();
    };
    let relationship_targets: BTreeSet<_> =
        supported_auxiliary_relationship_targets(chart_path, rels_data).collect();

    aux.auxiliary_files
        .iter()
        .map(|aux_file| normalize_path(&aux_file.path))
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
        None => false,
    }
}

fn chart_auxiliary_data_by_identity<'a>(
    sheet_rt: Option<&'a SheetRoundTripContext>,
    chart_spec: &ChartSpec,
    auxiliary_data: impl Fn(&'a SheetRoundTripContext) -> &'a [ChartAuxiliaryData],
) -> Option<&'a ChartAuxiliaryData> {
    let identity_path = chart_identity_path(chart_spec)?;
    auxiliary_data(sheet_rt?).iter().find(|aux| {
        aux.original_path.as_deref().map(normalize_path).as_deref() == Some(&identity_path)
    })
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

fn original_chart_number(aux: &ChartAuxiliaryData, prefix: &str) -> Option<usize> {
    let path = aux.original_path.as_deref()?;
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
}

fn auxiliary_kind(path: &str) -> Option<AuxiliaryKind> {
    let file_name = path.rsplit('/').next().unwrap_or(path);
    if file_name.starts_with("style") && file_name.ends_with(".xml") {
        Some(AuxiliaryKind::Style)
    } else if (file_name.starts_with("color") || file_name.starts_with("colors"))
        && file_name.ends_with(".xml")
    {
        Some(AuxiliaryKind::ColorStyle)
    } else {
        None
    }
}
