use super::*;
use ooxml_types::charts::MarkerStyle;

#[test]
fn test_parse_empty_series() {
    let xml = b"<c:ser></c:ser>";
    let series = parse_series(xml);
    assert_eq!(series.idx, 0);
    assert_eq!(series.order, 0);
}

#[test]
fn test_parse_series_basic() {
    let xml = br#"<c:ser>
            <c:idx val="0"/>
            <c:order val="0"/>
        </c:ser>"#;

    let series = parse_series(xml);
    assert_eq!(series.idx, 0);
    assert_eq!(series.order, 0);
}

#[test]
fn test_parse_series_with_text() {
    let xml = br#"<c:ser>
            <c:idx val="0"/>
            <c:order val="0"/>
            <c:tx>
                <c:v>Sales</c:v>
            </c:tx>
        </c:ser>"#;

    let series = parse_series(xml);
    assert!(series.tx.is_some());
    match series.tx.unwrap() {
        SeriesTextSource::Value(v) => assert_eq!(v, "Sales"),
        other => panic!("Expected SeriesTextSource::Value, got {:?}", other),
    }
}

#[test]
fn test_parse_series_all() {
    let xml = br#"<c:barChart>
            <c:ser>
                <c:idx val="0"/>
                <c:order val="0"/>
            </c:ser>
            <c:ser>
                <c:idx val="1"/>
                <c:order val="1"/>
            </c:ser>
        </c:barChart>"#;

    let series = parse_all_series(xml);
    assert_eq!(series.len(), 2);
    assert_eq!(series[0].idx, 0);
    assert_eq!(series[1].idx, 1);
}

#[test]
fn test_parse_num_ref() {
    let xml = br#"<c:numRef>
            <c:f>Sheet1!$B$2:$B$5</c:f>
            <c:numCache>
                <c:formatCode>General</c:formatCode>
                <c:ptCount val="4"/>
                <c:pt idx="0"><c:v>10</c:v></c:pt>
                <c:pt idx="1"><c:v>20</c:v></c:pt>
            </c:numCache>
        </c:numRef>"#;

    let num_ref = parse_num_ref(xml);
    assert_eq!(num_ref.f, "Sheet1!$B$2:$B$5");
    assert!(num_ref.num_cache.is_some());

    let cache = num_ref.num_cache.unwrap();
    assert_eq!(cache.format_code, Some("General".to_string()));
    assert_eq!(cache.pt_count, Some(4));
    assert_eq!(cache.pts.len(), 2);
    assert_eq!(cache.pts[0].idx, 0);
    assert_eq!(cache.pts[0].v, "10");
    assert_eq!(cache.pts[1].idx, 1);
    assert_eq!(cache.pts[1].v, "20");
}

#[test]
fn test_parse_str_ref() {
    let xml = br#"<c:strRef>
            <c:f>Sheet1!$A$2:$A$5</c:f>
            <c:strCache>
                <c:ptCount val="4"/>
                <c:pt idx="0"><c:v>Q1</c:v></c:pt>
                <c:pt idx="1"><c:v>Q2</c:v></c:pt>
            </c:strCache>
        </c:strRef>"#;

    let str_ref = parse_str_ref(xml);
    assert_eq!(str_ref.f, "Sheet1!$A$2:$A$5");
    assert!(str_ref.str_cache.is_some());

    let cache = str_ref.str_cache.unwrap();
    assert_eq!(cache.pt_count, Some(4));
    assert_eq!(cache.pts.len(), 2);
    assert_eq!(cache.pts[0].v, "Q1");
    assert_eq!(cache.pts[1].v, "Q2");
}

#[test]
fn test_parse_data_point() {
    let xml = br#"<c:dPt>
            <c:idx val="2"/>
            <c:explosion val="25"/>
        </c:dPt>"#;

    let point = parse_data_point(xml);
    assert_eq!(point.idx, 2);
    assert_eq!(point.explosion, Some(25));
}

