use super::fixtures::*;
use crate::ir::{
    NapiAccess, NapiDescriptor, NapiMethod, NapiParam, NapiParamTag, NapiServiceMeta, ReturnInfo,
};

#[test]
fn expand_produces_tokens() {
    let desc = NapiDescriptor {
        type_name: "KvStore".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "store_id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::LifecycleCreate,
            name: "new".to_string(),
            params: vec![NapiParam {
                name: "config".to_string(),
                ty: "KvConfig".to_string(),
                tag: NapiParamTag::Serde,
            }],
            return_type: None,
            error_type: Some("KvError".to_string()),
            is_fallible: true,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let code = code_for(&desc);
    assert_contains(&code, "__REGISTRY_KVSTORE");
    assert_contains(&code, "kv_store_new");
    assert_contains(&code, "kv_store_destroy");
}

#[test]
fn expand_pure_method() {
    let desc = pure_method_desc(
        "KvUtils",
        "hash_key",
        vec![NapiParam {
            name: "key".to_string(),
            ty: "&str".to_string(),
            tag: NapiParamTag::Str,
        }],
        Some(ReturnInfo {
            ty: "u64".to_string(),
            is_string: false,
            is_prim: true,
            is_bytes: false,
            is_unit: false,
            is_bytes_tuple: false,
            serde_inner_ty: None,
            is_self_tuple: false,
            self_tuple_inner_ty: None,
        }),
    );
    let code = code_for(&desc);
    assert_contains(&code, "kv_utils_hash_key");
    assert_contains(&code, "napi");
}

#[test]
fn skip_napi_method_is_excluded() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params { [serde] config: KvConfig, }
                return_type = Self;
                error_type = KvError;
                fallible;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
            method write set_time {
                params { [prim] serial: f64, }
                return_type = ();
                skip napi;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert_eq!(desc.methods.len(), 3);
    assert_eq!(desc.methods[2].skip_targets, vec!["napi".to_string()]);

    let code = code_for(&desc);
    assert_not_contains(&code, "kv_store_set_time");
    assert_contains(&code, "kv_store_get");
}

#[test]
fn skip_targets_parsed_correctly() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
                skip tauri;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert_eq!(desc.methods[0].skip_targets, vec!["tauri".to_string()]);
    let code = code_for(&desc);
    assert_contains(&code, "kv_store_get");
}

#[test]
fn skip_lifecycle_create_still_emits_registry() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params { [serde] config: KvConfig, }
                return_type = Self;
                error_type = KvError;
                fallible;
                skip napi;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let code = code_for(&desc);
    assert_contains(&code, "__REGISTRY_KVSTORE");
    assert_not_contains(&code, "kv_store_new");
    assert_contains(&code, "kv_store_destroy");
}

#[test]
fn napi_derive_attribute_emitted() {
    let desc = service_desc("Foo", "id", vec![lifecycle_create("new", None)]);
    let code = code_for(&desc);
    assert_contains(&code, "napi_derive :: napi");
}

#[test]
fn fn_prefix_override() {
    let mut desc = pure_method_desc("KvStore", "get", vec![], None);
    desc.fn_prefix = Some("kv".to_string());
    let code = code_for(&desc);
    assert_contains(&code, "kv_get");
    assert_not_contains(&code, "kv_store_get");
}

#[test]
fn fn_prefix_empty() {
    let mut desc = pure_method_desc("KvStore", "get", vec![], None);
    desc.fn_prefix = Some(String::new());
    let code = code_for(&desc);
    assert_contains(&code, "fn get");
}
