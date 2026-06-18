use super::*;

#[test]
fn parse_axis_self_closing_gridlines_do_not_capture_axis_sp_pr() {
    let xml = br#"<c:valAx>
        <c:axId val="500"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:majorGridlines/>
        <c:minorGridlines/>
        <c:crossAx val="600"/>
        <c:spPr>
            <a:ln>
                <a:solidFill><a:srgbClr val="D9E2F3"/></a:solidFill>
            </a:ln>
        </c:spPr>
    </c:valAx>"#;

    let axis = parse_axis(xml);
    let major_gridlines = axis.major_gridlines.as_ref().expect("major gridlines");
    assert!(
        major_gridlines.sp_pr.is_none(),
        "self-closing majorGridlines must not capture later axis spPr"
    );
    let minor_gridlines = axis.minor_gridlines.as_ref().expect("minor gridlines");
    assert!(
        minor_gridlines.sp_pr.is_none(),
        "self-closing minorGridlines must not capture later axis spPr"
    );

    assert_eq!(axis_line_color(&axis), Some("D9E2F3"));
}

fn axis_line_color(axis: &ChartAxis) -> Option<&str> {
    axis.sp_pr
        .as_ref()
        .and_then(|sp| sp.ln.as_ref())
        .and_then(|ln| ln.fill.as_ref())
        .and_then(|fill| match fill {
            ooxml_types::drawings::LineFill::Solid(solid) => match &solid.color {
                ooxml_types::drawings::DrawingColor::SrgbClr { val, .. } => Some(val.as_str()),
                _ => None,
            },
            _ => None,
        })
}
