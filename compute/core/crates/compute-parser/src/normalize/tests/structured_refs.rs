use super::super::structured_refs::qualify_implicit_structured_refs;

#[test]
fn test_qualifies_basic_implicit_ref() {
    assert_eq!(
        qualify_implicit_structured_refs("=[@Score]*2", Some("Table1")),
        "=Table1[@Score]*2"
    );
}

#[test]
fn test_leaves_refs_inside_double_quoted_strings() {
    assert_eq!(
        qualify_implicit_structured_refs(r#"=""[@Score]""&[@Score]"#, Some("Table1")),
        r#"=""[@Score]""&Table1[@Score]"#
    );
}

#[test]
fn test_multiple_implicit_refs_with_already_qualified_ref() {
    assert_eq!(
        qualify_implicit_structured_refs("=[@Price]*Data[@Qty]+[@Tax]", Some("Data")),
        "=Data[@Price]*Data[@Qty]+Data[@Tax]"
    );
}

#[test]
fn test_noop_without_formula_or_table_context() {
    assert_eq!(
        qualify_implicit_structured_refs("[@Score]", Some("Table1")),
        "[@Score]"
    );
    assert_eq!(
        qualify_implicit_structured_refs("=[@Score]", None),
        "=[@Score]"
    );
    assert_eq!(
        qualify_implicit_structured_refs("=[@Score]", Some("")),
        "=[@Score]"
    );
}

#[test]
fn qualify_long_this_row_without_rewriting_strings_or_qualified_tables() {
    for (input, expected) in [
        ("=[[#This Row],Sales]*2", "=Data[[#This Row],Sales]*2"),
        ("=[[#this row],[Sales]]", "=Data[[#this row],[Sales]]"),
        ("=Other[[#This Row],Sales]", "=Other[[#This Row],Sales]"),
        ("=Données[[#This Row],Sales]", "=Données[[#This Row],Sales]"),
        (
            r#"="[[#This Row],Sales]""quote"&[[#This Row],[Sales]]"#,
            r#"="[[#This Row],Sales]""quote"&Data[[#This Row],[Sales]]"#,
        ),
        ("=[[#This Row],[Sales'#]]", "=Data[[#This Row],[Sales'#]]"),
    ] {
        assert_eq!(
            qualify_implicit_structured_refs(input, Some("Data")),
            expected
        );
        assert_eq!(qualify_implicit_structured_refs(input, None), input);
    }
}

#[test]
fn qualified_long_this_row_parses() {
    let qualified = qualify_implicit_structured_refs("=[[#This Row],Sales]*2", Some("Data"));
    assert!(
        crate::parse_formula(&qualified, None).is_ok(),
        "{qualified}"
    );
}

#[test]
fn long_this_row_rejects_extra_or_malformed_unbracketed_parts() {
    for formula in [
        "=Data[[#This Row],Sales,Other]",
        "=Data[[#This Row],Sales:Other]",
        "=Data[[#This Row],#Headers]",
    ] {
        assert!(crate::parse_formula(formula, None).is_err(), "{formula}");
    }
}
