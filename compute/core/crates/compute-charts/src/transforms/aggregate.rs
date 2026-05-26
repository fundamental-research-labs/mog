//! Aggregate transform — group by fields and compute aggregate operations.
//!
//! Supports count, sum, mean, median, min, max, variance, stdev,
//! q1, q3, ci0, ci1, distinct, and values.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::statistics;
use crate::types::{AggregateOpKind, AggregateSpec, DataRow};

// =============================================================================
// Public API
// =============================================================================

/// Apply aggregate transforms sequentially.
///
/// Each `AggregateSpec` groups the current dataset by its `groupby` fields,
/// computes aggregate ops, and produces a new dataset that feeds the next spec.
pub fn apply_aggregate(data: &[DataRow], specs: &[AggregateSpec]) -> Vec<DataRow> {
    let mut result = data.to_vec();
    for spec in specs {
        result = apply_single_aggregate(&result, spec);
    }
    result
}

// =============================================================================
// Single aggregate pass
// =============================================================================

/// Apply a single aggregate specification.
fn apply_single_aggregate(data: &[DataRow], spec: &AggregateSpec) -> Vec<DataRow> {
    if data.is_empty() {
        return Vec::new();
    }

    // Group rows by serialized groupby key.
    let mut groups: BTreeMap<String, Vec<&DataRow>> = BTreeMap::new();

    for row in data {
        let key = make_group_key(row, &spec.groupby);
        groups.entry(key).or_default().push(row);
    }

    // Compute aggregates for each group.
    groups
        .values()
        .map(|group| {
            let mut out = DataRow::new();

            // Copy groupby field values from first row.
            if let Some(first) = group.first() {
                for field in &spec.groupby {
                    if let Some(val) = first.get(field) {
                        out.insert(field.clone(), val.clone());
                    }
                }
            }

            // Compute each aggregate op.
            for op in &spec.aggregate {
                let value = compute_aggregate_op(group, op.op, op.field.as_deref());
                out.insert(op.as_field.clone(), value);
            }

            out
        })
        .collect()
}

/// Build a group key by serializing the groupby field values.
fn make_group_key(row: &DataRow, groupby: &[String]) -> String {
    let parts: Vec<String> = groupby
        .iter()
        .map(|field| {
            row.get(field)
                .map(|v| v.to_string())
                .unwrap_or_else(|| "null".to_string())
        })
        .collect();
    parts.join("\x1f") // unit separator as delimiter
}

/// Extract f64 values from a field across all rows in a group.
fn extract_f64_values(group: &[&DataRow], field: &str) -> Vec<f64> {
    group
        .iter()
        .filter_map(|row| row.get(field).and_then(|v| v.as_f64()))
        .filter(|v| v.is_finite())
        .collect()
}

