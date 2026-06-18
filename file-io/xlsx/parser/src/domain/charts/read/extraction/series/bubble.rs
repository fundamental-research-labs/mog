use super::extract_single_series;

#[test]
fn series_bubble_3d_extracts_to_domain_series() {
    let series = ooxml_types::charts::ChartSeries {
        idx: 0,
        order: 0,
        bubble_3d: Some(true),
        ..Default::default()
    };

    let extracted = extract_single_series(&series, Some(domain_types::ChartType::Bubble), None);

    assert_eq!(extracted.bubble_3d, Some(true));
}
