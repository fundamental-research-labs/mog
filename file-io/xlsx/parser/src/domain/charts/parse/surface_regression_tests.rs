use crate::domain::charts::Chart;

#[test]
fn self_closing_surfaces_do_not_capture_later_series_shape_properties() {
    let xml = br#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
            <c:view3D>
                <c:rotX val="15"/>
                <c:rotY val="20"/>
            </c:view3D>
            <c:floor/>
            <c:sideWall/>
            <c:backWall/>
            <c:plotArea>
                <c:bar3DChart>
                    <c:barDir val="col"/>
                    <c:ser>
                        <c:idx val="0"/>
                        <c:order val="0"/>
                        <c:spPr>
                            <a:ln>
                                <a:prstDash val="solid"/>
                            </a:ln>
                        </c:spPr>
                    </c:ser>
                </c:bar3DChart>
            </c:plotArea>
        </c:chart>
    </c:chartSpace>"#;

    let chart = Chart::parse(xml);

    assert!(chart.floor.as_ref().expect("floor").sp_pr.is_none());
    assert!(chart.side_wall.as_ref().expect("side wall").sp_pr.is_none());
    assert!(chart.back_wall.as_ref().expect("back wall").sp_pr.is_none());

    assert!(
        chart
            .series
            .first()
            .and_then(|series| series.sp_pr.as_ref())
            .and_then(|sp| sp.ln.as_ref())
            .and_then(|ln| ln.dash.as_ref())
            .is_some(),
        "series shape properties should still be parsed"
    );
}
