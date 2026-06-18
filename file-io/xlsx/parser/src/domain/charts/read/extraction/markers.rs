use super::formatting::{extract_chart_color, extract_chart_line};

#[derive(Debug, Default)]
pub(super) struct MarkerConfigExtraction {
    pub show: Option<bool>,
    pub size: Option<u32>,
    pub style: Option<String>,
    pub background_color: Option<domain_types::chart::ChartColorData>,
    pub foreground_color: Option<domain_types::chart::ChartColorData>,
    pub line_format: Option<domain_types::chart::ChartLineData>,
}

pub(super) fn extract_marker_config(
    marker: &Option<ooxml_types::charts::Marker>,
) -> MarkerConfigExtraction {
    let m = match marker {
        Some(m) => m,
        None => return MarkerConfigExtraction::default(),
    };
    let show = m
        .symbol
        .as_ref()
        .map(|s| *s != ooxml_types::charts::MarkerStyle::None);
    let size = m.size;
    let style = m.symbol.as_ref().map(|s| s.to_ooxml().to_string());
    let background = m
        .sp_pr
        .as_ref()
        .and_then(|sp_pr| match sp_pr.fill.as_ref()? {
            ooxml_types::drawings::DrawingFill::Solid(solid) => extract_chart_color(&solid.color),
            _ => None,
        });
    let foreground = m
        .sp_pr
        .as_ref()
        .and_then(|sp_pr| sp_pr.ln.as_ref())
        .and_then(|line| match line.fill.as_ref()? {
            ooxml_types::drawings::LineFill::Solid(solid) => extract_chart_color(&solid.color),
            _ => None,
        });
    let line_format = m
        .sp_pr
        .as_ref()
        .and_then(|sp_pr| sp_pr.ln.as_ref())
        .map(extract_chart_line);

    MarkerConfigExtraction {
        show,
        size,
        style,
        background_color: background,
        foreground_color: foreground,
        line_format,
    }
}
