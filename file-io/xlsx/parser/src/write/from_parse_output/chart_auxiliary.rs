use domain_types::{ChartAuxiliaryData, ChartSpec, SheetRoundTripContext};

use crate::infra::opc::opc_target_to_zip_path;

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
