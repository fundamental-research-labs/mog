use super::fixtures::*;
use crate::ir::{NapiParam, NapiParamTag};

#[test]
fn str_tag_emits_string_param() {
    let desc = pure_method_desc(
        "KvUtils",
        "echo",
        vec![NapiParam {
            name: "input".to_string(),
            ty: "&str".to_string(),
            tag: NapiParamTag::Str,
        }],
        Some(return_string()),
    );
    let code = code_for(&desc);
    assert_contains(&code, "input : String");
    assert_contains(&code, "& input");
}

#[test]
fn bytes_tag_emits_buffer_type() {
    let desc = pure_method_desc(
        "BlobStore",
        "hash",
        vec![NapiParam {
            name: "data".to_string(),
            ty: "&[u8]".to_string(),
            tag: NapiParamTag::Bytes,
        }],
        Some(return_prim("u64")),
    );
    let code = code_for(&desc);
    assert_contains(&code, "Buffer");
    assert_contains(&code, "as_ref");
}

#[test]
fn serde_param_uses_serde_json_from_str() {
    let desc = pure_method_desc(
        "Svc",
        "process",
        vec![NapiParam {
            name: "config".to_string(),
            ty: "MyConfig".to_string(),
            tag: NapiParamTag::Serde,
        }],
        None,
    );
    let code = code_for(&desc);
    assert_contains(&code, "serde_json :: from_str");
    assert_contains(&code, "config : String");
    assert_not_contains(&code, "JsValue");
}

#[test]
fn parse_tag_uses_string_param() {
    let desc = pure_method_desc(
        "Svc",
        "lookup",
        vec![NapiParam {
            name: "id".to_string(),
            ty: "&KeyId".to_string(),
            tag: NapiParamTag::Parse,
        }],
        None,
    );
    let code = code_for(&desc);
    assert_contains(&code, "id : String");
    assert_contains(&code, "bridge_parse");
}

#[test]
fn str_tag_owned_string_passes_owned_value() {
    let desc = pure_method_desc(
        "KvUtils",
        "echo",
        vec![NapiParam {
            name: "input".to_string(),
            ty: "String".to_string(),
            tag: NapiParamTag::Str,
        }],
        Some(return_string()),
    );
    let code = code_for(&desc);
    assert_contains(&code, "input : String");
    assert_contains(&code, "KvUtils :: echo (input)");
    assert_not_contains(&code, "KvUtils :: echo (& input)");
}

#[test]
fn bytes_tag_owned_vec_uses_to_vec() {
    let desc = pure_method_desc(
        "BlobStore",
        "put",
        vec![NapiParam {
            name: "data".to_string(),
            ty: "Vec<u8>".to_string(),
            tag: NapiParamTag::Bytes,
        }],
        None,
    );
    let code = code_for(&desc);
    assert_contains(&code, "data : napi :: bindgen_prelude :: Buffer");
    assert_contains(&code, "data . to_vec ()");
}

#[test]
fn serde_option_str_param_deserializes_owned_and_as_deref() {
    let desc = pure_method_desc(
        "Svc",
        "filter",
        vec![NapiParam {
            name: "label".to_string(),
            ty: "Option<&str>".to_string(),
            tag: NapiParamTag::Serde,
        }],
        None,
    );
    let code = code_for(&desc);
    assert_contains(&code, "let label_owned : Option < String >");
    assert_contains(&code, "let label_converted = label_owned . as_deref ()");
    assert_contains(&code, "Svc :: filter (label_converted)");
}

#[test]
fn serde_slice_reference_param_deserializes_vec() {
    let desc = pure_method_desc(
        "Svc",
        "process_many",
        vec![NapiParam {
            name: "items".to_string(),
            ty: "&[Item]".to_string(),
            tag: NapiParamTag::Serde,
        }],
        None,
    );
    let code = code_for(&desc);
    assert_contains(&code, "let items_converted : Vec < Item >");
    assert_contains(&code, "Svc :: process_many (& items_converted)");
}

#[test]
fn serde_reference_param_passes_borrowed_converted_value() {
    let desc = pure_method_desc(
        "Svc",
        "process",
        vec![NapiParam {
            name: "config".to_string(),
            ty: "&MyConfig".to_string(),
            tag: NapiParamTag::Serde,
        }],
        None,
    );
    let code = code_for(&desc);
    assert_contains(&code, "let config_converted = match serde_json :: from_str");
    assert_contains(&code, "Svc :: process (& config_converted)");
}

#[test]
fn serde_owned_param_passes_converted_value() {
    let desc = pure_method_desc(
        "Svc",
        "process",
        vec![NapiParam {
            name: "config".to_string(),
            ty: "MyConfig".to_string(),
            tag: NapiParamTag::Serde,
        }],
        None,
    );
    let code = code_for(&desc);
    assert_contains(&code, "let config_converted = match serde_json :: from_str");
    assert_contains(&code, "Svc :: process (config_converted)");
    assert_not_contains(&code, "Svc :: process (& config_converted)");
}

#[test]
fn serde_missing_field_error_uses_enhancement() {
    let desc = pure_method_desc(
        "Svc",
        "process",
        vec![NapiParam {
            name: "config".to_string(),
            ty: "MyConfig".to_string(),
            tag: NapiParamTag::Serde,
        }],
        None,
    );
    let code = code_for(&desc);
    assert_contains(&code, "contains (\"missing field\")");
    assert_contains(&code, "serde_json :: from_str :: < serde_json :: Value >");
    assert_contains(&code, "bridge_types :: enhance_missing_field_error");
    assert_contains(&code, "bridge_types :: bridge_format_err ! (e)");
}

#[test]
fn parse_owned_param_passes_converted_value() {
    let desc = pure_method_desc(
        "Svc",
        "lookup",
        vec![NapiParam {
            name: "id".to_string(),
            ty: "KeyId".to_string(),
            tag: NapiParamTag::Parse,
        }],
        None,
    );
    let code = code_for(&desc);
    assert_contains(&code, "BridgeParse :: bridge_parse (& id)");
    assert_contains(&code, "map_err (| e | napi :: Error :: from_reason (e))");
    assert_contains(&code, "Svc :: lookup (id_converted)");
    assert_not_contains(&code, "Svc :: lookup (& id_converted)");
}
