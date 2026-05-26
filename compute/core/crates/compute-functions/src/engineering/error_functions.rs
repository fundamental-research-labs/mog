//! Error functions: ERF, ERF.PRECISE, ERFC, ERFC.PRECISE

use value_types::CellValue;

use super::helpers::coerce_num;
use crate::{FunctionRegistry, PureFunction};

// ===========================================================================
// Error Function Helpers
// ===========================================================================

/// Error function erf(x) using the statrs crate.
fn erf_approx(x: f64) -> f64 {
    statrs::function::erf::erf(x)
}

/// Complementary error function erfc(x) = 1 - erf(x).
fn erfc_approx(x: f64) -> f64 {
    statrs::function::erf::erfc(x)
}

// ===========================================================================
// Error Functions (4)
// ===========================================================================

pub(super) struct FnErf;
impl PureFunction for FnErf {
    fn name(&self) -> &'static str {
        "ERF"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let lower = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        if args.len() == 1 {
            CellValue::number(erf_approx(lower))
        } else {
            let upper = match coerce_num(args, 1) {
                Ok(v) => v,
                Err(e) => return e,
            };
            CellValue::number(erf_approx(upper) - erf_approx(lower))
        }
    }
}

pub(super) struct FnErfPrecise;
impl PureFunction for FnErfPrecise {
    fn name(&self) -> &'static str {
        "ERF.PRECISE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let x = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        CellValue::number(erf_approx(x))
    }
}

pub(super) struct FnErfc;
impl PureFunction for FnErfc {
    fn name(&self) -> &'static str {
        "ERFC"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let x = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        CellValue::number(erfc_approx(x))
    }
}

pub(super) struct FnErfcPrecise;
impl PureFunction for FnErfcPrecise {
    fn name(&self) -> &'static str {
        "ERFC.PRECISE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let x = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        CellValue::number(erfc_approx(x))
    }
}

// ===========================================================================
// Registration
// ===========================================================================

