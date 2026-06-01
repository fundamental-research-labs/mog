use super::formatting::extract_chart_color;

pub(super) fn extract_marker_config(
    marker: &Option<ooxml_types::charts::Marker>,
) -> (
    Option<bool>,
    Option<u32>,
    Option<String>,
    Option<domain_types::chart::ChartColorData>,
    Option<domain_types::chart::ChartColorData>,
) {
    let m = match marker {
        Some(m) => m,
        None => return (None, None, None, None, None),
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
    (show, size, style, background, foreground)
}
