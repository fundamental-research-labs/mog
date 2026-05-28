use crate::charts::*;

#[test]
fn num_ref_default() {
    let nr = NumRef::default();
    assert!(nr.f.is_empty());
    assert!(nr.num_cache.is_none());
}
#[test]
fn str_ref_default() {
    let sr = StrRef::default();
    assert!(sr.f.is_empty());
    assert!(sr.str_cache.is_none());
}
#[test]
fn cat_data_source_serde_roundtrip() {
    let src = CatDataSource::StrRef(StrRef {
        f: "Sheet1!$A$1:$A$5".to_string(),
        str_cache: None,
        extensions: vec![],
    });
    let json = serde_json::to_string(&src).unwrap();
    let back: CatDataSource = serde_json::from_str(&json).unwrap();
    assert_eq!(src, back);
}
#[test]
fn series_text_source_serde_roundtrip() {
    let src = SeriesTextSource::Value("Revenue".to_string());
    let json = serde_json::to_string(&src).unwrap();
    let back: SeriesTextSource = serde_json::from_str(&json).unwrap();
    assert_eq!(src, back);
}

// --------------------------------------------------
// Series type
// --------------------------------------------------
#[test]
fn multi_lvl_str_data_preserves_pt_count_and_levels() {
    let data = MultiLvlStrData {
        pt_count: Some(5),
        levels: vec![
            StrData {
                pt_count: Some(5),
                pts: vec![StrPoint {
                    idx: 0,
                    v: "A".to_string(),
                }],
                extensions: vec![],
            },
            StrData {
                pt_count: Some(5),
                pts: vec![StrPoint {
                    idx: 0,
                    v: "B".to_string(),
                }],
                extensions: vec![],
            },
        ],
        extensions: vec![],
    };
    assert_eq!(data.pt_count, Some(5));
    assert_eq!(data.effective_pt_count(), 5);
    assert_eq!(data.levels.len(), 2);
    assert_eq!(data.levels[0].pts[0].v, "A");
    assert_eq!(data.levels[1].pts[0].v, "B");
}
#[test]
fn multi_lvl_str_ref_uses_data_wrapper() {
    let mlsr = MultiLvlStrRef {
        f: "Sheet1!$A$1:$B$5".to_string(),
        multi_lvl_str_cache: Some(MultiLvlStrData {
            pt_count: Some(5),
            levels: vec![],
            extensions: vec![],
        }),
        extensions: vec![],
    };
    assert_eq!(mlsr.multi_lvl_str_cache.as_ref().unwrap().pt_count, Some(5));
}

// --------------------------------------------------
// ChartSeries.shape
// --------------------------------------------------
