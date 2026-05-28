use super::calculate_data_table;
use rustc_hash::FxHashMap;

use cell_types::CellId;
use value_types::{CellError, CellValue, FiniteF64};

/// Helper: create a CellId from a raw u128 value.
fn cell(n: u128) -> CellId {
    CellId::from_raw(n)
}

/// Simple evaluator that returns the sum of override values as numbers.
fn sum_evaluator(overrides: &FxHashMap<CellId, CellValue>) -> CellValue {
    let mut total = 0.0;
    for value in overrides.values() {
        match value.coerce_to_number() {
            Ok(n) => total += n,
            Err(e) => return CellValue::Error(e, None),
        }
    }
    CellValue::number(total)
}

/// Evaluator that doubles the first override value.
fn double_evaluator(overrides: &FxHashMap<CellId, CellValue>) -> CellValue {
    if let Some(value) = overrides.values().next() {
        match value.coerce_to_number() {
            Ok(n) => return CellValue::number(n * 2.0),
            Err(e) => return CellValue::Error(e, None),
        }
    }
    CellValue::Number(FiniteF64::must(0.0))
}

// -----------------------------------------------------------------------
// 1. test_one_var_row -- single row input, 5 values
// -----------------------------------------------------------------------
#[test]
fn test_one_var_row() {
    let row_input = Some(cell(1));
    let col_input = None;
    let row_values: Vec<CellValue> = (1..=5)
        .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
        .collect();
    let col_values: Vec<CellValue> = vec![];

    let result = calculate_data_table(
        row_input,
        col_input,
        &row_values,
        &col_values,
        double_evaluator,
    );

    assert_eq!(result.results.len(), 5);
    assert_eq!(result.cell_count, 5);
    assert!(!result.cancelled);

    // Each result should be double the input
    for (i, row) in result.results.iter().enumerate() {
        assert_eq!(row.len(), 1);
        assert_eq!(
            row[0],
            CellValue::Number(FiniteF64::must((i as f64 + 1.0) * 2.0))
        );
    }
}

// -----------------------------------------------------------------------
// 2. test_one_var_col -- single column input, 5 values
// -----------------------------------------------------------------------
#[test]
fn test_one_var_col() {
    let row_input = None;
    let col_input = Some(cell(2));
    let row_values: Vec<CellValue> = vec![];
    let col_values: Vec<CellValue> = (10..=14)
        .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
        .collect();

    let result = calculate_data_table(
        row_input,
        col_input,
        &row_values,
        &col_values,
        double_evaluator,
    );

    assert_eq!(result.results.len(), 1);
    assert_eq!(result.results[0].len(), 5);
    assert_eq!(result.cell_count, 5);

    for (i, val) in result.results[0].iter().enumerate() {
        assert_eq!(
            *val,
            CellValue::Number(FiniteF64::must((10 + i) as f64 * 2.0))
        );
    }
}

// -----------------------------------------------------------------------
// 3. test_two_var -- row + column inputs, 3x4 grid
// -----------------------------------------------------------------------
#[test]
fn test_two_var() {
    let row_input = Some(cell(1));
    let col_input = Some(cell(2));
    let row_values: Vec<CellValue> = (1..=3)
        .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
        .collect();
    let col_values: Vec<CellValue> = (10..=13)
        .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
        .collect();

    let result = calculate_data_table(
        row_input,
        col_input,
        &row_values,
        &col_values,
        sum_evaluator,
    );

    assert_eq!(result.results.len(), 3);
    for row in &result.results {
        assert_eq!(row.len(), 4);
    }
    assert_eq!(result.cell_count, 12);

    // In a two-var table, row_input gets row_values[r] and col_input gets col_values[c].
    // With sum_evaluator: result[r][c] = row_values[r] + col_values[c]
    assert_eq!(
        result.results[0][0],
        CellValue::Number(FiniteF64::must(11.0))
    ); // 10 + 1
    assert_eq!(
        result.results[0][3],
        CellValue::Number(FiniteF64::must(14.0))
    ); // 13 + 1
    assert_eq!(
        result.results[2][0],
        CellValue::Number(FiniteF64::must(13.0))
    ); // 10 + 3
    assert_eq!(
        result.results[2][3],
        CellValue::Number(FiniteF64::must(16.0))
    ); // 13 + 3
}

