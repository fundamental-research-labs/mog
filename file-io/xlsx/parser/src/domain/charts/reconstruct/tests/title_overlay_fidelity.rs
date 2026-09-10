use super::*;
use domain_types::chart::{AxisData, SingleAxisData};

#[test]
fn authored_chart_and_axis_titles_emit_overlay() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, Some("Sheet1!A1:B5"));
    spec.title = Some("Monthly Units".to_string());
    spec.axes = Some(AxisData {
        category_axis: Some(SingleAxisData {
            title: Some("Month".to_string()),
            visible: true,
            ..Default::default()
        }),
        value_axis: Some(SingleAxisData {
            title: Some("Units Sold".to_string()),
            visible: true,
            ..Default::default()
        }),
        secondary_category_axis: None,
        secondary_value_axis: None,
        series_axis: None,
    });

    let xml = chart_xml(&spec);
    let title_count = xml.matches("<c:title>").count();
    assert_eq!(title_count, 3, "chart + both axes: {xml}");
    assert_eq!(
        xml.matches(r#"<c:overlay val="0"/>"#).count(),
        title_count,
        "each authored title must reserve space: {xml}"
    );
    assert!(xml.contains(">Monthly Units<"), "{xml}");
    assert!(xml.contains(">Month<"), "{xml}");
    assert!(xml.contains(">Units Sold<"), "{xml}");
}
