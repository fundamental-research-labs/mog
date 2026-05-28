#[test]
fn conversion_functions_are_registered_with_expected_arity() {
    let reg = crate::FunctionRegistry::new();
    let expected = [
        ("TEXT", 2, Some(2)),
        ("VALUE", 1, Some(1)),
        ("CHAR", 1, Some(1)),
        ("CODE", 1, Some(1)),
        ("DOLLAR", 1, Some(2)),
        ("FIXED", 1, Some(3)),
        ("NUMBERVALUE", 1, Some(3)),
        ("VALUETOTEXT", 1, Some(2)),
        ("ARRAYTOTEXT", 1, Some(2)),
        ("TO_DATE", 1, Some(1)),
        ("TO_DOLLARS", 1, Some(1)),
        ("TO_PERCENT", 1, Some(1)),
        ("TO_PURE_NUMBER", 1, Some(1)),
        ("TO_TEXT", 1, Some(1)),
    ];

    for (name, min_args, max_args) in expected {
        let (_, function) = reg.get_by_name(name).expect(name);
        assert_eq!(function.name(), name);
        assert_eq!(function.min_args(), min_args, "{name} min arity");
        assert_eq!(function.max_args(), max_args, "{name} max arity");
    }
}

#[test]
fn conversion_lookup_uses_registry_normalization() {
    let reg = crate::FunctionRegistry::new();
    for name in ["text", "_xlfn.TO_TEXT", "_xlfn._xlws.TO_DATE"] {
        assert!(reg.get_by_name(name).is_some(), "{name}");
    }
}
