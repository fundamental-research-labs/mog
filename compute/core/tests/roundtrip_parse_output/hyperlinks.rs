use std::sync::Arc;

use super::helpers::*;
use domain_types::Hyperlink;
use value_types::CellValue;

#[test]
fn roundtrip_hyperlinks() {
    let mut output = make_single_sheet(
        "Links",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Click me"))),
            cell(1, 0, CellValue::Text(Arc::from("Internal link"))),
            cell(2, 0, CellValue::Text(Arc::from("With tooltip"))),
        ],
    );
    output.sheets[0].hyperlinks = vec![
        Hyperlink {
            cell_ref: "A1".to_string(),
            target: Some("https://example.com".to_string()),
            location: None,
            display: Some("Click me".to_string()),
            tooltip: None,
            uid: None,
            ..Default::default()
        },
        Hyperlink {
            cell_ref: "A2".to_string(),
            target: None,
            location: Some("Sheet1!B5".to_string()),
            display: Some("Internal link".to_string()),
            tooltip: None,
            uid: None,
            ..Default::default()
        },
        Hyperlink {
            cell_ref: "A3".to_string(),
            target: Some("https://example.org".to_string()),
            location: None,
            display: Some("With tooltip".to_string()),
            tooltip: Some("Visit example.org".to_string()),
            uid: None,
            ..Default::default()
        },
    ];

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);

    let rt_links = &rt.sheets[0].hyperlinks;
    assert!(
        rt_links.len() >= 2,
        "Expected at least 2 hyperlinks, got {}",
        rt_links.len()
    );

    let link_map: std::collections::HashMap<&str, &Hyperlink> =
        rt_links.iter().map(|h| (h.cell_ref.as_str(), h)).collect();

    // External URL
    let h1 = link_map.get("A1").expect("Hyperlink on A1 should survive");
    assert_eq!(
        h1.target.as_deref(),
        Some("https://example.com"),
        "External URL should be preserved"
    );

    // Internal link
    let h2 = link_map.get("A2").expect("Hyperlink on A2 should survive");
    assert!(
        h2.location.is_some() || h2.target.is_some(),
        "Internal link should preserve location or target"
    );

    // Tooltip
    let h3 = link_map.get("A3").expect("Hyperlink on A3 should survive");
    assert_eq!(
        h3.target.as_deref(),
        Some("https://example.org"),
        "URL should be preserved"
    );
    assert_eq!(
        h3.tooltip.as_deref(),
        Some("Visit example.org"),
        "Tooltip should be preserved"
    );
}
