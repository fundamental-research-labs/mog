//! Value coercion and flattening primitives.
//!
//! These helpers are used by virtually every function category to unwrap
//! arrays, extract numeric values, and propagate errors.

use value_types::{CellError, CellValue};

/// Flatten a CellValue (unwrapping arrays) into a Vec of scalar values.
pub fn flatten_values(vals: &[CellValue]) -> Vec<CellValue> {
    let mut flat = Vec::new();
    for v in vals {
        match v {
            CellValue::Array(arr) => {
                for cell in arr.iter() {
                    flat.push(cell.clone());
                }
            }
            other => flat.push(other.clone()),
        }
    }
    flat
}

/// Flatten a single CellValue into a Vec of references (zero-copy).
///
/// Unlike `flatten_values`, this avoids cloning every cell value — it returns
/// references into the existing Array. Use this for conditional aggregation
/// functions (COUNTIFS, SUMIFS, etc.) where the source arrays are large and
/// only need to be read, not modified.
pub fn flatten_values_ref(val: &CellValue) -> Vec<&CellValue> {
    match val {
        CellValue::Array(arr) => arr.iter().collect(),
        other => vec![other],
    }
}

/// Extract numbers from flattened values, skipping non-numeric.
/// Returns Err on first error value encountered.
pub fn extract_numbers(vals: &[CellValue]) -> Result<Vec<f64>, CellError> {
    let mut nums = Vec::new();
    for v in vals {
        match v {
            CellValue::Error(e, _) => return Err(*e),
            CellValue::Number(n) => nums.push(n.get()),
            CellValue::Boolean(b) => nums.push(if *b { 1.0 } else { 0.0 }),
            _ => {} // skip text, null
        }
    }
    Ok(nums)
}

/// Extract numbers from flattened values, only counting Number variants
/// (skip booleans, text, null). Returns Err on first error.
pub fn extract_numbers_strict(vals: &[CellValue]) -> Result<Vec<f64>, CellError> {
    let mut nums = Vec::new();
    for v in vals {
        match v {
            CellValue::Error(e, _) => return Err(*e),
            CellValue::Number(n) => nums.push(n.get()),
            _ => {}
        }
    }
    Ok(nums)
}

