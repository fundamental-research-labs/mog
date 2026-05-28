use super::*;

#[test]
fn test_argument_count_validation() {
    let reg = FunctionRegistry::new();
    let result = reg.call("ABS", &[]);
    assert_eq!(result, CellValue::Error(CellError::Value, None));
    let result = reg.call("ABS", &[CellValue::number(1.0), CellValue::number(2.0)]);
    assert_eq!(result, CellValue::Error(CellError::Value, None));
}

#[test]
fn test_too_few_args_returns_value_error() {
    let reg = FunctionRegistry::new();
    // ABS requires 1 arg, call with 0
    assert_eq!(
        reg.call("ABS", &[]),
        CellValue::Error(CellError::Value, None)
    );
    // ROUND requires at least 1 arg
    assert_eq!(
        reg.call("ROUND", &[]),
        CellValue::Error(CellError::Value, None)
    );
    // MOD requires 2 args
    assert_eq!(
        reg.call("MOD", &[CellValue::number(10.0)]),
        CellValue::Error(CellError::Value, None)
    );
    // TEXT requires 2 args
    assert_eq!(
        reg.call("TEXT", &[CellValue::number(1.0)]),
        CellValue::Error(CellError::Value, None)
    );
}

#[test]
fn test_too_many_args_returns_value_error() {
    let reg = FunctionRegistry::new();
    // ABS takes exactly 1 arg
    assert_eq!(
        reg.call("ABS", &[CellValue::number(1.0), CellValue::number(2.0)]),
        CellValue::Error(CellError::Value, None)
    );
    // ROUND takes at most 2 args
    assert_eq!(
        reg.call(
            "ROUND",
            &[
                CellValue::number(1.5),
                CellValue::number(0.0),
                CellValue::number(99.0)
            ]
        ),
        CellValue::Error(CellError::Value, None)
    );
    // LEN takes exactly 1 arg
    assert_eq!(
        reg.call(
            "LEN",
            &[CellValue::Text("a".into()), CellValue::Text("b".into())]
        ),
        CellValue::Error(CellError::Value, None)
    );
}

#[test]
fn test_exact_min_args_works() {
    let reg = FunctionRegistry::new();
    // ABS(1) = 1 -- exactly min_args=1
    assert_eq!(
        reg.call("ABS", &[CellValue::number(-7.0)]),
        CellValue::number(7.0)
    );
    // ROUND(1.5) with only 1 arg (min_args=1, digits defaults to 0 in impl)
    assert_eq!(
        reg.call("ROUND", &[CellValue::number(1.5)]),
        CellValue::number(2.0)
    );
}

#[test]
fn test_exact_max_args_works() {
    let reg = FunctionRegistry::new();
    // ROUND(1.567, 2) -- exactly max_args=2
    assert_eq!(
        reg.call("ROUND", &[CellValue::number(1.567), CellValue::number(2.0)]),
        CellValue::number(1.57)
    );
    // MOD(10, 3) -- exactly 2 args
    assert_eq!(
        reg.call("MOD", &[CellValue::number(10.0), CellValue::number(3.0)]),
        CellValue::number(1.0)
    );
}

#[test]
fn test_variadic_functions_accept_many_args() {
    let reg = FunctionRegistry::new();
    // CONCATENATE is variadic (max_args = None), should accept many args
    let result = reg.call(
        "CONCATENATE",
        &[
            CellValue::Text("a".into()),
            CellValue::Text("b".into()),
            CellValue::Text("c".into()),
            CellValue::Text("d".into()),
            CellValue::Text("e".into()),
        ],
    );
    assert_eq!(result, CellValue::Text("abcde".into()));

    // SUMSQ is variadic, accepts many numeric args
    let result = reg.call(
        "SUMSQ",
        &[
            CellValue::number(1.0),
            CellValue::number(2.0),
            CellValue::number(3.0),
        ],
    );
    assert_eq!(result, CellValue::number(14.0)); // 1+4+9
}

#[test]
fn test_countif_too_few_args() {
    let reg = FunctionRegistry::new();
    // COUNTIF requires 2 args (min_args=2)
    let arr = CellValue::from_rows(vec![vec![CellValue::number(1.0)]]);
    assert_eq!(
        reg.call("COUNTIF", &[arr]),
        CellValue::Error(CellError::Value, None)
    );
}

#[test]
fn test_countif_too_many_args() {
    let reg = FunctionRegistry::new();
    // COUNTIF takes exactly 2 args (max_args=2)
    let arr = CellValue::from_rows(vec![vec![CellValue::number(1.0)]]);
    assert_eq!(
        reg.call(
            "COUNTIF",
            &[arr, CellValue::number(1.0), CellValue::number(99.0)]
        ),
        CellValue::Error(CellError::Value, None)
    );
}

// -----------------------------------------------------------------
// Error propagation -- PureFunction (all args propagate)
// -----------------------------------------------------------------

#[test]
fn test_min_max_args_metadata() {
    let reg = FunctionRegistry::new();

    let (_, f) = reg.get_by_name("ABS").unwrap();
    assert_eq!(f.min_args(), 1);
    assert_eq!(f.max_args(), Some(1));

    let (_, f) = reg.get_by_name("ROUND").unwrap();
    assert_eq!(f.min_args(), 1);
    assert_eq!(f.max_args(), Some(2));

    let (_, f) = reg.get_by_name("CONCATENATE").unwrap();
    assert_eq!(f.min_args(), 1);
    assert_eq!(f.max_args(), None);

    let (_, f) = reg.get_by_name("COUNTIF").unwrap();
    assert_eq!(f.min_args(), 2);
    assert_eq!(f.max_args(), Some(2));
}
