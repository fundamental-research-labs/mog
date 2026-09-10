use super::*;
use domain_types::chart::{
    ChartColorData, ChartDashStyle, ChartFormatData, ChartLineData, ChartType as DomainChartType,
};
use ooxml_types::charts::ChartSpace;

#[test]
fn modeled_chart_edit_preserves_required_blip_children_and_unmodeled_line_details() {
    let mut spec = minimal_chart_spec(DomainChartType::Line, None);
    spec.chart_format = Some(ChartFormatData {
        fill: None,
        line: Some(ChartLineData {
            color: Some(ChartColorData::Hex("FF0000".to_string())),
            width: Some(2.0),
            dash_style: Some(ChartDashStyle::Dot),
            transparency: None,
            no_fill: None,
        }),
        font: None,
        text_rotation: None,
        text_vertical_type: None,
        shadow: None,
    });

    let mut parsed = crate::domain::charts::Chart::parse(
        br#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:vendor="urn:vendor">
            <c:chart><c:plotArea/></c:chart>
            <c:spPr>
                <a:ln w="12700" cap="rnd" cmpd="dbl" algn="in">
                    <a:solidFill><a:srgbClr val="0000FF"/></a:solidFill>
                    <a:prstDash val="dash"/>
                    <a:round/>
                    <a:headEnd type="triangle" w="lg" len="sm"/>
                    <a:tailEnd type="stealth" w="sm" len="lg"/>
                </a:ln>
                <a:blipFill>
                    <a:blip xmlns:local="urn:local">
                        <a:clrRepl><a:srgbClr val="112233"/></a:clrRepl>
                        <a:duotone><a:srgbClr val="000000"/><a:srgbClr val="FFFFFF"/></a:duotone>
                        <a:fillOverlay blend="mult"><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></a:fillOverlay>
                        <a:alphaMod><a:cont val="50000"/></a:alphaMod>
                        <vendor:futureEffect><local:payload/></vendor:futureEffect>
                    </a:blip>
                </a:blipFill>
            </c:spPr>
        </c:chartSpace>"#,
    );
    let imported_shape = parsed
        .chart_space
        .take()
        .and_then(|chart_space| chart_space.sp_pr)
        .expect("Chart::parse should preserve chart-space shape properties");
    spec.definition = Some(domain_types::ChartDefinition::Chart(ChartSpace {
        sp_pr: Some(imported_shape),
        ..Default::default()
    }));

    let xml = chart_xml(&spec);

    // Public line fields win where they are modeled.
    assert!(
        xml.contains(r#"<a:ln w="25400" cap="rnd" cmpd="dbl" algn="in">"#),
        "{xml}"
    );
    assert!(xml.contains(r#"<a:srgbClr val="FF0000"/>"#), "{xml}");
    assert!(xml.contains(r#"<a:prstDash val="dot"/>"#), "{xml}");
    // Imported line fields without a public projection survive independently.
    assert!(xml.contains("<a:round/>"), "{xml}");
    assert!(
        xml.contains(r#"<a:headEnd type="triangle" w="lg" len="sm"/>"#),
        "{xml}"
    );
    assert!(
        xml.contains(r#"<a:tailEnd type="stealth" w="sm" len="lg"/>"#),
        "{xml}"
    );
    // Required blip children remain valid after the same modeled edit.
    assert!(
        xml.contains(r#"<a:clrRepl><a:srgbClr val="112233"/></a:clrRepl>"#),
        "{xml}"
    );
    assert!(
        xml.contains(
            r#"<a:duotone><a:srgbClr val="000000"/><a:srgbClr val="FFFFFF"/></a:duotone>"#
        ),
        "{xml}"
    );
    assert!(
        xml.contains(r#"<a:fillOverlay blend="mult"><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></a:fillOverlay>"#),
        "{xml}"
    );
    let alpha_start = xml.find("<a:alphaMod").expect("alphaMod child");
    let alpha_open_end = xml[alpha_start..]
        .find('>')
        .map(|offset| alpha_start + offset)
        .expect("alphaMod opening tag");
    assert!(
        xml[alpha_start..=alpha_open_end]
            .contains(r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main""#),
        "raw alphaMod must carry its inherited DrawingML binding: {xml}"
    );
    assert!(
        xml.contains(r#"<a:cont val="50000"/></a:alphaMod>"#),
        "{xml}"
    );
    assert!(xml.contains("<vendor:futureEffect"), "{xml}");
    assert!(xml.contains(r#"xmlns:vendor="urn:vendor""#), "{xml}");
    assert!(xml.contains(r#"<local:payload/>"#), "{xml}");
    assert!(!xml.contains("<a:alphaMod/>"), "{xml}");
}
