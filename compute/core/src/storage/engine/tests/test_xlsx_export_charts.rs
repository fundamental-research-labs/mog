//! XLSX export regressions for runtime-created chart metadata.

use super::super::*;
use super::helpers::{archive_text, sheet_id, simple_snapshot};

#[test]
fn sdk_authored_chart_palette_exports_chart_color_style_part() {
    let cases = [
        (
            serde_json::json!({ "colors": ["#4472C4"] }),
            r#"id="0""#,
            Some(r#"<a:srgbClr val="4472C4"/>"#),
        ),
        (serde_json::json!({ "colorScheme": 1 }), r#"id="1""#, None),
        (
            serde_json::json!({ "colors": ["#4472C4"], "colorScheme": 1 }),
            r#"id="1""#,
            Some(r#"<a:srgbClr val="4472C4"/>"#),
        ),
    ];

    for (appearance_config, expected_scheme, expected_color) in cases {
        assert_sdk_authored_chart_color_style_export(
            appearance_config,
            expected_scheme,
            expected_color,
        );
    }
}

fn assert_sdk_authored_chart_color_style_export(
    appearance_config: serde_json::Value,
    expected_scheme: &str,
    expected_color: Option<&str>,
) {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sheet_id = sheet_id();
    let mut chart_config = serde_json::json!({
        "type": "area",
        "name": "Palette Contract",
        "title": "Palette Contract",
        "dataRange": "A1:B2",
        "anchorRow": 7,
        "anchorCol": 1,
        "width": 480.0,
        "height": 320.0
    });
    let chart_obj = chart_config
        .as_object_mut()
        .expect("chart config should be an object");
    for (key, value) in appearance_config
        .as_object()
        .expect("appearance config should be an object")
    {
        chart_obj.insert(key.clone(), value.clone());
    }

    engine
        .create_chart(&sheet_id, &chart_config)
        .expect("chart creation should succeed");

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let content_types =
        archive_text(&exported_bytes, "[Content_Types].xml").expect("content types should exist");
    let chart_rels = archive_text(&exported_bytes, "xl/charts/_rels/chart1.xml.rels")
        .expect("chart relationships should exist");
    let color_style = archive_text(&exported_bytes, "xl/charts/colors1.xml")
        .expect("chart color style should exist");

    assert!(content_types.contains("/xl/charts/colors1.xml"));
    assert!(
        chart_rels
            .contains("http://schemas.microsoft.com/office/2011/relationships/chartColorStyle")
    );
    assert!(chart_rels.contains(r#"Target="colors1.xml""#));
    assert!(color_style.contains(expected_scheme));
    if let Some(expected_color) = expected_color {
        assert!(color_style.contains(expected_color));
    }
}
