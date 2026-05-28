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
