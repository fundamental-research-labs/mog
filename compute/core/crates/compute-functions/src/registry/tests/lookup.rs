use super::*;

#[test]
fn test_registry_creation() {
    let reg = FunctionRegistry::new();
    assert!(!reg.is_empty());
    assert!(reg.len() > 50);
}

#[test]
fn test_lookup_by_name_case_insensitive() {
    let reg = FunctionRegistry::new();
    assert!(reg.get_by_name("ABS").is_some());
    assert!(reg.get_by_name("abs").is_some());
    assert!(reg.get_by_name("Abs").is_some());
    assert!(reg.get_by_name("aBs").is_some());
}

#[test]
fn test_lookup_by_id() {
    let reg = FunctionRegistry::new();
    let (id, _) = reg.get_by_name("ABS").unwrap();
    let func = reg.get_by_id(id).unwrap();
    assert_eq!(func.name(), "ABS");
}

#[test]
fn test_unknown_function() {
    let reg = FunctionRegistry::new();
    assert!(reg.get_by_name("DOES_NOT_EXIST").is_none());
}

#[test]
fn test_call_abs() {
    let reg = FunctionRegistry::new();
    let result = reg.call("ABS", &[CellValue::number(-5.0)]);
    assert_eq!(result, CellValue::number(5.0));
}

#[test]
fn test_call_unknown() {
    let reg = FunctionRegistry::new();
    let result = reg.call("NONEXISTENT", &[]);
    assert_eq!(result, CellValue::Error(CellError::Name, None));
}

#[test]
fn test_unknown_function_returns_name_error() {
    let reg = FunctionRegistry::new();
    assert_eq!(
        reg.call("XYZZY", &[CellValue::number(1.0)]),
        CellValue::Error(CellError::Name, None)
    );
    assert_eq!(
        reg.call("NOTAFUNCTION", &[]),
        CellValue::Error(CellError::Name, None)
    );
    assert_eq!(reg.call("", &[]), CellValue::Error(CellError::Name, None));
}

#[test]
fn test_unknown_function_lookup_returns_none() {
    let reg = FunctionRegistry::new();
    assert!(reg.get_by_name("XYZZY").is_none());
    assert!(reg.get_by_name("").is_none());
}

#[test]
fn test_unsupported_stubs_are_not_registered() {
    let reg = FunctionRegistry::new();
    for name in [
        "FORMULATEXT",
        "FORECAST.ETS",
        "FORECAST.ETS.CONFINT",
        "FORECAST.ETS.SEASONALITY",
        "FORECAST.ETS.STAT",
    ] {
        assert!(
            reg.get_by_name(name).is_none(),
            "{name} must not be advertised as implemented"
        );
        assert_eq!(reg.call(name, &[]), CellValue::Error(CellError::Name, None));
    }
}

// -----------------------------------------------------------------
// Volatile function detection
// -----------------------------------------------------------------

#[test]
fn test_case_insensitive_all_lower() {
    let reg = FunctionRegistry::new();
    assert_eq!(
        reg.call("abs", &[CellValue::number(-3.0)]),
        CellValue::number(3.0)
    );
}

#[test]
fn test_case_insensitive_mixed_case() {
    let reg = FunctionRegistry::new();
    assert_eq!(
        reg.call("AbS", &[CellValue::number(-3.0)]),
        CellValue::number(3.0)
    );
}

#[test]
fn test_case_insensitive_countif() {
    let reg = FunctionRegistry::new();
    let arr = CellValue::from_rows(vec![
        vec![CellValue::number(1.0)],
        vec![CellValue::number(2.0)],
    ]);
    assert_eq!(
        reg.call("countif", &[arr, CellValue::number(1.0)]),
        CellValue::number(1.0)
    );
}

// -----------------------------------------------------------------
// Min/max args metadata consistency
// -----------------------------------------------------------------

#[test]
fn test_get_by_id_roundtrip_multiple_functions() {
    let reg = FunctionRegistry::new();
    for name in &["ABS", "ROUND", "LEN", "COUNTIF", "CONCATENATE", "MOD"] {
        let (id, _) = reg.get_by_name(name).unwrap();
        let func = reg.get_by_id(id).unwrap();
        assert_eq!(func.name(), *name, "Round-trip failed for {}", name);
    }
}

#[test]
fn test_get_by_id_out_of_range() {
    let reg = FunctionRegistry::new();
    assert!(reg.get_by_id(u16::MAX).is_none());
}
