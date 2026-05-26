//! Serde round-trip tests for chart transform types.
//!
//! These verify that JSON matching the TS wire format deserializes correctly.

#[cfg(test)]
mod tests {
    use crate::types::*;
    use serde_json::json;

    #[test]
    fn test_filter_spec_round_trip() {
        let json = json!({
            "type": "filter",
            "filter": {
                "field": "value",
                "gt": 10.0,
                "lte": 100.0
            }
        });

        let transform: Transform = serde_json::from_value(json.clone()).unwrap();
        match &transform {
            Transform::Filter {
                filter: FilterInput::Spec(spec),
            } => {
                assert_eq!(spec.field, "value");
                assert_eq!(spec.gt, Some(10.0));
                assert_eq!(spec.lte, Some(100.0));
            }
            _ => panic!("Expected Filter with Spec"),
        }

        // Round-trip
        let serialized = serde_json::to_value(&transform).unwrap();
        let _back: Transform = serde_json::from_value(serialized).unwrap();
    }

    #[test]
    fn test_filter_expression_round_trip() {
        let json = json!({
            "type": "filter",
            "filter": "datum.x > 10"
        });

        let transform: Transform = serde_json::from_value(json).unwrap();
        match &transform {
            Transform::Filter {
                filter: FilterInput::Expression(expr),
            } => {
                assert_eq!(expr, "datum.x > 10");
            }
            _ => panic!("Expected Filter with Expression"),
        }
    }

    #[test]
    fn test_aggregate_round_trip() {
        let json = json!({
            "type": "aggregate",
            "aggregate": [{
                "groupby": ["category"],
                "aggregate": [
                    { "op": "sum", "field": "amount", "as": "total" },
                    { "op": "count", "as": "n" }
                ]
            }]
        });

        let transform: Transform = serde_json::from_value(json).unwrap();
        match &transform {
            Transform::Aggregate { aggregate } => {
                assert_eq!(aggregate.len(), 1);
                assert_eq!(aggregate[0].groupby, vec!["category"]);
                assert_eq!(aggregate[0].aggregate.len(), 2);
                assert_eq!(aggregate[0].aggregate[0].op, AggregateOpKind::Sum);
                assert_eq!(aggregate[0].aggregate[0].field, Some("amount".into()));
                assert_eq!(aggregate[0].aggregate[0].as_field, "total");
                assert_eq!(aggregate[0].aggregate[1].op, AggregateOpKind::Count);
            }
            _ => panic!("Expected Aggregate"),
        }
    }

    #[test]
    fn test_bin_round_trip() {
        let json = json!({
            "type": "bin",
            "bin": {
                "field": "value",
                "as": "bin_value",
                "maxbins": 20,
                "nice": true
            }
        });

        let transform: Transform = serde_json::from_value(json).unwrap();
        match &transform {
            Transform::Bin { bin } => {
                assert_eq!(bin.field, "value");
                assert_eq!(bin.as_field, "bin_value");
                assert_eq!(bin.maxbins, Some(20));
                assert_eq!(bin.nice, Some(true));
            }
            _ => panic!("Expected Bin"),
        }
    }

    #[test]
    fn test_sort_round_trip() {
        let json = json!({
            "type": "sort",
            "sort": [
                { "field": "name", "order": "ascending" },
                { "field": "score", "order": "descending" }
            ]
        });

        let transform: Transform = serde_json::from_value(json).unwrap();
        match &transform {
            Transform::Sort { sort } => {
                assert_eq!(sort.len(), 2);
                assert_eq!(sort[0].field, "name");
                assert_eq!(sort[0].order, Some(ChartSortOrder::Ascending));
                assert_eq!(sort[1].field, "score");
                assert_eq!(sort[1].order, Some(ChartSortOrder::Descending));
            }
            _ => panic!("Expected Sort"),
        }
    }

