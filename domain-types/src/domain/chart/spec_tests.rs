use super::floating_object::FloatingObjectData;
use super::*;

#[test]
fn chart_spec_to_floating_object_preserves_only_explicit_source_ranges() {
    let spec: ChartSpec = serde_json::from_value(serde_json::json!({
        "chartType": "column",
        "title": "Imported Revenue",
        "position": {
            "anchorRow": 0,
            "anchorCol": 0,
            "anchorRowOffset": 0,
            "anchorColOffset": 0,
            "endRow": 15,
            "endCol": 8,
            "endRowOffset": 0,
            "endColOffset": 0
        },
        "size": {
            "width": 640.0,
            "height": 300.0
        },
        "zIndex": 0,
        "series": [
            {
                "nameRef": "Data!B1",
                "values": "Data!B2:B3",
                "categories": "Data!A2:A3"
            },
            {
                "nameRef": "Data!C1",
                "values": "Data!C2:C3",
                "categories": "Data!A2:A3"
            }
        ]
    }))
    .expect("valid chart spec");

    let floating_object = spec.to_floating_object("sheet-abc", 1);
    let chart_data = match &floating_object.data {
        FloatingObjectData::Chart(chart_data) => chart_data,
        other => panic!("expected chart object, got {other:?}"),
    };

    assert_eq!(chart_data.series_range, None);
    assert_eq!(chart_data.category_range, None);
    assert_eq!(
        chart_data
            .series
            .as_ref()
            .and_then(|series| series.first())
            .and_then(|series| series.name_ref.as_deref()),
        Some("Data!B1")
    );
    assert_eq!(
        chart_data
            .series
            .as_ref()
            .and_then(|series| series.first())
            .and_then(|series| series.categories.as_deref()),
        Some("Data!A2:A3")
    );

    let roundtripped =
        ChartSpec::from_floating_object(&floating_object).expect("chart spec from object");
    assert_eq!(roundtripped.series_range, None);
    assert_eq!(roundtripped.category_range, None);
    assert_eq!(
        roundtripped
            .series
            .first()
            .and_then(|series| series.name_ref.as_deref()),
        Some("Data!B1")
    );
    assert_eq!(
        roundtripped
            .series
            .first()
            .and_then(|series| series.categories.as_deref()),
        Some("Data!A2:A3")
    );
}
