use super::*;
use ooxml_types::drawings::StAngle;

#[test]
fn test_parse_empty_axis() {
    let xml = b"<c:catAx></c:catAx>";
    let axis = parse_axis(xml);
    assert_eq!(axis.axis_type, AxisType::Category);
    assert_eq!(axis.ax_id, 0);
}

#[test]
fn test_parse_category_axis() {
    let xml = br#"<c:catAx>
        <c:axId val="123456"/>
        <c:scaling>
            <c:orientation val="minMax"/>
        </c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:majorGridlines/>
        <c:numFmt formatCode="General" sourceLinked="1"/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:crossAx val="654321"/>
        <c:crosses val="autoZero"/>
        <c:lblAlgn val="ctr"/>
        <c:lblOffset val="100"/>
    </c:catAx>"#;

    let axis = parse_axis(xml);
    assert_eq!(axis.axis_type, AxisType::Category);
    assert_eq!(axis.ax_id, 123456);
    assert_eq!(axis.cross_ax, 654321);
    assert!(!axis.delete);
    assert_eq!(axis.ax_pos, ChartAxisPosition::Bottom);
    assert_eq!(axis.scaling.orientation, Orientation::MinMax);
    assert!(axis.major_gridlines.is_some());
    assert!(axis.minor_gridlines.is_none());
    assert_eq!(axis.major_tick_mark, TickMark::Out);
    assert_eq!(axis.minor_tick_mark, TickMark::None);
    assert_eq!(axis.tick_lbl_pos, TickLabelPosition::NextTo);
    assert_eq!(axis.crosses, AxisCrosses::AutoZero);
    assert_eq!(axis.lbl_algn, Some(LabelAlignment::Center));
    assert_eq!(axis.lbl_offset, Some(100));
}

#[test]
fn test_parse_value_axis() {
    let xml = br#"<c:valAx>
        <c:axId val="654321"/>
        <c:scaling>
            <c:orientation val="minMax"/>
            <c:min val="0"/>
            <c:max val="100"/>
        </c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:majorGridlines/>
        <c:numFmt formatCode="0.00" sourceLinked="0"/>
        <c:majorTickMark val="out"/>
        <c:tickLblPos val="nextTo"/>
        <c:crossAx val="123456"/>
        <c:crosses val="autoZero"/>
        <c:majorUnit val="10"/>
        <c:minorUnit val="2"/>
    </c:valAx>"#;

    let axis = parse_axis(xml);
    assert_eq!(axis.axis_type, AxisType::Value);
    assert_eq!(axis.ax_id, 654321);
    assert_eq!(axis.ax_pos, ChartAxisPosition::Left);
    assert_eq!(axis.scaling.min, Some(0.0));
    assert_eq!(axis.scaling.max, Some(100.0));
    assert_eq!(axis.major_unit, Some(10.0));
    assert_eq!(axis.minor_unit, Some(2.0));
    assert!(axis.num_fmt.is_some());
    let num_fmt = axis.num_fmt.unwrap();
    assert_eq!(num_fmt.format_code, "0.00");
    assert_eq!(num_fmt.source_linked, Some(false));
}

#[test]
fn test_parse_date_axis() {
    let xml = br#"<c:dateAx>
        <c:axId val="111222"/>
        <c:scaling>
            <c:orientation val="minMax"/>
        </c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:numFmt formatCode="m/d/yyyy" sourceLinked="0"/>
        <c:majorTickMark val="out"/>
        <c:tickLblPos val="nextTo"/>
        <c:crossAx val="333444"/>
        <c:baseTimeUnit val="days"/>
        <c:majorUnit val="7"/>
        <c:majorTimeUnit val="days"/>
        <c:minorUnit val="1"/>
        <c:minorTimeUnit val="days"/>
    </c:dateAx>"#;

    let axis = parse_axis(xml);
    assert_eq!(axis.axis_type, AxisType::Date);
    assert_eq!(axis.ax_id, 111222);
    assert_eq!(axis.base_time_unit, Some(TimeUnit::Days));
    assert_eq!(axis.major_time_unit, Some(TimeUnit::Days));
    assert_eq!(axis.minor_time_unit, Some(TimeUnit::Days));
    assert_eq!(axis.major_unit, Some(7.0));
    assert_eq!(axis.minor_unit, Some(1.0));
}

