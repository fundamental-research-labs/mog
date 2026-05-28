use crate::FunctionRegistry;

#[test]
fn test_information_functions_registered() {
    let registry = FunctionRegistry::new();
    for name in [
        "ISERR",
        "ISEVEN",
        "ISODD",
        "ISLOGICAL",
        "ISNONTEXT",
        "ISBETWEEN",
        "ISDATE",
        "ISEMAIL",
        "ISURL",
        "ISREF",
        "N",
        "TYPE",
        "ERROR.TYPE",
        "CELL",
        "INFO",
        "SHEET",
        "SHEETS",
    ] {
        assert!(registry.get_by_name(name).is_some(), "{name}");
    }
}

#[test]
fn test_information_registry_metadata() {
    let registry = FunctionRegistry::new();
    for (name, min, max) in [
        ("ISERR", 1, Some(1)),
        ("ISEVEN", 1, Some(1)),
        ("ISODD", 1, Some(1)),
        ("ISLOGICAL", 1, Some(1)),
        ("ISNONTEXT", 1, Some(1)),
        ("ISBETWEEN", 3, Some(5)),
        ("ISDATE", 1, Some(1)),
        ("ISEMAIL", 1, Some(1)),
        ("ISURL", 1, Some(1)),
        ("ISREF", 1, Some(1)),
        ("N", 1, Some(1)),
        ("TYPE", 1, Some(1)),
        ("ERROR.TYPE", 1, Some(1)),
        ("CELL", 1, Some(2)),
        ("INFO", 1, Some(1)),
        ("SHEET", 0, Some(1)),
        ("SHEETS", 0, Some(1)),
    ] {
        let (_, function) = registry.get_by_name(name).expect(name);
        assert_eq!(function.min_args(), min, "{name} min arity");
        assert_eq!(function.max_args(), max, "{name} max arity");
    }
}
