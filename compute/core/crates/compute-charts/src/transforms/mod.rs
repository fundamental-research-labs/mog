//! Transform pipeline for chart data.
//!
//! Dispatches `Transform` specs to individual transform modules
//! and chains them into a sequential pipeline.

pub mod aggregate;
pub mod bin;
pub mod calculate;
pub mod density;
pub mod filter;
pub mod fold;
pub mod regression;
pub mod sort;

use crate::types::{DataRow, Transform};

// =============================================================================
// Pipeline dispatcher
// =============================================================================

/// Apply a sequence of transforms, piping output of each into the next.
pub fn apply_transforms(data: &[DataRow], transforms: &[Transform]) -> Vec<DataRow> {
    let mut result = data.to_vec();
    for transform in transforms {
        result = apply_transform(&result, transform);
    }
    result
}

/// Apply a single transform to data rows.
pub fn apply_transform(data: &[DataRow], transform: &Transform) -> Vec<DataRow> {
    match transform {
        Transform::Filter { filter } => filter::apply_filter(data, filter),
        Transform::Aggregate { aggregate } => aggregate::apply_aggregate(data, aggregate),
        Transform::Bin { bin: spec } => bin::apply_bin(
            data,
            &spec.field,
            &spec.as_field,
            spec.maxbins,
            spec.step,
            spec.nice,
        ),
        Transform::Sort { sort } => sort::apply_sort(data, sort),
        Transform::Calculate {
            calculate,
            as_field,
        } => calculate::apply_calculate(data, calculate, as_field),
        Transform::Fold { fold, as_fields } => {
            let default = ("key".to_string(), "value".to_string());
            let as_f = as_fields.as_ref().unwrap_or(&default);
            fold::apply_fold(data, fold, as_f)
        }
        Transform::Regression {
            regression: x_field,
            on: y_field,
            method,
            order,
            as_fields,
        } => regression::apply_regression(
            data,
            x_field,
            y_field,
            *method,
            *order,
            as_fields.as_ref(),
        ),
        Transform::Density {
            density: field,
            bandwidth,
            extent,
            steps,
            as_fields,
        } => density::apply_density(data, field, *bandwidth, *extent, *steps, as_fields.as_ref()),
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;
    use serde_json::json;

    fn make_row(pairs: &[(&str, serde_json::Value)]) -> DataRow {
        let mut row = DataRow::new();
        for (k, v) in pairs {
            row.insert(k.to_string(), v.clone());
        }
        row
    }

    fn sample_data() -> Vec<DataRow> {
        vec![
            make_row(&[
                ("region", json!("East")),
                ("amount", json!(100)),
                ("score", json!(90)),
            ]),
            make_row(&[
                ("region", json!("East")),
                ("amount", json!(200)),
                ("score", json!(85)),
            ]),
            make_row(&[
                ("region", json!("West")),
                ("amount", json!(150)),
                ("score", json!(92)),
            ]),
            make_row(&[
                ("region", json!("West")),
                ("amount", json!(250)),
                ("score", json!(78)),
            ]),
            make_row(&[
                ("region", json!("West")),
                ("amount", json!(300)),
                ("score", json!(95)),
            ]),
        ]
    }

    // ---- Multi-step pipeline: filter -> aggregate -> sort ----

    #[test]
    fn pipeline_filter_aggregate_sort() {
        let data = sample_data();
        let transforms = vec![
            Transform::Filter {
                filter: FilterInput::Spec(FilterSpec {
                    field: "amount".to_string(),
                    equal: None,
                    lt: None,
                    lte: None,
                    gt: None,
                    gte: Some(150.0),
                    one_of: None,
                    range: None,
                }),
            },
            Transform::Aggregate {
                aggregate: vec![AggregateSpec {
                    groupby: vec!["region".to_string()],
                    aggregate: vec![AggregateOp {
                        op: AggregateOpKind::Sum,
                        field: Some("amount".to_string()),
                        as_field: "total".to_string(),
                    }],
                }],
            },
            Transform::Sort {
                sort: vec![ChartSortSpec {
                    field: "total".to_string(),
                    order: Some(ChartSortOrder::Descending),
                }],
            },
        ];

        let result = apply_transforms(&data, &transforms);

        // After filter (>= 150): East(200), West(150, 250, 300)
        // After aggregate: East=200, West=700
        // After sort desc: West(700), East(200)
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].get("region"), Some(&json!("West")));
        assert_eq!(result[0].get("total").and_then(|v| v.as_f64()), Some(700.0));
        assert_eq!(result[1].get("region"), Some(&json!("East")));
        assert_eq!(result[1].get("total").and_then(|v| v.as_f64()), Some(200.0));
    }

    // ---- Pipeline: calculate -> sort ----

    #[test]
    fn pipeline_calculate_sort() {
        let data = vec![
            make_row(&[("price", json!(10)), ("qty", json!(5))]),
            make_row(&[("price", json!(20)), ("qty", json!(2))]),
            make_row(&[("price", json!(5)), ("qty", json!(10))]),
        ];

        let transforms = vec![
            Transform::Calculate {
                calculate: "datum.price * datum.qty".to_string(),
                as_field: "revenue".to_string(),
            },
            Transform::Sort {
                sort: vec![ChartSortSpec {
                    field: "revenue".to_string(),
                    order: Some(ChartSortOrder::Ascending),
                }],
            },
        ];

        let result = apply_transforms(&data, &transforms);
        assert_eq!(result.len(), 3);
        // Revenues: 50, 40, 50 -> sorted: 40, 50, 50
        assert_eq!(
            result[0].get("revenue").and_then(|v| v.as_f64()),
            Some(40.0)
        );
        assert_eq!(
            result[1].get("revenue").and_then(|v| v.as_f64()),
            Some(50.0)
        );
    }

    // ---- Pipeline: fold -> filter ----

    #[test]
    fn pipeline_fold_filter() {
        let data = vec![make_row(&[
            ("name", json!("A")),
            ("x", json!(10)),
            ("y", json!(20)),
        ])];

        let transforms = vec![
            Transform::Fold {
                fold: vec!["x".to_string(), "y".to_string()],
                as_fields: Some(("key".to_string(), "value".to_string())),
            },
            Transform::Filter {
                filter: FilterInput::Spec(FilterSpec {
                    field: "key".to_string(),
                    equal: Some(json!("y")),
                    lt: None,
                    lte: None,
                    gt: None,
                    gte: None,
                    one_of: None,
                    range: None,
                }),
            },
        ];

        let result = apply_transforms(&data, &transforms);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].get("key"), Some(&json!("y")));
        assert_eq!(result[0].get("value"), Some(&json!(20)));
    }

    // ---- Empty transforms returns data unchanged ----

    #[test]
    fn pipeline_no_transforms() {
        let data = sample_data();
        let result = apply_transforms(&data, &[]);
        assert_eq!(result.len(), data.len());
    }

    // ---- JSON round-trip: deserialize transforms, apply them ----

    #[test]
    fn pipeline_json_roundtrip() {
        let data = vec![
            make_row(&[("x", json!(3)), ("v", json!(30))]),
            make_row(&[("x", json!(1)), ("v", json!(10))]),
            make_row(&[("x", json!(2)), ("v", json!(20))]),
        ];

        // Deserialize a transform from JSON.
        let json_transform = json!({
            "type": "sort",
            "sort": [{"field": "x", "order": "ascending"}]
        });
        let transform: Transform = serde_json::from_value(json_transform).unwrap();

        let result = apply_transforms(&data, &[transform]);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].get("x").and_then(|v| v.as_f64()), Some(1.0));
        assert_eq!(result[1].get("x").and_then(|v| v.as_f64()), Some(2.0));
        assert_eq!(result[2].get("x").and_then(|v| v.as_f64()), Some(3.0));
    }

    #[test]
    fn pipeline_json_roundtrip_filter() {
        let data = vec![
            make_row(&[("x", json!(1))]),
            make_row(&[("x", json!(5))]),
            make_row(&[("x", json!(10))]),
        ];

        let json_transforms = json!([
            {
                "type": "filter",
                "filter": {"field": "x", "gt": 3}
            }
        ]);
        let transforms: Vec<Transform> = serde_json::from_value(json_transforms).unwrap();

        let result = apply_transforms(&data, &transforms);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn pipeline_json_roundtrip_aggregate() {
        let data = vec![
            make_row(&[("g", json!("A")), ("v", json!(10))]),
            make_row(&[("g", json!("A")), ("v", json!(20))]),
            make_row(&[("g", json!("B")), ("v", json!(30))]),
        ];

        let json_transforms = json!([
            {
                "type": "aggregate",
                "aggregate": [{
                    "groupby": ["g"],
                    "aggregate": [
                        {"op": "sum", "field": "v", "as": "total"},
                        {"op": "count", "as": "n"}
                    ]
                }]
            }
        ]);
        let transforms: Vec<Transform> = serde_json::from_value(json_transforms).unwrap();

        let result = apply_transforms(&data, &transforms);
        assert_eq!(result.len(), 2);

        let group_a = result
            .iter()
            .find(|r| r.get("g") == Some(&json!("A")))
            .unwrap();
        assert_eq!(group_a.get("total").and_then(|v| v.as_f64()), Some(30.0));
        assert_eq!(group_a.get("n").and_then(|v| v.as_f64()), Some(2.0));
    }
}