    #[test]
    fn test_calculate_round_trip() {
        let json = json!({
            "type": "calculate",
            "calculate": "datum.price * datum.quantity",
            "as": "total"
        });

        let transform: Transform = serde_json::from_value(json).unwrap();
        match &transform {
            Transform::Calculate {
                calculate,
                as_field,
            } => {
                assert_eq!(calculate, "datum.price * datum.quantity");
                assert_eq!(as_field, "total");
            }
            _ => panic!("Expected Calculate"),
        }
    }

    #[test]
    fn test_fold_round_trip() {
        let json = json!({
            "type": "fold",
            "fold": ["col1", "col2", "col3"],
            "as": ["key", "value"]
        });

        let transform: Transform = serde_json::from_value(json).unwrap();
        match &transform {
            Transform::Fold { fold, as_fields } => {
                assert_eq!(fold, &["col1", "col2", "col3"]);
                let (k, v) = as_fields.as_ref().unwrap();
                assert_eq!(k, "key");
                assert_eq!(v, "value");
            }
            _ => panic!("Expected Fold"),
        }
    }

    #[test]
    fn test_regression_round_trip() {
        let json = json!({
            "type": "regression",
            "regression": "x",
            "on": "y",
            "method": "poly",
            "order": 3,
            "as": ["x_pred", "y_pred"]
        });

        let transform: Transform = serde_json::from_value(json).unwrap();
        match &transform {
            Transform::Regression {
                regression,
                on,
                method,
                order,
                as_fields,
            } => {
                assert_eq!(regression, "x");
                assert_eq!(on, "y");
                assert_eq!(*method, Some(RegressionMethod::Poly));
                assert_eq!(*order, Some(3));
                let (x, y) = as_fields.as_ref().unwrap();
                assert_eq!(x, "x_pred");
                assert_eq!(y, "y_pred");
            }
            _ => panic!("Expected Regression"),
        }
    }

    #[test]
    fn test_regression_defaults() {
        let json = json!({
            "type": "regression",
            "regression": "x",
            "on": "y"
        });

        let transform: Transform = serde_json::from_value(json).unwrap();
        match &transform {
            Transform::Regression {
                method,
                order,
                as_fields,
                ..
            } => {
                // Default method should be linear
                assert_eq!(*method, Some(RegressionMethod::Linear));
                assert_eq!(*order, None);
                assert_eq!(*as_fields, None);
            }
            _ => panic!("Expected Regression"),
        }
    }

    #[test]
    fn test_density_round_trip() {
        let json = json!({
            "type": "density",
            "density": "value",
            "bandwidth": 0.5,
            "extent": [0.0, 100.0],
            "steps": 200,
            "as": ["x", "density"]
        });

        let transform: Transform = serde_json::from_value(json).unwrap();
        match &transform {
            Transform::Density {
                density,
                bandwidth,
                extent,
                steps,
                as_fields,
            } => {
                assert_eq!(density, "value");
                assert_eq!(*bandwidth, Some(0.5));
                assert_eq!(*extent, Some((0.0, 100.0)));
                assert_eq!(*steps, Some(200));
                let (x, d) = as_fields.as_ref().unwrap();
                assert_eq!(x, "x");
                assert_eq!(d, "density");
            }
            _ => panic!("Expected Density"),
        }
    }

    #[test]
    fn test_density_defaults() {
        let json = json!({
            "type": "density",
            "density": "value"
        });

        let transform: Transform = serde_json::from_value(json).unwrap();
        match &transform {
            Transform::Density {
                bandwidth,
                extent,
                steps,
                as_fields,
                ..
            } => {
                assert_eq!(*bandwidth, None);
                assert_eq!(*extent, None);
                assert_eq!(*steps, None);
                assert_eq!(*as_fields, None);
            }
            _ => panic!("Expected Density"),
        }
    }