// -----------------------------------------------------------------------
// 4. test_empty_row_values -- no row values -> empty results
// -----------------------------------------------------------------------
#[test]
fn test_empty_row_values() {
    let row_input = Some(cell(1));
    let col_input = None;
    let row_values: Vec<CellValue> = vec![];
    let col_values: Vec<CellValue> = vec![];

    let result = calculate_data_table(
        row_input,
        col_input,
        &row_values,
        &col_values,
        double_evaluator,
    );

    assert_eq!(result.results.len(), 0);
    assert_eq!(result.cell_count, 0);
}

// -----------------------------------------------------------------------
// 5. test_empty_col_values -- no col values -> empty results
// -----------------------------------------------------------------------
#[test]
fn test_empty_col_values() {
    let row_input = None;
    let col_input = Some(cell(2));
    let row_values: Vec<CellValue> = vec![];
    let col_values: Vec<CellValue> = vec![];

    let result = calculate_data_table(
        row_input,
        col_input,
        &row_values,
        &col_values,
        double_evaluator,
    );

    assert_eq!(result.results.len(), 1);
    assert_eq!(result.results[0].len(), 0);
    assert_eq!(result.cell_count, 0);
}

// -----------------------------------------------------------------------
// 6. test_no_input_cells -- neither input specified -> empty results
// -----------------------------------------------------------------------
#[test]
fn test_no_input_cells() {
    let row_values: Vec<CellValue> = vec![CellValue::Number(FiniteF64::must(1.0))];
    let col_values: Vec<CellValue> = vec![CellValue::Number(FiniteF64::must(2.0))];

    let result = calculate_data_table(None, None, &row_values, &col_values, double_evaluator);

    assert_eq!(result.results.len(), 0);
    assert_eq!(result.cell_count, 0);
}

// -----------------------------------------------------------------------
// 7. test_single_value -- one row value, one result
// -----------------------------------------------------------------------
#[test]
fn test_single_value() {
    let row_input = Some(cell(1));
    let row_values = vec![CellValue::Number(FiniteF64::must(42.0))];

    let result = calculate_data_table(row_input, None, &row_values, &[], double_evaluator);

    assert_eq!(result.results.len(), 1);
    assert_eq!(result.results[0].len(), 1);
    assert_eq!(
        result.results[0][0],
        CellValue::Number(FiniteF64::must(84.0))
    );
    assert_eq!(result.cell_count, 1);
}

// -----------------------------------------------------------------------
// 8. test_result_dimensions -- verify results grid dimensions match inputs
// -----------------------------------------------------------------------
#[test]
fn test_result_dimensions() {
    // One-variable row: N rows, 1 column each
    let row_values: Vec<CellValue> = (0..7)
        .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
        .collect();
    let result = calculate_data_table(Some(cell(1)), None, &row_values, &[], double_evaluator);
    assert_eq!(result.results.len(), 7);
    for row in &result.results {
        assert_eq!(row.len(), 1);
    }

    // One-variable col: 1 row, N columns
    let col_values: Vec<CellValue> = (0..4)
        .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
        .collect();
    let result = calculate_data_table(None, Some(cell(2)), &[], &col_values, double_evaluator);
    assert_eq!(result.results.len(), 1);
    assert_eq!(result.results[0].len(), 4);

    // Two-variable: R rows x C columns
    let row_values: Vec<CellValue> = (0..5)
        .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
        .collect();
    let col_values: Vec<CellValue> = (0..3)
        .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
        .collect();
    let result = calculate_data_table(
        Some(cell(1)),
        Some(cell(2)),
        &row_values,
        &col_values,
        sum_evaluator,
    );
    assert_eq!(result.results.len(), 5);
    for row in &result.results {
        assert_eq!(row.len(), 3);
    }
}

// -----------------------------------------------------------------------
// 9. test_formula_returning_text -- formula produces text values
// -----------------------------------------------------------------------
#[test]
fn test_formula_returning_text() {
    let text_evaluator = |overrides: &FxHashMap<CellId, CellValue>| -> CellValue {
        if let Some(value) = overrides.values().next() {
            return CellValue::Text(format!("Result: {}", value).into());
        }
        CellValue::Text("empty".into())
    };

    let row_input = Some(cell(1));
    let row_values = vec![
        CellValue::Number(FiniteF64::must(1.0)),
        CellValue::Text("hello".into()),
    ];

    let result = calculate_data_table(row_input, None, &row_values, &[], text_evaluator);

    assert_eq!(result.results.len(), 2);
    assert!(matches!(result.results[0][0], CellValue::Text(_)));
    assert!(matches!(result.results[1][0], CellValue::Text(_)));
}

