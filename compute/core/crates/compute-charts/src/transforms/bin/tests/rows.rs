use serde_json::{Value, json};

use crate::transforms::bin::{apply_bin, apply_bin_spec};
use crate::types::{BinSpec, DataRow};

use super::helpers::make_row;

#[test]
fn apply_bin_empty() {
    let result = apply_bin(&[], "x", "bin_x", None, None, None);
    assert!(result.is_empty());
}

#[test]
fn apply_bin_no_numeric_values() {
    let mut row = DataRow::new();
    row.insert("x".to_string(), json!("text"));
    let result = apply_bin(&[row], "x", "bin_x", None, None, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].get("bin_x"), Some(&Value::Null));
    assert_eq!(result[0].get("bin_x_end"), Some(&Value::Null));
}

#[test]
fn apply_bin_basic() {
    let data: Vec<DataRow> = vec![
        make_row("v", 1.5),
        make_row("v", 3.7),
        make_row("v", 7.2),
        make_row("v", 9.9),
    ];

    let result = apply_bin(&data, "v", "bin_v", Some(5), None, Some(true));
    assert_eq!(result.len(), 4);

    for row in &result {
        assert!(row.contains_key("bin_v"));
        assert!(row.contains_key("bin_v_end"));
        let start = row.get("bin_v").and_then(|v| v.as_f64()).unwrap();
        let end = row.get("bin_v_end").and_then(|v| v.as_f64()).unwrap();
        assert!(end > start, "bin_end ({}) should be > bin ({})", end, start);
    }
}

#[test]
fn apply_bin_preserves_original_data() {
    let mut row = DataRow::new();
    row.insert("v".to_string(), json!(5.0));
    row.insert("name".to_string(), json!("test"));

    let result = apply_bin(&[row], "v", "bin_v", None, None, None);
    assert_eq!(result[0].get("name"), Some(&json!("test")));
    assert_eq!(result[0].get("v"), Some(&json!(5.0)));
}

#[test]
fn apply_bin_single_value() {
    let data = vec![make_row("v", 5.0)];
    let result = apply_bin(&data, "v", "bin_v", None, None, None);
    assert_eq!(result.len(), 1);
    let start = result[0].get("bin_v").and_then(|v| v.as_f64()).unwrap();
    let end = result[0].get("bin_v_end").and_then(|v| v.as_f64()).unwrap();
    assert!(start <= 5.0);
    assert!(end >= 5.0);
}

#[test]
fn apply_bin_explicit_step() {
    let data: Vec<DataRow> = (0..10).map(|i| make_row("v", i as f64)).collect();
    let result = apply_bin(&data, "v", "bin_v", None, Some(2.0), Some(true));

    for row in &result {
        let start = row.get("bin_v").and_then(|v| v.as_f64()).unwrap();
        let end = row.get("bin_v_end").and_then(|v| v.as_f64()).unwrap();
        assert_approx!(end - start, 2.0);
    }
}

#[test]
fn apply_bin_mixed_types() {
    let mut data = vec![make_row("v", 1.0), make_row("v", 5.0)];
    let mut text_row = DataRow::new();
    text_row.insert("v".to_string(), json!("not a number"));
    data.push(text_row);

    let result = apply_bin(&data, "v", "bin_v", None, None, None);
    assert_eq!(result.len(), 3);
    assert!(result[0].get("bin_v").unwrap().is_number());
    assert!(result[1].get("bin_v").unwrap().is_number());
    assert_eq!(result[2].get("bin_v"), Some(&Value::Null));
    assert_eq!(result[2].get("bin_v_end"), Some(&Value::Null));
}

#[test]
fn apply_bin_null_values() {
    let mut data = vec![make_row("v", 3.0)];
    let mut null_row = DataRow::new();
    null_row.insert("v".to_string(), Value::Null);
    data.push(null_row);

    let result = apply_bin(&data, "v", "bin_v", None, None, None);
    assert_eq!(result.len(), 2);
    assert!(result[0].get("bin_v").unwrap().is_number());
    assert_eq!(result[1].get("bin_v"), Some(&Value::Null));
}

#[test]
fn apply_bin_spec_basic() {
    let data: Vec<DataRow> = (0..20).map(|i| make_row("x", i as f64)).collect();
    let spec = BinSpec {
        field: "x".to_string(),
        as_field: "bin_x".to_string(),
        maxbins: Some(5),
        step: None,
        nice: Some(true),
    };

    let result = apply_bin_spec(&data, &spec);
    assert_eq!(result.len(), 20);

    for row in &result {
        assert!(row.contains_key("bin_x"));
        assert!(row.contains_key("bin_x_end"));
        let b0 = row.get("bin_x").and_then(|v| v.as_f64()).unwrap();
        let b1 = row.get("bin_x_end").and_then(|v| v.as_f64()).unwrap();
        assert!(b1 > b0);
    }
}

#[test]
fn apply_bin_spec_with_step() {
    let data: Vec<DataRow> = vec![make_row("x", 0.0), make_row("x", 5.0), make_row("x", 10.0)];
    let spec = BinSpec {
        field: "x".to_string(),
        as_field: "bin".to_string(),
        maxbins: None,
        step: Some(5.0),
        nice: Some(true),
    };

    let result = apply_bin_spec(&data, &spec);
    for row in &result {
        let b0 = row.get("bin").and_then(|v| v.as_f64()).unwrap();
        let b1 = row.get("bin_end").and_then(|v| v.as_f64()).unwrap();
        assert_approx!(b1 - b0, 5.0);
    }
}
