//! Shared arithmetic-result normalization for Excel's formula value space.
//!
//! Office uses IEC 60559 doubles but excludes denormalized (subnormal)
//! numbers.  Formula arithmetic therefore flushes a finite subnormal result
//! to positive zero.  This helper belongs at formula/function result
//! boundaries; it deliberately does not change `CellValue` constructors or
//! imported values.  Numerical kernels such as SUMPRODUCT and Kahan-based
//! aggregators may have subnormal intermediates; their internal flushing
//! semantics remain unproved and are intentionally outside this boundary
//! contract.

use value_types::CellValue;

/// Normalize one arithmetic result to Excel's supported numeric domain.
///
/// Non-finite values are intentionally preserved for `CellValue::number` to
/// classify as `#NUM!`.  Zero is returned as positive zero, matching the
/// worksheet contract and `FiniteF64`'s zero normalization.
#[inline]
pub fn normalize_formula_result(result: f64) -> f64 {
    if result == 0.0 || result.is_subnormal() {
        0.0
    } else {
        result
    }
}

/// Whether a divisor is zero in Excel's supported arithmetic domain.
///
/// A subnormal denominator cannot be represented as non-zero by Excel and is
/// therefore handled by the division operator as `#DIV/0!`.
#[inline]
pub fn is_formula_zero(value: f64) -> bool {
    value == 0.0 || value.is_subnormal()
}

/// Normalize numeric leaves in a formula result, preserving non-numeric
/// values and array shape.
///
/// This is intentionally separate from `CellValue::number`: imported and
/// stored values may still be subnormal, while values produced by formula
/// evaluation must obey Excel's arithmetic boundary.
#[inline]
pub fn normalize_formula_value(value: CellValue) -> CellValue {
    normalize_formula_value_inner(value).0
}

/// Normalize one value and report whether its representation changed.  The
/// change flag lets array normalization retain the original `Arc<CellArray>`
/// when every leaf is already in the supported domain.
fn normalize_formula_value_inner(value: CellValue) -> (CellValue, bool) {
    match value {
        CellValue::Number(number) => {
            // `lo()` is zero without dd-precision.  With dd-precision, a
            // zero high part plus a subnormal error term still represents a
            // value in the excluded range, so flush the complete result.
            if number.get().is_subnormal() || (number.get() == 0.0 && number.lo().is_subnormal()) {
                (CellValue::number(0.0), true)
            } else {
                (CellValue::Number(number), false)
            }
        }
        CellValue::Array(array) => {
            // Scan without allocating.  Once the first changed leaf appears,
            // copy the untouched prefix and continue collecting normalized
            // leaves.  Nested unchanged arrays retain their own Arc as well.
            let mut normalized: Option<Vec<CellValue>> = None;
            for (index, leaf) in array.iter().enumerate() {
                let (value, changed) = normalize_formula_value_inner(leaf.clone());
                if let Some(values) = &mut normalized {
                    values.push(value);
                } else if changed {
                    let mut values = Vec::with_capacity(array.len());
                    values.extend(array.data()[..index].iter().cloned());
                    values.push(value);
                    normalized = Some(values);
                }
            }

            match normalized {
                Some(values) => (CellValue::array(values, array.cols()), true),
                None => (CellValue::Array(array), false),
            }
        }
        other => (other, false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn result_flushes_both_subnormal_signs() {
        let subnormal = f64::MIN_POSITIVE / 2.0;
        assert_eq!(normalize_formula_result(subnormal), 0.0);
        assert_eq!(normalize_formula_result(-subnormal), 0.0);
    }

    #[test]
    fn normal_boundary_is_preserved() {
        assert_eq!(
            normalize_formula_result(f64::MIN_POSITIVE),
            f64::MIN_POSITIVE
        );
        assert_eq!(
            normalize_formula_result(-f64::MIN_POSITIVE),
            -f64::MIN_POSITIVE
        );
        assert!(normalize_formula_result(-0.0).is_sign_positive());
    }

    #[test]
    fn divisor_domain_includes_subnormals() {
        assert!(is_formula_zero(0.0));
        assert!(is_formula_zero(f64::MIN_POSITIVE / 2.0));
        assert!(!is_formula_zero(f64::MIN_POSITIVE));
    }

    #[test]
    fn arrays_are_normalized_without_changing_shape() {
        let value = CellValue::row_array(vec![
            CellValue::number(f64::MIN_POSITIVE / 2.0),
            CellValue::number(f64::MIN_POSITIVE),
            CellValue::Text("x".into()),
        ]);
        let result = normalize_formula_value(value);
        let array = result.as_array().expect("array result");
        assert_eq!(array.rows(), 1);
        assert_eq!(array.cols(), 3);
        assert_eq!(array.get(0, 0), Some(&CellValue::number(0.0)));
        assert_eq!(array.get(0, 1), Some(&CellValue::number(f64::MIN_POSITIVE)));
        assert_eq!(array.get(0, 2), Some(&CellValue::Text("x".into())));
    }

    #[test]
    fn unchanged_array_retains_its_arc() {
        let value = CellValue::row_array(vec![
            CellValue::number(f64::MIN_POSITIVE),
            CellValue::number(1.0),
        ]);
        let original = match &value {
            CellValue::Array(array) => std::sync::Arc::clone(array),
            _ => panic!("expected array"),
        };

        let result = normalize_formula_value(value);
        let normalized = match result {
            CellValue::Array(array) => array,
            _ => panic!("expected array"),
        };
        assert!(std::sync::Arc::ptr_eq(&original, &normalized));
    }

    #[test]
    fn changed_array_allocates_once_and_preserves_normal_leaves() {
        let value = CellValue::row_array(vec![
            CellValue::number(f64::MIN_POSITIVE),
            CellValue::number(f64::MIN_POSITIVE / 2.0),
        ]);
        let original = match &value {
            CellValue::Array(array) => std::sync::Arc::clone(array),
            _ => panic!("expected array"),
        };

        let result = normalize_formula_value(value);
        let normalized = match result {
            CellValue::Array(array) => array,
            _ => panic!("expected array"),
        };
        assert!(!std::sync::Arc::ptr_eq(&original, &normalized));
        assert_eq!(
            normalized.get(0, 0),
            Some(&CellValue::number(f64::MIN_POSITIVE))
        );
        assert_eq!(normalized.get(0, 1), Some(&CellValue::number(0.0)));
    }
}
