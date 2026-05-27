use super::*;

// ---- 4a: FieldId ----

#[test]
fn field_id_from_string() {
    let id = FieldId::from("sales".to_string());
    assert_eq!(&*id, "sales");
    assert_eq!(id.to_string(), "sales");
}

#[test]
fn field_id_from_str() {
    let id = FieldId::from("region");
    assert_eq!(&*id, "region");
}

#[test]
fn field_id_serde_transparent() {
    let id = FieldId::from("test_field");
    let json = serde_json::to_string(&id).unwrap();
    assert_eq!(json, r#""test_field""#);
    let deserialized: FieldId = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, id);
}

#[test]
fn field_id_equality_and_hash() {
    use std::collections::HashSet;
    let id1 = FieldId::from("sales");
    let id2 = FieldId::from("sales");
    let id3 = FieldId::from("region");
    assert_eq!(id1, id2);
    assert_ne!(id1, id3);
    let mut set = HashSet::new();
    set.insert(id1.clone());
    assert!(set.contains(&id2));
    assert!(!set.contains(&id3));
}

// ---- 4f: SortDirection ----

#[test]
fn sort_direction_serde() {
    let asc = SortDirection::Asc;
    let desc = SortDirection::Desc;
    assert_eq!(serde_json::to_string(&asc).unwrap(), r#""asc""#);
    assert_eq!(serde_json::to_string(&desc).unwrap(), r#""desc""#);
    assert_eq!(
        serde_json::from_str::<SortDirection>(r#""asc""#).unwrap(),
        SortDirection::Asc
    );
    assert_eq!(
        serde_json::from_str::<SortDirection>(r#""desc""#).unwrap(),
        SortDirection::Desc
    );
}

#[test]
fn sort_direction_default_is_asc() {
    assert_eq!(SortDirection::default(), SortDirection::Asc);
}

// ---- 4g: AggregateFunction variant naming with serde rename ----

#[test]
fn aggregate_function_serde_names() {
    // Verify the serde rename aliases work correctly
    assert_eq!(
        serde_json::to_string(&AggregateFunction::CountA).unwrap(),
        r#""counta""#
    );
    assert_eq!(
        serde_json::to_string(&AggregateFunction::CountUnique).unwrap(),
        r#""countunique""#
    );
    assert_eq!(
        serde_json::to_string(&AggregateFunction::StdDev).unwrap(),
        r#""stdev""#
    );
    assert_eq!(
        serde_json::to_string(&AggregateFunction::StdDevP).unwrap(),
        r#""stdevp""#
    );
    assert_eq!(
        serde_json::to_string(&AggregateFunction::VarP).unwrap(),
        r#""varp""#
    );

    // Verify deserialization from the lowercase names
    assert_eq!(
        serde_json::from_str::<AggregateFunction>(r#""counta""#).unwrap(),
        AggregateFunction::CountA
    );
    assert_eq!(
        serde_json::from_str::<AggregateFunction>(r#""countunique""#).unwrap(),
        AggregateFunction::CountUnique
    );
    assert_eq!(
        serde_json::from_str::<AggregateFunction>(r#""stdev""#).unwrap(),
        AggregateFunction::StdDev
    );
    assert_eq!(
        serde_json::from_str::<AggregateFunction>(r#""stdevp""#).unwrap(),
        AggregateFunction::StdDevP
    );
    assert_eq!(
        serde_json::from_str::<AggregateFunction>(r#""varp""#).unwrap(),
        AggregateFunction::VarP
    );
}

// ---- 4g: NumberGrouping::validate() ----

#[test]
fn number_grouping_validate_valid() {
    let ng = NumberGrouping::new(0.0, 100.0, 10.0);
    assert!(ng.validate().is_ok());
}

#[test]
fn number_grouping_validate_zero_interval() {
    let ng = NumberGrouping::new(0.0, 100.0, 0.0);
    assert!(ng.validate().is_err());
    assert!(ng.validate().unwrap_err().contains("positive"));
}

#[test]
fn number_grouping_validate_negative_interval() {
    let ng = NumberGrouping::new(0.0, 100.0, -5.0);
    assert!(ng.validate().is_err());
}

#[test]
fn number_grouping_validate_end_less_than_start() {
    let ng = NumberGrouping::new(100.0, 0.0, 10.0);
    assert!(ng.validate().is_err());
    assert!(ng.validate().unwrap_err().contains("greater than start"));
}

#[test]
fn number_grouping_validate_end_equals_start() {
    let ng = NumberGrouping::new(50.0, 50.0, 10.0);
    assert!(ng.validate().is_err());
}

#[test]
fn number_grouping_validate_nan_start() {
    let ng = NumberGrouping::new(f64::NAN, 100.0, 10.0);
    assert!(ng.validate().is_err());
    assert!(ng.validate().unwrap_err().contains("finite"));
}

#[test]
fn number_grouping_validate_infinity_end() {
    let ng = NumberGrouping::new(0.0, f64::INFINITY, 10.0);
    assert!(ng.validate().is_err());
}

#[test]
fn number_grouping_validate_nan_interval() {
    let ng = NumberGrouping::new(0.0, 100.0, f64::NAN);
    assert!(ng.validate().is_err());
}

// ---- 4g: PivotExpansionState with HashSet ----

#[test]
fn expansion_state_serialize_as_arrays() {
    let mut state = PivotExpansionState::default();
    state.expanded_rows.insert("East".to_string());
    state.expanded_rows.insert("West".to_string());
    let json = serde_json::to_string(&state).unwrap();
    // Should serialize as arrays, not objects
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(v["expandedRows"].is_array());
    assert!(v["expandedColumns"].is_array());
}

#[test]
fn expansion_state_deserialize_from_hashset_array() {
    let json = r#"{"expandedRows": ["East", "West"], "expandedColumns": []}"#;
    let state: PivotExpansionState = serde_json::from_str(json).unwrap();
    assert!(state.expanded_rows.contains("East"));
    assert!(state.expanded_rows.contains("West"));
    assert_eq!(state.expanded_rows.len(), 2);
    assert!(state.expanded_columns.is_empty());
}

#[test]
fn expansion_state_deserialize_from_legacy_hashmap() {
    let json =
        r#"{"expandedRows": {"East": true, "West": true, "North": false}, "expandedColumns": {}}"#;
    let state: PivotExpansionState = serde_json::from_str(json).unwrap();
    assert!(state.expanded_rows.contains("East"));
    assert!(state.expanded_rows.contains("West"));
    // "North" has value false, so it should NOT be in the set
    assert!(!state.expanded_rows.contains("North"));
    assert_eq!(state.expanded_rows.len(), 2);
}

#[test]
fn expansion_state_deserialize_empty() {
    let json = r#"{}"#;
    let state: PivotExpansionState = serde_json::from_str(json).unwrap();
    assert!(state.expanded_rows.is_empty());
    assert!(state.expanded_columns.is_empty());
}

// ---- 4g: PivotTopBottomFilter.n with alias "count" ----

#[test]
fn top_bottom_filter_n_field() {
    let json = r#"{"type":"top","n":5,"by":"items"}"#;
    let filter: PivotTopBottomFilter = serde_json::from_str(json).unwrap();
    assert_eq!(filter.n, 5.0);
    assert_eq!(filter.filter_type, TopBottomType::Top);
}

#[test]
fn top_bottom_filter_count_alias() {
    // Legacy format uses "count" instead of "n"
    let json = r#"{"type":"top","count":10,"by":"percent"}"#;
    let filter: PivotTopBottomFilter = serde_json::from_str(json).unwrap();
    assert_eq!(filter.n, 10.0);
    assert_eq!(filter.by, TopBottomBy::Percent);
}

#[test]
fn top_bottom_filter_fractional_percent() {
    let json = r#"{"type":"top","n":33.33,"by":"percent"}"#;
    let filter: PivotTopBottomFilter = serde_json::from_str(json).unwrap();
    assert!((filter.n - 33.33).abs() < f64::EPSILON);
    assert_eq!(filter.by, TopBottomBy::Percent);
}

// ---- 4g: SortByValueConfig with column_key ----

#[test]
fn sort_by_value_config_with_column_key() {
    let config = SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: Some("Q2".to_string()),
    };
    let json = serde_json::to_string(&config).unwrap();
    assert!(json.contains(r#""columnKey":"Q2""#));
    let deserialized: SortByValueConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, config);
}

#[test]
fn sort_by_value_config_without_column_key() {
    let json = r#"{"valueFieldId":"sales","order":"asc"}"#;
    let config: SortByValueConfig = serde_json::from_str(json).unwrap();
    assert_eq!(config.value_field_id, FieldId::from("sales"));
    assert_eq!(config.order, SortDirection::Asc);
    assert!(config.column_key.is_none());
}

// ---- 4g: PivotField.source_column is u32 ----

#[test]
fn pivot_field_source_column_u32() {
    let field = PivotField {
        id: FieldId::from("sales"),
        name: "Sales".to_string(),
        source_column: 5,
        data_type: DetectedDataType::Number,
        ..Default::default()
    };
    let json = serde_json::to_string(&field).unwrap();
    let deserialized: PivotField = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.source_column, 5u32);
}

// ---- RelativePosition serde ----

#[test]
fn relative_position_serde() {
    assert_eq!(
        serde_json::to_string(&RelativePosition::Previous).unwrap(),
        r#""previous""#
    );
    assert_eq!(
        serde_json::to_string(&RelativePosition::Next).unwrap(),
        r#""next""#
    );
    assert_eq!(
        serde_json::from_str::<RelativePosition>(r#""previous""#).unwrap(),
        RelativePosition::Previous
    );
    assert_eq!(
        serde_json::from_str::<RelativePosition>(r#""next""#).unwrap(),
        RelativePosition::Next
    );
}

// ============================================================
// Additional coverage tests
// ============================================================

// ---- FieldId: new(), Deref, Display, AsRef<str> ----

#[test]
fn field_id_new() {
    let id = FieldId::new("revenue");
    assert_eq!(id.as_str(), "revenue");
}

#[test]
fn field_id_new_from_string() {
    let id = FieldId::new(String::from("cost"));
    assert_eq!(id.as_str(), "cost");
}

#[test]
fn field_id_deref_str_methods() {
    let id = FieldId::new("Hello World");
    // Deref to str lets us call str methods directly
    assert!(id.starts_with("Hello"));
    assert!(id.contains("World"));
    assert_eq!(id.len(), 11);
    assert!(!id.is_empty());
}

#[test]
fn field_id_display() {
    let id = FieldId::new("my_field");
    let displayed = format!("{}", id);
    assert_eq!(displayed, "my_field");
}

#[test]
fn field_id_as_ref_str() {
    let id = FieldId::new("test_ref");
    let s: &str = id.as_ref();
    assert_eq!(s, "test_ref");
}
