//! Fold transform — pivots wide data to long (unpivot).
//!
//! For each row, for each fold field, creates a new row with non-fold
//! fields copied plus a key column (field name) and value column (field value).

use serde_json::Value;

use crate::types::DataRow;

// =============================================================================
// Public API
// =============================================================================

/// Apply a fold (wide-to-long) transform.
///
/// For each input row, one output row is created per fold field.
/// Non-fold fields are copied as-is. The `as_fields` tuple specifies
/// `(key_field_name, value_field_name)`.
///
/// If a fold field is missing from a row, it produces a row with `Null` value.
pub fn apply_fold(
    data: &[DataRow],
    fields: &[String],
    as_fields: &(String, String),
) -> Vec<DataRow> {
    if fields.is_empty() || data.is_empty() {
        return data.to_vec();
    }

    let (key_name, value_name) = as_fields;

    // Collect fold field names as a set for quick lookup.
    let fold_set: std::collections::HashSet<&str> = fields.iter().map(|s| s.as_str()).collect();

    let mut result = Vec::with_capacity(data.len() * fields.len());

    for row in data {
        for field in fields {
            let mut new_row = DataRow::new();

            // Copy non-fold fields.
            for (k, v) in row.iter() {
                if !fold_set.contains(k.as_str()) {
                    new_row.insert(k.clone(), v.clone());
                }
            }

            // Add key and value.
            new_row.insert(key_name.clone(), Value::String(field.clone()));
            new_row.insert(
                value_name.clone(),
                row.get(field).cloned().unwrap_or(Value::Null),
            );

            result.push(new_row);
        }
    }

    result
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

    // ---- Empty data ----

    #[test]
    fn fold_empty_data() {
        let as_fields = ("key".to_string(), "value".to_string());
        let result = apply_fold(&[], &["a".to_string()], &as_fields);
        assert!(result.is_empty());
    }

    // ---- Empty fold fields ----

    #[test]
    fn fold_no_fields() {
        let data = vec![make_row(&[("x", json!(1))])];
        let as_fields = ("key".to_string(), "value".to_string());
        let result = apply_fold(&data, &[], &as_fields);
        // Should return data unchanged.
        assert_eq!(result.len(), 1);
    }

    // ---- Basic fold ----

    #[test]
    fn fold_basic() {
        let data = vec![
            make_row(&[("name", json!("A")), ("x", json!(10)), ("y", json!(20))]),
            make_row(&[("name", json!("B")), ("x", json!(30)), ("y", json!(40))]),
        ];
        let as_fields = ("variable".to_string(), "measurement".to_string());
        let result = apply_fold(&data, &["x".to_string(), "y".to_string()], &as_fields);

        // 2 rows x 2 fold fields = 4 output rows.
        assert_eq!(result.len(), 4);

        // Check first output row: name=A, variable=x, measurement=10
        assert_eq!(result[0].get("name"), Some(&json!("A")));
        assert_eq!(result[0].get("variable"), Some(&json!("x")));
        assert_eq!(result[0].get("measurement"), Some(&json!(10)));

        // Fold fields should NOT appear as separate columns.
        assert!(!result[0].contains_key("x"));
        assert!(!result[0].contains_key("y"));

        // Check second output row: name=A, variable=y, measurement=20
        assert_eq!(result[1].get("variable"), Some(&json!("y")));
        assert_eq!(result[1].get("measurement"), Some(&json!(20)));

        // Third: name=B, variable=x, measurement=30
        assert_eq!(result[2].get("name"), Some(&json!("B")));
        assert_eq!(result[2].get("variable"), Some(&json!("x")));
        assert_eq!(result[2].get("measurement"), Some(&json!(30)));
    }

    // ---- Missing fold field ----

    #[test]
    fn fold_missing_field() {
        let data = vec![make_row(&[("name", json!("A")), ("x", json!(10))])];
        let as_fields = ("key".to_string(), "value".to_string());
        let result = apply_fold(&data, &["x".to_string(), "y".to_string()], &as_fields);

        assert_eq!(result.len(), 2);
        // First row: key=x, value=10
        assert_eq!(result[0].get("value"), Some(&json!(10)));
        // Second row: key=y, value=null (missing)
        assert_eq!(result[1].get("value"), Some(&Value::Null));
    }

    // ---- Single fold field ----

    #[test]
    fn fold_single_field() {
        let data = vec![
            make_row(&[("id", json!(1)), ("val", json!(100))]),
            make_row(&[("id", json!(2)), ("val", json!(200))]),
        ];
        let as_fields = ("key".to_string(), "value".to_string());
        let result = apply_fold(&data, &["val".to_string()], &as_fields);

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].get("key"), Some(&json!("val")));
        assert_eq!(result[0].get("value"), Some(&json!(100)));
        assert_eq!(result[0].get("id"), Some(&json!(1)));
    }

    // ---- Non-fold fields preserved ----

    #[test]
    fn fold_preserves_extra_fields() {
        let data = vec![make_row(&[
            ("name", json!("X")),
            ("group", json!("G1")),
            ("a", json!(1)),
            ("b", json!(2)),
        ])];
        let as_fields = ("k".to_string(), "v".to_string());
        let result = apply_fold(&data, &["a".to_string(), "b".to_string()], &as_fields);

        assert_eq!(result.len(), 2);
        // Both rows should preserve name and group.
        for row in &result {
            assert_eq!(row.get("name"), Some(&json!("X")));
            assert_eq!(row.get("group"), Some(&json!("G1")));
        }
    }
}