#[test]
fn test_parse_data_labels() {
    let xml = br#"<c:dLbls>
            <c:showVal val="1"/>
            <c:showCatName val="0"/>
            <c:showSerName val="1"/>
            <c:dLblPos val="outEnd"/>
        </c:dLbls>"#;

    let labels = parse_data_labels(xml);
    assert!(labels.show_value);
    assert!(!labels.show_category);
    assert!(labels.show_series_name);
    assert_eq!(labels.position, DataLabelPosition::OutsideEnd);
}

#[test]
fn test_data_label_position_from_ooxml() {
    assert_eq!(
        DataLabelPosition::from_ooxml("bestFit"),
        DataLabelPosition::BestFit
    );
    assert_eq!(
        DataLabelPosition::from_ooxml("ctr"),
        DataLabelPosition::Center
    );
    assert_eq!(
        DataLabelPosition::from_ooxml("outEnd"),
        DataLabelPosition::OutsideEnd
    );
    assert_eq!(
        DataLabelPosition::from_ooxml("inEnd"),
        DataLabelPosition::InsideEnd
    );
}

#[test]
fn test_parse_error_bars() {
    let xml = br#"<c:errBars>
            <c:errDir val="y"/>
            <c:errBarType val="both"/>
            <c:errValType val="percentage"/>
            <c:val val="5"/>
        </c:errBars>"#;

    let err_bars = parse_error_bars(xml);
    assert_eq!(err_bars.err_dir, Some(ErrorBarDirection::Y));
    assert_eq!(err_bars.err_bar_type, ErrorBarType::Both);
    assert_eq!(err_bars.err_val_type, ErrorValueType::Percentage);
    assert_eq!(err_bars.val, Some(5.0));
}

#[test]
fn test_error_bar_types() {
    assert_eq!(ErrorBarDirection::from_ooxml("x"), ErrorBarDirection::X);
    assert_eq!(ErrorBarDirection::from_ooxml("y"), ErrorBarDirection::Y);
    assert_eq!(ErrorBarType::from_ooxml("plus"), ErrorBarType::Plus);
    assert_eq!(ErrorBarType::from_ooxml("minus"), ErrorBarType::Minus);
    assert_eq!(
        ErrorValueType::from_ooxml("fixedVal"),
        ErrorValueType::FixedVal
    );
    assert_eq!(ErrorValueType::from_ooxml("stdDev"), ErrorValueType::StdDev);
}

#[test]
fn test_parse_trendline() {
    let xml = br#"<c:trendline>
            <c:name>Linear Trend</c:name>
            <c:trendlineType val="linear"/>
            <c:forward val="2"/>
            <c:backward val="1"/>
            <c:dispEq val="1"/>
            <c:dispRSqr val="1"/>
        </c:trendline>"#;

    let trendline = parse_trendline(xml);
    assert_eq!(trendline.name, Some("Linear Trend".to_string()));
    assert_eq!(trendline.trendline_type, TrendlineType::Linear);
    assert_eq!(trendline.forward, Some(2.0));
    assert_eq!(trendline.backward, Some(1.0));
    assert_eq!(trendline.disp_eq, Some(true));
    assert_eq!(trendline.disp_r_sqr, Some(true));
}

#[test]
fn test_parse_polynomial_trendline() {
    let xml = br#"<c:trendline>
            <c:trendlineType val="poly"/>
            <c:order val="3"/>
        </c:trendline>"#;

    let trendline = parse_trendline(xml);
    assert_eq!(trendline.trendline_type, TrendlineType::Polynomial);
    assert_eq!(trendline.order, Some(3));
}

#[test]
fn test_parse_moving_average_trendline() {
    let xml = br#"<c:trendline>
            <c:trendlineType val="movingAvg"/>
            <c:period val="5"/>
        </c:trendline>"#;

    let trendline = parse_trendline(xml);
    assert_eq!(trendline.trendline_type, TrendlineType::MovingAverage);
    assert_eq!(trendline.period, Some(5));
}

#[test]
fn test_trendline_type_from_ooxml() {
    assert_eq!(TrendlineType::from_ooxml("exp"), TrendlineType::Exponential);
    assert_eq!(TrendlineType::from_ooxml("linear"), TrendlineType::Linear);
    assert_eq!(TrendlineType::from_ooxml("log"), TrendlineType::Logarithmic);
    assert_eq!(
        TrendlineType::from_ooxml("movingAvg"),
        TrendlineType::MovingAverage
    );
    assert_eq!(TrendlineType::from_ooxml("poly"), TrendlineType::Polynomial);
    assert_eq!(TrendlineType::from_ooxml("power"), TrendlineType::Power);
}