    #[test]
    fn test_all_aggregate_ops_deserialize() {
        let ops = [
            "count", "sum", "mean", "average", "median", "min", "max", "variance", "stdev", "q1",
            "q3", "ci0", "ci1", "distinct", "values",
        ];

        for op_name in ops {
            let json = json!({ "op": op_name, "field": "x", "as": "result" });
            let op: AggregateOp = serde_json::from_value(json).unwrap();
            assert_eq!(op.as_field, "result");
        }
    }

    #[test]
    fn test_all_regression_methods_deserialize() {
        let methods = ["linear", "log", "exp", "pow", "quad", "poly"];
        for m in methods {
            let json = json!({ "type": "regression", "regression": "x", "on": "y", "method": m });
            let t: Transform = serde_json::from_value(json).unwrap();
            assert!(matches!(t, Transform::Regression { .. }));
        }
    }

    #[test]
    fn test_stack_input_output_round_trip() {
        let input = StackInput {
            category: "A".into(),
            value: 10.0,
            group: "G1".into(),
        };
        let json = serde_json::to_value(&input).unwrap();
        let back: StackInput = serde_json::from_value(json).unwrap();
        assert_eq!(back.category, "A");
        assert_eq!(back.value, 10.0);
        assert_eq!(back.group, "G1");

        let output = StackOutput {
            category: "A".into(),
            group: "G1".into(),
            value: 10.0,
            start: 0.0,
            end: 10.0,
        };
        let json = serde_json::to_value(&output).unwrap();
        let back: StackOutput = serde_json::from_value(json).unwrap();
        assert_eq!(back.start, 0.0);
        assert_eq!(back.end, 10.0);
    }

    #[test]
    fn test_regression_output_round_trip() {
        let output = RegressionOutput {
            method: RegressionMethod::Linear,
            order: None,
            coefficients: vec![2.5, 1.3],
            r_squared: 0.95,
            points: vec![Point { x: 0.0, y: 2.5 }, Point { x: 1.0, y: 3.8 }],
            equation: "y = 1.3x + 2.5".into(),
        };
        let json = serde_json::to_value(&output).unwrap();
        let back: RegressionOutput = serde_json::from_value(json).unwrap();
        assert_eq!(back.method, RegressionMethod::Linear);
        assert_eq!(back.coefficients, vec![2.5, 1.3]);
        assert!((back.r_squared - 0.95).abs() < 1e-10);
        assert_eq!(back.points.len(), 2);
    }

    #[test]
    fn test_density_result_round_trip() {
        let result = DensityResult {
            x: vec![0.0, 1.0, 2.0],
            density: vec![0.1, 0.5, 0.1],
            bandwidth: 0.3,
            max_density: 0.5,
        };
        let json = serde_json::to_value(&result).unwrap();
        let back: DensityResult = serde_json::from_value(json).unwrap();
        assert_eq!(back.x, vec![0.0, 1.0, 2.0]);
        assert_eq!(back.density, vec![0.1, 0.5, 0.1]);
    }

    #[test]
    fn test_filter_spec_with_one_of() {
        let json = json!({
            "type": "filter",
            "filter": {
                "field": "category",
                "oneOf": ["A", "B", "C"]
            }
        });
        let t: Transform = serde_json::from_value(json).unwrap();
        match t {
            Transform::Filter {
                filter: FilterInput::Spec(spec),
            } => {
                assert_eq!(spec.one_of.as_ref().unwrap().len(), 3);
            }
            _ => panic!("Expected Filter with Spec"),
        }
    }

    #[test]
    fn test_filter_spec_with_range() {
        let json = json!({
            "type": "filter",
            "filter": {
                "field": "value",
                "range": [0.0, 100.0]
            }
        });
        let t: Transform = serde_json::from_value(json).unwrap();
        match t {
            Transform::Filter {
                filter: FilterInput::Spec(spec),
            } => {
                assert_eq!(spec.range, Some((0.0, 100.0)));
            }
            _ => panic!("Expected Filter with Spec"),
        }
    }