#[test]
fn test_parse_series_axis() {
    let xml = br#"<c:serAx>
        <c:axId val="555666"/>
        <c:scaling>
            <c:orientation val="minMax"/>
        </c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:majorTickMark val="out"/>
        <c:tickLblPos val="nextTo"/>
        <c:crossAx val="777888"/>
    </c:serAx>"#;

    let axis = parse_axis(xml);
    assert_eq!(axis.axis_type, AxisType::Series);
    assert_eq!(axis.ax_id, 555666);
}

#[test]
fn test_parse_axis_with_title() {
    let xml = br#"<c:valAx>
        <c:axId val="123"/>
        <c:title>
            <c:tx>
                <c:rich>
                    <a:p>
                        <a:r>
                            <a:t>Revenue ($)</a:t>
                        </a:r>
                    </a:p>
                </c:rich>
            </c:tx>
            <c:overlay val="0"/>
        </c:title>
    </c:valAx>"#;

    let axis = parse_axis(xml);
    assert!(axis.title.is_some());
    let title = axis.title.unwrap();
    let text = extract_title_text(&title);
    assert_eq!(text, Some("Revenue ($)".to_string()));
    assert!(!extract_title_overlay(&title));
}

#[test]
fn test_parse_scaling_with_log_base() {
    let xml = br#"<c:scaling>
        <c:orientation val="minMax"/>
        <c:logBase val="10"/>
        <c:min val="1"/>
        <c:max val="1000"/>
    </c:scaling>"#;

    let scaling = parse_scaling(xml);
    assert_eq!(scaling.orientation, Orientation::MinMax);
    assert_eq!(scaling.log_base, Some(10.0));
    assert_eq!(scaling.min, Some(1.0));
    assert_eq!(scaling.max, Some(1000.0));
}

#[test]
fn test_parse_reversed_orientation() {
    let xml = br#"<c:scaling>
        <c:orientation val="maxMin"/>
    </c:scaling>"#;

    let scaling = parse_scaling(xml);
    assert_eq!(scaling.orientation, Orientation::MaxMin);
}

#[test]
fn test_chart_axis_position_from_ooxml() {
    assert_eq!(
        ChartAxisPosition::from_ooxml("b"),
        ChartAxisPosition::Bottom
    );
    assert_eq!(ChartAxisPosition::from_ooxml("t"), ChartAxisPosition::Top);
    assert_eq!(ChartAxisPosition::from_ooxml("l"), ChartAxisPosition::Left);
    assert_eq!(ChartAxisPosition::from_ooxml("r"), ChartAxisPosition::Right);
    assert_eq!(
        ChartAxisPosition::from_ooxml("unknown"),
        ChartAxisPosition::Bottom
    );
}

#[test]
fn test_tick_mark_from_ooxml() {
    assert_eq!(TickMark::from_ooxml("cross"), TickMark::Cross);
    assert_eq!(TickMark::from_ooxml("in"), TickMark::In);
    assert_eq!(TickMark::from_ooxml("none"), TickMark::None);
    assert_eq!(TickMark::from_ooxml("out"), TickMark::Out);
    assert_eq!(TickMark::from_ooxml("unknown"), TickMark::Cross);
}

#[test]
fn test_tick_label_position_from_ooxml() {
    assert_eq!(
        TickLabelPosition::from_ooxml("high"),
        TickLabelPosition::High
    );
    assert_eq!(TickLabelPosition::from_ooxml("low"), TickLabelPosition::Low);
    assert_eq!(
        TickLabelPosition::from_ooxml("nextTo"),
        TickLabelPosition::NextTo
    );
    assert_eq!(
        TickLabelPosition::from_ooxml("none"),
        TickLabelPosition::None
    );
}

#[test]
fn test_axis_crosses_from_ooxml() {
    assert_eq!(AxisCrosses::from_ooxml("autoZero"), AxisCrosses::AutoZero);
    assert_eq!(AxisCrosses::from_ooxml("max"), AxisCrosses::Max);
    assert_eq!(AxisCrosses::from_ooxml("min"), AxisCrosses::Min);
}

