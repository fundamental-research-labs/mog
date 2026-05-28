use crate::charts::*;

#[test]
fn chart_text_rich_variant() {
    use crate::drawings::TextBody;
    let ct = ChartText::Rich(TextBody::default());
    match &ct {
        ChartText::Rich(_tb) => {} // ok
        ChartText::StrRef(_) => panic!("expected Rich variant"),
    }
}
#[test]
fn chart_text_str_ref_variant() {
    let ct = ChartText::StrRef(StrRef {
        f: "Sheet1!$A$1".to_string(),
        str_cache: None,
        extensions: vec![],
    });
    match &ct {
        ChartText::StrRef(sr) => assert_eq!(sr.f, "Sheet1!$A$1"),
        ChartText::Rich(_) => panic!("expected StrRef variant"),
    }
}
#[test]
fn chart_text_serde_roundtrip() {
    let ct = ChartText::StrRef(StrRef {
        f: "Sheet1!$A$1".to_string(),
        str_cache: None,
        extensions: vec![],
    });
    let json = serde_json::to_string(&ct).unwrap();
    let back: ChartText = serde_json::from_str(&json).unwrap();
    assert_eq!(ct, back);
}
#[test]
fn title_text_is_chart_text_alias() {
    // TitleText is a type alias for ChartText
    let tt: TitleText = ChartText::StrRef(StrRef::default());
    let _ct: ChartText = tt; // should compile since they're the same type
}
#[test]
fn trendline_label_with_chart_text() {
    let label = TrendlineLabel {
        tx: Some(ChartText::StrRef(StrRef {
            f: "Sheet1!$B$1".to_string(),
            str_cache: None,
            extensions: vec![],
        })),
        ..Default::default()
    };
    assert!(label.tx.is_some());
}

// --------------------------------------------------
// MultiLvlStrData
// --------------------------------------------------
