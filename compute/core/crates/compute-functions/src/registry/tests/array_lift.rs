use super::*;

#[test]
fn test_registry_scalar_pure_functions_auto_lifted() {
    let reg = FunctionRegistry::new();
    // Scalar PureFunctions (is_scalar_arg → true) ARE auto-lifted.
    // ABS({-1;-2;-3}) produces {1;2;3} via element-wise lifting.
    let arr = CellValue::from_rows(vec![
        vec![CellValue::number(-1.0)],
        vec![CellValue::number(-2.0)],
        vec![CellValue::number(-3.0)],
    ]);
    let result = reg.call("ABS", &[arr]);
    let expected = CellValue::from_rows(vec![
        vec![CellValue::number(1.0)],
        vec![CellValue::number(2.0)],
        vec![CellValue::number(3.0)],
    ]);
    assert_eq!(result, expected);
}

#[test]
fn test_registry_large_not_broken_by_lifting() {
    let reg = FunctionRegistry::new();
    // LARGE({100, 200, 300}, 1) should return 300 (not auto-lift)
    let arr = CellValue::from_rows(vec![
        vec![CellValue::number(100.0)],
        vec![CellValue::number(200.0)],
        vec![CellValue::number(300.0)],
    ]);
    let result = reg.call("LARGE", &[arr, CellValue::number(1.0)]);
    assert_eq!(result, CellValue::number(300.0));
}

#[test]
fn test_registry_preserves_range_args() {
    let reg = FunctionRegistry::new();
    // COUNTIF(range, criteria) — Range-role arg should NOT be auto-lifted.
    // COUNTIF({1;2;3;2}, 2) should count how many 2s are in the range => 2
    let arr = CellValue::from_rows(vec![
        vec![CellValue::number(1.0)],
        vec![CellValue::number(2.0)],
        vec![CellValue::number(3.0)],
        vec![CellValue::number(2.0)],
    ]);
    let result = reg.call("COUNTIF", &[arr, CellValue::number(2.0)]);
    assert_eq!(result, CellValue::number(2.0));
}

#[test]
fn test_registry_isnumber_auto_lifted() {
    let reg = FunctionRegistry::new();
    // ISNUMBER({1;"text";3}) -> {TRUE;FALSE;TRUE}
    let arr = CellValue::from_rows(vec![
        vec![CellValue::number(1.0)],
        vec![CellValue::Text("text".into())],
        vec![CellValue::number(3.0)],
    ]);
    let result = reg.call("ISNUMBER", &[arr]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 3);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::Boolean(true));
            assert_eq!(*arr.get(1, 0).unwrap(), CellValue::Boolean(false));
            assert_eq!(*arr.get(2, 0).unwrap(), CellValue::Boolean(true));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_registry_search_auto_lifted() {
    let reg = FunctionRegistry::new();
    // SEARCH("fox", {"the fox";"no cat";"a fox ran"}) -> {5;#VALUE!;3}
    let arr = CellValue::from_rows(vec![
        vec![CellValue::Text("the fox".into())],
        vec![CellValue::Text("no cat".into())],
        vec![CellValue::Text("a fox ran".into())],
    ]);
    let result = reg.call("SEARCH", &[CellValue::Text("fox".into()), arr]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 3);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::number(5.0));
            assert_eq!(
                *arr.get(1, 0).unwrap(),
                CellValue::Error(CellError::Value, None)
            );
            assert_eq!(*arr.get(2, 0).unwrap(), CellValue::number(3.0));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_registry_no_lift_for_array_returning_functions() {
    let reg = FunctionRegistry::new();
    // Verify that returns_array() is correct for key functions
    assert!(reg.returns_array("SORT"));
    assert!(reg.returns_array("FILTER"));
    assert!(reg.returns_array("UNIQUE"));
    assert!(!reg.returns_array("ABS"));
    assert!(!reg.returns_array("ISNUMBER"));
}

#[test]
fn test_text_array_lift_1000_elements() {
    let reg = FunctionRegistry::new();
    let n = 1000;
    let numbers: Vec<Vec<CellValue>> = (0..n).map(|i| vec![CellValue::number(i as f64)]).collect();
    let arr = CellValue::from_rows(numbers);
    let format_arg = CellValue::Text("@".into());

    let result = reg.call("TEXT", &[arr, format_arg]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), n);
            assert_eq!(arr.cols(), 1);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::Text("0".into()));
            assert_eq!(*arr.get(42, 0).unwrap(), CellValue::Text("42".into()));
            assert_eq!(*arr.get(999, 0).unwrap(), CellValue::Text("999".into()));
            for i in 0..n {
                match arr.get(i, 0).unwrap() {
                    CellValue::Text(_) => {}
                    other => panic!("Element {} expected Text, got {:?}", i, other),
                }
            }
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

