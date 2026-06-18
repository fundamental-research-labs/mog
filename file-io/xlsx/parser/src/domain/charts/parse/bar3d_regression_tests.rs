use crate::domain::charts::{BarShape, Chart, ChartTypeConfig};

#[test]
fn series_bar_shape_does_not_become_bar3d_chart_shape() {
    let xml = br#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
            <c:plotArea>
                <c:bar3DChart>
                    <c:barDir val="col"/>
                    <c:grouping val="clustered"/>
                    <c:ser>
                        <c:idx val="0"/>
                        <c:order val="0"/>
                        <c:shape val="cone"/>
                    </c:ser>
                    <c:gapWidth val="150"/>
                </c:bar3DChart>
            </c:plotArea>
        </c:chart>
    </c:chartSpace>"#;

    let chart = Chart::parse(xml);

    match chart.chart_type_config.expect("bar3D config") {
        ChartTypeConfig::Bar3D(config) => {
            assert_eq!(config.shape, None);
        }
        other => panic!("expected bar3D config, got {other:?}"),
    }

    assert_eq!(
        chart.series.first().and_then(|series| series.shape),
        Some(BarShape::Cone)
    );
}

#[test]
fn chart_level_bar3d_shape_is_parsed_from_direct_child() {
    let xml = br#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:chart>
            <c:plotArea>
                <c:bar3DChart>
                    <c:barDir val="col"/>
                    <c:grouping val="clustered"/>
                    <c:ser>
                        <c:idx val="0"/>
                        <c:order val="0"/>
                    </c:ser>
                    <c:gapWidth val="150"/>
                    <c:shape val="cylinder"/>
                </c:bar3DChart>
            </c:plotArea>
        </c:chart>
    </c:chartSpace>"#;

    let chart = Chart::parse(xml);

    match chart.chart_type_config.expect("bar3D config") {
        ChartTypeConfig::Bar3D(config) => {
            assert_eq!(config.shape, Some(BarShape::Cylinder));
        }
        other => panic!("expected bar3D config, got {other:?}"),
    }
}
