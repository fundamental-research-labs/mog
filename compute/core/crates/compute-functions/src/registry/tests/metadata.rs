use super::*;

#[test]
fn test_volatile_functions() {
    let reg = FunctionRegistry::new();
    assert!(reg.is_volatile("RAND"));
    assert!(reg.is_volatile("RANDBETWEEN"));
    assert!(reg.is_volatile("RANDARRAY"));
    assert!(!reg.is_volatile("ABS"));
    assert!(!reg.is_volatile("IF"));
}

#[test]
fn test_array_returning_functions() {
    let reg = FunctionRegistry::new();
    assert!(reg.returns_array("FILTER"));
    assert!(reg.returns_array("SORT"));
    assert!(reg.returns_array("UNIQUE"));
    assert!(reg.returns_array("SEQUENCE"));
    assert!(reg.returns_array("REGEXEXTRACT"));
    assert!(!reg.returns_array("ABS"));
    assert!(!reg.returns_array("REGEXREPLACE"));
    assert!(!reg.returns_array("REGEXMATCH"));
    assert!(!reg.returns_array("REGEXTEST"));
}

#[test]
fn test_registry_regex_metadata() {
    let reg = FunctionRegistry::new();
    let (_, extract) = reg.get_by_name("REGEXEXTRACT").expect("REGEXEXTRACT");
    assert_eq!(extract.min_args(), 2);
    assert_eq!(extract.max_args(), Some(4));
    assert!(extract.returns_array());

    let (_, replace) = reg.get_by_name("REGEXREPLACE").expect("REGEXREPLACE");
    assert_eq!(replace.min_args(), 3);
    assert_eq!(replace.max_args(), Some(5));
    assert!(!replace.returns_array());

    let (_, regexmatch) = reg.get_by_name("REGEXMATCH").expect("REGEXMATCH");
    assert_eq!(regexmatch.min_args(), 2);
    assert_eq!(regexmatch.max_args(), Some(2));
    assert!(!regexmatch.returns_array());

    let (_, regextest) = reg.get_by_name("REGEXTEST").expect("REGEXTEST");
    assert_eq!(regextest.min_args(), 2);
    assert_eq!(regextest.max_args(), Some(3));
    assert!(!regextest.returns_array());

    assert!(reg.get_by_name("_xlfn.REGEXTEST").is_some());
    assert!(reg.get_by_name("_Xlfn._XLWS.REGEXEXTRACT").is_some());
}

#[test]
fn test_left_default_num_chars_metadata() {
    let reg = FunctionRegistry::new();
    let (_, func) = reg.get_by_name("LEFT").unwrap();
    assert_eq!(func.default_for_arg(1), Some(CellValue::number(1.0)));
    assert_eq!(func.default_for_arg(0), None);
    assert_eq!(func.default_for_arg(2), None);
}

#[test]
fn test_left_with_one_arg_uses_default() {
    let reg = FunctionRegistry::new();
    assert_eq!(
        reg.call("LEFT", &[CellValue::Text("Hello".into())]),
        CellValue::Text("H".into())
    );
}

#[test]
fn test_round_with_one_arg_defaults_digits_to_zero() {
    let reg = FunctionRegistry::new();
    assert_eq!(
        reg.call("ROUND", &[CellValue::number(2.7)]),
        CellValue::number(3.0)
    );
}

#[test]
fn test_functions_without_defaults_return_none() {
    let reg = FunctionRegistry::new();
    let (_, f) = reg.get_by_name("ABS").unwrap();
    assert_eq!(f.default_for_arg(0), None);
    let (_, f) = reg.get_by_name("MOD").unwrap();
    assert_eq!(f.default_for_arg(0), None);
    assert_eq!(f.default_for_arg(1), None);
}

// -----------------------------------------------------------------
// Unknown function -> #NAME!
// -----------------------------------------------------------------

#[test]
fn test_volatile_rand_randbetween() {
    let reg = FunctionRegistry::new();
    assert!(reg.is_volatile("RAND"));
    assert!(reg.is_volatile("RANDBETWEEN"));
    assert!(reg.is_volatile("RANDARRAY"));
    assert!(crate::helpers::VOLATILE_FUNCTIONS.contains(&"RANDARRAY"));
}

#[test]
fn test_non_volatile_standard_functions() {
    let reg = FunctionRegistry::new();
    assert!(!reg.is_volatile("ABS"));
    assert!(!reg.is_volatile("ROUND"));
    assert!(!reg.is_volatile("LEN"));
    assert!(!reg.is_volatile("CONCATENATE"));
    assert!(!reg.is_volatile("COUNTIF"));
    assert!(!reg.is_volatile("IF"));
    assert!(!reg.is_volatile("MOD"));
}

#[test]
fn test_volatile_unknown_returns_false() {
    let reg = FunctionRegistry::new();
    assert!(!reg.is_volatile("DOESNOTEXIST"));
}

// -----------------------------------------------------------------
// Array-returning function detection
// -----------------------------------------------------------------

#[test]
fn test_array_returning_sort_filter_unique_sequence() {
    let reg = FunctionRegistry::new();
    assert!(reg.returns_array("SORT"));
    assert!(reg.returns_array("FILTER"));
    assert!(reg.returns_array("UNIQUE"));
    assert!(reg.returns_array("SEQUENCE"));
}

#[test]
fn test_scalar_functions_do_not_return_array() {
    let reg = FunctionRegistry::new();
    assert!(!reg.returns_array("ABS"));
    assert!(!reg.returns_array("ROUND"));
    assert!(!reg.returns_array("TEXT"));
    assert!(!reg.returns_array("LEN"));
    assert!(!reg.returns_array("MOD"));
    assert!(!reg.returns_array("COUNTIF"));
}

#[test]
fn test_returns_array_unknown_returns_false() {
    let reg = FunctionRegistry::new();
    assert!(!reg.returns_array("DOESNOTEXIST"));
}

// -----------------------------------------------------------------
// Array-returning functions skip auto-lifting
// -----------------------------------------------------------------

#[test]
fn test_countblank_all_nulls() {
    let reg = FunctionRegistry::new();
    let arr = CellValue::from_rows(vec![
        vec![CellValue::Null],
        vec![CellValue::Null],
        vec![CellValue::Null],
    ]);
    assert_eq!(reg.call("COUNTBLANK", &[arr]), CellValue::number(3.0));
}