// =================================================================
// EDGE-CASE TESTS: Excel function dispatch semantics from first
// principles. Tests grouped by Excel behavioral contract.
// =================================================================

// -----------------------------------------------------------------
// Argument count validation
// -----------------------------------------------------------------

#[test]
fn test_abs_array_lift_1d() {
    let reg = FunctionRegistry::new();
    let arr = CellValue::array(
        vec![
            CellValue::number(-1.0),
            CellValue::number(-2.0),
            CellValue::number(-3.0),
        ],
        3,
    );
    let result = reg.call("ABS", &[arr]);
    let expected = CellValue::array(
        vec![
            CellValue::number(1.0),
            CellValue::number(2.0),
            CellValue::number(3.0),
        ],
        3,
    );
    assert_eq!(result, expected);
}

#[test]
fn test_abs_array_lift_2d_preserves_shape() {
    let reg = FunctionRegistry::new();
    let arr = CellValue::from_rows(vec![
        vec![CellValue::number(-1.0), CellValue::number(-2.0)],
        vec![CellValue::number(-3.0), CellValue::number(-4.0)],
    ]);
    let result = reg.call("ABS", &[arr]);
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 2);
            assert_eq!(a.cols(), 2);
            assert_eq!(*a.get(0, 0).unwrap(), CellValue::number(1.0));
            assert_eq!(*a.get(0, 1).unwrap(), CellValue::number(2.0));
            assert_eq!(*a.get(1, 0).unwrap(), CellValue::number(3.0));
            assert_eq!(*a.get(1, 1).unwrap(), CellValue::number(4.0));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_round_first_arg_array_lifted() {
    let reg = FunctionRegistry::new();
    let arr = CellValue::from_rows(vec![
        vec![CellValue::number(1.5)],
        vec![CellValue::number(2.5)],
        vec![CellValue::number(3.5)],
    ]);
    let result = reg.call("ROUND", &[arr, CellValue::number(0.0)]);
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 3);
            // Each element should be a rounded number
            for r in 0..3 {
                assert!(
                    matches!(a.get(r, 0).unwrap(), CellValue::Number(_)),
                    "Row {} expected Number, got {:?}",
                    r,
                    a.get(r, 0).unwrap()
                );
            }
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_text_first_arg_lifted_second_stays() {
    let reg = FunctionRegistry::new();
    let arr = CellValue::from_rows(vec![
        vec![CellValue::number(1.0)],
        vec![CellValue::number(2.0)],
        vec![CellValue::number(3.0)],
    ]);
    let result = reg.call("TEXT", &[arr, CellValue::Text("0.00".into())]);
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 3);
            assert_eq!(*a.get(0, 0).unwrap(), CellValue::Text("1.00".into()));
            assert_eq!(*a.get(1, 0).unwrap(), CellValue::Text("2.00".into()));
            assert_eq!(*a.get(2, 0).unwrap(), CellValue::Text("3.00".into()));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_aggregate_does_not_auto_lift() {
    let reg = FunctionRegistry::new();
    // SUMSQ({1,4,9}) = 1+16+81 = 98 -- processes array as aggregate
    let arr = CellValue::from_rows(vec![
        vec![CellValue::number(1.0)],
        vec![CellValue::number(4.0)],
        vec![CellValue::number(9.0)],
    ]);
    assert_eq!(reg.call("SUMSQ", &[arr]), CellValue::number(98.0));
}

#[test]
fn test_countif_range_not_auto_lifted() {
    let reg = FunctionRegistry::new();
    let arr = CellValue::from_rows(vec![
        vec![CellValue::number(1.0)],
        vec![CellValue::number(2.0)],
        vec![CellValue::number(3.0)],
        vec![CellValue::number(2.0)],
        vec![CellValue::number(2.0)],
    ]);
    assert_eq!(
        reg.call("COUNTIF", &[arr, CellValue::number(2.0)]),
        CellValue::number(3.0)
    );
}

#[test]
fn test_sign_array_lift() {
    let reg = FunctionRegistry::new();
    let arr = CellValue::array(
        vec![
            CellValue::number(-5.0),
            CellValue::number(0.0),
            CellValue::number(7.0),
        ],
        3,
    );
    let expected = CellValue::array(
        vec![
            CellValue::number(-1.0),
            CellValue::number(0.0),
            CellValue::number(1.0),
        ],
        3,
    );
    assert_eq!(reg.call("SIGN", &[arr]), expected);
}

