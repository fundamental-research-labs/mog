use super::super::dispersion::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

fn err(e: CellError) -> CellValue {
    CellValue::Error(e, None)
}

fn arr(vals: Vec<f64>) -> CellValue {
    CellValue::from_rows(vec![vals.into_iter().map(num).collect()])
}

fn assert_num(result: CellValue, expected: f64, tolerance: f64, label: &str) {
    if let CellValue::Number(n) = result {
        assert!(
            (n.get() - expected).abs() < tolerance,
            "{}: expected {}, got {}",
            label,
            expected,
            n.get()
        );
    } else {
        panic!("{}: expected number {}, got {:?}", label, expected, result);
    }
}

fn assert_err(result: CellValue, expected: CellError, label: &str) {
    if let CellValue::Error(e, _) = result {
        assert_eq!(
            e, expected,
            "{}: expected {:?}, got {:?}",
            label, expected, e
        );
    } else {
        panic!("{}: expected error {:?}, got {:?}", label, expected, result);
    }
}

#[test]
fn test_stdev_s() {
    let f = FnStdevS;
    // Data: 2,4,4,4,5,5,7,9 => mean=5, sum_sq_dev=32, variance_s=32/7=4.571, stdev_s=2.138
    let result = f.call(&[
        num(2.0),
        num(4.0),
        num(4.0),
        num(4.0),
        num(5.0),
        num(5.0),
        num(7.0),
        num(9.0),
    ]);
    if let CellValue::Number(n) = result {
        assert!((n.get() - 2.138).abs() < 0.01, "stdev.s was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_stdev_p() {
    let f = FnStdevP;
    // Data: 2,4,4,4,5,5,7,9 => mean=5, sum_sq_dev=32, variance_p=32/8=4, stdev_p=2.0
    let result = f.call(&[
        num(2.0),
        num(4.0),
        num(4.0),
        num(4.0),
        num(5.0),
        num(5.0),
        num(7.0),
        num(9.0),
    ]);
    if let CellValue::Number(n) = result {
        assert!((n.get() - 2.0).abs() < 0.01, "stdev.p was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_stdev_too_few() {
    assert_eq!(FnStdevS.call(&[num(1.0)]), err(CellError::Div0));
}

#[test]
fn test_var_s() {
    let f = FnVarS;
    // Data: 2,4,4,4,5,5,7,9 => var.s = 32/7 = 4.571
    let result = f.call(&[
        num(2.0),
        num(4.0),
        num(4.0),
        num(4.0),
        num(5.0),
        num(5.0),
        num(7.0),
        num(9.0),
    ]);
    if let CellValue::Number(n) = result {
        assert!((n.get() - 4.571).abs() < 0.01, "var.s was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_var_p() {
    let f = FnVarP;
    // Data: 2,4,4,4,5,5,7,9 => var.p = 32/8 = 4.0
    let result = f.call(&[
        num(2.0),
        num(4.0),
        num(4.0),
        num(4.0),
        num(5.0),
        num(5.0),
        num(7.0),
        num(9.0),
    ]);
    assert_eq!(result, num(4.0));
}

#[test]
fn test_avedev() {
    let f = FnAveDev;
    // Data: 2,4,8,16 => mean=7.5, avedev = (5.5+3.5+0.5+8.5)/4 = 4.5
    let result = f.call(&[num(2.0), num(4.0), num(8.0), num(16.0)]);
    if let CellValue::Number(n) = result {
        assert!((n.get() - 4.5).abs() < 0.01, "avedev was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_var_s_basic_dataset() {
    // {2,4,4,4,5,5,7,9}: mean=5, sum_sq_dev=9+1+1+1+0+0+4+16=32, VAR.S = 32/7
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]);
    assert_num(reg.call("VAR.S", &[data]), 32.0 / 7.0, 1e-4, "VAR.S basic");
}

#[test]
fn test_var_s_small_dataset() {
    // {1,2,3}: mean=2, sum_sq_dev=2, VAR.S = 2/2 = 1.0
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![1.0, 2.0, 3.0]);
    assert_num(reg.call("VAR.S", &[data]), 1.0, 1e-10, "VAR.S {1,2,3}");
}

#[test]
fn test_var_s_single_element_div0() {
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![5.0]);
    assert_err(reg.call("VAR.S", &[data]), CellError::Div0, "VAR.S single");
}

#[test]
fn test_var_s_all_same_values() {
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![3.0, 3.0, 3.0, 3.0]);
    assert_num(reg.call("VAR.S", &[data]), 0.0, 1e-10, "VAR.S all same");
}

#[test]
fn test_var_alias_equals_var_s() {
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![1.0, 2.0, 3.0]);
    assert_num(reg.call("VAR", &[data]), 1.0, 1e-10, "VAR alias");
}

#[test]
fn test_var_s_two_elements() {
    // {10,20}: mean=15, devsq=50, VAR.S=50/1=50
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![10.0, 20.0]);
    assert_num(reg.call("VAR.S", &[data]), 50.0, 1e-10, "VAR.S two elem");
}

#[test]
fn test_var_p_basic_dataset() {
    // {2,4,4,4,5,5,7,9}: VAR.P = 32/8 = 4.0
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]);
    assert_num(reg.call("VAR.P", &[data]), 4.0, 1e-10, "VAR.P basic");
}

