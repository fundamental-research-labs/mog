use super::*;

#[test]
fn parse_chart_ex_self_closing_gridlines_do_not_capture_axis_sp_pr() {
    let xml = br#"<cx:axis id="500">
        <cx:valScaling/>
        <cx:majorGridlines/>
        <cx:minorGridlines/>
        <cx:spPr>
            <a:ln>
                <a:solidFill><a:srgbClr val="D9E2F3"/></a:solidFill>
            </a:ln>
        </cx:spPr>
    </cx:axis>"#;

    let axis = parse_chart_ex_axis(xml);
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

#[test]
fn parse_chart_ex_axis_sp_pr_ignores_gridline_sp_pr() {
    let xml = br#"<cx:axis id="500">
        <cx:valScaling/>
        <cx:majorGridlines>
            <cx:spPr>
                <a:ln>
                    <a:solidFill><a:srgbClr val="CCCCCC"/></a:solidFill>
                </a:ln>
            </cx:spPr>
        </cx:majorGridlines>
        <cx:spPr>
            <a:ln>
                <a:solidFill><a:srgbClr val="D9E2F3"/></a:solidFill>
            </a:ln>
        </cx:spPr>
    </cx:axis>"#;

    let axis = parse_chart_ex_axis(xml);
    let major_gridlines = axis.major_gridlines.as_ref().expect("major gridlines");
    assert_eq!(gridline_line_color(major_gridlines), Some("CCCCCC"));
    assert_eq!(axis_line_color(&axis), Some("D9E2F3"));
}

fn gridline_line_color(gridlines: &ChartExGridlines) -> Option<&str> {
    shape_line_color(gridlines.sp_pr.as_ref())
}

fn axis_line_color(axis: &ChartExAxis) -> Option<&str> {
    shape_line_color(axis.sp_pr.as_ref())
}

fn shape_line_color(sp_pr: Option<&ooxml_types::drawings::ShapeProperties>) -> Option<&str> {
    sp_pr
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
