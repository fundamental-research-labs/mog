//! Regression transform — computes trendline points from data.
//!
//! Extracts x/y field values from DataRows, delegates to
//! `crate::regression::create_regression()`, and converts
//! the output points back to DataRows.

use serde_json::Value;

use crate::regression::{self, RegressionOptions};
use crate::types::{DataRow, Point, RegressionMethod};

// =============================================================================
// Public API
// =============================================================================

/// Apply a regression transform.
///
/// Extracts numeric values from `x_field` and `y_field`, computes a regression
/// trendline, and returns DataRows with the predicted points.
///
/// The output field names default to the input field names unless `as_fields`
/// overrides them.
pub fn apply_regression(
    data: &[DataRow],
    x_field: &str,
    y_field: &str,
    method: Option<RegressionMethod>,
    order: Option<u32>,
    as_fields: Option<&(String, String)>,
) -> Vec<DataRow> {
    let method = method.unwrap_or(RegressionMethod::Linear);
    let degree = order.unwrap_or(if matches!(method, RegressionMethod::Quad) {
        2
    } else {
        3
    });

    // Extract paired (x, y) numeric values.
    let points: Vec<Point> = data
        .iter()
        .filter_map(|row| {
            let x = row.get(x_field).and_then(|v| v.as_f64())?;
            let y = row.get(y_field).and_then(|v| v.as_f64())?;
            if x.is_finite() && y.is_finite() {
                Some(Point { x, y })
            } else {
                None
            }
        })
        .collect();

    if points.is_empty() {
        return Vec::new();
    }

    let options = RegressionOptions::default();
    let output = regression::create_regression(&points, method, degree, &options);

    // Determine output field names.
    let default_as = (x_field.to_string(), y_field.to_string());
    let (out_x, out_y) = as_fields.unwrap_or(&default_as);

    // Convert regression points to DataRows.
    output
        .points
        .iter()
        .map(|pt| {
            let mut row = DataRow::new();
            row.insert(out_x.clone(), Value::from(pt.x));
            row.insert(out_y.clone(), Value::from(pt.y));
            row
        })
        .collect()
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_row(x: f64, y: f64) -> DataRow {
        let mut row = DataRow::new();
        row.insert("x".to_string(), json!(x));
        row.insert("y".to_string(), json!(y));
        row
    }

    // ---- Empty data ----

    #[test]
    fn regression_empty_data() {
        let result = apply_regression(&[], "x", "y", None, None, None);
        assert!(result.is_empty());
    }

    // ---- Linear regression ----

    #[test]
    fn regression_linear() {
        // y = 2x + 1
        let data: Vec<DataRow> = vec![
            make_row(1.0, 3.0),
            make_row(2.0, 5.0),
            make_row(3.0, 7.0),
            make_row(4.0, 9.0),
        ];
        let result = apply_regression(&data, "x", "y", Some(RegressionMethod::Linear), None, None);

        // Default options generate 50 points.
        assert_eq!(result.len(), 50);

        // Each row should have x and y.
        for row in &result {
            assert!(row.contains_key("x"));
            assert!(row.contains_key("y"));
        }

        // Points should span from min_x to max_x.
        let first_x = result[0].get("x").and_then(|v| v.as_f64()).unwrap();
        let last_x = result
            .last()
            .unwrap()
            .get("x")
            .and_then(|v| v.as_f64())
            .unwrap();
        assert!(first_x <= 1.0 + 0.01);
        assert!(last_x >= 4.0 - 0.01);
    }

    // ---- Custom as_fields ----

    #[test]
    fn regression_custom_as_fields() {
        let data: Vec<DataRow> = vec![make_row(1.0, 1.0), make_row(2.0, 4.0), make_row(3.0, 9.0)];
        let as_fields = ("pred_x".to_string(), "pred_y".to_string());
        let result = apply_regression(
            &data,
            "x",
            "y",
            Some(RegressionMethod::Quad),
            Some(2),
            Some(&as_fields),
        );

        assert!(!result.is_empty());
        assert!(result[0].contains_key("pred_x"));
        assert!(result[0].contains_key("pred_y"));
        // Should NOT have the original field names.
        assert!(!result[0].contains_key("x"));
        assert!(!result[0].contains_key("y"));
    }

    // ---- Non-numeric values filtered ----

    #[test]
    fn regression_filters_non_numeric() {
        let mut data = vec![make_row(1.0, 2.0), make_row(2.0, 4.0)];
        let mut bad_row = DataRow::new();
        bad_row.insert("x".to_string(), json!("hello"));
        bad_row.insert("y".to_string(), json!(5));
        data.push(bad_row);

        let result = apply_regression(&data, "x", "y", None, None, None);
        // Should still produce output from the 2 valid points.
        assert!(!result.is_empty());
    }

    // ---- All non-numeric ----

    #[test]
    fn regression_all_non_numeric() {
        let mut row = DataRow::new();
        row.insert("x".to_string(), json!("a"));
        row.insert("y".to_string(), json!("b"));
        let result = apply_regression(&[row], "x", "y", None, None, None);
        assert!(result.is_empty());
    }

    // ---- Exponential regression ----

    #[test]
    fn regression_exponential() {
        // y = 2 * e^(0.5x)
        let data: Vec<DataRow> = (0..=5)
            .map(|i| {
                let x = i as f64;
                let y = 2.0 * (0.5 * x).exp();
                make_row(x, y)
            })
            .collect();

        let result = apply_regression(&data, "x", "y", Some(RegressionMethod::Exp), None, None);

        assert!(!result.is_empty());
    }

    // ---- Default method is linear ----

    #[test]
    fn regression_default_method() {
        let data: Vec<DataRow> = vec![make_row(1.0, 1.0), make_row(2.0, 2.0), make_row(3.0, 3.0)];
        let result = apply_regression(&data, "x", "y", None, None, None);
        // Should produce output (default linear).
        assert!(!result.is_empty());
    }
}