#[test]
fn test_var_p_small_dataset() {
    // {1,2,3}: VAR.P = 2/3
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![1.0, 2.0, 3.0]);
    assert_num(
        reg.call("VAR.P", &[data]),
        2.0 / 3.0,
        1e-10,
        "VAR.P {1,2,3}",
    );
}

#[test]
fn test_var_p_single_element_zero() {
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![5.0]);
    assert_num(reg.call("VAR.P", &[data]), 0.0, 1e-10, "VAR.P single");
}

#[test]
fn test_varp_alias_equals_var_p() {
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![1.0, 2.0, 3.0]);
    assert_num(reg.call("VARP", &[data]), 2.0 / 3.0, 1e-10, "VARP alias");
}

#[test]
fn test_var_p_two_elements() {
    // {10,20}: VAR.P = 50/2 = 25
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![10.0, 20.0]);
    assert_num(reg.call("VAR.P", &[data]), 25.0, 1e-10, "VAR.P two elem");
}

#[test]
fn test_var_p_empty_div0() {
    let reg = crate::FunctionRegistry::new();
    let data = CellValue::from_rows(vec![vec![text("no"), text("numbers")]]);
    assert_err(reg.call("VAR.P", &[data]), CellError::Div0, "VAR.P empty");
}

#[test]
fn test_stdev_s_basic_dataset() {
    // STDEV.S = sqrt(32/7) ≈ 2.1381
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]);
    assert_num(
        reg.call("STDEV.S", &[data]),
        (32.0_f64 / 7.0).sqrt(),
        1e-4,
        "STDEV.S basic",
    );
}

#[test]
fn test_stdev_s_small_dataset() {
    // {1,2,3}: STDEV.S = 1.0
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![1.0, 2.0, 3.0]);
    assert_num(reg.call("STDEV.S", &[data]), 1.0, 1e-10, "STDEV.S {1,2,3}");
}

#[test]
fn test_stdev_s_single_element_div0() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call("STDEV.S", &[arr(vec![5.0])]),
        CellError::Div0,
        "STDEV.S single",
    );
}

#[test]
fn test_stdev_s_all_same() {
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call("STDEV.S", &[arr(vec![7.0, 7.0, 7.0])]),
        0.0,
        1e-10,
        "STDEV.S all same",
    );
}

#[test]
fn test_stdev_alias_equals_stdev_s() {
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call("STDEV", &[arr(vec![1.0, 2.0, 3.0])]),
        1.0,
        1e-10,
        "STDEV alias",
    );
}