pub(crate) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnErf));
    registry.register(Box::new(FnErfPrecise));
    registry.register(Box::new(FnErfc));
    registry.register(Box::new(FnErfcPrecise));
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use value_types::{CellError, CellValue};

    const TOL: f64 = 1e-9;

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }

    fn text(s: &str) -> CellValue {
        CellValue::from(s)
    }

    fn assert_num(result: CellValue, expected: f64) {
        match result {
            CellValue::Number(n) => {
                let actual = n.get();
                assert!(
                    (actual - expected).abs() < TOL,
                    "expected {expected}, got {actual}"
                );
            }
            other => panic!("Expected Number, got {:?}", other),
        }
    }

    fn assert_error(result: CellValue, expected: CellError) {
        match result {
            CellValue::Error(e, _) => assert_eq!(e, expected, "wrong error variant"),
            other => panic!("Expected Error({:?}), got {:?}", expected, other),
        }
    }

    fn reg() -> crate::FunctionRegistry {
        crate::FunctionRegistry::new()
    }

    // -----------------------------------------------------------------------
    // ERF(x) — single argument: erf(x) = (2/√π) ∫₀ˣ e^{-t²} dt
    // -----------------------------------------------------------------------

    #[test]
    fn erf_zero() {
        let r = reg();
        assert_num(r.call("ERF", &[num(0.0)]), 0.0);
    }

    #[test]
    fn erf_half() {
        let r = reg();
        assert_num(r.call("ERF", &[num(0.5)]), 0.5204998778);
    }

    #[test]
    fn erf_one() {
        let r = reg();
        assert_num(r.call("ERF", &[num(1.0)]), 0.8427007929);
    }

    #[test]
    fn erf_one_point_five() {
        let r = reg();
        assert_num(r.call("ERF", &[num(1.5)]), 0.9661051465);
    }

    #[test]
    fn erf_two() {
        let r = reg();
        assert_num(r.call("ERF", &[num(2.0)]), 0.9953222650);
    }

    #[test]
    fn erf_three() {
        let r = reg();
        assert_num(r.call("ERF", &[num(3.0)]), 0.9999779095);
    }

    #[test]
    fn erf_large_approaches_one() {
        let r = reg();
        let result = r.call("ERF", &[num(10.0)]);
        assert_num(result, 1.0);
    }

    // erf is an odd function: erf(-x) = -erf(x)
    #[test]
    fn erf_odd_symmetry_half() {
        let r = reg();
        assert_num(r.call("ERF", &[num(-0.5)]), -0.5204998778);
    }

    #[test]
    fn erf_odd_symmetry_one() {
        let r = reg();
        assert_num(r.call("ERF", &[num(-1.0)]), -0.8427007929);
    }

    #[test]
    fn erf_odd_symmetry_two() {
        let r = reg();
        assert_num(r.call("ERF", &[num(-2.0)]), -0.9953222650);
    }

    #[test]
    fn erf_negative_large_approaches_neg_one() {
        let r = reg();
        let result = r.call("ERF", &[num(-10.0)]);
        assert_num(result, -1.0);
    }

    // -----------------------------------------------------------------------
    // ERF(lower, upper) — two arguments: erf(upper) - erf(lower)
    // -----------------------------------------------------------------------

    #[test]
    fn erf_two_args_zero_to_one() {
        let r = reg();
        // ERF(0,1) = erf(1) - erf(0) = erf(1)
        assert_num(r.call("ERF", &[num(0.0), num(1.0)]), 0.8427007929);
    }

    #[test]
    fn erf_two_args_one_to_two() {
        let r = reg();
        // ERF(1,2) = erf(2) - erf(1) ≈ 0.1526214721
        assert_num(r.call("ERF", &[num(1.0), num(2.0)]), 0.1526214721);
    }

    #[test]
    fn erf_two_args_same_value_is_zero() {
        let r = reg();
        assert_num(r.call("ERF", &[num(1.0), num(1.0)]), 0.0);
    }

    #[test]
    fn erf_two_args_reversed_is_negative() {
        let r = reg();
        // ERF(2,1) = erf(1) - erf(2) ≈ -0.1526214721
        assert_num(r.call("ERF", &[num(2.0), num(1.0)]), -0.1526214721);
    }

    #[test]
    fn erf_two_args_negative_lower() {
        let r = reg();
        // ERF(-1,1) = erf(1) - erf(-1) = 2*erf(1)
        assert_num(r.call("ERF", &[num(-1.0), num(1.0)]), 2.0 * 0.8427007929);
    }

    // -----------------------------------------------------------------------
    // ERF error cases
    // -----------------------------------------------------------------------

    #[test]
    fn erf_non_numeric_arg_returns_value_error() {
        let r = reg();
        assert_error(r.call("ERF", &[text("abc")]), CellError::Value);
    }

    #[test]
    fn erf_two_args_second_non_numeric() {
        let r = reg();
        assert_error(r.call("ERF", &[num(0.0), text("abc")]), CellError::Value);
    }

    // -----------------------------------------------------------------------
    // ERFC(x) = 1 - erf(x)
    // -----------------------------------------------------------------------

    #[test]
    fn erfc_zero() {
        let r = reg();
        assert_num(r.call("ERFC", &[num(0.0)]), 1.0);
    }

    #[test]
    fn erfc_one() {
        let r = reg();
        assert_num(r.call("ERFC", &[num(1.0)]), 0.1572992070);
    }

    #[test]
    fn erfc_two() {
        let r = reg();
        assert_num(r.call("ERFC", &[num(2.0)]), 0.0046777349);
    }

    #[test]
    fn erfc_large_approaches_zero() {
        let r = reg();
        let result = r.call("ERFC", &[num(10.0)]);
        assert_num(result, 0.0);
    }

    #[test]
    fn erfc_negative_one() {
        let r = reg();
        // erfc(-1) = 1 - erf(-1) = 1 + erf(1) ≈ 1.8427007929
        assert_num(r.call("ERFC", &[num(-1.0)]), 1.8427007929);
    }

    #[test]
    fn erfc_negative_large_approaches_two() {
        let r = reg();
        let result = r.call("ERFC", &[num(-10.0)]);
        assert_num(result, 2.0);
    }

    #[test]
    fn erfc_plus_erf_equals_one() {
        // Fundamental identity: erf(x) + erfc(x) = 1 for any x
        let r = reg();
        for &x in &[0.0, 0.5, 1.0, 1.5, 2.0, 3.0, -1.0, -2.5] {
            let erf_val = match r.call("ERF", &[num(x)]) {
                CellValue::Number(n) => n.get(),
                other => panic!("ERF({x}) returned {:?}", other),
            };
            let erfc_val = match r.call("ERFC", &[num(x)]) {
                CellValue::Number(n) => n.get(),
                other => panic!("ERFC({x}) returned {:?}", other),
            };
            assert!(
                (erf_val + erfc_val - 1.0).abs() < TOL,
                "erf({x}) + erfc({x}) = {} + {} = {}, expected 1.0",
                erf_val,
                erfc_val,
                erf_val + erfc_val
            );
        }
    }

    #[test]
    fn erfc_non_numeric_arg_returns_value_error() {
        let r = reg();
        assert_error(r.call("ERFC", &[text("abc")]), CellError::Value);
    }

    // -----------------------------------------------------------------------
    // ERF.PRECISE(x) — identical to ERF(x) single-arg
    // -----------------------------------------------------------------------

    #[test]
    fn erf_precise_zero() {
        let r = reg();
        assert_num(r.call("ERF.PRECISE", &[num(0.0)]), 0.0);
    }

    #[test]
    fn erf_precise_one() {
        let r = reg();
        assert_num(r.call("ERF.PRECISE", &[num(1.0)]), 0.8427007929);
    }

    #[test]
    fn erf_precise_negative_is_odd() {
        let r = reg();
        assert_num(r.call("ERF.PRECISE", &[num(-1.0)]), -0.8427007929);
    }

    #[test]
    fn erf_precise_half() {
        let r = reg();
        assert_num(r.call("ERF.PRECISE", &[num(0.5)]), 0.5204998778);
    }

    #[test]
    fn erf_precise_matches_erf_single_arg() {
        // ERF.PRECISE(x) should give same result as ERF(x)
        let r = reg();
        for &x in &[0.0, 0.5, 1.0, -1.0, 2.0, 3.0] {
            let erf_val = match r.call("ERF", &[num(x)]) {
                CellValue::Number(n) => n.get(),
                other => panic!("ERF({x}) returned {:?}", other),
            };
            let precise_val = match r.call("ERF.PRECISE", &[num(x)]) {
                CellValue::Number(n) => n.get(),
                other => panic!("ERF.PRECISE({x}) returned {:?}", other),
            };
            assert!(
                (erf_val - precise_val).abs() < TOL,
                "ERF({x}) = {erf_val}, ERF.PRECISE({x}) = {precise_val}"
            );
        }
    }

    #[test]
    fn erf_precise_non_numeric_returns_value_error() {
        let r = reg();
        assert_error(r.call("ERF.PRECISE", &[text("abc")]), CellError::Value);
    }

    // -----------------------------------------------------------------------
    // ERFC.PRECISE(x) — identical to ERFC(x)
    // -----------------------------------------------------------------------

    #[test]
    fn erfc_precise_zero() {
        let r = reg();
        assert_num(r.call("ERFC.PRECISE", &[num(0.0)]), 1.0);
    }

    #[test]
    fn erfc_precise_one() {
        let r = reg();
        assert_num(r.call("ERFC.PRECISE", &[num(1.0)]), 0.1572992070);
    }

    #[test]
    fn erfc_precise_two() {
        let r = reg();
        assert_num(r.call("ERFC.PRECISE", &[num(2.0)]), 0.0046777349);
    }

    #[test]
    fn erfc_precise_negative() {
        let r = reg();
        assert_num(r.call("ERFC.PRECISE", &[num(-1.0)]), 1.8427007929);
    }

    #[test]
    fn erfc_precise_matches_erfc() {
        // ERFC.PRECISE(x) should give same result as ERFC(x)
        let r = reg();
        for &x in &[0.0, 0.5, 1.0, -1.0, 2.0, 3.0] {
            let erfc_val = match r.call("ERFC", &[num(x)]) {
                CellValue::Number(n) => n.get(),
                other => panic!("ERFC({x}) returned {:?}", other),
            };
            let precise_val = match r.call("ERFC.PRECISE", &[num(x)]) {
                CellValue::Number(n) => n.get(),
                other => panic!("ERFC.PRECISE({x}) returned {:?}", other),
            };
            assert!(
                (erfc_val - precise_val).abs() < TOL,
                "ERFC({x}) = {erfc_val}, ERFC.PRECISE({x}) = {precise_val}"
            );
        }
    }

    #[test]
    fn erfc_precise_non_numeric_returns_value_error() {
        let r = reg();
        assert_error(r.call("ERFC.PRECISE", &[text("abc")]), CellError::Value);
    }

    // -----------------------------------------------------------------------
    // Boolean / string coercion edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn erf_boolean_true_coerces_to_one() {
        let r = reg();
        // TRUE coerces to 1.0
        assert_num(r.call("ERF", &[CellValue::Boolean(true)]), 0.8427007929);
    }

    #[test]
    fn erf_boolean_false_coerces_to_zero() {
        let r = reg();
        assert_num(r.call("ERF", &[CellValue::Boolean(false)]), 0.0);
    }

    #[test]
    fn erf_numeric_string_coerces() {
        let r = reg();
        // "1" should coerce to 1.0
        assert_num(r.call("ERF", &[text("1")]), 0.8427007929);
    }
}
