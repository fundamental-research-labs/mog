use super::*;
use domain_types::ChartDefinition;
use domain_types::chart::{ChartFontData, ChartFormatData, ChartFormatStringData};
use ooxml_types::charts::{Chart, ChartSpace, ChartText, Title};

#[test]
fn redundant_title_font_stays_on_rich_text_runs() {
    let font = ChartFontData {
        name: Some("Aptos".to_string()),
        size: Some(14.0),
        bold: Some(true),
        italic: None,
        color: None,
        underline: None,
        strikethrough: None,
    };
    let mut spec = minimal_chart_spec(DomainChartType::Column, Some("Data!A1:B3"));
    spec.title_format = Some(ChartFormatData {
        fill: None,
        line: None,
        font: Some(font.clone()),
        text_rotation: Some(45.0),
        text_vertical_type: None,
        shadow: None,
    });
    spec.title_rich_text = Some(vec![ChartFormatStringData {
        text: "Revenue".to_string(),
        font: Some(font),
    }]);

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:txPr>"), "{xml}");
    assert!(xml.contains("rot=\"2700000\""), "{xml}");
    assert!(xml.contains("<a:rPr"), "{xml}");
    assert!(!xml.contains("<a:defRPr"), "{xml}");
}

#[test]
fn imported_title_tx_pr_survives_redundant_rich_text_font() {
    let font = ChartFontData {
        name: None,
        size: None,
        bold: Some(true),
        italic: None,
        color: None,
        underline: None,
        strikethrough: None,
    };
    let mut spec = minimal_chart_spec(DomainChartType::Column, Some("Data!A1:B3"));
    spec.title_format = Some(ChartFormatData {
        fill: None,
        line: None,
        font: Some(font.clone()),
        text_rotation: None,
        text_vertical_type: None,
        shadow: None,
    });
    spec.title_rich_text = Some(vec![ChartFormatStringData {
        text: "Revenue".to_string(),
        font: Some(font),
    }]);
    spec.definition = Some(ChartDefinition::Chart(ChartSpace {
        chart: Chart {
            title: Some(Title {
                tx: Some(ChartText::Rich(crate::domain::charts::parse_text_body(
                    br#"<c:rich xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                        <a:bodyPr/><a:p><a:r><a:t>Revenue</a:t></a:r></a:p>
                    </c:rich>"#,
                ))),
                tx_pr: Some(crate::domain::charts::parse_text_body(
                    br#"<c:txPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                        <a:bodyPr/><a:p><a:pPr><a:defRPr b="1"/></a:pPr></a:p>
                    </c:txPr>"#,
                )),
                ..Default::default()
            }),
            ..Default::default()
        },
        ..Default::default()
    }));

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:txPr>"), "{xml}");
    assert!(xml.contains("<a:defRPr b=\"1\"/>"), "{xml}");
}

#[test]
fn imported_empty_title_does_not_materialize_chart_title_placeholder() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, Some("Data!A1:B3"));
    spec.title = None;
    spec.auto_title_deleted = Some(false);
    spec.definition = Some(ChartDefinition::Chart(ChartSpace {
        chart: Chart {
            title: Some(Title {
                tx_pr: Some(crate::domain::charts::parse_text_body(
                    br#"<c:txPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                        <a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1800"/></a:pPr></a:p>
                    </c:txPr>"#,
                )),
                ..Default::default()
            }),
            auto_title_deleted: Some(false),
            ..Default::default()
        },
        ..Default::default()
    }));

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:title>"), "{xml}");
    assert!(xml.contains("<c:txPr>"), "{xml}");
    assert!(!xml.contains("<a:t>Chart Title</a:t>"), "{xml}");
}

#[test]
fn imported_rich_text_field_survives_modeled_title_reconstruction() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, Some("Data!A1:B3"));
    spec.title = Some("Revenue".to_string());
    spec.title_rich_text = Some(vec![ChartFormatStringData {
        text: "Revenue".to_string(),
        font: None,
    }]);
    spec.definition = Some(ChartDefinition::Chart(ChartSpace {
        chart: Chart {
            title: Some(Title {
                tx: Some(ChartText::Rich(crate::domain::charts::parse_text_body(
                    br#"<c:rich xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                        <a:bodyPr/><a:p><a:fld id="{field-id}" type="VALUE"><a:t>Revenue</a:t></a:fld></a:p>
                    </c:rich>"#,
                ))),
                ..Default::default()
            }),
            ..Default::default()
        },
        ..Default::default()
    }));

    let xml = chart_xml(&spec);

    assert!(xml.contains("<a:fld id=\"{field-id}\" type=\"VALUE\">"));
}

#[test]
fn modeled_title_replaces_stale_rich_text_and_keeps_imported_run_formatting() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, Some("Data!A1:B3"));
    spec.title = Some("Edited Revenue".to_string());
    spec.title_rich_text = Some(vec![ChartFormatStringData {
        text: "Imported Revenue".to_string(),
        font: Some(ChartFontData {
            name: None,
            size: Some(14.0),
            bold: Some(true),
            italic: None,
            color: None,
            underline: None,
            strikethrough: None,
        }),
    }]);
    spec.definition = Some(ChartDefinition::Chart(ChartSpace {
        chart: Chart {
            title: Some(Title {
                tx: Some(ChartText::Rich(crate::domain::charts::parse_text_body(
                    br#"<c:rich xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                        <a:bodyPr wrap="square"/><a:p><a:r><a:rPr lang="en-US"/><a:t>Imported Revenue</a:t></a:r></a:p>
                    </c:rich>"#,
                ))),
                ..Default::default()
            }),
            ..Default::default()
        },
        ..Default::default()
    }));

    let xml = chart_xml(&spec);

    assert!(xml.contains("Edited Revenue"), "{xml}");
    assert!(!xml.contains("Imported Revenue"), "{xml}");
    assert!(xml.contains("lang=\"en-US\""), "{xml}");
    assert!(xml.contains("wrap=\"square\""), "{xml}");
}
