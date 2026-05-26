//! Sort transform — multi-field sort with null handling.
//!
//! Null/missing values sort to the end regardless of sort direction.
//! Numbers compare numerically, strings lexicographically.
//! Default order is ascending.

use std::cmp::Ordering;

use serde_json::Value;

use crate::types::{ChartSortOrder, ChartSortSpec, DataRow};

// =============================================================================
// Public API
// =============================================================================

/// Apply a multi-field sort to data rows.
///
/// Returns a new sorted `Vec<DataRow>`. Null/missing values sort to the end.
pub fn apply_sort(data: &[DataRow], specs: &[ChartSortSpec]) -> Vec<DataRow> {
    if specs.is_empty() || data.is_empty() {
        return data.to_vec();
    }

    let mut result = data.to_vec();
    result.sort_by(|a, b| compare_rows(a, b, specs));
    result
}

// =============================================================================
// Comparison helpers
// =============================================================================

/// Compare two rows across all sort specs.
fn compare_rows(a: &DataRow, b: &DataRow, specs: &[ChartSortSpec]) -> Ordering {
    for spec in specs {
        let av = a.get(&spec.field);
        let bv = b.get(&spec.field);
        let ascending = !matches!(spec.order, Some(ChartSortOrder::Descending));

        let a_is_null = is_null_or_missing(av);
        let b_is_null = is_null_or_missing(bv);

        // Nulls always sort to the end, regardless of direction.
        match (a_is_null, b_is_null) {
            (true, true) => continue,
            (true, false) => return Ordering::Greater,
            (false, true) => return Ordering::Less,
            (false, false) => {}
        }

        // Both values are present and non-null — compare and apply direction.
        let ord = compare_present_values(av.unwrap(), bv.unwrap());
        let ord = if ascending { ord } else { ord.reverse() };

        if ord != Ordering::Equal {
            return ord;
        }
    }
    Ordering::Equal
}

/// Check if a value is null or missing.
fn is_null_or_missing(v: Option<&Value>) -> bool {
    matches!(v, None | Some(Value::Null))
}