/// Check for error in an argument, returning it if found.
/// Preserves the diagnostic message via clone.
pub fn check_error(v: &CellValue) -> Option<CellValue> {
    if matches!(v, CellValue::Error(..)) {
        Some(v.clone())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // Helper constructors
    // -----------------------------------------------------------------------

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }

    fn text(s: &str) -> CellValue {
        CellValue::from(s)
    }

    fn bool_val(b: bool) -> CellValue {
        CellValue::Boolean(b)
    }

    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }

    fn array_2x2() -> CellValue {
        CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]])
    }

    /// Extract numbers from a flat CellValue slice for assertions.
    fn nums(vals: &[CellValue]) -> Vec<f64> {
        vals.iter()
            .filter_map(|v| match v {
                CellValue::Number(n) => Some(n.get()),
                _ => None,
            })
            .collect()
    }

    // =======================================================================
    // flatten_values
    // =======================================================================

    #[test]
    fn flatten_empty_input() {
        assert!(flatten_values(&[]).is_empty());
    }

    #[test]
    fn flatten_single_number() {
        let flat = flatten_values(&[num(42.0)]);
        assert_eq!(flat.len(), 1);
        assert_eq!(flat[0], num(42.0));
    }

    #[test]
    fn flatten_single_text() {
        let flat = flatten_values(&[text("hello")]);
        assert_eq!(flat.len(), 1);
        assert_eq!(flat[0], text("hello"));
    }

    #[test]
    fn flatten_single_boolean() {
        let flat = flatten_values(&[bool_val(true)]);
        assert_eq!(flat, vec![bool_val(true)]);
    }

    #[test]
    fn flatten_single_null() {
        let flat = flatten_values(&[CellValue::Null]);
        assert_eq!(flat, vec![CellValue::Null]);
    }

    #[test]
    fn flatten_single_error() {
        let flat = flatten_values(&[err(CellError::Na)]);
        assert_eq!(flat, vec![err(CellError::Na)]);
    }

    #[test]
    fn flatten_multiple_scalars_unchanged() {
        let vals = vec![num(1.0), text("a"), bool_val(false), CellValue::Null];
        let flat = flatten_values(&vals);
        assert_eq!(flat.len(), 4);
        assert_eq!(flat[0], num(1.0));
        assert_eq!(flat[1], text("a"));
        assert_eq!(flat[2], bool_val(false));
        assert_eq!(flat[3], CellValue::Null);
    }

    #[test]
    fn flatten_single_array() {
        let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
        let flat = flatten_values(&[arr]);
        assert_eq!(flat.len(), 4);
        // Row-major order: (0,0), (0,1), (1,0), (1,1)
        assert_eq!(nums(&flat), vec![1.0, 2.0, 3.0, 4.0]);
    }

    #[test]
    fn flatten_array_row_major_order() {
        // 3x2 array: verify exact row-major ordering
        let arr = CellValue::from_rows(vec![
            vec![num(10.0), num(20.0)],
            vec![num(30.0), num(40.0)],
            vec![num(50.0), num(60.0)],
        ]);
        let flat = flatten_values(&[arr]);
        assert_eq!(nums(&flat), vec![10.0, 20.0, 30.0, 40.0, 50.0, 60.0]);
    }

    #[test]
    fn flatten_mixed_scalars_and_arrays() {
        let vals = vec![
            num(0.0),
            CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]),
            num(5.0),
        ];
        let flat = flatten_values(&vals);
        assert_eq!(flat.len(), 6);
        assert_eq!(nums(&flat), vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0]);
    }

    #[test]
    fn flatten_preserves_order_with_multiple_arrays() {
        let vals = vec![
            CellValue::from_rows(vec![vec![num(1.0), num(2.0)]]),
            num(99.0),
            CellValue::from_rows(vec![vec![num(3.0), num(4.0)]]),
        ];
        let flat = flatten_values(&vals);
        assert_eq!(nums(&flat), vec![1.0, 2.0, 99.0, 3.0, 4.0]);
    }

    #[test]
    fn flatten_array_with_mixed_types() {
        // An array containing number, text, boolean, error, null
        let arr = CellValue::array(
            vec![
                num(1.0),
                text("hi"),
                bool_val(true),
                err(CellError::Div0),
                CellValue::Null,
            ],
            5,
        );
        let flat = flatten_values(&[arr]);
        assert_eq!(flat.len(), 5);
        assert_eq!(flat[0], num(1.0));
        assert_eq!(flat[1], text("hi"));
        assert_eq!(flat[2], bool_val(true));
        assert_eq!(flat[3], err(CellError::Div0));
        assert_eq!(flat[4], CellValue::Null);
    }

    #[test]
    fn flatten_single_column_array() {
        let arr = CellValue::column_array(vec![num(10.0), num(20.0), num(30.0)]);
        let flat = flatten_values(&[arr]);
        assert_eq!(nums(&flat), vec![10.0, 20.0, 30.0]);
    }

    #[test]
    fn flatten_single_row_array() {
        let arr = CellValue::row_array(vec![num(10.0), num(20.0), num(30.0)]);
        let flat = flatten_values(&[arr]);
        assert_eq!(nums(&flat), vec![10.0, 20.0, 30.0]);
    }

    #[test]
    fn flatten_nested_array_is_only_one_level() {
        // If an array element is itself an array, flatten_values only peels one
        // layer because it matches CellValue::Array at the top level of the slice.
        // The inner elements from iter() are scalars from CellArray — CellArray
        // stores CellValue which CAN be Array, but from_rows doesn't nest them.
        // This test documents the single-level behavior.
        let inner = CellValue::from_rows(vec![vec![num(1.0), num(2.0)]]);
        let outer = vec![inner.clone(), num(3.0)];
        let flat = flatten_values(&outer);
        assert_eq!(flat.len(), 3);
        assert_eq!(nums(&flat), vec![1.0, 2.0, 3.0]);
    }

    // =======================================================================
    // flatten_values_ref
    // =======================================================================

    #[test]
    fn flatten_ref_single_scalar() {
        let v = num(42.0);
        let refs = flatten_values_ref(&v);
        assert_eq!(refs.len(), 1);
        assert_eq!(*refs[0], num(42.0));
    }

    #[test]
    fn flatten_ref_null() {
        let v = CellValue::Null;
        let refs = flatten_values_ref(&v);
        assert_eq!(refs.len(), 1);
        assert_eq!(*refs[0], CellValue::Null);
    }

    #[test]
    fn flatten_ref_boolean() {
        let v = bool_val(true);
        let refs = flatten_values_ref(&v);
        assert_eq!(refs, vec![&bool_val(true)]);
    }

    #[test]
    fn flatten_ref_text() {
        let v = text("hello");
        let refs = flatten_values_ref(&v);
        assert_eq!(refs.len(), 1);
        assert_eq!(*refs[0], text("hello"));
    }

    #[test]
    fn flatten_ref_error() {
        let v = err(CellError::Value);
        let refs = flatten_values_ref(&v);
        assert_eq!(refs.len(), 1);
        assert_eq!(*refs[0], err(CellError::Value));
    }

    #[test]
    fn flatten_ref_array_returns_refs_to_elements() {
        let v = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
        let refs = flatten_values_ref(&v);
        assert_eq!(refs.len(), 4);
        // Verify row-major order through references
        assert_eq!(*refs[0], num(1.0));
        assert_eq!(*refs[1], num(2.0));
        assert_eq!(*refs[2], num(3.0));
        assert_eq!(*refs[3], num(4.0));
    }

    #[test]
    fn flatten_ref_is_zero_copy() {
        // Verify the references actually point into the original array data
        let v = CellValue::from_rows(vec![vec![num(1.0), num(2.0)]]);
        let refs = flatten_values_ref(&v);
        if let CellValue::Array(arr) = &v {
            let data = arr.data();
            // The references should point to the same memory as the array data
            assert!(std::ptr::eq(refs[0], &data[0]));
            assert!(std::ptr::eq(refs[1], &data[1]));
        } else {
            panic!("expected Array variant");
        }
    }

    #[test]
    fn flatten_ref_single_element_array() {
        let v = CellValue::array(vec![num(99.0)], 1);
        let refs = flatten_values_ref(&v);
        assert_eq!(refs.len(), 1);
        assert_eq!(*refs[0], num(99.0));
    }

    // =======================================================================
    // extract_numbers — Excel arithmetic coercion semantics
    // =======================================================================

    #[test]
    fn extract_numbers_empty_input() {
        assert_eq!(extract_numbers(&[]).unwrap(), Vec::<f64>::new());
    }

    #[test]
    fn extract_numbers_single_number() {
        assert_eq!(extract_numbers(&[num(42.0)]).unwrap(), vec![42.0]);
    }

    #[test]
    fn extract_numbers_multiple_numbers() {
        let vals = vec![num(1.0), num(2.5), num(-3.0), num(0.0)];
        assert_eq!(extract_numbers(&vals).unwrap(), vec![1.0, 2.5, -3.0, 0.0]);
    }

    #[test]
    fn extract_numbers_true_is_one() {
        // Excel: TRUE = 1.0 in arithmetic context (SUM, AVERAGE, etc.)
        assert_eq!(extract_numbers(&[bool_val(true)]).unwrap(), vec![1.0]);
    }

    #[test]
    fn extract_numbers_false_is_zero() {
        // Excel: FALSE = 0.0 in arithmetic context
        assert_eq!(extract_numbers(&[bool_val(false)]).unwrap(), vec![0.0]);
    }

    #[test]
    fn extract_numbers_booleans_mixed_with_numbers() {
        let vals = vec![num(10.0), bool_val(true), num(20.0), bool_val(false)];
        assert_eq!(extract_numbers(&vals).unwrap(), vec![10.0, 1.0, 20.0, 0.0]);
    }

    #[test]
    fn extract_numbers_text_is_skipped() {
        // Excel array context: text values are SKIPPED, not coerced.
        // "5" in an array does NOT become 5.0 — it's ignored.
        let vals = vec![num(1.0), text("5"), num(2.0), text("hello")];
        assert_eq!(extract_numbers(&vals).unwrap(), vec![1.0, 2.0]);
    }

    #[test]
    fn extract_numbers_null_is_skipped() {
        // Empty cells are skipped in aggregation (SUM ignores blanks)
        let vals = vec![num(1.0), CellValue::Null, num(2.0), CellValue::Null];
        assert_eq!(extract_numbers(&vals).unwrap(), vec![1.0, 2.0]);
    }

    #[test]
    fn extract_numbers_all_text_returns_empty() {
        let vals = vec![text("a"), text("b"), text("c")];
        assert_eq!(extract_numbers(&vals).unwrap(), Vec::<f64>::new());
    }

    #[test]
    fn extract_numbers_all_null_returns_empty() {
        let vals = vec![CellValue::Null, CellValue::Null];
        assert_eq!(extract_numbers(&vals).unwrap(), Vec::<f64>::new());
    }

    #[test]
    fn extract_numbers_error_stops_extraction() {
        // Errors propagate: first error encountered is returned
        let vals = vec![num(1.0), err(CellError::Div0), num(2.0)];
        assert_eq!(extract_numbers(&vals).unwrap_err(), CellError::Div0);
    }

    #[test]
    fn extract_numbers_first_error_wins() {
        // Multiple errors: the FIRST one encountered is returned
        let vals = vec![
            err(CellError::Na),
            err(CellError::Value),
            err(CellError::Ref),
        ];
        assert_eq!(extract_numbers(&vals).unwrap_err(), CellError::Na);
    }

    #[test]
    fn extract_numbers_error_after_valid_numbers() {
        let vals = vec![num(1.0), num(2.0), err(CellError::Num)];
        assert_eq!(extract_numbers(&vals).unwrap_err(), CellError::Num);
    }

    #[test]
    fn extract_numbers_error_before_anything() {
        let vals = vec![err(CellError::Name)];
        assert_eq!(extract_numbers(&vals).unwrap_err(), CellError::Name);
    }

    #[test]
    fn extract_numbers_negative_zero() {
        let vals = vec![num(-0.0)];
        let result = extract_numbers(&vals).unwrap();
        assert_eq!(result.len(), 1);
        // -0.0 == 0.0 in f64, but it's preserved
        assert!(result[0].is_sign_negative() || result[0] == 0.0);
    }

    #[test]
    fn extract_numbers_large_values() {
        let vals = vec![num(f64::MAX), num(f64::MIN)];
        assert_eq!(extract_numbers(&vals).unwrap(), vec![f64::MAX, f64::MIN]);
    }

    #[test]
    fn extract_numbers_nan_becomes_error() {
        // CellValue::number(NaN) produces Error(Num), so this tests error propagation
        let vals = vec![CellValue::number(f64::NAN)];
        // NaN becomes CellError::Num through the constructor
        assert_eq!(extract_numbers(&vals).unwrap_err(), CellError::Num);
    }

    #[test]
    fn extract_numbers_infinity_becomes_error() {
        // CellValue::number(INFINITY) produces Error(Num)
        let vals = vec![CellValue::number(f64::INFINITY)];
        assert_eq!(extract_numbers(&vals).unwrap_err(), CellError::Num);
    }

    #[test]
    fn extract_numbers_all_error_variants() {
        // Each error variant should propagate correctly
        let errors = vec![
            CellError::Div0,
            CellError::Na,
            CellError::Name,
            CellError::Null,
            CellError::Num,
            CellError::Ref,
            CellError::Value,
            CellError::Spill,
            CellError::Calc,
            CellError::GettingData,
            CellError::Circ,
        ];
        for e in errors {
            let result = extract_numbers(&[err(e)]);
            assert_eq!(
                result.unwrap_err(),
                e,
                "Error variant {e:?} should propagate"
            );
        }
    }

    #[test]
    fn extract_numbers_mixed_everything() {
        // Number, boolean, text, null — only numbers and booleans extracted
        let vals = vec![
            num(10.0),
            bool_val(true),
            text("skip"),
            CellValue::Null,
            num(20.0),
            bool_val(false),
            text("also skip"),
        ];
        assert_eq!(extract_numbers(&vals).unwrap(), vec![10.0, 1.0, 20.0, 0.0]);
    }

    // =======================================================================
    // extract_numbers_strict — COUNT-like semantics (booleans are NOT numbers)
    // =======================================================================

    #[test]
    fn extract_strict_empty_input() {
        assert_eq!(extract_numbers_strict(&[]).unwrap(), Vec::<f64>::new());
    }

    #[test]
    fn extract_strict_single_number() {
        assert_eq!(extract_numbers_strict(&[num(42.0)]).unwrap(), vec![42.0]);
    }

    #[test]
    fn extract_strict_multiple_numbers() {
        let vals = vec![num(1.0), num(2.0), num(3.0)];
        assert_eq!(extract_numbers_strict(&vals).unwrap(), vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn extract_strict_booleans_are_skipped() {
        // KEY DIFFERENCE: In strict mode (COUNT semantics), booleans are NOT numbers
        let vals = vec![num(1.0), bool_val(true), num(2.0), bool_val(false)];
        assert_eq!(extract_numbers_strict(&vals).unwrap(), vec![1.0, 2.0]);
    }

    #[test]
    fn extract_strict_only_booleans_returns_empty() {
        let vals = vec![bool_val(true), bool_val(false)];
        assert_eq!(extract_numbers_strict(&vals).unwrap(), Vec::<f64>::new());
    }

    #[test]
    fn extract_strict_text_is_skipped() {
        let vals = vec![num(1.0), text("5"), text("hello")];
        assert_eq!(extract_numbers_strict(&vals).unwrap(), vec![1.0]);
    }

    #[test]
    fn extract_strict_null_is_skipped() {
        let vals = vec![CellValue::Null, num(1.0), CellValue::Null];
        assert_eq!(extract_numbers_strict(&vals).unwrap(), vec![1.0]);
    }

    #[test]
    fn extract_strict_error_stops_extraction() {
        let vals = vec![num(1.0), err(CellError::Value), num(2.0)];
        assert_eq!(extract_numbers_strict(&vals).unwrap_err(), CellError::Value);
    }

    #[test]
    fn extract_strict_first_error_wins() {
        let vals = vec![err(CellError::Div0), err(CellError::Na)];
        assert_eq!(extract_numbers_strict(&vals).unwrap_err(), CellError::Div0);
    }

    #[test]
    fn extract_strict_all_non_numeric_returns_empty() {
        let vals = vec![bool_val(true), text("hi"), CellValue::Null, bool_val(false)];
        assert_eq!(extract_numbers_strict(&vals).unwrap(), Vec::<f64>::new());
    }

    #[test]
    fn extract_strict_mixed_everything() {
        let vals = vec![
            num(10.0),
            bool_val(true), // skipped in strict
            text("skip"),
            CellValue::Null,
            num(20.0),
            bool_val(false), // skipped in strict
        ];
        assert_eq!(extract_numbers_strict(&vals).unwrap(), vec![10.0, 20.0]);
    }

    #[test]
    fn extract_strict_all_error_variants() {
        let errors = vec![
            CellError::Div0,
            CellError::Na,
            CellError::Name,
            CellError::Null,
            CellError::Num,
            CellError::Ref,
            CellError::Value,
            CellError::Spill,
            CellError::Calc,
            CellError::GettingData,
            CellError::Circ,
        ];
        for e in errors {
            let result = extract_numbers_strict(&[err(e)]);
            assert_eq!(result.unwrap_err(), e);
        }
    }

    // =======================================================================
    // check_error
    // =======================================================================

    #[test]
    fn check_error_number_returns_none() {
        assert!(check_error(&num(42.0)).is_none());
    }

    #[test]
    fn check_error_text_returns_none() {
        assert!(check_error(&text("hello")).is_none());
    }

    #[test]
    fn check_error_boolean_returns_none() {
        assert!(check_error(&bool_val(true)).is_none());
        assert!(check_error(&bool_val(false)).is_none());
    }

    #[test]
    fn check_error_null_returns_none() {
        assert!(check_error(&CellValue::Null).is_none());
    }

    #[test]
    fn check_error_array_returns_none() {
        assert!(check_error(&array_2x2()).is_none());
    }

    #[test]
    fn check_error_div0_returns_some() {
        let result = check_error(&err(CellError::Div0));
        assert_eq!(result, Some(err(CellError::Div0)));
    }

    #[test]
    fn check_error_all_error_variants_return_some() {
        let errors = vec![
            CellError::Div0,
            CellError::Na,
            CellError::Name,
            CellError::Null,
            CellError::Num,
            CellError::Ref,
            CellError::Value,
            CellError::Spill,
            CellError::Calc,
            CellError::GettingData,
            CellError::Circ,
        ];
        for e in errors {
            let input = err(e);
            let result = check_error(&input);
            assert!(result.is_some(), "check_error should return Some for {e:?}");
            assert_eq!(result.unwrap(), input);
        }
    }

    #[test]
    fn check_error_preserves_error_variant() {
        // Verify the returned error is the same variant, not a generic error
        let result = check_error(&err(CellError::Na)).unwrap();
        assert_eq!(result, err(CellError::Na));
        assert_ne!(result, err(CellError::Div0));
    }

    // =======================================================================
    // Cross-cutting: extract_numbers vs extract_numbers_strict comparison
    // =======================================================================

    #[test]
    fn strict_vs_normal_boolean_handling() {
        let vals = vec![bool_val(true), bool_val(false), num(5.0)];

        // Normal: booleans coerced to numbers
        let normal = extract_numbers(&vals).unwrap();
        assert_eq!(normal, vec![1.0, 0.0, 5.0]);

        // Strict: booleans skipped
        let strict = extract_numbers_strict(&vals).unwrap();
        assert_eq!(strict, vec![5.0]);
    }

    #[test]
    fn strict_vs_normal_agree_on_numbers() {
        let vals = vec![num(1.0), num(2.0), num(3.0)];
        assert_eq!(
            extract_numbers(&vals).unwrap(),
            extract_numbers_strict(&vals).unwrap()
        );
    }

    #[test]
    fn strict_vs_normal_agree_on_error_propagation() {
        let vals = vec![num(1.0), err(CellError::Ref)];
        assert_eq!(extract_numbers(&vals).unwrap_err(), CellError::Ref);
        assert_eq!(extract_numbers_strict(&vals).unwrap_err(), CellError::Ref);
    }

    #[test]
    fn strict_vs_normal_agree_on_text_skipping() {
        let vals = vec![text("hello"), num(5.0), text("world")];
        assert_eq!(extract_numbers(&vals).unwrap(), vec![5.0]);
        assert_eq!(extract_numbers_strict(&vals).unwrap(), vec![5.0]);
    }
}