    #[test]
    fn test_transform_pipeline_deserialize() {
        // A realistic multi-step pipeline
        let pipeline = json!([
            { "type": "filter", "filter": { "field": "status", "equal": "active" } },
            { "type": "aggregate", "aggregate": [{ "groupby": ["region"], "aggregate": [{ "op": "sum", "field": "sales", "as": "total_sales" }] }] },
            { "type": "sort", "sort": [{ "field": "total_sales", "order": "descending" }] }
        ]);

        let transforms: Vec<Transform> = serde_json::from_value(pipeline).unwrap();
        assert_eq!(transforms.len(), 3);
        assert!(matches!(transforms[0], Transform::Filter { .. }));
        assert!(matches!(transforms[1], Transform::Aggregate { .. }));
        assert!(matches!(transforms[2], Transform::Sort { .. }));
    }

    #[test]
    fn test_per_series_bin_config_round_trip() {
        let json = json!({
            "binCount": 20,
            "binWidth": 5.0,
            "cumulative": true
        });
        let config: PerSeriesBinConfig = serde_json::from_value(json).unwrap();
        assert_eq!(config.bin_count, Some(20));
        assert_eq!(config.bin_width, Some(5.0));
        assert_eq!(config.cumulative, Some(true));

        // Round-trip
        let serialized = serde_json::to_value(&config).unwrap();
        let back: PerSeriesBinConfig = serde_json::from_value(serialized).unwrap();
        assert_eq!(back.bin_count, Some(20));
    }

    #[test]
    fn test_per_series_bin_config_defaults() {
        let json = json!({});
        let config: PerSeriesBinConfig = serde_json::from_value(json).unwrap();
        assert_eq!(config.bin_count, None);
        assert_eq!(config.bin_width, None);
        assert_eq!(config.cumulative, None);
    }

    #[test]
    fn test_per_series_boxwhisker_config_round_trip() {
        let json = json!({
            "showOutliers": true,
            "showMean": false,
            "whiskerType": "minMax"
        });
        let config: PerSeriesBoxwhiskerConfig = serde_json::from_value(json).unwrap();
        assert_eq!(config.show_outliers, Some(true));
        assert_eq!(config.show_mean, Some(false));
        assert_eq!(config.whisker_type, Some("minMax".to_string()));

        // Round-trip
        let serialized = serde_json::to_value(&config).unwrap();
        let back: PerSeriesBoxwhiskerConfig = serde_json::from_value(serialized).unwrap();
        assert_eq!(back.show_outliers, Some(true));
    }

    #[test]
    fn test_per_series_boxwhisker_defaults() {
        let json = json!({});
        let config: PerSeriesBoxwhiskerConfig = serde_json::from_value(json).unwrap();
        assert_eq!(config.show_outliers, None);
        assert_eq!(config.show_mean, None);
        assert_eq!(config.whisker_type, None);
    }

    #[test]
    fn test_resolve_boxwhisker_params_series_override() {
        let series_config = PerSeriesBoxwhiskerConfig {
            show_outliers: Some(false),
            show_mean: Some(true),
            whisker_type: Some("percentile".to_string()),
        };
        let (outliers, mean, whisker) = resolve_boxwhisker_params(
            Some(&series_config),
            Some(true),    // chart-level show_outliers
            Some(false),   // chart-level show_mean
            Some("tukey"), // chart-level whisker_type
        );
        // Per-series should override chart-level
        assert!(!outliers);
        assert!(mean);
        assert_eq!(whisker, "percentile");
    }

    #[test]
    fn test_resolve_boxwhisker_params_chart_fallback() {
        let (outliers, mean, whisker) =
            resolve_boxwhisker_params(None, Some(false), Some(true), Some("minMax"));
        // Should fall back to chart-level
        assert!(!outliers);
        assert!(mean);
        assert_eq!(whisker, "minMax");
    }
}
