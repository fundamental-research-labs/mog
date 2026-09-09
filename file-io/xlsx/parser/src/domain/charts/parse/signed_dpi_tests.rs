use crate::domain::charts::{write_canonical, Chart};

#[test]
fn chart_page_setup_signed_dpi_round_trips_through_canonical_xml() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                    </c:barChart>
                </c:plotArea>
            </c:chart>
            <c:printSettings>
                <c:pageSetup horizontalDpi="-1" verticalDpi="2147483647"/>
            </c:printSettings>
        </c:chartSpace>"#;

    let parsed = Chart::parse(xml);
    let page_setup = parsed
        .chart_space
        .as_ref()
        .and_then(|chart_space| chart_space.print_settings.as_ref())
        .and_then(|print_settings| print_settings.page_setup.as_ref())
        .expect("signed chart page setup");
    assert_eq!(page_setup.horizontal_dpi, Some(-1));
    assert_eq!(page_setup.vertical_dpi, Some(i32::MAX));

    let serialized = write_canonical::serialize_chart_space(
        parsed.chart_space.as_ref().expect("canonical chart space"),
    );
    let serialized = String::from_utf8(serialized).expect("canonical chart XML");
    assert!(serialized.contains("horizontalDpi=\"-1\""));
    assert!(serialized.contains("verticalDpi=\"2147483647\""));

    let reparsed = Chart::parse(serialized.as_bytes());
    let reparsed_page_setup = reparsed
        .chart_space
        .as_ref()
        .and_then(|chart_space| chart_space.print_settings.as_ref())
        .and_then(|print_settings| print_settings.page_setup.as_ref())
        .expect("reparsed signed chart page setup");
    assert_eq!(reparsed_page_setup.horizontal_dpi, Some(-1));
    assert_eq!(reparsed_page_setup.vertical_dpi, Some(i32::MAX));
}
