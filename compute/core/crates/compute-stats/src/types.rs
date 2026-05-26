//! Shared analytical type definitions for the compute engine.
//!
//! These are general-purpose analytical primitives used by both the pivot engine
//! (`compute-pivot`) and worksheet functions (`compute-core`).  They are NOT
//! pivot-specific — any subsystem that needs aggregation, filtering, sorting,
//! or data-type detection should depend on these definitions.
//!
//! **NOTE**: Canonical definitions now live in `domain_types::domain::analytics`.
//! This module re-exports them for backward compatibility.

pub use domain_types::domain::analytics::{
    AggregateFunction, BinaryFilterOp, DateGrouping, DetectedDataType, FilterOperator,
    NullaryFilterOp, NumberGrouping, PivotFilterCondition, PivotFilterConditionFlat, SortDirection,
    UnaryFilterOp,
};

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::CellValue;

    // =====================================================================
    // NumberGrouping::new()
    // =====================================================================

    #[test]
    fn number_grouping_new_stores_values() {
        let g = NumberGrouping::new(1.0, 100.0, 10.0);
        assert_eq!(g.start, 1.0);
        assert_eq!(g.end, 100.0);
        assert_eq!(g.interval, 10.0);
    }

    // =====================================================================
    // NumberGrouping::validate()
    // =====================================================================

    #[test]
    fn validate_valid_grouping() {
        assert!(NumberGrouping::new(0.0, 100.0, 10.0).validate().is_ok());
    }

    #[test]
    fn validate_negative_range_valid() {
        // Negative numbers are fine as long as end > start and interval > 0
        assert!(NumberGrouping::new(-100.0, -10.0, 5.0).validate().is_ok());
    }

    #[test]
    fn validate_very_small_interval() {
        // 1000 bins — should still be valid
        assert!(NumberGrouping::new(0.0, 1.0, 0.001).validate().is_ok());
    }

    #[test]
    fn validate_fractional_values() {
        assert!(NumberGrouping::new(0.5, 10.5, 0.1).validate().is_ok());
    }

    #[test]
    fn validate_interval_zero_is_err() {
        // Zero-width bins are degenerate — must reject
        assert!(NumberGrouping::new(0.0, 100.0, 0.0).validate().is_err());
    }

    #[test]
    fn validate_interval_negative_is_err() {
        assert!(NumberGrouping::new(0.0, 100.0, -5.0).validate().is_err());
    }

    #[test]
    fn validate_end_equals_start_is_err() {
        // Empty range — no bins possible
        assert!(NumberGrouping::new(50.0, 50.0, 1.0).validate().is_err());
    }

    #[test]
    fn validate_end_less_than_start_is_err() {
        assert!(NumberGrouping::new(100.0, 0.0, 10.0).validate().is_err());
    }

    #[test]
    fn validate_start_nan_is_err() {
        assert!(
            NumberGrouping::new(f64::NAN, 100.0, 10.0)
                .validate()
                .is_err()
        );
    }

    #[test]
    fn validate_end_nan_is_err() {
        assert!(NumberGrouping::new(0.0, f64::NAN, 10.0).validate().is_err());
    }

    #[test]
    fn validate_interval_nan_is_err() {
        assert!(
            NumberGrouping::new(0.0, 100.0, f64::NAN)
                .validate()
                .is_err()
        );
    }

    #[test]
    fn validate_start_infinity_is_err() {
        assert!(
            NumberGrouping::new(f64::INFINITY, 100.0, 10.0)
                .validate()
                .is_err()
        );
    }

    #[test]
    fn validate_end_infinity_is_err() {
        assert!(
            NumberGrouping::new(0.0, f64::INFINITY, 10.0)
                .validate()
                .is_err()
        );
    }

    #[test]
    fn validate_interval_infinity_is_err() {
        assert!(
            NumberGrouping::new(0.0, 100.0, f64::INFINITY)
                .validate()
                .is_err()
        );
    }

    #[test]
    fn validate_start_neg_infinity_is_err() {
        assert!(
            NumberGrouping::new(f64::NEG_INFINITY, 100.0, 10.0)
                .validate()
                .is_err()
        );
    }

    #[test]
    fn validate_end_neg_infinity_is_err() {
        assert!(
            NumberGrouping::new(0.0, f64::NEG_INFINITY, 10.0)
                .validate()
                .is_err()
        );
    }

    // =====================================================================
    // PivotFilterCondition::from_flat() — nullary operators
    // =====================================================================

    #[test]
    fn from_flat_is_blank() {
        let flat = PivotFilterConditionFlat {
            operator: FilterOperator::IsBlank,
            value: None,
            value2: None,
        };
        assert_eq!(
            PivotFilterCondition::from_flat(flat),
            PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank)
        );
    }

    #[test]
    fn from_flat_is_not_blank() {
        let flat = PivotFilterConditionFlat {
            operator: FilterOperator::IsNotBlank,
            value: None,
            value2: None,
        };
        assert_eq!(
            PivotFilterCondition::from_flat(flat),
            PivotFilterCondition::Nullary(NullaryFilterOp::IsNotBlank)
        );
    }

    #[test]
    fn from_flat_above_average() {
        let flat = PivotFilterConditionFlat {
            operator: FilterOperator::AboveAverage,
            value: None,
            value2: None,
        };
        assert_eq!(
            PivotFilterCondition::from_flat(flat),
            PivotFilterCondition::Nullary(NullaryFilterOp::AboveAverage)
        );
    }

    #[test]
    fn from_flat_below_average() {
        let flat = PivotFilterConditionFlat {
            operator: FilterOperator::BelowAverage,
            value: None,
            value2: None,
        };
        assert_eq!(
            PivotFilterCondition::from_flat(flat),
            PivotFilterCondition::Nullary(NullaryFilterOp::BelowAverage)
        );
    }

    #[test]
    fn from_flat_nullary_ignores_provided_values() {
        // Nullary operators should produce Nullary variant even if values are provided
        let flat = PivotFilterConditionFlat {
            operator: FilterOperator::IsBlank,
            value: Some(CellValue::from(42.0)),
            value2: Some(CellValue::from(99.0)),
        };
        assert_eq!(
            PivotFilterCondition::from_flat(flat),
            PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank)
        );
    }

    // =====================================================================
    // PivotFilterCondition::from_flat() — unary operators
    // =====================================================================

    #[test]
    fn from_flat_equals_with_value() {
        let flat = PivotFilterConditionFlat {
            operator: FilterOperator::Equals,
            value: Some(CellValue::from(42.0)),
            value2: None,
        };
        assert_eq!(
            PivotFilterCondition::from_flat(flat),
            PivotFilterCondition::Unary {
                op: UnaryFilterOp::Equals,
                value: CellValue::from(42.0),
            }
        );
    }

    #[test]
    fn from_flat_unary_missing_value_fills_null() {
        // When no value is provided, it should default to CellValue::Null
        let flat = PivotFilterConditionFlat {
            operator: FilterOperator::Equals,
            value: None,
            value2: None,
        };
        assert_eq!(
            PivotFilterCondition::from_flat(flat),
            PivotFilterCondition::Unary {
                op: UnaryFilterOp::Equals,
                value: CellValue::Null,
            }
        );
    }

    #[test]
    fn from_flat_all_unary_operators() {
        let cases: Vec<(FilterOperator, UnaryFilterOp)> = vec![
            (FilterOperator::Equals, UnaryFilterOp::Equals),
            (FilterOperator::NotEquals, UnaryFilterOp::NotEquals),
            (FilterOperator::GreaterThan, UnaryFilterOp::GreaterThan),
            (FilterOperator::LessThan, UnaryFilterOp::LessThan),
            (
                FilterOperator::GreaterThanOrEqual,
                UnaryFilterOp::GreaterThanOrEqual,
            ),
            (
                FilterOperator::LessThanOrEqual,
                UnaryFilterOp::LessThanOrEqual,
            ),
            (FilterOperator::Contains, UnaryFilterOp::Contains),
            (FilterOperator::NotContains, UnaryFilterOp::NotContains),
            (FilterOperator::StartsWith, UnaryFilterOp::StartsWith),
            (FilterOperator::EndsWith, UnaryFilterOp::EndsWith),
        ];

        let val = CellValue::from("test");
        for (filter_op, expected_unary_op) in cases {
            let flat = PivotFilterConditionFlat {
                operator: filter_op.clone(),
                value: Some(val.clone()),
                value2: None,
            };
            let result = PivotFilterCondition::from_flat(flat);
            assert_eq!(
                result,
                PivotFilterCondition::Unary {
                    op: expected_unary_op,
                    value: val.clone(),
                },
                "Failed for operator {:?}",
                filter_op
            );
        }
    }

    // =====================================================================
    // PivotFilterCondition::from_flat() — binary operators
    // =====================================================================

    #[test]
    fn from_flat_between_with_both_values() {
        let flat = PivotFilterConditionFlat {
            operator: FilterOperator::Between,
            value: Some(CellValue::from(10.0)),
            value2: Some(CellValue::from(20.0)),
        };
        assert_eq!(
            PivotFilterCondition::from_flat(flat),
            PivotFilterCondition::Binary {
                op: BinaryFilterOp::Between,
                value: CellValue::from(10.0),
                value2: CellValue::from(20.0),
            }
        );
    }

    #[test]
    fn from_flat_not_between_with_both_values() {
        let flat = PivotFilterConditionFlat {
            operator: FilterOperator::NotBetween,
            value: Some(CellValue::from(10.0)),
            value2: Some(CellValue::from(20.0)),
        };
        assert_eq!(
            PivotFilterCondition::from_flat(flat),
            PivotFilterCondition::Binary {
                op: BinaryFilterOp::NotBetween,
                value: CellValue::from(10.0),
                value2: CellValue::from(20.0),
            }
        );
    }

    #[test]
    fn from_flat_between_missing_both_values_fills_null() {
        let flat = PivotFilterConditionFlat {
            operator: FilterOperator::Between,
            value: None,
            value2: None,
        };
        assert_eq!(
            PivotFilterCondition::from_flat(flat),
            PivotFilterCondition::Binary {
                op: BinaryFilterOp::Between,
                value: CellValue::Null,
                value2: CellValue::Null,
            }
        );
    }

    #[test]
    fn from_flat_between_missing_value2_fills_null() {
        let flat = PivotFilterConditionFlat {
            operator: FilterOperator::Between,
            value: Some(CellValue::from(10.0)),
            value2: None,
        };
        let result = PivotFilterCondition::from_flat(flat);
        assert_eq!(
            result,
            PivotFilterCondition::Binary {
                op: BinaryFilterOp::Between,
                value: CellValue::from(10.0),
                value2: CellValue::Null,
            }
        );
    }

    #[test]
    fn from_flat_between_missing_value1_fills_null() {
        let flat = PivotFilterConditionFlat {
            operator: FilterOperator::Between,
            value: None,
            value2: Some(CellValue::from(20.0)),
        };
        let result = PivotFilterCondition::from_flat(flat);
        assert_eq!(
            result,
            PivotFilterCondition::Binary {
                op: BinaryFilterOp::Between,
                value: CellValue::Null,
                value2: CellValue::from(20.0),
            }
        );
    }

    // =====================================================================
    // PivotFilterConditionFlat From<PivotFilterCondition>
    // =====================================================================

    #[test]
    fn into_flat_nullary() {
        let typed = PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank);
        let flat: PivotFilterConditionFlat = typed.into();
        assert_eq!(flat.operator, FilterOperator::IsBlank);
        assert_eq!(flat.value, None);
        assert_eq!(flat.value2, None);
    }

    #[test]
    fn into_flat_unary() {
        let typed = PivotFilterCondition::Unary {
            op: UnaryFilterOp::Contains,
            value: CellValue::from("hello"),
        };
        let flat: PivotFilterConditionFlat = typed.into();
        assert_eq!(flat.operator, FilterOperator::Contains);
        assert_eq!(flat.value, Some(CellValue::from("hello")));
        assert_eq!(flat.value2, None);
    }

    #[test]
    fn into_flat_binary() {
        let typed = PivotFilterCondition::Binary {
            op: BinaryFilterOp::Between,
            value: CellValue::from(10.0),
            value2: CellValue::from(20.0),
        };
        let flat: PivotFilterConditionFlat = typed.into();
        assert_eq!(flat.operator, FilterOperator::Between);
        assert_eq!(flat.value, Some(CellValue::from(10.0)));
        assert_eq!(flat.value2, Some(CellValue::from(20.0)));
    }

    #[test]
    fn into_flat_all_nullary_operators() {
        let cases = vec![
            (NullaryFilterOp::IsBlank, FilterOperator::IsBlank),
            (NullaryFilterOp::IsNotBlank, FilterOperator::IsNotBlank),
            (NullaryFilterOp::AboveAverage, FilterOperator::AboveAverage),
            (NullaryFilterOp::BelowAverage, FilterOperator::BelowAverage),
        ];
        for (nullary_op, expected_filter_op) in cases {
            let flat: PivotFilterConditionFlat =
                PivotFilterCondition::Nullary(nullary_op.clone()).into();
            assert_eq!(flat.operator, expected_filter_op);
            assert_eq!(flat.value, None);
            assert_eq!(flat.value2, None);
        }
    }

    // =====================================================================
    // Round-trip: from_flat -> into flat preserves semantics
    // =====================================================================

    #[test]
    fn roundtrip_nullary() {
        let original = PivotFilterConditionFlat {
            operator: FilterOperator::IsBlank,
            value: None,
            value2: None,
        };
        let typed = PivotFilterCondition::from_flat(original.clone());
        let back: PivotFilterConditionFlat = typed.into();
        assert_eq!(back, original);
    }

    #[test]
    fn roundtrip_unary() {
        let original = PivotFilterConditionFlat {
            operator: FilterOperator::GreaterThan,
            value: Some(CellValue::from(42.0)),
            value2: None,
        };
        let typed = PivotFilterCondition::from_flat(original.clone());
        let back: PivotFilterConditionFlat = typed.into();
        assert_eq!(back, original);
    }

    #[test]
    fn roundtrip_binary() {
        let original = PivotFilterConditionFlat {
            operator: FilterOperator::Between,
            value: Some(CellValue::from(1.0)),
            value2: Some(CellValue::from(100.0)),
        };
        let typed = PivotFilterCondition::from_flat(original.clone());
        let back: PivotFilterConditionFlat = typed.into();
        assert_eq!(back, original);
    }

    #[test]
    fn roundtrip_unary_missing_value_becomes_null() {
        // from_flat fills None with CellValue::Null, and into flat wraps it in Some.
        // So a round-trip changes value from None to Some(Null).
        let original = PivotFilterConditionFlat {
            operator: FilterOperator::Equals,
            value: None,
            value2: None,
        };
        let typed = PivotFilterCondition::from_flat(original);
        let back: PivotFilterConditionFlat = typed.into();
        assert_eq!(back.operator, FilterOperator::Equals);
        assert_eq!(back.value, Some(CellValue::Null));
        assert_eq!(back.value2, None);
    }

    #[test]
    fn roundtrip_binary_missing_values_become_null() {
        let original = PivotFilterConditionFlat {
            operator: FilterOperator::NotBetween,
            value: None,
            value2: None,
        };
        let typed = PivotFilterCondition::from_flat(original);
        let back: PivotFilterConditionFlat = typed.into();
        assert_eq!(back.operator, FilterOperator::NotBetween);
        assert_eq!(back.value, Some(CellValue::Null));
        assert_eq!(back.value2, Some(CellValue::Null));
    }

    #[test]
    fn roundtrip_all_16_operators() {
        // Every FilterOperator variant should survive a from_flat -> into flat round-trip
        // (with values filled for operators that need them).
        let operators = vec![
            (FilterOperator::IsBlank, false, false),
            (FilterOperator::IsNotBlank, false, false),
            (FilterOperator::AboveAverage, false, false),
            (FilterOperator::BelowAverage, false, false),
            (FilterOperator::Equals, true, false),
            (FilterOperator::NotEquals, true, false),
            (FilterOperator::GreaterThan, true, false),
            (FilterOperator::LessThan, true, false),
            (FilterOperator::GreaterThanOrEqual, true, false),
            (FilterOperator::LessThanOrEqual, true, false),
            (FilterOperator::Contains, true, false),
            (FilterOperator::NotContains, true, false),
            (FilterOperator::StartsWith, true, false),
            (FilterOperator::EndsWith, true, false),
            (FilterOperator::Between, true, true),
            (FilterOperator::NotBetween, true, true),
        ];

        for (op, needs_v1, needs_v2) in operators {
            let flat = PivotFilterConditionFlat {
                operator: op.clone(),
                value: if needs_v1 {
                    Some(CellValue::from(1.0))
                } else {
                    None
                },
                value2: if needs_v2 {
                    Some(CellValue::from(2.0))
                } else {
                    None
                },
            };
            let typed = PivotFilterCondition::from_flat(flat.clone());
            let back: PivotFilterConditionFlat = typed.into();
            assert_eq!(
                back.operator, flat.operator,
                "Operator mismatch for {:?}",
                op
            );
            if needs_v1 {
                assert_eq!(back.value, flat.value, "Value mismatch for {:?}", op);
            }
            if needs_v2 {
                assert_eq!(back.value2, flat.value2, "Value2 mismatch for {:?}", op);
            }
        }
    }

    // =====================================================================
    // Serde tests
    // =====================================================================

    #[test]
    fn serde_aggregate_function_rename() {
        // Standard lowercase
        assert_eq!(
            serde_json::to_string(&AggregateFunction::Sum).unwrap(),
            "\"sum\""
        );
        assert_eq!(
            serde_json::to_string(&AggregateFunction::Count).unwrap(),
            "\"count\""
        );
        assert_eq!(
            serde_json::to_string(&AggregateFunction::Average).unwrap(),
            "\"average\""
        );
        assert_eq!(
            serde_json::to_string(&AggregateFunction::Min).unwrap(),
            "\"min\""
        );
        assert_eq!(
            serde_json::to_string(&AggregateFunction::Max).unwrap(),
            "\"max\""
        );
        assert_eq!(
            serde_json::to_string(&AggregateFunction::Product).unwrap(),
            "\"product\""
        );
        assert_eq!(
            serde_json::to_string(&AggregateFunction::Var).unwrap(),
            "\"var\""
        );

        // Custom renames
        assert_eq!(
            serde_json::to_string(&AggregateFunction::CountA).unwrap(),
            "\"counta\""
        );
        assert_eq!(
            serde_json::to_string(&AggregateFunction::CountUnique).unwrap(),
            "\"countunique\""
        );
        assert_eq!(
            serde_json::to_string(&AggregateFunction::StdDev).unwrap(),
            "\"stdev\""
        );
        assert_eq!(
            serde_json::to_string(&AggregateFunction::StdDevP).unwrap(),
            "\"stdevp\""
        );
        assert_eq!(
            serde_json::to_string(&AggregateFunction::VarP).unwrap(),
            "\"varp\""
        );
    }

    #[test]
    fn serde_aggregate_function_deserialize() {
        assert_eq!(
            serde_json::from_str::<AggregateFunction>("\"counta\"").unwrap(),
            AggregateFunction::CountA
        );
        assert_eq!(
            serde_json::from_str::<AggregateFunction>("\"stdev\"").unwrap(),
            AggregateFunction::StdDev
        );
        // Ensure incorrect casing is rejected
        assert!(serde_json::from_str::<AggregateFunction>("\"CountA\"").is_err());
        assert!(serde_json::from_str::<AggregateFunction>("\"STDEV\"").is_err());
    }

    #[test]
    fn serde_sort_direction() {
        assert_eq!(
            serde_json::to_string(&SortDirection::Asc).unwrap(),
            "\"asc\""
        );
        assert_eq!(
            serde_json::to_string(&SortDirection::Desc).unwrap(),
            "\"desc\""
        );
        assert_eq!(
            serde_json::from_str::<SortDirection>("\"asc\"").unwrap(),
            SortDirection::Asc
        );
        assert_eq!(
            serde_json::from_str::<SortDirection>("\"desc\"").unwrap(),
            SortDirection::Desc
        );
    }

    #[test]
    fn serde_detected_data_type() {
        assert_eq!(
            serde_json::to_string(&DetectedDataType::String).unwrap(),
            "\"string\""
        );
        assert_eq!(
            serde_json::to_string(&DetectedDataType::Number).unwrap(),
            "\"number\""
        );
        assert_eq!(
            serde_json::to_string(&DetectedDataType::Date).unwrap(),
            "\"date\""
        );
        assert_eq!(
            serde_json::to_string(&DetectedDataType::Boolean).unwrap(),
            "\"boolean\""
        );
        assert_eq!(
            serde_json::to_string(&DetectedDataType::Empty).unwrap(),
            "\"empty\""
        );
        assert_eq!(
            serde_json::to_string(&DetectedDataType::Error).unwrap(),
            "\"error\""
        );

        // Roundtrip
        for variant in [
            DetectedDataType::String,
            DetectedDataType::Number,
            DetectedDataType::Date,
            DetectedDataType::Boolean,
            DetectedDataType::Empty,
            DetectedDataType::Error,
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            let back: DetectedDataType = serde_json::from_str(&json).unwrap();
            assert_eq!(back, variant);
        }
    }

    #[test]
    fn serde_filter_operator_camel_case() {
        assert_eq!(
            serde_json::to_string(&FilterOperator::GreaterThanOrEqual).unwrap(),
            "\"greaterThanOrEqual\""
        );
        assert_eq!(
            serde_json::to_string(&FilterOperator::IsBlank).unwrap(),
            "\"isBlank\""
        );
        assert_eq!(
            serde_json::to_string(&FilterOperator::NotBetween).unwrap(),
            "\"notBetween\""
        );
    }

    #[test]
    fn serde_number_grouping_camel_case() {
        let g = NumberGrouping::new(0.0, 100.0, 10.0);
        let json = serde_json::to_string(&g).unwrap();
        // Fields should be camelCase
        assert!(json.contains("\"start\""));
        assert!(json.contains("\"end\""));
        assert!(json.contains("\"interval\""));
        // Roundtrip
        let back: NumberGrouping = serde_json::from_str(&json).unwrap();
        assert_eq!(back.start, 0.0);
        assert_eq!(back.end, 100.0);
        assert_eq!(back.interval, 10.0);
    }

    #[test]
    fn serde_date_grouping() {
        assert_eq!(
            serde_json::to_string(&DateGrouping::Year).unwrap(),
            "\"year\""
        );
        assert_eq!(
            serde_json::to_string(&DateGrouping::Quarter).unwrap(),
            "\"quarter\""
        );
        assert_eq!(
            serde_json::to_string(&DateGrouping::Month).unwrap(),
            "\"month\""
        );
    }

    #[test]
    fn sort_direction_default_is_asc() {
        assert_eq!(SortDirection::default(), SortDirection::Asc);
    }
}