#[test]
fn test_label_alignment_from_ooxml() {
    assert_eq!(LabelAlignment::from_ooxml("ctr"), LabelAlignment::Center);
    assert_eq!(LabelAlignment::from_ooxml("l"), LabelAlignment::Left);
    assert_eq!(LabelAlignment::from_ooxml("r"), LabelAlignment::Right);
}

#[test]
fn test_time_unit_from_ooxml() {
    assert_eq!(TimeUnit::from_ooxml("days"), TimeUnit::Days);
    assert_eq!(TimeUnit::from_ooxml("months"), TimeUnit::Months);
    assert_eq!(TimeUnit::from_ooxml("years"), TimeUnit::Years);
}

#[test]
fn test_orientation_from_ooxml() {
    assert_eq!(Orientation::from_ooxml("minMax"), Orientation::MinMax);
    assert_eq!(Orientation::from_ooxml("maxMin"), Orientation::MaxMin);
}

#[test]
fn test_parse_axis_deleted() {
    let xml = br#"<c:catAx>
        <c:axId val="123"/>
        <c:delete val="1"/>
    </c:catAx>"#;

    let axis = parse_axis(xml);
    assert!(axis.delete);
}

#[test]
fn test_parse_axis_crosses_at_value() {
    let xml = br#"<c:valAx>
        <c:axId val="123"/>
        <c:crossesAt val="50"/>
    </c:valAx>"#;

    let axis = parse_axis(xml);
    assert_eq!(axis.crosses_at, Some(50.0));
}

#[test]
fn test_parse_number_format() {
    let xml = br##"<c:numFmt formatCode="#,##0.00" sourceLinked="0"/>"##;

    let num_fmt = parse_num_fmt(xml);
    assert_eq!(num_fmt.format_code, "#,##0.00");
    assert_eq!(num_fmt.source_linked, Some(false));
}

#[test]
fn test_parse_axis_with_skip() {
    let xml = br#"<c:catAx>
        <c:axId val="123"/>
        <c:tickLblSkip val="2"/>
        <c:tickMarkSkip val="3"/>
    </c:catAx>"#;

    let axis = parse_axis(xml);
    assert_eq!(axis.tick_lbl_skip, Some(2));
    assert_eq!(axis.tick_mark_skip, Some(3));
}

#[test]
fn test_axis_type_default() {
    assert_eq!(AxisType::default(), AxisType::Category);
}

#[test]
fn test_scaling_default() {
    let scaling = Scaling::default();
    assert_eq!(scaling.orientation, Orientation::MinMax);
    assert!(scaling.min.is_none());
    assert!(scaling.max.is_none());
    assert!(scaling.log_base.is_none());
}

#[test]
fn test_parse_axis_with_tx_pr() {
    let xml = br#"<c:valAx>
        <c:axId val="100"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:crossAx val="200"/>
        <c:txPr>
            <a:bodyPr rot="-5400000" vert="horz"/>
            <a:p>
                <a:pPr>
                    <a:defRPr sz="1000" b="1">
                        <a:solidFill>
                            <a:srgbClr val="333333"/>
                        </a:solidFill>
                        <a:latin typeface="Calibri"/>
                    </a:defRPr>
                </a:pPr>
            </a:p>
        </c:txPr>
    </c:valAx>"#;

    let axis = parse_axis(xml);
    assert_eq!(axis.axis_type, AxisType::Value);
    assert!(axis.tx_pr.is_some());
    let tx_pr = axis.tx_pr.unwrap();
    // bodyPr rotation should be parsed
    assert_eq!(tx_pr.body_props.rot, Some(StAngle::new(-5400000)));
    // paragraph with run properties
    assert!(!tx_pr.paragraphs.is_empty());
}

#[test]
fn test_parse_axis_with_cross_between_and_disp_units() {
    let xml = br#"<c:valAx>
        <c:axId val="300"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:crossAx val="400"/>
        <c:crossBetween val="between"/>
        <c:noMultiLvlLbl val="1"/>
        <c:dispUnits>
            <c:builtInUnit val="thousands"/>
        </c:dispUnits>
    </c:valAx>"#;

    let axis = parse_axis(xml);
    assert_eq!(axis.cross_between, Some(CrossBetween::Between));
    assert_eq!(axis.no_multi_lvl_lbl, Some(true));
    assert!(axis.disp_units.is_some());
}

