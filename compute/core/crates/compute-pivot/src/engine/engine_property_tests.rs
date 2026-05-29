//! Randomized property-like tests for the pivot engine.
//!
//! These tests use deterministic pseudo-random data (via a simple LCG with
//! fixed seed) to verify invariants that should hold for any valid input:
//!
//! - `aggregate(Sum, values) == kahan_sum(numeric_values)` -- the Sum
//!   aggregation through the full pipeline matches a direct kahan_sum over
//!   the same numeric source values.
//! - Sort stability: sorting the same data twice produces identical results.
//! - Filter idempotence: applying the same filter twice gives the same result.

use super::test_helpers::*;
use super::*;
use crate::kahan_sum;
use crate::types::*;
use value_types::CellValue;

/// Simple linear congruential generator for deterministic pseudo-random f64.
/// Parameters from Numerical Recipes.
struct Lcg {
    state: u64,
}

impl Lcg {
    fn new(seed: u64) -> Self {
        Lcg { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self
            .state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.state
    }

    /// Returns a f64 in [0, max).
    fn next_f64(&mut self, max: f64) -> f64 {
        let raw = self.next_u64();
        // Use top 53 bits for a uniform f64 in [0, 1)
        let frac = (raw >> 11) as f64 / (1u64 << 53) as f64;
        frac * max
    }

    /// Returns a random index in [0, len).
    fn next_usize(&mut self, len: usize) -> usize {
        (self.next_u64() % (len as u64)) as usize
    }
}

/// Generate randomized sales-like data with a fixed seed.
fn generate_random_data(seed: u64, num_rows: usize) -> (Vec<Vec<CellValue>>, Vec<PivotField>) {
    let mut rng = Lcg::new(seed);
    let categories = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];
    let quarters = ["Q1", "Q2", "Q3", "Q4"];

    let mut data: Vec<Vec<CellValue>> = Vec::with_capacity(num_rows + 1);
    // Header row
    data.push(vec![
        cv_text("Category"),
        cv_text("Quarter"),
        cv_text("Amount"),
    ]);

    for _ in 0..num_rows {
        let cat = categories[rng.next_usize(categories.len())];
        let qtr = quarters[rng.next_usize(quarters.len())];
        let amount = rng.next_f64(10000.0) - 2000.0; // range [-2000, 8000)
        data.push(vec![cv_text(cat), cv_text(qtr), cv_num(amount)]);
    }