/// Compare two non-null JSON values.
fn compare_present_values(a: &Value, b: &Value) -> Ordering {
    // Both numbers
    if let (Some(an), Some(bn)) = (a.as_f64(), b.as_f64()) {
        return an.partial_cmp(&bn).unwrap_or(Ordering::Equal);
    }

    // Both strings
    if let (Some(a_s), Some(b_s)) = (a.as_str(), b.as_str()) {
        return a_s.cmp(b_s);
    }

    // Both booleans
    if let (Some(ab), Some(bb)) = (a.as_bool(), b.as_bool()) {
        return ab.cmp(&bb);
    }

    // Mixed types — assign a type order: Bool=0, Number=1, String=2, Other=3
    let type_ord = |v: &Value| -> u8 {
        match v {
            Value::Bool(_) => 0,
            Value::Number(_) => 1,
            Value::String(_) => 2,
            _ => 3,
        }
    };
    type_ord(a).cmp(&type_ord(b))
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_row(pairs: &[(&str, Value)]) -> DataRow {
        let mut row = DataRow::new();
        for (k, v) in pairs {
            row.insert(k.to_string(), v.clone());
        }
        row
    }

    fn get_f64(row: &DataRow, field: &str) -> Option<f64> {
        row.get(field).and_then(|v| v.as_f64())
    }

    fn get_str<'a>(row: &'a DataRow, field: &str) -> Option<&'a str> {
        row.get(field).and_then(|v| v.as_str())
    }

    // ---- Empty data ----

    #[test]
    fn sort_empty_data() {
        let result = apply_sort(
            &[],
            &[ChartSortSpec {
                field: "x".to_string(),
                order: None,
            }],
        );
        assert!(result.is_empty());
    }

    // ---- No specs ----

    #[test]
    fn sort_no_specs() {
        let data = vec![make_row(&[("x", json!(3))]), make_row(&[("x", json!(1))])];
        let result = apply_sort(&data, &[]);
        assert_eq!(result.len(), 2);
        // Should preserve original order.
        assert_eq!(get_f64(&result[0], "x"), Some(3.0));
    }

    // ---- Ascending numeric sort ----

    #[test]
    fn sort_ascending_numeric() {
        let data = vec![
            make_row(&[("v", json!(30))]),
            make_row(&[("v", json!(10))]),
            make_row(&[("v", json!(20))]),
        ];
        let result = apply_sort(
            &data,
            &[ChartSortSpec {
                field: "v".to_string(),
                order: Some(ChartSortOrder::Ascending),
            }],
        );
        assert_eq!(get_f64(&result[0], "v"), Some(10.0));
        assert_eq!(get_f64(&result[1], "v"), Some(20.0));
        assert_eq!(get_f64(&result[2], "v"), Some(30.0));
    }

    // ---- Descending numeric sort ----

    #[test]
    fn sort_descending_numeric() {
        let data = vec![
            make_row(&[("v", json!(10))]),
            make_row(&[("v", json!(30))]),
            make_row(&[("v", json!(20))]),
        ];
        let result = apply_sort(
            &data,
            &[ChartSortSpec {
                field: "v".to_string(),
                order: Some(ChartSortOrder::Descending),
            }],
        );
        assert_eq!(get_f64(&result[0], "v"), Some(30.0));
        assert_eq!(get_f64(&result[1], "v"), Some(20.0));
        assert_eq!(get_f64(&result[2], "v"), Some(10.0));
    }

    // ---- String sort ----

    #[test]
    fn sort_strings() {
        let data = vec![
            make_row(&[("name", json!("Charlie"))]),
            make_row(&[("name", json!("Alice"))]),
            make_row(&[("name", json!("Bob"))]),
        ];
        let result = apply_sort(
            &data,
            &[ChartSortSpec {
                field: "name".to_string(),
                order: Some(ChartSortOrder::Ascending),
            }],
        );
        assert_eq!(get_str(&result[0], "name"), Some("Alice"));
        assert_eq!(get_str(&result[1], "name"), Some("Bob"));
        assert_eq!(get_str(&result[2], "name"), Some("Charlie"));
    }

    // ---- Null handling ----

    #[test]
    fn sort_nulls_to_end_ascending() {
        let data = vec![
            make_row(&[("v", json!(null))]),
            make_row(&[("v", json!(2))]),
            make_row(&[("v", json!(1))]),
        ];
        let result = apply_sort(
            &data,
            &[ChartSortSpec {
                field: "v".to_string(),
                order: Some(ChartSortOrder::Ascending),
            }],
        );
        assert_eq!(get_f64(&result[0], "v"), Some(1.0));
        assert_eq!(get_f64(&result[1], "v"), Some(2.0));
        assert!(result[2].get("v").unwrap().is_null());
    }

    #[test]
    fn sort_nulls_to_end_descending() {
        let data = vec![
            make_row(&[("v", json!(null))]),
            make_row(&[("v", json!(2))]),
            make_row(&[("v", json!(1))]),
        ];
        let result = apply_sort(
            &data,
            &[ChartSortSpec {
                field: "v".to_string(),
                order: Some(ChartSortOrder::Descending),
            }],
        );
        assert_eq!(get_f64(&result[0], "v"), Some(2.0));
        assert_eq!(get_f64(&result[1], "v"), Some(1.0));
        // Null always sorts last, regardless of direction.
        assert!(result[2].get("v").unwrap().is_null());
    }

    // ---- Missing field ----

    #[test]
    fn sort_missing_field() {
        let data = vec![
            make_row(&[("a", json!(1))]),
            make_row(&[("a", json!(2)), ("b", json!(10))]),
        ];
        let result = apply_sort(
            &data,
            &[ChartSortSpec {
                field: "b".to_string(),
                order: Some(ChartSortOrder::Ascending),
            }],
        );
        // Row with b=10 should come first, missing-b row last.
        assert_eq!(get_f64(&result[0], "b"), Some(10.0));
        assert_eq!(result[1].get("b"), None);
    }

    // ---- Multi-field sort ----

    #[test]
    fn sort_multi_field() {
        let data = vec![
            make_row(&[("group", json!("B")), ("val", json!(2))]),
            make_row(&[("group", json!("A")), ("val", json!(3))]),
            make_row(&[("group", json!("A")), ("val", json!(1))]),
            make_row(&[("group", json!("B")), ("val", json!(1))]),
        ];
        let result = apply_sort(
            &data,
            &[
                ChartSortSpec {
                    field: "group".to_string(),
                    order: Some(ChartSortOrder::Ascending),
                },
                ChartSortSpec {
                    field: "val".to_string(),
                    order: Some(ChartSortOrder::Ascending),
                },
            ],
        );
        assert_eq!(get_str(&result[0], "group"), Some("A"));
        assert_eq!(get_f64(&result[0], "val"), Some(1.0));
        assert_eq!(get_str(&result[1], "group"), Some("A"));
        assert_eq!(get_f64(&result[1], "val"), Some(3.0));
        assert_eq!(get_str(&result[2], "group"), Some("B"));
        assert_eq!(get_f64(&result[2], "val"), Some(1.0));
        assert_eq!(get_str(&result[3], "group"), Some("B"));
        assert_eq!(get_f64(&result[3], "val"), Some(2.0));
    }

    // ---- Default ascending ----

    #[test]
    fn sort_default_ascending() {
        let data = vec![
            make_row(&[("v", json!(3))]),
            make_row(&[("v", json!(1))]),
            make_row(&[("v", json!(2))]),
        ];
        let result = apply_sort(
            &data,
            &[ChartSortSpec {
                field: "v".to_string(),
                order: None,
            }],
        );
        assert_eq!(get_f64(&result[0], "v"), Some(1.0));
        assert_eq!(get_f64(&result[1], "v"), Some(2.0));
        assert_eq!(get_f64(&result[2], "v"), Some(3.0));
    }
}