#[test]
fn test_len_array_lift() {
    let reg = FunctionRegistry::new();
    let arr = CellValue::from_rows(vec![
        vec![CellValue::Text("hi".into())],
        vec![CellValue::Text("hello".into())],
        vec![CellValue::Text("x".into())],
    ]);
    let result = reg.call("LEN", &[arr]);
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 3);
            assert_eq!(*a.get(0, 0).unwrap(), CellValue::number(2.0));
            assert_eq!(*a.get(1, 0).unwrap(), CellValue::number(5.0));
            assert_eq!(*a.get(2, 0).unwrap(), CellValue::number(1.0));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_mod_first_arg_array_lifted() {
    let reg = FunctionRegistry::new();
    let arr = CellValue::array(
        vec![
            CellValue::number(10.0),
            CellValue::number(11.0),
            CellValue::number(12.0),
        ],
        3,
    );
    let expected = CellValue::array(
        vec![
            CellValue::number(1.0),
            CellValue::number(2.0),
            CellValue::number(0.0),
        ],
        3,
    );
    assert_eq!(reg.call("MOD", &[arr, CellValue::number(3.0)]), expected);
}

#[test]
fn test_abs_array_lift_with_error_element() {
    let reg = FunctionRegistry::new();
    // ABS({-1, #DIV/0!, 3}) -- error element should produce error in that position
    let arr = CellValue::array(
        vec![
            CellValue::number(-1.0),
            CellValue::Error(CellError::Div0, None),
            CellValue::number(3.0),
        ],
        3,
    );
    let result = reg.call("ABS", &[arr]);
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.len(), 3);
            assert_eq!(*a.get(0, 0).unwrap(), CellValue::number(1.0));
            assert_eq!(
                *a.get(0, 1).unwrap(),
                CellValue::Error(CellError::Div0, None)
            );
            assert_eq!(*a.get(0, 2).unwrap(), CellValue::number(3.0));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_abs_3x3_array_preserves_shape() {
    let reg = FunctionRegistry::new();
    let arr = CellValue::from_rows(vec![
        vec![
            CellValue::number(-1.0),
            CellValue::number(-2.0),
            CellValue::number(-3.0),
        ],
        vec![
            CellValue::number(-4.0),
            CellValue::number(-5.0),
            CellValue::number(-6.0),
        ],
        vec![
            CellValue::number(-7.0),
            CellValue::number(-8.0),
            CellValue::number(-9.0),
        ],
    ]);
    let result = reg.call("ABS", &[arr]);
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 3);
            assert_eq!(a.cols(), 3);
            for r in 0..3 {
                for c in 0..3 {
                    let expected = (r * 3 + c + 1) as f64;
                    assert_eq!(
                        *a.get(r, c).unwrap(),
                        CellValue::number(expected),
                        "Mismatch at ({}, {})",
                        r,
                        c
                    );
                }
            }
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

// -----------------------------------------------------------------
// Default arguments
// -----------------------------------------------------------------

#[test]
fn test_sort_does_not_auto_lift() {
    let reg = FunctionRegistry::new();
    let arr = CellValue::from_rows(vec![
        vec![CellValue::number(3.0)],
        vec![CellValue::number(1.0)],
        vec![CellValue::number(2.0)],
    ]);
    let result = reg.call("SORT", &[arr]);
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 3);
            assert_eq!(*a.get(0, 0).unwrap(), CellValue::number(1.0));
            assert_eq!(*a.get(1, 0).unwrap(), CellValue::number(2.0));
            assert_eq!(*a.get(2, 0).unwrap(), CellValue::number(3.0));
        }
        other => panic!("Expected sorted Array, got {:?}", other),
    }
}

// -----------------------------------------------------------------
// Case-insensitive lookup edge cases
// -----------------------------------------------------------------

