//! Grouping utilities for chart data.
//!
//! Provides group-by operations on DataRow collections,
//! preserving insertion (first-seen) order.

use std::collections::{HashMap, HashSet};

use crate::types::DataRow;
use crate::utils::value_to_string;

fn field_to_string(row: &DataRow, field: &str) -> String {
    match row.get(field) {
        Some(v) => value_to_string(v),
        None => "undefined".to_string(),
    }
}

/// Group data rows by a single field value, preserving first-seen order.
pub fn group_by<'a>(data: &'a [DataRow], field: &str) -> Vec<(String, Vec<&'a DataRow>)> {
    let mut groups: Vec<(String, Vec<&'a DataRow>)> = Vec::new();
    let mut key_index: HashMap<String, usize> = HashMap::new();

    for row in data {
        let key = field_to_string(row, field);
        if let Some(&idx) = key_index.get(&key) {
            groups[idx].1.push(row);
        } else {
            let idx = groups.len();
            key_index.insert(key.clone(), idx);
            groups.push((key, vec![row]));
        }
    }

    groups
}

/// Group data rows by multiple fields (composite key via JSON stringification).
pub fn group_by_fields<'a>(
    data: &'a [DataRow],
    fields: &[&str],
) -> Vec<(String, Vec<&'a DataRow>)> {
    let mut groups: Vec<(String, Vec<&'a DataRow>)> = Vec::new();
    let mut key_index: HashMap<String, usize> = HashMap::new();

    for row in data {
        let parts: Vec<serde_json::Value> = fields
            .iter()
            .map(|f| row.get(*f).cloned().unwrap_or(serde_json::Value::Null))
            .collect();
        let key = serde_json::to_string(&parts).unwrap_or_default();
        if let Some(&idx) = key_index.get(&key) {
            groups[idx].1.push(row);
        } else {
            let idx = groups.len();
            key_index.insert(key.clone(), idx);
            groups.push((key, vec![row]));
        }
    }

    groups
}

/// Get unique values of a field in first-seen order.
pub fn unique_values(data: &[DataRow], field: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();

    for row in data {
        let value = field_to_string(row, field);
        if seen.insert(value.clone()) {
            result.push(value);
        }
    }

    result
}

/// Count occurrences per category in first-seen order.
pub fn count_by_field(data: &[DataRow], field: &str) -> Vec<(String, usize)> {
    let mut counts: Vec<(String, usize)> = Vec::new();
    let mut key_index: HashMap<String, usize> = HashMap::new();

    for row in data {
        let key = field_to_string(row, field);
        if let Some(&idx) = key_index.get(&key) {
            counts[idx].1 += 1;
        } else {
            let idx = counts.len();
            key_index.insert(key.clone(), idx);
            counts.push((key, 1));
        }
    }

    counts
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_row(pairs: &[(&str, serde_json::Value)]) -> DataRow {
        let mut map = serde_json::Map::new();
        for (k, v) in pairs {
            map.insert(k.to_string(), v.clone());
        }
        map
    }

    #[test]
    fn group_by_groups_correctly_preserves_order() {
        let data = vec![
            make_row(&[("color", json!("red")), ("val", json!(1))]),
            make_row(&[("color", json!("blue")), ("val", json!(2))]),
            make_row(&[("color", json!("red")), ("val", json!(3))]),
            make_row(&[("color", json!("blue")), ("val", json!(4))]),
            make_row(&[("color", json!("green")), ("val", json!(5))]),
        ];

        let groups = group_by(&data, "color");

        assert_eq!(groups.len(), 3);
        assert_eq!(groups[0].0, "red");
        assert_eq!(groups[0].1.len(), 2);
        assert_eq!(groups[1].0, "blue");
        assert_eq!(groups[1].1.len(), 2);
        assert_eq!(groups[2].0, "green");
        assert_eq!(groups[2].1.len(), 1);
        assert_eq!(groups[0].1[0].get("val").unwrap(), &json!(1));
        assert_eq!(groups[0].1[1].get("val").unwrap(), &json!(3));
    }

    #[test]
    fn group_by_all_same_key_one_group() {
        let data = vec![
            make_row(&[("x", json!("A"))]),
            make_row(&[("x", json!("A"))]),
            make_row(&[("x", json!("A"))]),
        ];

        let groups = group_by(&data, "x");
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].0, "A");
        assert_eq!(groups[0].1.len(), 3);
    }

    #[test]
    fn group_by_empty_data() {
        let data: Vec<DataRow> = vec![];
        let groups = group_by(&data, "x");
        assert!(groups.is_empty());
    }

    #[test]
    fn group_by_missing_field() {
        let data = vec![make_row(&[("x", json!(1))]), make_row(&[("y", json!(2))])];

        let groups = group_by(&data, "x");
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].0, "1");
        assert_eq!(groups[1].0, "undefined");
    }

    #[test]
    fn group_by_fields_composite_keys() {
        let data = vec![
            make_row(&[("a", json!("X")), ("b", json!(1))]),
            make_row(&[("a", json!("X")), ("b", json!(2))]),
            make_row(&[("a", json!("X")), ("b", json!(1))]),
            make_row(&[("a", json!("Y")), ("b", json!(1))]),
        ];

        let groups = group_by_fields(&data, &["a", "b"]);

        assert_eq!(groups.len(), 3);
        assert_eq!(groups[0].0, r#"["X",1]"#);
        assert_eq!(groups[0].1.len(), 2);
        assert_eq!(groups[1].0, r#"["X",2]"#);
        assert_eq!(groups[1].1.len(), 1);
        assert_eq!(groups[2].0, r#"["Y",1]"#);
        assert_eq!(groups[2].1.len(), 1);
    }

    #[test]
    fn group_by_fields_empty_data() {
        let data: Vec<DataRow> = vec![];
        let groups = group_by_fields(&data, &["a", "b"]);
        assert!(groups.is_empty());
    }

    #[test]
    fn unique_values_first_seen_order_no_duplicates() {
        let data = vec![
            make_row(&[("fruit", json!("apple"))]),
            make_row(&[("fruit", json!("banana"))]),
            make_row(&[("fruit", json!("apple"))]),
            make_row(&[("fruit", json!("cherry"))]),
            make_row(&[("fruit", json!("banana"))]),
        ];

        let unique = unique_values(&data, "fruit");
        assert_eq!(unique, vec!["apple", "banana", "cherry"]);
    }

    #[test]
    fn unique_values_empty_data() {
        let data: Vec<DataRow> = vec![];
        let unique = unique_values(&data, "x");
        assert!(unique.is_empty());
    }

    #[test]
    fn unique_values_mixed_types() {
        let data = vec![
            make_row(&[("x", json!(1))]),
            make_row(&[("x", json!("1"))]),
            make_row(&[("x", json!(true))]),
            make_row(&[("x", json!(null))]),
        ];

        let unique = unique_values(&data, "x");
        assert_eq!(unique.len(), 3);
        assert_eq!(unique[0], "1");
        assert_eq!(unique[1], "true");
        assert_eq!(unique[2], "null");
    }

    #[test]
    fn count_by_field_correct_counts() {
        let data = vec![
            make_row(&[("status", json!("open"))]),
            make_row(&[("status", json!("closed"))]),
            make_row(&[("status", json!("open"))]),
            make_row(&[("status", json!("open"))]),
            make_row(&[("status", json!("closed"))]),
        ];

        let counts = count_by_field(&data, "status");
        assert_eq!(counts.len(), 2);
        assert_eq!(counts[0], ("open".to_string(), 3));
        assert_eq!(counts[1], ("closed".to_string(), 2));
    }

    #[test]
    fn count_by_field_empty_data() {
        let data: Vec<DataRow> = vec![];
        let counts = count_by_field(&data, "x");
        assert!(counts.is_empty());
    }

    #[test]
    fn count_by_field_single_unique_value() {
        let data = vec![
            make_row(&[("x", json!("a"))]),
            make_row(&[("x", json!("a"))]),
            make_row(&[("x", json!("a"))]),
        ];

        let counts = count_by_field(&data, "x");
        assert_eq!(counts.len(), 1);
        assert_eq!(counts[0], ("a".to_string(), 3));
    }
}
