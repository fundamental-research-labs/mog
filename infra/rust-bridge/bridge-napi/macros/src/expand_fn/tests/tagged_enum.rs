use super::fixtures::*;
use crate::classify::classify_return;
use crate::ir::{
    NapiFieldTag, NapiParam, NapiParamTag, NapiTaggedEnumSpec, NapiVariantField, NapiVariantSpec,
};

#[test]
fn tagged_enum_param_emits_kind_branch_decode() {
    let desc = pure_method_desc(
        "Gate",
        "check",
        vec![NapiParam {
            name: "target".to_string(),
            ty: "AccessTarget".to_string(),
            tag: NapiParamTag::TaggedEnum(NapiTaggedEnumSpec {
                type_name: "AccessTarget".to_string(),
                tag: "kind".to_string(),
                content: None,
                variants: vec![
                    NapiVariantSpec {
                        rust_name: "Workbook".to_string(),
                        wire_name: "workbook".to_string(),
                        fields: vec![],
                    },
                    NapiVariantSpec {
                        rust_name: "Sheet".to_string(),
                        wire_name: "sheet".to_string(),
                        fields: vec![NapiVariantField {
                            rust_name: "sheet_id".to_string(),
                            wire_name: "sheet_id".to_string(),
                            field_tag: NapiFieldTag::Serde,
                        }],
                    },
                ],
            }),
        }],
        Some(classify_return("bool")),
    );
    let code = code_for(&desc);
    assert_contains(&code, "target : String");
    assert_contains(&code, "\"kind\"");
    assert_contains(&code, "\"workbook\"");
    assert_contains(&code, "\"sheet\"");
    assert_contains(&code, "AccessTarget :: Workbook");
    assert_contains(&code, "AccessTarget :: Sheet");
}

#[test]
fn tagged_enum_param_with_content_key_falls_back_to_serde() {
    let desc = pure_method_desc(
        "X",
        "probe",
        vec![NapiParam {
            name: "msg".to_string(),
            ty: "Msg".to_string(),
            tag: NapiParamTag::TaggedEnum(NapiTaggedEnumSpec {
                type_name: "Msg".to_string(),
                tag: "t".to_string(),
                content: Some("c".to_string()),
                variants: vec![NapiVariantSpec {
                    rust_name: "Hello".to_string(),
                    wire_name: "Hello".to_string(),
                    fields: vec![],
                }],
            }),
        }],
        Some(classify_return("bool")),
    );
    let code = code_for(&desc);
    assert_contains(&code, "serde_json :: from_str");
    assert!(
        !code.contains("\"t\" => ") && !code.contains("__tag"),
        "should not emit discriminator branch for adjacent tag: {code}"
    );
}

#[test]
fn tagged_enum_variant_field_tags_decode_all_supported_shapes() {
    let desc = pure_method_desc(
        "Gate",
        "check",
        vec![NapiParam {
            name: "target".to_string(),
            ty: "AccessTarget".to_string(),
            tag: NapiParamTag::TaggedEnum(NapiTaggedEnumSpec {
                type_name: "AccessTarget".to_string(),
                tag: "kind".to_string(),
                content: None,
                variants: vec![NapiVariantSpec {
                    rust_name: "Sheet".to_string(),
                    wire_name: "sheet".to_string(),
                    fields: vec![
                        NapiVariantField {
                            rust_name: "name".to_string(),
                            wire_name: "name".to_string(),
                            field_tag: NapiFieldTag::Str,
                        },
                        NapiVariantField {
                            rust_name: "index".to_string(),
                            wire_name: "index".to_string(),
                            field_tag: NapiFieldTag::Prim,
                        },
                        NapiVariantField {
                            rust_name: "payload".to_string(),
                            wire_name: "payload".to_string(),
                            field_tag: NapiFieldTag::Bytes,
                        },
                        NapiVariantField {
                            rust_name: "meta".to_string(),
                            wire_name: "meta".to_string(),
                            field_tag: NapiFieldTag::Serde,
                        },
                        NapiVariantField {
                            rust_name: "key".to_string(),
                            wire_name: "key".to_string(),
                            field_tag: NapiFieldTag::Parse,
                        },
                    ],
                }],
            }),
        }],
        Some(classify_return("bool")),
    );
    let code = code_for(&desc);
    assert_contains(&code, "let name : String");
    assert_contains(&code, "and_then (| v | v . as_str ())");
    assert_contains(&code, "let index = :: serde_json :: from_value");
    assert_contains(
        &code,
        "let payload : Vec < u8 > = :: serde_json :: from_value",
    );
    assert_contains(&code, "let meta = :: serde_json :: from_value");
    assert_contains(&code, "cloned () . ok_or_else");
    assert_contains(&code, "BridgeParse :: bridge_parse (__s)");
    assert_contains(
        &code,
        "AccessTarget :: Sheet { name , index , payload , meta , key }",
    );
}

#[test]
fn tagged_enum_borrowed_param_passes_reference() {
    let desc = pure_method_desc(
        "Gate",
        "check",
        vec![NapiParam {
            name: "target".to_string(),
            ty: "&AccessTarget".to_string(),
            tag: NapiParamTag::TaggedEnum(NapiTaggedEnumSpec {
                type_name: "AccessTarget".to_string(),
                tag: "kind".to_string(),
                content: None,
                variants: vec![NapiVariantSpec {
                    rust_name: "Workbook".to_string(),
                    wire_name: "workbook".to_string(),
                    fields: vec![],
                }],
            }),
        }],
        Some(classify_return("bool")),
    );
    let code = code_for(&desc);
    assert_contains(&code, "target : String");
    assert_contains(&code, "Gate :: check (& target_converted)");
}