#[test]
fn test_parse_marker() {
    let xml = br#"<c:marker>
            <c:symbol val="circle"/>
            <c:size val="7"/>
        </c:marker>"#;

    let marker = parse_marker(xml);
    assert_eq!(marker.symbol, Some(MarkerStyle::Circle));
    assert_eq!(marker.size, Some(7));
}

#[test]
fn test_parse_series_with_values() {
    let xml = br#"<c:ser>
            <c:idx val="0"/>
            <c:order val="0"/>
            <c:val>
                <c:numRef>
                    <c:f>Sheet1!$B$2:$B$5</c:f>
                </c:numRef>
            </c:val>
            <c:cat>
                <c:strRef>
                    <c:f>Sheet1!$A$2:$A$5</c:f>
                </c:strRef>
            </c:cat>
        </c:ser>"#;

    let series = parse_series(xml);
    assert!(series.val.is_some());
    assert!(series.cat.is_some());

    match series.val.unwrap() {
        NumDataSource::Ref(nr) => assert_eq!(nr.f, "Sheet1!$B$2:$B$5"),
        other => panic!("Expected NumDataSource::Ref, got {:?}", other),
    }

    match series.cat.unwrap() {
        CatDataSource::StrRef(sr) => assert_eq!(sr.f, "Sheet1!$A$2:$A$5"),
        other => panic!("Expected CatDataSource::StrRef, got {:?}", other),
    }
}

#[test]
fn test_parse_smooth_series() {
    let xml = br#"<c:ser>
            <c:idx val="0"/>
            <c:smooth val="1"/>
        </c:ser>"#;

    let series = parse_series(xml);
    assert_eq!(series.smooth, Some(true));
}

#[test]
fn test_parse_exploded_pie_series() {
    let xml = br#"<c:ser>
            <c:idx val="0"/>
            <c:explosion val="25"/>
        </c:ser>"#;

    let series = parse_series(xml);
    assert_eq!(series.explosion, Some(25));
}

#[test]
fn test_parse_multiple_trendlines() {
    let xml = br#"<c:ser>
            <c:idx val="0"/>
            <c:order val="0"/>
            <c:trendline>
                <c:name>Linear Trend</c:name>
                <c:trendlineType val="linear"/>
                <c:dispEq val="1"/>
            </c:trendline>
            <c:trendline>
                <c:name>Exponential Trend</c:name>
                <c:trendlineType val="exp"/>
                <c:dispRSqr val="1"/>
            </c:trendline>
            <c:trendline>
                <c:name>Polynomial Trend</c:name>
                <c:trendlineType val="poly"/>
                <c:order val="2"/>
            </c:trendline>
        </c:ser>"#;

    let series = parse_series(xml);
    assert_eq!(series.trendline.len(), 3);

    // First trendline: Linear
    assert_eq!(series.trendline[0].name, Some("Linear Trend".to_string()));
    assert_eq!(series.trendline[0].trendline_type, TrendlineType::Linear);
    assert_eq!(series.trendline[0].disp_eq, Some(true));

    // Second trendline: Exponential
    assert_eq!(
        series.trendline[1].name,
        Some("Exponential Trend".to_string())
    );
    assert_eq!(
        series.trendline[1].trendline_type,
        TrendlineType::Exponential
    );
    assert_eq!(series.trendline[1].disp_r_sqr, Some(true));

    // Third trendline: Polynomial
    assert_eq!(
        series.trendline[2].name,
        Some("Polynomial Trend".to_string())
    );
    assert_eq!(
        series.trendline[2].trendline_type,
        TrendlineType::Polynomial
    );
    assert_eq!(series.trendline[2].order, Some(2));
}

#[test]
fn test_parse_single_trendline() {
    let xml = br#"<c:ser>
            <c:idx val="0"/>
            <c:trendline>
                <c:trendlineType val="linear"/>
            </c:trendline>
        </c:ser>"#;

    let series = parse_series(xml);
    assert_eq!(series.trendline.len(), 1);
    assert_eq!(series.trendline[0].trendline_type, TrendlineType::Linear);
}

