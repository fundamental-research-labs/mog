use super::*;
use domain_types::chart::{ChartSeriesCategorySourceTypeData, ChartSeriesDimensionSourceKindData};

#[test]
fn numeric_category_ref_source_type_reconstructs_num_ref_without_cache_hints() {
    let mut spec = minimal_chart_spec(DomainChartType::Column3D, None);
    let mut series = ranges::chart_series_data(
        None,
        Some("'Data'!$B$6:$B$13".to_string()),
        Some("'Data'!$C$6:$C$13".to_string()),
        0,
    );
    series.category_source_kind = Some(ChartSeriesDimensionSourceKindData::Ref);
    series.category_source_type = Some(ChartSeriesCategorySourceTypeData::Number);
    spec.series = vec![series];

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:cat><c:numRef>"), "{xml}");
    assert!(xml.contains("<c:f>'Data'!$B$6:$B$13</c:f>"), "{xml}");
    assert!(!xml.contains("<c:cat><c:strRef>"), "{xml}");
}
