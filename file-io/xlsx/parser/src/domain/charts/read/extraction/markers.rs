pub(super) fn extract_marker_config(
    marker: &Option<ooxml_types::charts::Marker>,
) -> (Option<bool>, Option<u32>, Option<String>) {
    let m = match marker {
        Some(m) => m,
        None => return (None, None, None),
    };
    let show = m
        .symbol
        .as_ref()
        .map(|s| *s != ooxml_types::charts::MarkerStyle::None);
    let size = m.size;
    let style = m.symbol.as_ref().map(|s| s.to_ooxml().to_string());
    (show, size, style)
}
