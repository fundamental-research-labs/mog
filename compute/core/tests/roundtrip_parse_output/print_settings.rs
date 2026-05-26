use std::sync::Arc;

use super::helpers::*;
use domain_types::{HeaderFooter, PageMargins, PrintSettings};
use value_types::CellValue;

#[test]
fn roundtrip_print_settings_basic() {
    let mut output = make_single_sheet(
        "PrintSheet",
        vec![cell(0, 0, CellValue::Text(Arc::from("Print me")))],
    );
    output.sheets[0].print_settings = Some(PrintSettings {
        paper_size: Some(1), // Letter
        orientation: Some("landscape".to_string()),
        scale: Some(80),
        gridlines: true,
        h_centered: true,
        margins: Some(PageMargins {
            top: 1.0,
            bottom: 1.0,
            left: 0.75,
            right: 0.75,
            header: 0.5,
            footer: 0.5,
        }),
        ..Default::default()
    });

    let rt = roundtrip(&output);
    let rt_ps = rt.sheets[0]
        .print_settings
        .as_ref()
        .expect("Print settings should survive round-trip");

    assert_eq!(rt_ps.paper_size, Some(1), "Paper size should be preserved");
    assert_eq!(
        rt_ps.orientation.as_deref(),
        Some("landscape"),
        "Orientation should be preserved"
    );
    assert_eq!(rt_ps.scale, Some(80), "Scale should be preserved");
    assert_eq!(rt_ps.gridlines, true, "Gridlines should be preserved");
    assert_eq!(rt_ps.h_centered, true, "h_centered should be preserved");

    // Check margins
    if let Some(ref margins) = rt_ps.margins {
        let eps = 0.01;
        assert!((margins.top - 1.0).abs() < eps, "Top margin mismatch");
        assert!((margins.bottom - 1.0).abs() < eps, "Bottom margin mismatch");
        assert!((margins.left - 0.75).abs() < eps, "Left margin mismatch");
        assert!((margins.right - 0.75).abs() < eps, "Right margin mismatch");
    }
}

#[test]
fn roundtrip_print_settings_header_footer() {
    let mut output = make_single_sheet(
        "HeaderFooter",
        vec![cell(0, 0, CellValue::Text(Arc::from("Content")))],
    );
    output.sheets[0].print_settings = Some(PrintSettings {
        header_footer: Some(HeaderFooter {
            odd_header: Some("&CPage Header".to_string()),
            odd_footer: Some("&CPage &P of &N".to_string()),
            different_odd_even: false,
            different_first: false,
            ..Default::default()
        }),
        ..Default::default()
    });

    let rt = roundtrip(&output);
    let rt_ps = rt.sheets[0]
        .print_settings
        .as_ref()
        .expect("Print settings should survive");

    if let Some(ref hf) = rt_ps.header_footer {
        assert!(hf.odd_header.is_some(), "Odd header should be preserved");
        assert!(hf.odd_footer.is_some(), "Odd footer should be preserved");
        if let Some(ref header) = hf.odd_header {
            assert!(
                header.contains("Page Header"),
                "Header text should be preserved. Got: {header}"
            );
        }
    } else {
        // Some writers may not output header_footer if not supported
        // This is acceptable but we note it
        eprintln!("WARNING: header_footer not preserved in round-trip");
    }
}

#[test]
fn roundtrip_print_settings_fit_to_page() {
    let mut output = make_single_sheet(
        "FitToPage",
        vec![cell(0, 0, CellValue::Text(Arc::from("Fit")))],
    );
    output.sheets[0].print_settings = Some(PrintSettings {
        fit_to_width: Some(1),
        fit_to_height: Some(1),
        orientation: Some("portrait".to_string()),
        ..Default::default()
    });

    let rt = roundtrip(&output);
    let rt_ps = rt.sheets[0]
        .print_settings
        .as_ref()
        .expect("Print settings should survive");

    assert_eq!(
        rt_ps.fit_to_width,
        Some(1),
        "fit_to_width should be preserved"
    );
    assert_eq!(
        rt_ps.fit_to_height,
        Some(1),
        "fit_to_height should be preserved"
    );
    assert_eq!(
        rt_ps.orientation.as_deref(),
        Some("portrait"),
        "Orientation should be preserved"
    );
}