    let fields = vec![
        PivotField {
            id: FieldId::from("category"),
            name: "Category".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("quarter"),
            name: "Quarter".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("amount"),
            name: "Amount".to_string(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    (data, fields)
}

// -------------------------------------------------------------------------
// Property 1: Sum aggregation matches kahan_sum of source values
// -------------------------------------------------------------------------

#[test]
fn property_sum_matches_kahan_sum() {
    for seed in 0..5 {
        let (data, fields) = generate_random_data(seed * 12345 + 42, 200);

        let config = PivotTableConfig {
            schema_version: crate::types::PIVOT_CONFIG_SCHEMA_VERSION,
            id: "prop_sum".to_string(),
            name: "Prop Sum".to_string(),
            source_sheet_id: None,
            source_sheet_name: "sheet1".to_string(),
            source_range: CellRange::new(0, 0, (data.len() - 1) as u32, 2),
            output_sheet_name: "sheet1".to_string(),
            output_location: OutputLocation { row: 0, col: 0 },
            fields: fields.clone(),
            placements: vec![
                make_placement("category", PivotFieldArea::Row, 0, None),
                make_placement(
                    "amount",
                    PivotFieldArea::Value,
                    0,
                    Some(AggregateFunction::Sum),
                ),
            ],
            filters: vec![],
            layout: Some(PivotTableLayout {
                show_row_grand_totals: Some(true),
                show_column_grand_totals: Some(false),
                ..Default::default()
            }),
            style: None,
            data_options: None,
            created_at: None,
            updated_at: None,
            calculated_fields: None,
            allow_multiple_filters_per_field: None,
            auto_format: None,
            preserve_formatting: None,
            data_on_rows: None,
            cache_id: None,
            ref_range: None,
            first_data_row: None,
            first_header_row: None,
            first_data_col: None,
            rows_per_page: None,
            cols_per_page: None,
            row_items: Vec::new(),
            col_items: Vec::new(),
        };

        let result = compute(&config, &data, Some(&expand_all()));
        assert!(
            result.errors.is_none(),
            "seed {}: errors {:?}",
            seed,
            result.errors
        );

        // Compute expected grand total using kahan_sum over all Amount values
        let all_amounts: Vec<f64> = data[1..]
            .iter()
            .filter_map(|row| match &row[2] {
                CellValue::Number(n) => Some(n.get()),
                _ => None,
            })
            .collect();
        let expected_total = kahan_sum(all_amounts.iter().copied());

        let gt = result
            .grand_totals
            .row
            .as_ref()
            .unwrap_or_else(|| panic!("seed {}: no grand totals", seed));
        if let CellValue::Number(actual_total) = &gt[0] {
            assert!(
                (actual_total.get() - expected_total).abs() < 1e-6,
                "seed {}: grand total mismatch: pipeline={}, kahan_sum={}",
                seed,
                actual_total,
                expected_total
            );
        } else {
            panic!("seed {}: grand total not a number: {:?}", seed, gt[0]);
        }

        // Also verify per-group sums
        for row in &result.rows {
            let cat_name = match &row.headers[0].value {
                CellValue::Text(s) => s.clone(),
                _ => continue,
            };
            let group_amounts: Vec<f64> = data[1..]
                .iter()
                .filter_map(|data_row| {
                    if let CellValue::Text(c) = &data_row[0] {
                        if c == &cat_name {
                            if let CellValue::Number(n) = &data_row[2] {
                                return Some(n.get());
                            }
                        }
                    }
                    None
                })
                .collect();
            let expected = kahan_sum(group_amounts.iter().copied());

            if let CellValue::Number(actual) = &row.values[0] {
                assert!(
                    (actual.get() - expected).abs() < 1e-6,
                    "seed {}, cat '{}': pipeline={}, kahan_sum={}",
                    seed,
                    cat_name,
                    actual,
                    expected
                );
            }
        }
    }
}

// -------------------------------------------------------------------------
// Property 2: Sort stability -- sorting the same data twice produces
// identical results
// -------------------------------------------------------------------------

#[test]
fn property_sort_stability() {
    for seed in 0..5 {
        let (data, fields) = generate_random_data(seed * 99991 + 7, 150);

        let mut axis = make_row_axis("category", 0);
        axis.sort_by_value = Some(SortByValueConfig {
            value_field_id: FieldId::from("amount"),
            order: SortDirection::Desc,
            column_key: None,
        });

        let config = PivotTableConfig {
            schema_version: crate::types::PIVOT_CONFIG_SCHEMA_VERSION,
            id: "prop_sort".to_string(),
            name: "Prop Sort".to_string(),
            source_sheet_id: None,
            source_sheet_name: "sheet1".to_string(),
            source_range: CellRange::new(0, 0, (data.len() - 1) as u32, 2),
            output_sheet_name: "sheet1".to_string(),
            output_location: OutputLocation { row: 0, col: 0 },
            fields: fields.clone(),
            placements: vec![
                PivotFieldPlacement::Row(axis.clone()),
                make_placement(
                    "amount",
                    PivotFieldArea::Value,
                    0,
                    Some(AggregateFunction::Sum),
                ),
            ],
            filters: vec![],
            layout: None,
            style: None,
            data_options: None,
            created_at: None,
            updated_at: None,
            calculated_fields: None,
            allow_multiple_filters_per_field: None,
            auto_format: None,
            preserve_formatting: None,
            data_on_rows: None,
            cache_id: None,
            ref_range: None,
            first_data_row: None,
            first_header_row: None,
            first_data_col: None,
            rows_per_page: None,
            cols_per_page: None,
            row_items: Vec::new(),
            col_items: Vec::new(),
        };

        let result1 = compute(&config, &data, Some(&expand_all()));
        let result2 = compute(&config, &data, Some(&expand_all()));

        assert!(
            result1.errors.is_none(),
            "seed {}: errors {:?}",
            seed,
            result1.errors
        );
        assert!(
            result2.errors.is_none(),
            "seed {}: errors {:?}",
            seed,
            result2.errors
        );

        let keys1: Vec<&str> = result1.rows.iter().map(|r| r.key.as_str()).collect();
        let keys2: Vec<&str> = result2.rows.iter().map(|r| r.key.as_str()).collect();
        assert_eq!(
            keys1, keys2,
            "seed {}: sorting the same data twice must produce identical row order",
            seed
        );

        let vals1: Vec<&Vec<CellValue>> = result1.rows.iter().map(|r| &r.values).collect();
        let vals2: Vec<&Vec<CellValue>> = result2.rows.iter().map(|r| &r.values).collect();
        assert_eq!(
            vals1, vals2,
            "seed {}: sorting the same data twice must produce identical values",
            seed
        );
    }
}

// -------------------------------------------------------------------------
// Property 3: Filter idempotence -- applying the same filter twice gives
// the same result
// -------------------------------------------------------------------------

#[test]
fn property_filter_idempotence() {
    for seed in 0..5 {
        let (data, fields) = generate_random_data(seed * 77777 + 13, 200);

        // Filter: only include rows where Amount > 0
        let filter = PivotFilter {
            field_id: FieldId::from("amount"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::GreaterThan,
                value: Some(cv_num(0.0)),
                value2: None,
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        };

        let make_config = |filters: Vec<PivotFilter>| -> PivotTableConfig {
            PivotTableConfig {
                schema_version: PIVOT_CONFIG_SCHEMA_VERSION,
                id: "prop_filter".to_string(),
                name: "Prop Filter".to_string(),
                source_sheet_id: None,
                source_sheet_name: "sheet1".to_string(),
                source_range: CellRange::new(0, 0, (data.len() - 1) as u32, 2),
                output_sheet_name: "sheet1".to_string(),
                output_location: OutputLocation { row: 0, col: 0 },
                fields: fields.clone(),
                placements: vec![
                    make_placement("category", PivotFieldArea::Row, 0, None),
                    make_placement(
                        "amount",
                        PivotFieldArea::Value,
                        0,
                        Some(AggregateFunction::Sum),
                    ),
                ],
                filters,
                layout: None,
                style: None,
                data_options: None,
                created_at: None,
                updated_at: None,
                calculated_fields: None,
                allow_multiple_filters_per_field: None,
                auto_format: None,
                preserve_formatting: None,
                data_on_rows: None,
                cache_id: None,
                ref_range: None,
                first_data_row: None,
                first_header_row: None,
                first_data_col: None,
                rows_per_page: None,
                cols_per_page: None,
                row_items: Vec::new(),
                col_items: Vec::new(),
            }
        };

        // Apply filter once
        let config_once = make_config(vec![filter.clone()]);
        let result_once = compute(&config_once, &data, Some(&expand_all()));

        // Apply the same filter twice (stacked)
        let config_twice = make_config(vec![filter.clone(), filter.clone()]);
        let result_twice = compute(&config_twice, &data, Some(&expand_all()));

        assert!(
            result_once.errors.is_none(),
            "seed {}: once errors {:?}",
            seed,
            result_once.errors
        );
        assert!(
            result_twice.errors.is_none(),
            "seed {}: twice errors {:?}",
            seed,
            result_twice.errors
        );

        // Same rows
        assert_eq!(
            result_once.rows.len(),
            result_twice.rows.len(),
            "seed {}: filter idempotence: row count differs: once={}, twice={}",
            seed,
            result_once.rows.len(),
            result_twice.rows.len()
        );

        let keys_once: Vec<&str> = result_once.rows.iter().map(|r| r.key.as_str()).collect();
        let keys_twice: Vec<&str> = result_twice.rows.iter().map(|r| r.key.as_str()).collect();
        assert_eq!(
            keys_once, keys_twice,
            "seed {}: filter idempotence: row keys differ",
            seed
        );

        // Same values
        for (r1, r2) in result_once.rows.iter().zip(result_twice.rows.iter()) {
            assert_eq!(
                r1.values, r2.values,
                "seed {}: filter idempotence: values differ for row '{}'",
                seed, r1.key
            );
        }
    }
}