#[test]
fn test_date_multi_array_broadcast_column() {
    // DATE({2024;2024;2024}, {1;2;3}, 1) should produce element-wise results,
    // NOT a cross-product / nested array.
    let reg = FunctionRegistry::new();
    let years = CellValue::from_rows(vec![
        vec![CellValue::number(2024.0)],
        vec![CellValue::number(2024.0)],
        vec![CellValue::number(2024.0)],
    ]);
    let months = CellValue::from_rows(vec![
        vec![CellValue::number(1.0)],
        vec![CellValue::number(2.0)],
        vec![CellValue::number(3.0)],
    ]);
    let result = reg.call("DATE", &[years, months, CellValue::number(1.0)]);
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 3, "Expected 3 rows, got {}", a.rows());
            assert_eq!(a.cols(), 1, "Expected 1 col, got {}", a.cols());
            // All results should be flat Number values, not nested arrays
            for r in 0..3 {
                assert!(
                    matches!(a.get(r, 0).unwrap(), CellValue::Number(_)),
                    "Row {} expected Number, got {:?}",
                    r,
                    a.get(r, 0).unwrap()
                );
            }
            // Each row's date serial should be different (Jan, Feb, Mar 2024)
            let v0 = a.get(0, 0).unwrap().coerce_to_number().unwrap();
            let v1 = a.get(1, 0).unwrap().coerce_to_number().unwrap();
            let v2 = a.get(2, 0).unwrap().coerce_to_number().unwrap();
            assert!(
                v0 < v1 && v1 < v2,
                "Dates should be ascending: {} < {} < {}",
                v0,
                v1,
                v2
            );
            // Jan-Feb difference should be 31 days
            assert_eq!(v1 - v0, 31.0);
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_date_multi_array_broadcast_row() {
    // DATE({2024, 2025}, {6, 12}, {1, 15}) — 1×2 row arrays
    let reg = FunctionRegistry::new();
    let years = CellValue::array(
        vec![CellValue::number(2024.0), CellValue::number(2025.0)],
        2,
    );
    let months = CellValue::array(vec![CellValue::number(6.0), CellValue::number(12.0)], 2);
    let days = CellValue::array(vec![CellValue::number(1.0), CellValue::number(15.0)], 2);
    let result = reg.call("DATE", &[years, months, days]);
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 1);
            assert_eq!(a.cols(), 2);
            // Both elements should be flat numbers
            assert!(matches!(a.get(0, 0).unwrap(), CellValue::Number(_)));
            assert!(matches!(a.get(0, 1).unwrap(), CellValue::Number(_)));
            // Second date (2025-12-15) should be after first (2024-06-01)
            let v0 = a.get(0, 0).unwrap().coerce_to_number().unwrap();
            let v1 = a.get(0, 1).unwrap().coerce_to_number().unwrap();
            assert!(v1 > v0);
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_date_mixed_array_scalar_broadcast() {
    // DATE(2024, {1;2;3}, 1) — scalar year, array months, scalar day
    // This tests the single-array fast path still works
    let reg = FunctionRegistry::new();
    let months = CellValue::from_rows(vec![
        vec![CellValue::number(1.0)],
        vec![CellValue::number(2.0)],
        vec![CellValue::number(3.0)],
    ]);
    let result = reg.call(
        "DATE",
        &[CellValue::number(2024.0), months, CellValue::number(1.0)],
    );
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 3);
            assert_eq!(a.cols(), 1);
            let v0 = a.get(0, 0).unwrap().coerce_to_number().unwrap();
            let v1 = a.get(1, 0).unwrap().coerce_to_number().unwrap();
            let v2 = a.get(2, 0).unwrap().coerce_to_number().unwrap();
            assert_eq!(v1 - v0, 31.0); // Jan→Feb = 31 days
            assert!(v2 > v1);
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_multi_array_dimension_mismatch_returns_error() {
    // DATE({2024;2025}, {1;2;3}, 1) — 2-row vs 3-row → #VALUE!
    let reg = FunctionRegistry::new();
    let years = CellValue::from_rows(vec![
        vec![CellValue::number(2024.0)],
        vec![CellValue::number(2025.0)],
    ]);
    let months = CellValue::from_rows(vec![
        vec![CellValue::number(1.0)],
        vec![CellValue::number(2.0)],
        vec![CellValue::number(3.0)],
    ]);
    let result = reg.call("DATE", &[years, months, CellValue::number(1.0)]);
    assert_eq!(result, CellValue::Error(CellError::Value, None));
}

#[test]
fn test_multi_array_broadcast_scalar_dimension() {
    // DATE({2024}, {1;2;3}, 1) — 1-row array broadcasts with 3-row array
    let reg = FunctionRegistry::new();
    let years = CellValue::from_rows(vec![vec![CellValue::number(2024.0)]]);
    let months = CellValue::from_rows(vec![
        vec![CellValue::number(1.0)],
        vec![CellValue::number(2.0)],
        vec![CellValue::number(3.0)],
    ]);
    let result = reg.call("DATE", &[years, months, CellValue::number(1.0)]);
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 3, "1-row should broadcast to 3 rows");
            assert_eq!(a.cols(), 1);
            for r in 0..3 {
                assert!(
                    matches!(a.get(r, 0).unwrap(), CellValue::Number(_)),
                    "Row {} expected Number, got {:?}",
                    r,
                    a.get(r, 0).unwrap()
                );
            }
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}
