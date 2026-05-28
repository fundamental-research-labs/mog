use super::*;

#[test]
fn test_pure_abs_propagates_div0() {
    let reg = FunctionRegistry::new();
    assert_eq!(
        reg.call("ABS", &[CellValue::Error(CellError::Div0, None)]),
        CellValue::Error(CellError::Div0, None)
    );
}

#[test]
fn test_pure_abs_propagates_na() {
    let reg = FunctionRegistry::new();
    assert_eq!(
        reg.call("ABS", &[CellValue::Error(CellError::Na, None)]),
        CellValue::Error(CellError::Na, None)
    );
}

#[test]
fn test_pure_abs_propagates_ref() {
    let reg = FunctionRegistry::new();
    assert_eq!(
        reg.call("ABS", &[CellValue::Error(CellError::Ref, None)]),
        CellValue::Error(CellError::Ref, None)
    );
}

#[test]
fn test_pure_round_propagates_first_arg_error() {
    let reg = FunctionRegistry::new();
    assert_eq!(
        reg.call(
            "ROUND",
            &[
                CellValue::Error(CellError::Value, None),
                CellValue::number(2.0)
            ]
        ),
        CellValue::Error(CellError::Value, None)
    );
}

#[test]
fn test_pure_round_propagates_second_arg_error() {
    let reg = FunctionRegistry::new();
    assert_eq!(
        reg.call(
            "ROUND",
            &[
                CellValue::number(1.5),
                CellValue::Error(CellError::Num, None)
            ]
        ),
        CellValue::Error(CellError::Num, None)
    );
}

#[test]
fn test_pure_concatenate_propagates_first_error() {
    let reg = FunctionRegistry::new();
    assert_eq!(
        reg.call(
            "CONCATENATE",
            &[
                CellValue::Text("a".into()),
                CellValue::Error(CellError::Na, None),
                CellValue::Text("c".into()),
            ]
        ),
        CellValue::Error(CellError::Na, None)
    );
}

#[test]
fn test_pure_mod_propagates_error() {
    let reg = FunctionRegistry::new();
    assert_eq!(
        reg.call(
            "MOD",
            &[
                CellValue::Error(CellError::Ref, None),
                CellValue::number(3.0)
            ]
        ),
        CellValue::Error(CellError::Ref, None)
    );
}

#[test]
fn test_all_error_variants_propagate_through_pure_function() {
    let reg = FunctionRegistry::new();
    let errors = [
        CellError::Div0,
        CellError::Na,
        CellError::Name,
        CellError::Null,
        CellError::Num,
        CellError::Ref,
        CellError::Value,
    ];
    for err in &errors {
        let result = reg.call("ABS", &[CellValue::Error(*err, None)]);
        assert_eq!(
            result,
            CellValue::Error(*err, None),
            "ABS should propagate {:?} unchanged",
            err
        );
    }
}

// -----------------------------------------------------------------
// Error propagation -- ExcelFunction (role-based)
// -----------------------------------------------------------------

#[test]
fn test_excel_countif_range_error_propagates() {
    let reg = FunctionRegistry::new();
    // COUNTIF(#REF!, ">5") -- Range arg has error, should propagate
    assert_eq!(
        reg.call(
            "COUNTIF",
            &[
                CellValue::Error(CellError::Ref, None),
                CellValue::Text(">5".into())
            ]
        ),
        CellValue::Error(CellError::Ref, None)
    );
}

#[test]
fn test_excel_countif_criteria_error_does_not_propagate() {
    let reg = FunctionRegistry::new();
    // COUNTIF({1,2,#N/A,2}, #N/A) -- Criteria role does NOT propagate.
    // Should count cells matching #N/A.
    let arr = CellValue::from_rows(vec![
        vec![CellValue::number(1.0)],
        vec![CellValue::number(2.0)],
        vec![CellValue::Error(CellError::Na, None)],
        vec![CellValue::number(2.0)],
    ]);
    let result = reg.call("COUNTIF", &[arr, CellValue::Error(CellError::Na, None)]);
    assert_eq!(result, CellValue::number(1.0));
}

#[test]
fn test_excel_countif_range_div0_propagates() {
    let reg = FunctionRegistry::new();
    assert_eq!(
        reg.call(
            "COUNTIF",
            &[
                CellValue::Error(CellError::Div0, None),
                CellValue::number(1.0)
            ]
        ),
        CellValue::Error(CellError::Div0, None)
    );
}

#[test]
fn test_all_error_variants_propagate_through_range_role() {
    let reg = FunctionRegistry::new();
    let errors = [
        CellError::Div0,
        CellError::Na,
        CellError::Name,
        CellError::Null,
        CellError::Num,
        CellError::Ref,
        CellError::Value,
    ];
    for err in &errors {
        let result = reg.call(
            "COUNTIF",
            &[CellValue::Error(*err, None), CellValue::number(1.0)],
        );
        assert_eq!(
            result,
            CellValue::Error(*err, None),
            "COUNTIF Range arg should propagate {:?}",
            err
        );
    }
}

#[test]
fn test_excel_sumifs_sum_range_error_propagates() {
    let reg = FunctionRegistry::new();
    let criteria_range = CellValue::from_rows(vec![
        vec![CellValue::number(1.0)],
        vec![CellValue::number(2.0)],
        vec![CellValue::number(3.0)],
    ]);
    assert_eq!(
        reg.call(
            "SUMIFS",
            &[
                CellValue::Error(CellError::Ref, None),
                criteria_range,
                CellValue::Text(">0".into())
            ]
        ),
        CellValue::Error(CellError::Ref, None)
    );
}

#[test]
fn test_excel_sumifs_criteria_range_error_propagates() {
    let reg = FunctionRegistry::new();
    let sum_range = CellValue::from_rows(vec![
        vec![CellValue::number(1.0)],
        vec![CellValue::number(2.0)],
        vec![CellValue::number(3.0)],
    ]);
    assert_eq!(
        reg.call(
            "SUMIFS",
            &[
                sum_range,
                CellValue::Error(CellError::Ref, None),
                CellValue::Text(">0".into())
            ]
        ),
        CellValue::Error(CellError::Ref, None)
    );
}

#[test]
fn test_excel_sumifs_criteria_error_does_not_propagate() {
    let reg = FunctionRegistry::new();
    let sum_range = CellValue::from_rows(vec![
        vec![CellValue::number(10.0)],
        vec![CellValue::number(20.0)],
        vec![CellValue::number(30.0)],
    ]);
    let criteria_range = CellValue::from_rows(vec![
        vec![CellValue::number(1.0)],
        vec![CellValue::number(2.0)],
        vec![CellValue::number(3.0)],
    ]);
    let result = reg.call(
        "SUMIFS",
        &[
            sum_range,
            criteria_range,
            CellValue::Error(CellError::Na, None),
        ],
    );
    // Key: criteria error does NOT propagate -- result is NOT #N/A
    assert!(
        !matches!(result, CellValue::Error(CellError::Na, _)),
        "SUMIFS criteria error should not propagate, got {:?}",
        result
    );
}