// -----------------------------------------------------------------------
// 10. test_formula_returning_error -- formula produces error values
// -----------------------------------------------------------------------
#[test]
fn test_formula_returning_error() {
    let error_evaluator = |_overrides: &FxHashMap<CellId, CellValue>| -> CellValue {
        CellValue::Error(CellError::Div0, None)
    };

    let row_input = Some(cell(1));
    let row_values = vec![
        CellValue::Number(FiniteF64::must(1.0)),
        CellValue::Number(FiniteF64::must(2.0)),
    ];

    let result = calculate_data_table(row_input, None, &row_values, &[], error_evaluator);

    assert_eq!(result.results.len(), 2);
    assert_eq!(
        result.results[0][0],
        CellValue::Error(CellError::Div0, None)
    );
    assert_eq!(
        result.results[1][0],
        CellValue::Error(CellError::Div0, None)
    );
    assert_eq!(result.cell_count, 2);
}

// -----------------------------------------------------------------------
// 11. test_override_applied -- verify override actually changes result
// -----------------------------------------------------------------------
#[test]
fn test_override_applied() {
    let input_cell = cell(100);

    // Evaluator that checks the override map and returns the overridden value
    let identity_evaluator = |overrides: &FxHashMap<CellId, CellValue>| -> CellValue {
        overrides
            .get(&cell(100))
            .cloned()
            .unwrap_or(CellValue::Null)
    };

    let row_values = vec![
        CellValue::Number(FiniteF64::must(10.0)),
        CellValue::Number(FiniteF64::must(20.0)),
        CellValue::Number(FiniteF64::must(30.0)),
    ];

    let result = calculate_data_table(Some(input_cell), None, &row_values, &[], identity_evaluator);

    assert_eq!(
        result.results[0][0],
        CellValue::Number(FiniteF64::must(10.0))
    );
    assert_eq!(
        result.results[1][0],
        CellValue::Number(FiniteF64::must(20.0))
    );
    assert_eq!(
        result.results[2][0],
        CellValue::Number(FiniteF64::must(30.0))
    );
}

// -----------------------------------------------------------------------
// 12. test_two_var_override_both -- verify both overrides applied simultaneously
// -----------------------------------------------------------------------
#[test]
fn test_two_var_override_both() {
    let row_cell = cell(1);
    let col_cell = cell(2);

    // Evaluator that verifies both overrides are present and returns their product
    let verify_both_evaluator = |overrides: &FxHashMap<CellId, CellValue>| -> CellValue {
        let row_val = overrides.get(&cell(1));
        let col_val = overrides.get(&cell(2));
        match (row_val, col_val) {
            (Some(r), Some(c)) => {
                let rn = r.coerce_to_number().unwrap_or(0.0);
                let cn = c.coerce_to_number().unwrap_or(0.0);
                CellValue::number(rn * cn)
            }
            _ => CellValue::Error(CellError::Value, None),
        }
    };

    let row_values = vec![
        CellValue::Number(FiniteF64::must(2.0)),
        CellValue::Number(FiniteF64::must(3.0)),
    ];
    let col_values = vec![
        CellValue::Number(FiniteF64::must(5.0)),
        CellValue::Number(FiniteF64::must(7.0)),
    ];

    let result = calculate_data_table(
        Some(row_cell),
        Some(col_cell),
        &row_values,
        &col_values,
        verify_both_evaluator,
    );

    assert_eq!(
        result.results[0][0],
        CellValue::Number(FiniteF64::must(10.0))
    ); // 2 * 5
    assert_eq!(
        result.results[0][1],
        CellValue::Number(FiniteF64::must(14.0))
    ); // 2 * 7
    assert_eq!(
        result.results[1][0],
        CellValue::Number(FiniteF64::must(15.0))
    ); // 3 * 5
    assert_eq!(
        result.results[1][1],
        CellValue::Number(FiniteF64::must(21.0))
    ); // 3 * 7
}

// -----------------------------------------------------------------------
// 13. test_cell_count -- verify cell_count matches total cells computed
// -----------------------------------------------------------------------
#[test]
fn test_cell_count() {
    // One-var row: 5 cells
    let result = calculate_data_table(
        Some(cell(1)),
        None,
        &(0..5)
            .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
            .collect::<Vec<_>>(),
        &[],
        double_evaluator,
    );
    assert_eq!(result.cell_count, 5);

    // One-var col: 8 cells
    let result = calculate_data_table(
        None,
        Some(cell(2)),
        &[],
        &(0..8)
            .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
            .collect::<Vec<_>>(),
        double_evaluator,
    );
    assert_eq!(result.cell_count, 8);

    // Two-var: 4 * 6 = 24 cells
    let result = calculate_data_table(
        Some(cell(1)),
        Some(cell(2)),
        &(0..4)
            .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
            .collect::<Vec<_>>(),
        &(0..6)
            .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
            .collect::<Vec<_>>(),
        sum_evaluator,
    );
    assert_eq!(result.cell_count, 24);
}