#[test]
fn test_stdev_p_basic_dataset() {
    // STDEV.P = sqrt(4.0) = 2.0
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]);
    assert_num(
        reg.call("STDEV.P", &[data]),
        4.0_f64.sqrt(),
        1e-4,
        "STDEV.P basic",
    );
}

#[test]
fn test_stdev_p_small_dataset() {
    // {1,2,3}: STDEV.P = sqrt(2/3) ≈ 0.8165
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call("STDEV.P", &[arr(vec![1.0, 2.0, 3.0])]),
        (2.0_f64 / 3.0).sqrt(),
        1e-4,
        "STDEV.P {1,2,3}",
    );
}

#[test]
fn test_stdev_p_single_element_zero() {
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call("STDEV.P", &[arr(vec![42.0])]),
        0.0,
        1e-10,
        "STDEV.P single",
    );
}

#[test]
fn test_stdevp_alias_equals_stdev_p() {
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call("STDEVP", &[arr(vec![1.0, 2.0, 3.0])]),
        (2.0_f64 / 3.0).sqrt(),
        1e-4,
        "STDEVP alias",
    );
}

#[test]
fn test_avedev_basic() {
    // {2,4,4,4,5,5,7,9}: mean=5, sum|dev|=3+1+1+1+0+0+2+4=12, AVEDEV=12/8=1.5
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]);
    assert_num(reg.call("AVEDEV", &[data]), 1.5, 1e-10, "AVEDEV basic");
}

#[test]
fn test_avedev_single() {
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call("AVEDEV", &[arr(vec![10.0])]),
        0.0,
        1e-10,
        "AVEDEV single",
    );
}

#[test]
fn test_avedev_symmetric() {
    // {1,3}: mean=2, |1-2|+|3-2|=2, AVEDEV=1
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call("AVEDEV", &[arr(vec![1.0, 3.0])]),
        1.0,
        1e-10,
        "AVEDEV symmetric",
    );
}

#[test]
fn test_avedev_all_same() {
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call("AVEDEV", &[arr(vec![5.0, 5.0, 5.0])]),
        0.0,
        1e-10,
        "AVEDEV all same",
    );
}

#[test]
fn test_devsq_basic() {
    // {2,4,4,4,5,5,7,9}: DEVSQ = 9+1+1+1+0+0+4+16 = 32
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]);
    assert_num(reg.call("DEVSQ", &[data]), 32.0, 1e-10, "DEVSQ basic");
}

#[test]
fn test_devsq_small() {
    // {1,2,3}: mean=2, devsq=1+0+1=2
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call("DEVSQ", &[arr(vec![1.0, 2.0, 3.0])]),
        2.0,
        1e-10,
        "DEVSQ {1,2,3}",
    );
}

#[test]
fn test_devsq_single() {
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call("DEVSQ", &[arr(vec![5.0])]),
        0.0,
        1e-10,
        "DEVSQ single",
    );
}

#[test]
fn test_vara_with_booleans_and_text() {
    // {TRUE, FALSE, 2, "hello"} -> {1, 0, 2, 0}
    // mean=0.75, devsq=0.0625+0.5625+1.5625+0.5625=2.75
    // VARA (sample) = 2.75/3
    let reg = crate::FunctionRegistry::new();
    let args = CellValue::from_rows(vec![vec![
        CellValue::Boolean(true),
        CellValue::Boolean(false),
        num(2.0),
        text("hello"),
    ]]);
    assert_num(
        reg.call("VARA", &[args]),
        2.75 / 3.0,
        1e-4,
        "VARA bool+text",
    );
}

#[test]
fn test_varpa_with_booleans_and_text() {
    // Same data, VARPA (population) = 2.75/4 = 0.6875
    let reg = crate::FunctionRegistry::new();
    let args = CellValue::from_rows(vec![vec![
        CellValue::Boolean(true),
        CellValue::Boolean(false),
        num(2.0),
        text("hello"),
    ]]);
    assert_num(
        reg.call("VARPA", &[args]),
        2.75 / 4.0,
        1e-4,
        "VARPA bool+text",
    );
}

