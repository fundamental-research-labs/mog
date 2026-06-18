use domain_types::chart::{ChartColorData, ChartLineData};
use ooxml_types::charts::TrendlineType;

pub(super) fn trendline_type_to_public(trendline_type: TrendlineType) -> String {
    match trendline_type {
        TrendlineType::Exponential => "exponential",
        TrendlineType::Linear => "linear",
        TrendlineType::Logarithmic => "logarithmic",
        TrendlineType::MovingAverage => "moving-average",
        TrendlineType::Polynomial => "polynomial",
        TrendlineType::Power => "power",
    }
    .to_string()
}

pub(super) fn trendline_legacy_color(line: Option<&ChartLineData>) -> Option<String> {
    match line?.color.as_ref()? {
        ChartColorData::Hex(hex) => Some(hex.clone()),
        _ => None,
    }
}

pub(super) fn trendline_legacy_line_width(line: Option<&ChartLineData>) -> Option<f64> {
    line.and_then(|line| line.width)
}