#[test]
fn test_parse_axis_with_custom_display_units_label() {
    let xml = br#"<c:valAx>
        <c:axId val="300"/>
        <c:axPos val="l"/>
        <c:crossAx val="400"/>
        <c:dispUnits>
            <c:custUnit val="2500"/>
            <c:dispUnitsLbl>
                <c:layout>
                    <c:manualLayout>
                        <c:yMode val="edge"/>
                        <c:x val="0.25"/>
                    </c:manualLayout>
                </c:layout>
                <c:tx>
                    <c:rich>
                        <a:bodyPr/>
                        <a:lstStyle/>
                        <a:p><a:r><a:t>Custom Units</a:t></a:r></a:p>
                    </c:rich>
                </c:tx>
                <c:spPr>
                    <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
                </c:spPr>
                <c:txPr>
                    <a:bodyPr rot="5400000"/>
                    <a:p>
                        <a:pPr>
                            <a:defRPr sz="1200">
                                <a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>
                            </a:defRPr>
                        </a:pPr>
                    </a:p>
                </c:txPr>
            </c:dispUnitsLbl>
        </c:dispUnits>
    </c:valAx>"#;

    let axis = parse_axis(xml);
    let disp_units = axis.disp_units.expect("display units");
    assert_eq!(disp_units.kind, Some(DisplayUnitKind::Custom(2500.0)));
    let label = disp_units.disp_units_lbl.expect("display units label");
    assert_eq!(
        label.layout.as_ref().and_then(|layout| layout.x),
        Some(0.25)
    );
    assert_eq!(
        label.layout.as_ref().and_then(|layout| layout.y_mode),
        Some(ooxml_types::charts::LayoutMode::Edge),
    );
    assert!(matches!(
        label.tx,
        Some(ooxml_types::charts::ChartText::Rich(_))
    ));
    assert!(label.sp_pr.is_some());
    assert_eq!(
        label.tx_pr.as_ref().and_then(|tx_pr| tx_pr.body_props.rot),
        Some(ooxml_types::drawings::StAngle::new(5400000)),
    );
    assert!(
        axis.tx_pr.is_none(),
        "nested display-unit label txPr must not become axis tick-label txPr"
    );
    assert!(
        axis.sp_pr.is_none(),
        "nested display-unit label spPr must not become axis shape properties"
    );
}

#[test]
fn test_parse_axis_with_sp_pr_and_gridlines_sp_pr() {
    let xml = br#"<c:catAx>
        <c:axId val="500"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:crossAx val="600"/>
        <c:majorGridlines>
            <c:spPr>
                <a:ln w="12700">
                    <a:solidFill><a:srgbClr val="CCCCCC"/></a:solidFill>
                </a:ln>
            </c:spPr>
        </c:majorGridlines>
        <c:spPr>
            <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
        </c:spPr>
    </c:catAx>"#;

    let axis = parse_axis(xml);
    assert!(axis.major_gridlines.is_some());
    assert!(axis.major_gridlines.as_ref().unwrap().sp_pr.is_some());
    assert!(axis.sp_pr.is_some());
}

#[test]
fn test_self_closing_sppr_on_axis() {
    let xml = br#"<c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:spPr/>
        <c:txPr>
            <a:bodyPr/>
            <a:p><a:pPr><a:defRPr>
                <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
            </a:defRPr></a:pPr></a:p>
        </c:txPr>
    </c:catAx>"#;

    let axis = parse_axis(xml);
    // Self-closing <c:spPr/> should parse as empty ShapeProperties,
    // NOT pick up the solidFill from the subsequent txPr element.
    assert!(axis.sp_pr.is_some());
    let sp = axis.sp_pr.as_ref().unwrap();
    assert!(
        sp.fill.is_none(),
        "self-closing spPr should have no fill, got: {:?}",
        sp.fill
    );
}