#[test]
fn test_vara_single_element_div0() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call("VARA", &[num(5.0)]),
        CellError::Div0,
        "VARA single",
    );
}

#[test]
fn test_varpa_numbers_matches_var_p() {
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![1.0, 2.0, 3.0]);
    assert_num(
        reg.call("VARPA", &[data]),
        2.0 / 3.0,
        1e-10,
        "VARPA nums only",
    );
}

#[test]
fn test_vara_pure_numbers_matches_var_s() {
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    let vara = reg.call("VARA", std::slice::from_ref(&data));
    let vars = reg.call("VAR.S", &[data]);
    assert_eq!(vara, vars, "VARA nums should equal VAR.S");
}

#[test]
fn test_stdeva_with_booleans_and_text() {
    // STDEVA = sqrt(VARA) = sqrt(2.75/3)
    let reg = crate::FunctionRegistry::new();
    let args = CellValue::from_rows(vec![vec![
        CellValue::Boolean(true),
        CellValue::Boolean(false),
        num(2.0),
        text("hello"),
    ]]);
    assert_num(
        reg.call("STDEVA", &[args]),
        (2.75_f64 / 3.0).sqrt(),
        1e-4,
        "STDEVA bool+text",
    );
}

#[test]
fn test_stdevpa_with_booleans_and_text() {
    // STDEVPA = sqrt(VARPA) = sqrt(2.75/4)
    let reg = crate::FunctionRegistry::new();
    let args = CellValue::from_rows(vec![vec![
        CellValue::Boolean(true),
        CellValue::Boolean(false),
        num(2.0),
        text("hello"),
    ]]);
    assert_num(
        reg.call("STDEVPA", &[args]),
        (2.75_f64 / 4.0).sqrt(),
        1e-4,
        "STDEVPA bool+text",
    );
}

#[test]
fn test_stdeva_single_element_div0() {
    let reg = crate::FunctionRegistry::new();
    assert_err(
        reg.call("STDEVA", &[num(5.0)]),
        CellError::Div0,
        "STDEVA single",
    );
}

#[test]
fn test_stdevpa_single_element_zero() {
    let reg = crate::FunctionRegistry::new();
    assert_num(
        reg.call("STDEVPA", &[num(5.0)]),
        0.0,
        1e-10,
        "STDEVPA single",
    );
}

#[test]
fn test_var_s_ignores_text_and_booleans() {
    // extract_numbers_strict skips text and booleans; only {2,4} survive
    // mean=3, VAR.S = 2/1 = 2.0
    let reg = crate::FunctionRegistry::new();
    let args = CellValue::from_rows(vec![vec![
        num(2.0),
        text("ignored"),
        CellValue::Boolean(true),
        num(4.0),
    ]]);
    assert_num(
        reg.call("VAR.S", &[args]),
        2.0,
        1e-10,
        "VAR.S ignores text/bool",
    );
}

#[test]
fn test_stdev_s_is_sqrt_of_var_s() {
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]);
    let var_s = reg.call("VAR.S", std::slice::from_ref(&data));
    let stdev_s = reg.call("STDEV.S", &[data]);
    if let (CellValue::Number(v), CellValue::Number(s)) = (var_s, stdev_s) {
        assert!(
            (s.get() - v.get().sqrt()).abs() < 1e-10,
            "STDEV.S should be sqrt(VAR.S)"
        );
    } else {
        panic!("Expected numbers");
    }
}

#[test]
fn test_devsq_equals_n_times_var_p() {
    // DEVSQ = n * VAR.P
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]);
    let devsq = reg.call("DEVSQ", std::slice::from_ref(&data));
    let var_p = reg.call("VAR.P", &[data]);
    if let (CellValue::Number(d), CellValue::Number(v)) = (devsq, var_p) {
        assert!(
            (d.get() - 8.0 * v.get()).abs() < 1e-10,
            "DEVSQ should equal n * VAR.P"
        );
    } else {
        panic!("Expected numbers");
    }
}
