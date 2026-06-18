use super::super::formatting::{extract_chart_line, extract_fill_color};

pub(super) fn extract_legacy_series_color(
    series: &ooxml_types::charts::ChartSeries,
    legacy_color_from_line: bool,
) -> Option<String> {
    let sp_pr = series.sp_pr.as_ref()?;
    if !legacy_color_from_line {
        return extract_fill_color(sp_pr);
    }

    sp_pr
        .ln
        .as_ref()
        .map(extract_chart_line)
        .and_then(|line| match line.color {
            Some(domain_types::chart::ChartColorData::Hex(hex)) => Some(hex),
            _ => None,
        })
        .or_else(|| extract_fill_color(sp_pr))
}
