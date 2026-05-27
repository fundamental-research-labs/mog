use super::*;
use crate::classify::classify_return;
use crate::ir::{
    NapiAccess, NapiDescriptor, NapiFieldTag, NapiMethod, NapiParam, NapiParamTag, NapiServiceMeta,
    NapiTaggedEnumSpec, NapiVariantField, NapiVariantSpec, ReturnInfo,
};

fn parse_descriptor(tokens: &str) -> syn::Result<NapiDescriptor> {
    syn::parse_str::<NapiDescriptor>(tokens)
}

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
            return_type: None, // Self for lifecycle
            error_type: Some("KvError".to_string()),
            is_fallible: true,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // Should contain the registry
    assert!(
        code.contains("__REGISTRY_KVSTORE"),
        "expected registry in output: {}",
        code
    );
    // Should contain the create function
    assert!(
        code.contains("kv_store_new"),
        "expected create fn in output: {}",
        code
    );
    // Should contain destroy function
    assert!(
        code.contains("kv_store_destroy"),
        "expected destroy fn in output: {}",
        code
    );
}

#[test]
fn expand_pure_method() {
    let desc = NapiDescriptor {
        type_name: "KvUtils".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![NapiMethod {
            access: NapiAccess::Pure,
            name: "hash_key".to_string(),
            params: vec![NapiParam {
                name: "key".to_string(),
                ty: "&str".to_string(),
                tag: NapiParamTag::Str,
            }],
            return_type: Some(ReturnInfo {
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
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    assert!(
        code.contains("kv_utils_hash_key"),
        "expected fn name in output: {}",
        code
    );
    // Should wrap in napi::Result
    assert!(code.contains("napi"), "expected napi in output: {}", code);
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
    let desc: NapiDescriptor = syn::parse_str(input).unwrap();
    assert_eq!(desc.methods.len(), 3);
    assert_eq!(desc.methods[2].skip_targets, vec!["napi".to_string()]);

    let tokens = expand(&desc);
    let code = tokens.to_string();
    // set_time should be excluded from napi output
    assert!(
        !code.contains("kv_store_set_time"),
        "set_time should be skipped for napi but was found in output"
    );
    // get should still be included
    assert!(
        code.contains("kv_store_get"),
        "get should be present in napi output"
    );
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
    let desc: NapiDescriptor = syn::parse_str(input).unwrap();
    assert_eq!(desc.methods[0].skip_targets, vec!["tauri".to_string()]);
    // This method targets tauri, not napi, so it should NOT be filtered
    let tokens = expand(&desc);
    let code = tokens.to_string();
    assert!(
        code.contains("kv_store_get"),
        "method with skip tauri should still appear in napi output"
    );
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
    let desc: NapiDescriptor = syn::parse_str(input).unwrap();
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // lifecycle create is skipped, but registry/helpers/destroy are still emitted
    // because declares_lifecycle is true (the lifecycle method exists, just skipped)
    assert!(
        code.contains("__REGISTRY_KVSTORE"),
        "registry should be emitted when lifecycle is declared even if skipped"
    );
    assert!(
        !code.contains("kv_store_new"),
        "create fn should not be emitted when lifecycle create is skipped"
    );
    assert!(
        code.contains("kv_store_destroy"),
        "destroy fn should be emitted when lifecycle is declared even if skipped"
    );
}

#[test]
fn bytes_tuple_pure_method_codegen() {
    let desc = NapiDescriptor {
        type_name: "Engine".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![NapiMethod {
            access: NapiAccess::Pure,
            name: "get_data".to_string(),
            params: vec![],
            return_type: Some(ReturnInfo {
                ty: "(Vec<u8>, MutationMeta)".to_string(),
                is_string: false,
                is_prim: false,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: true,
                serde_inner_ty: Some("MutationMeta".to_string()),
                is_self_tuple: false,
                self_tuple_inner_ty: None,
            }),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    assert!(
        code.contains("engine_get_data"),
        "expected function name in output"
    );
    // Should use Buffer for bytes and serde_json for metadata
    assert!(
        code.contains("Buffer"),
        "expected Buffer conversion in output: {}",
        code
    );
    assert!(
        code.contains("serde_json"),
        "expected serde_json conversion for metadata: {}",
        code
    );
}

#[test]
fn bytes_tuple_service_method_codegen() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = Engine;
            key_type = str;
            key_param = "engine_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method write apply_mutations {
                params {}
                return_type = (Vec<u8>, MutationMeta);
                error_type = EngineError;
                fallible;
            }
        "#;
    let desc: NapiDescriptor = syn::parse_str(input).unwrap();
    let method = &desc.methods[1];
    assert!(method.return_type.is_some());
    let ret = method.return_type.as_ref().unwrap();
    assert!(
        ret.is_bytes_tuple,
        "expected bytes_tuple return for service method"
    );

    let tokens = expand(&desc);
    let code = tokens.to_string();
    assert!(
        code.contains("engine_apply_mutations"),
        "expected method in output: {}",
        code
    );
    assert!(
        code.contains("Buffer"),
        "expected Buffer in service method output: {}",
        code
    );
}

#[test]
fn registry_uses_lazy_lock_dashmap() {
    let desc = NapiDescriptor {
        type_name: "KvStore".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "store_id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::LifecycleCreate,
            name: "new".to_string(),
            params: vec![],
            return_type: None,
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // Registry should use LazyLock<DashMap>
    assert!(
        code.contains("LazyLock"),
        "expected LazyLock in registry: {}",
        code
    );
    assert!(
        code.contains("DashMap"),
        "expected DashMap in registry: {}",
        code
    );
    // Should NOT contain thread_local
    assert!(
        !code.contains("thread_local"),
        "should not contain thread_local: {}",
        code
    );
}

#[test]
fn str_tag_emits_string_param() {
    let desc = NapiDescriptor {
        type_name: "KvUtils".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![NapiMethod {
            access: NapiAccess::Pure,
            name: "echo".to_string(),
            params: vec![NapiParam {
                name: "input".to_string(),
                ty: "&str".to_string(),
                tag: NapiParamTag::Str,
            }],
            return_type: Some(ReturnInfo {
                ty: "String".to_string(),
                is_string: true,
                is_prim: false,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: false,
                serde_inner_ty: None,
                is_self_tuple: false,
                self_tuple_inner_ty: None,
            }),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // The function signature should take String, not &str
    assert!(
        code.contains("input : String"),
        "expected String param in output: {}",
        code
    );
    // The inner call should pass &input
    assert!(
        code.contains("& input"),
        "expected &input in call: {}",
        code
    );
}

#[test]
fn bytes_tag_emits_buffer_type() {
    let desc = NapiDescriptor {
        type_name: "BlobStore".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![NapiMethod {
            access: NapiAccess::Pure,
            name: "hash".to_string(),
            params: vec![NapiParam {
                name: "data".to_string(),
                ty: "&[u8]".to_string(),
                tag: NapiParamTag::Bytes,
            }],
            return_type: Some(ReturnInfo {
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
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // Should use napi::bindgen_prelude::Buffer for bytes param
    assert!(
        code.contains("Buffer"),
        "expected Buffer type for bytes param: {}",
        code
    );
    // Should convert using as_ref() for &[u8]
    assert!(
        code.contains("as_ref"),
        "expected as_ref() conversion for &[u8]: {}",
        code
    );
}

#[test]
fn serde_return_uses_serde_json() {
    let desc = NapiDescriptor {
        type_name: "MyService".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![NapiMethod {
            access: NapiAccess::Pure,
            name: "get_stats".to_string(),
            params: vec![],
            return_type: Some(ReturnInfo {
                ty: "StoreStats".to_string(),
                is_string: false,
                is_prim: false,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: false,
                serde_inner_ty: None,
                is_self_tuple: false,
                self_tuple_inner_ty: None,
            }),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // Should use serde_json::to_string, not serde_wasm_bindgen::to_value
    assert!(
        code.contains("serde_json :: to_string"),
        "expected serde_json::to_string in output: {}",
        code
    );
    assert!(
        !code.contains("serde_wasm_bindgen"),
        "should not contain serde_wasm_bindgen: {}",
        code
    );
}

#[test]
fn napi_derive_attribute_emitted() {
    let desc = NapiDescriptor {
        type_name: "Foo".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::LifecycleCreate,
            name: "new".to_string(),
            params: vec![],
            return_type: None,
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // Should contain #[napi_derive::napi] attribute
    assert!(
        code.contains("napi_derive :: napi"),
        "expected napi_derive::napi attribute in output: {}",
        code
    );
}

#[test]
fn error_type_uses_napi_error() {
    let desc = NapiDescriptor {
        type_name: "Svc".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "id".to_string(),
        }),
        methods: vec![
            NapiMethod {
                access: NapiAccess::LifecycleCreate,
                name: "new".to_string(),
                params: vec![],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            },
            NapiMethod {
                access: NapiAccess::Read,
                name: "get".to_string(),
                params: vec![NapiParam {
                    name: "key".to_string(),
                    ty: "&str".to_string(),
                    tag: NapiParamTag::Str,
                }],
                return_type: Some(ReturnInfo {
                    ty: "String".to_string(),
                    is_string: true,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: Some("SvcError".to_string()),
                is_fallible: true,
                is_async: false,
                skip_targets: Vec::new(),
            },
        ],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // Should use napi::Error::from_reason for errors
    assert!(
        code.contains("napi :: Error :: from_reason"),
        "expected napi::Error::from_reason in output: {}",
        code
    );
    // Should use napi::Result return type
    assert!(
        code.contains("napi :: Result"),
        "expected napi::Result in output: {}",
        code
    );
    // Should NOT use JsError
    assert!(
        !code.contains("JsError"),
        "should not contain JsError: {}",
        code
    );
}

#[test]
fn destroy_takes_string_param() {
    let desc = NapiDescriptor {
        type_name: "KvStore".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "store_id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::LifecycleCreate,
            name: "new".to_string(),
            params: vec![],
            return_type: None,
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // Destroy function should take String (owned), not &str
    assert!(
        code.contains("id : String"),
        "expected owned String param for destroy: {}",
        code
    );
}

#[test]
fn fn_prefix_override() {
    let desc = NapiDescriptor {
        type_name: "KvStore".to_string(),
        fn_prefix: Some("kv".to_string()),
        service: None,
        methods: vec![NapiMethod {
            access: NapiAccess::Pure,
            name: "get".to_string(),
            params: vec![],
            return_type: None,
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // Should use custom prefix "kv_get" instead of "kv_store_get"
    assert!(
        code.contains("kv_get"),
        "expected kv_get with custom prefix: {}",
        code
    );
    assert!(
        !code.contains("kv_store_get"),
        "should not contain default prefix kv_store_get: {}",
        code
    );
}

#[test]
fn fn_prefix_empty() {
    let desc = NapiDescriptor {
        type_name: "KvStore".to_string(),
        fn_prefix: Some(String::new()),
        service: None,
        methods: vec![NapiMethod {
            access: NapiAccess::Pure,
            name: "get".to_string(),
            params: vec![],
            return_type: None,
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // With empty prefix, function name should just be "get"
    assert!(
        code.contains("fn get"),
        "expected bare fn name 'get' with empty prefix: {}",
        code
    );
}

#[test]
fn bytes_return_emits_buffer() {
    let desc = NapiDescriptor {
        type_name: "Enc".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![NapiMethod {
            access: NapiAccess::Pure,
            name: "encode".to_string(),
            params: vec![],
            return_type: Some(ReturnInfo {
                ty: "Vec<u8>".to_string(),
                is_string: false,
                is_prim: false,
                is_bytes: true,
                is_unit: false,
                is_bytes_tuple: false,
                serde_inner_ty: None,
                is_self_tuple: false,
                self_tuple_inner_ty: None,
            }),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // Return type should be Buffer
    assert!(
        code.contains("Buffer"),
        "expected Buffer return type: {}",
        code
    );
    assert!(
        code.contains("Buffer :: from"),
        "expected Buffer::from conversion: {}",
        code
    );
}

#[test]
fn serde_param_uses_serde_json_from_str() {
    let desc = NapiDescriptor {
        type_name: "Svc".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![NapiMethod {
            access: NapiAccess::Pure,
            name: "process".to_string(),
            params: vec![NapiParam {
                name: "config".to_string(),
                ty: "MyConfig".to_string(),
                tag: NapiParamTag::Serde,
            }],
            return_type: None,
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // Serde params should use serde_json::from_str
    assert!(
        code.contains("serde_json :: from_str"),
        "expected serde_json::from_str in output: {}",
        code
    );
    // Param should be String (JSON), not JsValue
    assert!(
        code.contains("config : String"),
        "expected String param for serde: {}",
        code
    );
    assert!(
        !code.contains("JsValue"),
        "should not contain JsValue: {}",
        code
    );
}

#[test]
fn parse_tag_uses_string_param() {
    let desc = NapiDescriptor {
        type_name: "Svc".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![NapiMethod {
            access: NapiAccess::Pure,
            name: "lookup".to_string(),
            params: vec![NapiParam {
                name: "id".to_string(),
                ty: "&KeyId".to_string(),
                tag: NapiParamTag::Parse,
            }],
            return_type: None,
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // Parse param should take String
    assert!(
        code.contains("id : String"),
        "expected String param for parse tag: {}",
        code
    );
    // Should use BridgeParse with &id
    assert!(
        code.contains("bridge_parse"),
        "expected bridge_parse call: {}",
        code
    );
}

#[test]
fn service_key_param_is_string() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
            }
        "#;
    let desc: NapiDescriptor = syn::parse_str(input).unwrap();
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // Service key param should be String (owned), not &str
    assert!(
        code.contains("store_id : String"),
        "expected owned String for service key param: {}",
        code
    );
}

// --- Async method codegen tests ---

#[test]
fn async_pure_method_emits_async_fn_and_await() {
    let desc = NapiDescriptor {
        type_name: "DbService".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![NapiMethod {
            access: NapiAccess::Pure,
            name: "validate".to_string(),
            params: vec![NapiParam {
                name: "sql".to_string(),
                ty: "String".to_string(),
                tag: NapiParamTag::Str,
            }],
            return_type: Some(ReturnInfo {
                ty: "bool".to_string(),
                is_string: false,
                is_prim: true,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: false,
                serde_inner_ty: None,
                is_self_tuple: false,
                self_tuple_inner_ty: None,
            }),
            error_type: None,
            is_fallible: false,
            is_async: true,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // Should emit `pub async fn`
    assert!(
        code.contains("pub async fn db_service_validate"),
        "expected pub async fn: {}",
        code
    );
    // Should contain .await (token stream renders as ". await")
    assert!(
        code.contains(". await"),
        "expected .await in async method: {}",
        code
    );
}

#[test]
fn async_pure_method_fallible_emits_await_before_map_err() {
    let desc = NapiDescriptor {
        type_name: "DbService".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![NapiMethod {
            access: NapiAccess::Pure,
            name: "query".to_string(),
            params: vec![NapiParam {
                name: "sql".to_string(),
                ty: "String".to_string(),
                tag: NapiParamTag::Str,
            }],
            return_type: Some(ReturnInfo {
                ty: "String".to_string(),
                is_string: true,
                is_prim: false,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: false,
                serde_inner_ty: None,
                is_self_tuple: false,
                self_tuple_inner_ty: None,
            }),
            error_type: Some("DbError".to_string()),
            is_fallible: true,
            is_async: true,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    assert!(
        code.contains("pub async fn"),
        "expected pub async fn: {}",
        code
    );
    assert!(code.contains(". await"), "expected .await: {}", code);
    // .await should appear before .map_err (token stream renders as ". await")
    let await_pos = code.find(". await").unwrap();
    let map_err_pos = code.find("map_err").unwrap();
    assert!(await_pos < map_err_pos, "expected .await before .map_err");
}

#[test]
fn sync_pure_method_unchanged_when_is_async_false() {
    let desc = NapiDescriptor {
        type_name: "DbService".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![NapiMethod {
            access: NapiAccess::Pure,
            name: "version".to_string(),
            params: vec![],
            return_type: Some(ReturnInfo {
                ty: "String".to_string(),
                is_string: true,
                is_prim: false,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: false,
                serde_inner_ty: None,
                is_self_tuple: false,
                self_tuple_inner_ty: None,
            }),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // Should NOT emit `async`
    assert!(
        !code.contains("async"),
        "sync method should not contain async: {}",
        code
    );
    // Should NOT contain .await
    assert!(
        !code.contains(".await"),
        "sync method should not contain .await: {}",
        code
    );
}

#[test]
fn async_service_method_clones_from_registry() {
    let desc = NapiDescriptor {
        type_name: "DbDriver".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "connection_id".to_string(),
        }),
        methods: vec![
            NapiMethod {
                access: NapiAccess::LifecycleCreate,
                name: "new".to_string(),
                params: vec![],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            },
            NapiMethod {
                access: NapiAccess::Read,
                name: "query".to_string(),
                params: vec![NapiParam {
                    name: "sql".to_string(),
                    ty: "String".to_string(),
                    tag: NapiParamTag::Str,
                }],
                return_type: Some(ReturnInfo {
                    ty: "String".to_string(),
                    is_string: true,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: Some("DbError".to_string()),
                is_fallible: true,
                is_async: true,
                skip_targets: Vec::new(),
            },
        ],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // The async method should use `pub async fn`
    assert!(
        code.contains("pub async fn db_driver_query"),
        "expected pub async fn: {}",
        code
    );
    // Should clone from registry (not use closure helper)
    assert!(
        code.contains(". clone ()"),
        "expected .clone() from registry for async method: {}",
        code
    );
    // Should contain .await (token stream renders as ". await")
    assert!(
        code.contains(". await"),
        "expected .await in async service method: {}",
        code
    );
    // Lifecycle create should still be sync
    assert!(
        code.contains("pub fn db_driver_new"),
        "lifecycle create should remain sync: {}",
        code
    );
}

#[test]
fn async_service_write_method_clones_mut() {
    let desc = NapiDescriptor {
        type_name: "DbDriver".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "connection_id".to_string(),
        }),
        methods: vec![
            NapiMethod {
                access: NapiAccess::LifecycleCreate,
                name: "new".to_string(),
                params: vec![],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            },
            NapiMethod {
                access: NapiAccess::Write,
                name: "execute".to_string(),
                params: vec![NapiParam {
                    name: "sql".to_string(),
                    ty: "String".to_string(),
                    tag: NapiParamTag::Str,
                }],
                return_type: None,
                error_type: Some("DbError".to_string()),
                is_fallible: true,
                is_async: true,
                skip_targets: Vec::new(),
            },
        ],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    assert!(
        code.contains("pub async fn db_driver_execute"),
        "expected pub async fn: {}",
        code
    );
    // Should use `let mut svc` for write access
    assert!(
        code.contains("let mut svc"),
        "expected mutable clone for async write method: {}",
        code
    );
    assert!(code.contains(". await"), "expected .await: {}", code);
}

#[test]
fn async_flag_parsed_from_descriptor() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = DbDriver;
            key_type = str;
            key_param = "connection_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method read query {
                params { [str] sql: String, }
                return_type = String;
                error_type = DbError;
                fallible;
                async;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert_eq!(desc.methods.len(), 2);
    // Lifecycle create is NOT async
    assert!(
        !desc.methods[0].is_async,
        "lifecycle create should not be async"
    );
    // query IS async
    assert!(desc.methods[1].is_async, "query method should be async");
}

#[test]
fn registry_lifecycle_create_self_tuple_returns_string() {
    let desc = NapiDescriptor {
        type_name: "Engine".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "engine_id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::LifecycleCreate,
            name: "new".to_string(),
            params: vec![],
            return_type: Some(ReturnInfo {
                ty: "(Self, InitData)".to_string(),
                is_string: false,
                is_prim: false,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: false,
                serde_inner_ty: None,
                is_self_tuple: true,
                self_tuple_inner_ty: Some("InitData".to_string()),
            }),
            error_type: None,
            is_fallible: true,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // Should return String (the serialized auxiliary data)
    assert!(
        code.contains("napi :: Result < String >"),
        "expected napi::Result<String> return for (Self, T) registry create: {}",
        code
    );
    // Should destructure the tuple
    assert!(
        code.contains("__instance"),
        "expected __instance destructure: {}",
        code
    );
    assert!(
        code.contains("__data"),
        "expected __data destructure: {}",
        code
    );
    // Should serialize with serde_json
    assert!(
        code.contains("serde_json :: to_string"),
        "expected serde_json::to_string: {}",
        code
    );
    // Should insert instance (not tuple) into registry
    assert!(
        code.contains("__instance"),
        "expected __instance in registry insert: {}",
        code
    );
}

#[test]
fn tagged_enum_param_emits_kind_branch_decode() {
    let desc = NapiDescriptor {
        type_name: "Gate".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![NapiMethod {
            access: NapiAccess::Pure,
            name: "check".to_string(),
            params: vec![NapiParam {
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
            return_type: Some(classify_return("bool")),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // The FFI param should still be a String (JSON).
    assert!(
        code.contains("target : String"),
        "expected String FFI param: {}",
        code
    );
    // The decode should branch on the "kind" discriminator.
    assert!(code.contains("\"kind\""), "expected kind literal: {}", code);
    // The decode should reference both wire names.
    assert!(
        code.contains("\"workbook\""),
        "expected workbook arm: {}",
        code
    );
    assert!(code.contains("\"sheet\""), "expected sheet arm: {}", code);
    // And the rust enum path.
    assert!(
        code.contains("AccessTarget :: Workbook"),
        "expected constructed Workbook: {}",
        code
    );
    assert!(
        code.contains("AccessTarget :: Sheet"),
        "expected constructed Sheet: {}",
        code
    );
}

#[test]
fn tagged_enum_param_with_content_key_falls_back_to_serde() {
    // content = Some(_) means adjacent tagging; generated code uses
    // serde_json::from_str directly.
    let desc = NapiDescriptor {
        type_name: "X".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![NapiMethod {
            access: NapiAccess::Pure,
            name: "probe".to_string(),
            params: vec![NapiParam {
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
            return_type: Some(classify_return("bool")),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // Adjacent-tagged decode falls through to serde_json::from_str.
    assert!(
        code.contains("serde_json :: from_str"),
        "expected serde_json::from_str fallback: {}",
        code
    );
    // No explicit "kind"-style branching for adjacent form.
    assert!(
        !code.contains("\"t\" => ") && !code.contains("__tag"),
        "should not emit discriminator branch for adjacent tag: {}",
        code
    );
}