#[test]
fn test_parse_no_trendlines() {
    let xml = br#"<c:ser>
            <c:idx val="0"/>
        </c:ser>"#;

    let series = parse_series(xml);
    assert!(series.trendline.is_empty());
}

#[test]
fn test_parse_series_with_solid_fill_sp_pr() {
    let xml = br#"<c:ser>
            <c:idx val="0"/>
            <c:order val="0"/>
            <c:spPr>
                <a:solidFill>
                    <a:srgbClr val="FF0000"/>
                </a:solidFill>
                <a:ln w="25400">
                    <a:solidFill>
                        <a:srgbClr val="0000FF"/>
                    </a:solidFill>
                </a:ln>
            </c:spPr>
        </c:ser>"#;

    let series = parse_series(xml);
    assert!(series.sp_pr.is_some());
    let sp = series.sp_pr.unwrap();
    // Should have a solid fill
    assert!(sp.fill.is_some());
    // Should have an outline
    assert!(sp.ln.is_some());
    let outline = sp.ln.unwrap();
    assert_eq!(outline.width, Some(25400));
}

#[test]
fn test_parse_data_point_with_sp_pr() {
    let xml = br#"<c:dPt>
            <c:idx val="2"/>
            <c:spPr>
                <a:solidFill>
                    <a:srgbClr val="00FF00"/>
                </a:solidFill>
            </c:spPr>
        </c:dPt>"#;

    let point = parse_data_point(xml);
    assert_eq!(point.idx, 2);
    assert!(point.sp_pr.is_some());
}

#[test]
fn test_parse_data_labels_with_sp_pr_and_tx_pr() {
    let xml = br#"<c:dLbls>
            <c:showVal val="1"/>
            <c:spPr>
                <a:solidFill>
                    <a:srgbClr val="FFFFFF"/>
                </a:solidFill>
            </c:spPr>
            <c:txPr>
                <a:bodyPr rot="0"/>
                <a:p>
                    <a:pPr>
                        <a:defRPr sz="1000" b="1"/>
                    </a:pPr>
                </a:p>
            </c:txPr>
        </c:dLbls>"#;

    let labels = parse_data_labels(xml);
    assert!(labels.show_value);
    assert!(labels.sp_pr.is_some());
    assert!(labels.tx_pr.is_some());
}

#[test]
fn test_parse_trendline_with_label() {
    let xml = br#"<c:trendline>
            <c:trendlineType val="linear"/>
            <c:dispEq val="1"/>
            <c:trendlineLbl>
                <c:layout>
                    <c:manualLayout>
                        <c:x val="0.1"/>
                        <c:y val="0.2"/>
                    </c:manualLayout>
                </c:layout>
                <c:numFmt formatCode="0.00" sourceLinked="0"/>
                <c:spPr>
                    <a:solidFill>
                        <a:srgbClr val="FFFFFF"/>
                    </a:solidFill>
                </c:spPr>
                <c:txPr>
                    <a:bodyPr rot="0"/>
                    <a:p>
                        <a:pPr>
                            <a:defRPr sz="900"/>
                        </a:pPr>
                    </a:p>
                </c:txPr>
            </c:trendlineLbl>
        </c:trendline>"#;

    let trendline = parse_trendline(xml);
    assert_eq!(trendline.trendline_type, TrendlineType::Linear);
    assert_eq!(trendline.disp_eq, Some(true));
    assert!(trendline.trendline_lbl.is_some());
    let label = trendline.trendline_lbl.unwrap();
    assert!(label.layout.is_some());
    let layout = label.layout.unwrap();
    assert_eq!(layout.x, Some(0.1));
    assert_eq!(layout.y, Some(0.2));
    assert!(label.num_fmt.is_some());
    let num_fmt = label.num_fmt.unwrap();
    assert_eq!(num_fmt.format_code, "0.00");
    assert_eq!(num_fmt.source_linked, Some(false));
    assert!(label.sp_pr.is_some());
    assert!(label.tx_pr.is_some());
}
