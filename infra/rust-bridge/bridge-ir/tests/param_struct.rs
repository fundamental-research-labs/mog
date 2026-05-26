//! Parser round-trip tests for `ParamStructDescriptor`.
//!
//! These mirror the shape `#[derive(BridgeParamStruct)]` in bridge-derive
//! emits: an `__bridge_param_descriptor_<Name>!` declarative macro whose body
//! is parseable by `bridge_ir::ParamStructDescriptor`'s `Parse` impl.
//!
//! See bridge-ir/src/param_struct.rs for the DSL grammar.

use bridge_ir::{ParamStructDescriptor, ParamTag};

fn parse(src: &str) -> syn::Result<ParamStructDescriptor> {
    syn::parse_str(src)
}

#[test]
fn parses_terminal_only_struct() {
    // Mode-B eligible: all fields [str] / [prim], one Option.
    let desc = parse(
        r#"
            param_struct_version = 1;
            struct_name = ChartSpec;
            fields {
                [str]  kind;
                [str]  range;
                [str]  title (optional);
                [prim] width;
            }
        "#,
    )
    .expect("parse");

    assert_eq!(desc.struct_name.to_string(), "ChartSpec");
    assert_eq!(desc.fields.len(), 4);

    assert_eq!(desc.fields[0].name.to_string(), "kind");
    assert!(matches!(desc.fields[0].tag, ParamTag::Str));
    assert!(!desc.fields[0].optional);

    assert_eq!(desc.fields[2].name.to_string(), "title");
    assert!(desc.fields[2].optional);

    assert!(matches!(desc.fields[3].tag, ParamTag::Prim));
    assert!(!desc.fields[3].optional);

    assert!(desc.is_mode_b_eligible());
}

#[test]
fn serde_field_forces_mode_a_only() {
    // A nested-struct field tagged [serde] makes the whole struct Mode-A only.
    let desc = parse(
        r#"
            param_struct_version = 1;
            struct_name = PivotDef;
            fields {
                [str]   name;
                [serde] layout;
            }
        "#,
    )
    .expect("parse");

    assert!(!desc.is_mode_b_eligible());
}

#[test]
fn bytes_field_forces_mode_a_only() {
    // [bytes] has no sensible scalar representation on a CLI flag.
    let desc = parse(
        r#"
            param_struct_version = 1;
            struct_name = Upload;
            fields {
                [str]   name;
                [bytes] blob;
            }
        "#,
    )
    .expect("parse");

    assert!(!desc.is_mode_b_eligible());
}

#[test]
fn parse_field_forces_mode_a_only() {
    // [parse] requires runtime `BridgeParse::bridge_parse`; Mode B would elide
    // that contract.
    let desc = parse(
        r#"
            param_struct_version = 1;
            struct_name = Op;
            fields {
                [parse] target;
            }
        "#,
    )
    .expect("parse");

    assert!(!desc.is_mode_b_eligible());
}

#[test]
fn empty_fields_is_trivially_mode_b_eligible() {
    // A zero-field struct serializes to `{}` under Mode A and emits zero Mode
    // B flags — both modes work. The eligibility check returns true because
    // `all()` on an empty iterator is true, which is the semantically right
    // answer (no non-terminal field to disqualify).
    let desc = parse(
        r#"
            param_struct_version = 1;
            struct_name = Empty;
            fields { }
        "#,
    )
    .expect("parse");

    assert_eq!(desc.fields.len(), 0);
    assert!(desc.is_mode_b_eligible());
}

#[test]
fn unknown_tag_fails_with_clear_diagnostic() {
    let err = parse(
        r#"
            param_struct_version = 1;
            struct_name = Bad;
            fields { [wobble] foo; }
        "#,
    )
    .expect_err("unknown tag must be rejected");
    assert!(
        err.to_string()
            .contains("unknown param-struct field tag 'wobble'"),
        "expected clear diagnostic, got: {}",
        err
    );
}

#[test]
fn missing_struct_name_fails() {
    let err = parse(
        r#"
            param_struct_version = 1;
            fields { [str] foo; }
        "#,
    )
    .expect_err("missing struct_name must be rejected");
    assert!(
        err.to_string().contains("struct_name"),
        "expected struct_name diagnostic, got: {}",
        err
    );
}