/// Compute a single aggregate operation.
fn compute_aggregate_op(group: &[&DataRow], op: AggregateOpKind, field: Option<&str>) -> Value {
    match op {
        AggregateOpKind::Count => Value::from(group.len() as f64),

        AggregateOpKind::Sum => {
            let values = field
                .map(|f| extract_f64_values(group, f))
                .unwrap_or_default();
            Value::from(statistics::sum(&values))
        }

        AggregateOpKind::Mean | AggregateOpKind::Average => {
            let values = field
                .map(|f| extract_f64_values(group, f))
                .unwrap_or_default();
            let m = statistics::mean(&values);
            if m.is_nan() {
                Value::Null
            } else {
                Value::from(m)
            }
        }

        AggregateOpKind::Median => {
            let values = field
                .map(|f| extract_f64_values(group, f))
                .unwrap_or_default();
            let m = statistics::median(&values);
            if m.is_nan() {
                Value::Null
            } else {
                Value::from(m)
            }
        }

        AggregateOpKind::Min => {
            let values = field
                .map(|f| extract_f64_values(group, f))
                .unwrap_or_default();
            let m = statistics::min_val(&values);
            if m.is_infinite() {
                Value::Null
            } else {
                Value::from(m)
            }
        }

        AggregateOpKind::Max => {
            let values = field
                .map(|f| extract_f64_values(group, f))
                .unwrap_or_default();
            let m = statistics::max_val(&values);
            if m.is_infinite() {
                Value::Null
            } else {
                Value::from(m)
            }
        }

        AggregateOpKind::Variance => {
            let values = field
                .map(|f| extract_f64_values(group, f))
                .unwrap_or_default();
            let v = statistics::sample_variance(&values);
            if v.is_nan() {
                Value::Null
            } else {
                Value::from(v)
            }
        }

        AggregateOpKind::Stdev => {
            let values = field
                .map(|f| extract_f64_values(group, f))
                .unwrap_or_default();
            let s = statistics::sample_std_dev(&values);
            if s.is_nan() {
                Value::Null
            } else {
                Value::from(s)
            }
        }

        AggregateOpKind::Q1 => {
            let values = field
                .map(|f| extract_f64_values(group, f))
                .unwrap_or_default();
            let q = statistics::quantile(&values, 0.25);
            if q.is_nan() {
                Value::Null
            } else {
                Value::from(q)
            }
        }

        AggregateOpKind::Q3 => {
            let values = field
                .map(|f| extract_f64_values(group, f))
                .unwrap_or_default();
            let q = statistics::quantile(&values, 0.75);
            if q.is_nan() {
                Value::Null
            } else {
                Value::from(q)
            }
        }

        AggregateOpKind::Ci0 => {
            // 95% CI lower bound: mean - z * (stdev / sqrt(n))
            let values = field
                .map(|f| extract_f64_values(group, f))
                .unwrap_or_default();
            if values.len() < 2 {
                return Value::Null;
            }
            let m = statistics::mean(&values);
            let s = statistics::sample_std_dev(&values);
            let n = values.len() as f64;
            let ci = m - 1.96 * (s / n.sqrt());
            Value::from(ci)
        }

        AggregateOpKind::Ci1 => {
            // 95% CI upper bound: mean + z * (stdev / sqrt(n))
            let values = field
                .map(|f| extract_f64_values(group, f))
                .unwrap_or_default();
            if values.len() < 2 {
                return Value::Null;
            }
            let m = statistics::mean(&values);
            let s = statistics::sample_std_dev(&values);
            let n = values.len() as f64;
            let ci = m + 1.96 * (s / n.sqrt());
            Value::from(ci)
        }

        AggregateOpKind::Distinct => {
            let field_name = match field {
                Some(f) => f,
                None => return Value::from(0.0),
            };
            let mut seen = std::collections::HashSet::new();
            for row in group {
                if let Some(v) = row.get(field_name) {
                    seen.insert(v.to_string());
                }
            }
            Value::from(seen.len() as f64)
        }

        AggregateOpKind::Values => {
            let field_name = match field {
                Some(f) => f,
                None => return Value::Array(vec![]),
            };
            let vals: Vec<Value> = group
                .iter()
                .filter_map(|row| row.get(field_name).cloned())
                .collect();
            Value::Array(vals)
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{AggregateOp, AggregateOpKind, AggregateSpec};
    use serde_json::json;

    fn make_row(pairs: &[(&str, Value)]) -> DataRow {
        let mut row = DataRow::new();
        for (k, v) in pairs {
            row.insert(k.to_string(), v.clone());
        }
        row
    }

    fn sales_data() -> Vec<DataRow> {
        vec![
            make_row(&[("region", json!("East")), ("amount", json!(100))]),
            make_row(&[("region", json!("East")), ("amount", json!(200))]),
            make_row(&[("region", json!("West")), ("amount", json!(150))]),
            make_row(&[("region", json!("West")), ("amount", json!(250))]),
            make_row(&[("region", json!("West")), ("amount", json!(300))]),
        ]
    }

    // ---- Empty data ----

    #[test]
    fn aggregate_empty_data() {
        let spec = AggregateSpec {
            groupby: vec!["x".to_string()],
            aggregate: vec![AggregateOp {
                op: AggregateOpKind::Count,
                field: None,
                as_field: "count".to_string(),
            }],
        };
        let result = apply_aggregate(&[], &[spec]);
        assert!(result.is_empty());
    }

    // ---- Count ----

    #[test]
    fn aggregate_count() {
        let data = sales_data();
        let spec = AggregateSpec {
            groupby: vec!["region".to_string()],
            aggregate: vec![AggregateOp {
                op: AggregateOpKind::Count,
                field: None,
                as_field: "count".to_string(),
            }],
        };
        let result = apply_aggregate(&data, &[spec]);
        assert_eq!(result.len(), 2);

        // Find East group.
        let east = result
            .iter()
            .find(|r| r.get("region") == Some(&json!("East")))
            .unwrap();
        assert_eq!(east.get("count").and_then(|v| v.as_f64()), Some(2.0));

        let west = result
            .iter()
            .find(|r| r.get("region") == Some(&json!("West")))
            .unwrap();
        assert_eq!(west.get("count").and_then(|v| v.as_f64()), Some(3.0));
    }

    // ---- Sum ----

    #[test]
    fn aggregate_sum() {
        let data = sales_data();
        let spec = AggregateSpec {
            groupby: vec!["region".to_string()],
            aggregate: vec![AggregateOp {
                op: AggregateOpKind::Sum,
                field: Some("amount".to_string()),
                as_field: "total".to_string(),
            }],
        };
        let result = apply_aggregate(&data, &[spec]);

        let east = result
            .iter()
            .find(|r| r.get("region") == Some(&json!("East")))
            .unwrap();
        assert_eq!(east.get("total").and_then(|v| v.as_f64()), Some(300.0));

        let west = result
            .iter()
            .find(|r| r.get("region") == Some(&json!("West")))
            .unwrap();
        assert_eq!(west.get("total").and_then(|v| v.as_f64()), Some(700.0));
    }

    // ---- Mean ----

    #[test]
    fn aggregate_mean() {
        let data = sales_data();
        let spec = AggregateSpec {
            groupby: vec!["region".to_string()],
            aggregate: vec![AggregateOp {
                op: AggregateOpKind::Mean,
                field: Some("amount".to_string()),
                as_field: "avg".to_string(),
            }],
        };
        let result = apply_aggregate(&data, &[spec]);

        let east = result
            .iter()
            .find(|r| r.get("region") == Some(&json!("East")))
            .unwrap();
        assert_eq!(east.get("avg").and_then(|v| v.as_f64()), Some(150.0));
    }

    // ---- Min / Max ----

    #[test]
    fn aggregate_min_max() {
        let data = sales_data();
        let spec = AggregateSpec {
            groupby: vec!["region".to_string()],
            aggregate: vec![
                AggregateOp {
                    op: AggregateOpKind::Min,
                    field: Some("amount".to_string()),
                    as_field: "min_amt".to_string(),
                },
                AggregateOp {
                    op: AggregateOpKind::Max,
                    field: Some("amount".to_string()),
                    as_field: "max_amt".to_string(),
                },
            ],
        };
        let result = apply_aggregate(&data, &[spec]);

        let west = result
            .iter()
            .find(|r| r.get("region") == Some(&json!("West")))
            .unwrap();
        assert_eq!(west.get("min_amt").and_then(|v| v.as_f64()), Some(150.0));
        assert_eq!(west.get("max_amt").and_then(|v| v.as_f64()), Some(300.0));
    }

    // ---- Distinct ----

    #[test]
    fn aggregate_distinct() {
        let data = vec![
            make_row(&[("g", json!("A")), ("v", json!(1))]),
            make_row(&[("g", json!("A")), ("v", json!(1))]),
            make_row(&[("g", json!("A")), ("v", json!(2))]),
        ];
        let spec = AggregateSpec {
            groupby: vec!["g".to_string()],
            aggregate: vec![AggregateOp {
                op: AggregateOpKind::Distinct,
                field: Some("v".to_string()),
                as_field: "unique_count".to_string(),
            }],
        };
        let result = apply_aggregate(&data, &[spec]);
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0].get("unique_count").and_then(|v| v.as_f64()),
            Some(2.0)
        );
    }

    // ---- Values ----

    #[test]
    fn aggregate_values() {
        let data = vec![
            make_row(&[("g", json!("A")), ("v", json!(10))]),
            make_row(&[("g", json!("A")), ("v", json!(20))]),
        ];
        let spec = AggregateSpec {
            groupby: vec!["g".to_string()],
            aggregate: vec![AggregateOp {
                op: AggregateOpKind::Values,
                field: Some("v".to_string()),
                as_field: "all_v".to_string(),
            }],
        };
        let result = apply_aggregate(&data, &[spec]);
        let vals = result[0].get("all_v").unwrap().as_array().unwrap();
        assert_eq!(vals.len(), 2);
    }

    // ---- No groupby (whole dataset) ----

    #[test]
    fn aggregate_no_groupby() {
        let data = sales_data();
        let spec = AggregateSpec {
            groupby: vec![],
            aggregate: vec![
                AggregateOp {
                    op: AggregateOpKind::Count,
                    field: None,
                    as_field: "total_count".to_string(),
                },
                AggregateOp {
                    op: AggregateOpKind::Sum,
                    field: Some("amount".to_string()),
                    as_field: "total_amount".to_string(),
                },
            ],
        };
        let result = apply_aggregate(&data, &[spec]);
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0].get("total_count").and_then(|v| v.as_f64()),
            Some(5.0)
        );
        assert_eq!(
            result[0].get("total_amount").and_then(|v| v.as_f64()),
            Some(1000.0)
        );
    }

    // ---- Median ----

    #[test]
    fn aggregate_median() {
        let data = vec![
            make_row(&[("g", json!("A")), ("v", json!(1))]),
            make_row(&[("g", json!("A")), ("v", json!(2))]),
            make_row(&[("g", json!("A")), ("v", json!(3))]),
        ];
        let spec = AggregateSpec {
            groupby: vec!["g".to_string()],
            aggregate: vec![AggregateOp {
                op: AggregateOpKind::Median,
                field: Some("v".to_string()),
                as_field: "med".to_string(),
            }],
        };
        let result = apply_aggregate(&data, &[spec]);
        assert_eq!(result[0].get("med").and_then(|v| v.as_f64()), Some(2.0));
    }

    // ---- CI ----

    #[test]
    fn aggregate_ci() {
        let data: Vec<DataRow> = (0..100)
            .map(|i| make_row(&[("g", json!("A")), ("v", json!(i as f64))]))
            .collect();
        let spec = AggregateSpec {
            groupby: vec!["g".to_string()],
            aggregate: vec![
                AggregateOp {
                    op: AggregateOpKind::Ci0,
                    field: Some("v".to_string()),
                    as_field: "ci_lo".to_string(),
                },
                AggregateOp {
                    op: AggregateOpKind::Ci1,
                    field: Some("v".to_string()),
                    as_field: "ci_hi".to_string(),
                },
            ],
        };
        let result = apply_aggregate(&data, &[spec]);
        let lo = result[0].get("ci_lo").and_then(|v| v.as_f64()).unwrap();
        let hi = result[0].get("ci_hi").and_then(|v| v.as_f64()).unwrap();
        assert!(lo < hi);
        // Mean is 49.5; CI should bracket it.
        assert!(lo < 49.5);
        assert!(hi > 49.5);
    }

    // ---- Sequential specs ----

    #[test]
    fn aggregate_sequential_specs() {
        let data = sales_data();
        // First: group by region, compute sum.
        // Second: no groupby, compute count of groups.
        let specs = vec![
            AggregateSpec {
                groupby: vec!["region".to_string()],
                aggregate: vec![AggregateOp {
                    op: AggregateOpKind::Sum,
                    field: Some("amount".to_string()),
                    as_field: "total".to_string(),
                }],
            },
            AggregateSpec {
                groupby: vec![],
                aggregate: vec![AggregateOp {
                    op: AggregateOpKind::Count,
                    field: None,
                    as_field: "num_regions".to_string(),
                }],
            },
        ];
        let result = apply_aggregate(&data, &specs);
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0].get("num_regions").and_then(|v| v.as_f64()),
            Some(2.0)
        );
    }
}