// -----------------------------------------------------------------------
// 14. test_large_table -- 100x100 two-variable table
// -----------------------------------------------------------------------
#[test]
fn test_large_table() {
    let row_values: Vec<CellValue> = (0..100)
        .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
        .collect();
    let col_values: Vec<CellValue> = (0..100)
        .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
        .collect();

    let result = calculate_data_table(
        Some(cell(1)),
        Some(cell(2)),
        &row_values,
        &col_values,
        sum_evaluator,
    );

    assert_eq!(result.results.len(), 100);
    assert_eq!(result.results[0].len(), 100);
    assert_eq!(result.cell_count, 10_000);
    assert!(!result.cancelled);

    // Spot check a few values
    assert_eq!(
        result.results[0][0],
        CellValue::Number(FiniteF64::must(0.0))
    ); // 0 + 0
    assert_eq!(
        result.results[99][99],
        CellValue::Number(FiniteF64::must(198.0))
    ); // 99 + 99
    assert_eq!(
        result.results[50][25],
        CellValue::Number(FiniteF64::must(75.0))
    ); // 50 + 25
}

// -----------------------------------------------------------------------
// 15. test_boolean_input_values -- boolean input values work
// -----------------------------------------------------------------------
#[test]
fn test_boolean_input_values() {
    let row_input = Some(cell(1));
    let row_values = vec![CellValue::Boolean(true), CellValue::Boolean(false)];

    // Evaluator that coerces boolean to number (TRUE=1, FALSE=0) and doubles it
    let result = calculate_data_table(row_input, None, &row_values, &[], double_evaluator);

    assert_eq!(result.results.len(), 2);
    // TRUE coerced to 1.0, doubled = 2.0
    assert_eq!(
        result.results[0][0],
        CellValue::Number(FiniteF64::must(2.0))
    );
    // FALSE coerced to 0.0, doubled = 0.0
    assert_eq!(
        result.results[1][0],
        CellValue::Number(FiniteF64::must(0.0))
    );
}

// -----------------------------------------------------------------------
// 16. test_null_input_values -- Null input values work
// -----------------------------------------------------------------------
#[test]
fn test_null_input_values() {
    let row_input = Some(cell(1));
    let row_values = vec![CellValue::Null];

    let result = calculate_data_table(row_input, None, &row_values, &[], double_evaluator);

    assert_eq!(result.results.len(), 1);
    // Null coerced to 0.0, doubled = 0.0
    assert_eq!(
        result.results[0][0],
        CellValue::Number(FiniteF64::must(0.0))
    );
    assert_eq!(result.cell_count, 1);
}

// -----------------------------------------------------------------------
// 17. test_cancelled_is_always_false -- synchronous implementation
// -----------------------------------------------------------------------
#[test]
fn test_cancelled_is_always_false() {
    let result = calculate_data_table(
        Some(cell(1)),
        None,
        &[CellValue::Number(FiniteF64::must(1.0))],
        &[],
        double_evaluator,
    );
    assert!(!result.cancelled);

    let result = calculate_data_table(None, None, &[], &[], double_evaluator);
    assert!(!result.cancelled);
}

// -----------------------------------------------------------------------
// 18. test_mixed_value_types -- different CellValue types in row values
// -----------------------------------------------------------------------
#[test]
fn test_mixed_value_types() {
    let identity_evaluator = |overrides: &FxHashMap<CellId, CellValue>| -> CellValue {
        overrides.get(&cell(1)).cloned().unwrap_or(CellValue::Null)
    };

    let row_input = Some(cell(1));
    let row_values = vec![
        CellValue::Number(FiniteF64::must(42.0)),
        CellValue::Text("hello".into()),
        CellValue::Boolean(true),
        CellValue::Null,
        CellValue::Error(CellError::Na, None),
    ];

    let result = calculate_data_table(row_input, None, &row_values, &[], identity_evaluator);

    assert_eq!(result.results.len(), 5);
    assert_eq!(
        result.results[0][0],
        CellValue::Number(FiniteF64::must(42.0))
    );
    assert_eq!(result.results[1][0], CellValue::Text("hello".into()));
    assert_eq!(result.results[2][0], CellValue::Boolean(true));
    assert_eq!(result.results[3][0], CellValue::Null);
    assert_eq!(result.results[4][0], CellValue::Error(CellError::Na, None));
    assert_eq!(result.cell_count, 5);
}
