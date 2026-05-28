use super::generate::expand;
use super::ir::{
    ReturnInfo, WasmAccess, WasmDescriptor, WasmMethod, WasmParam, WasmParamTag, WasmServiceMeta,
};
use super::names::to_snake_case;
use super::types::classify_return;

#[test]
fn snake_case_simple() {
    assert_eq!(to_snake_case("KvStore"), "kv_store");
}

#[test]
fn snake_case_single_word() {
    assert_eq!(to_snake_case("Engine"), "engine");
}

#[test]
fn snake_case_already_snake() {
    assert_eq!(to_snake_case("already_snake"), "already_snake");
}

#[test]
fn snake_case_consecutive_caps() {
    assert_eq!(to_snake_case("HTTPServer"), "h_t_t_p_server");
}

#[test]
fn snake_case_kv_utils() {
    assert_eq!(to_snake_case("KvUtils"), "kv_utils");
}

#[test]
fn classify_return_unit() {
    let r = classify_return("()");
    assert!(r.is_unit);
    assert!(!r.is_string);
}

#[test]
fn classify_return_string() {
    let r = classify_return("String");
    assert!(r.is_string);
    assert!(!r.is_prim);
}

#[test]
fn classify_return_u64() {
    let r = classify_return("u64");
    assert!(r.is_prim);
    assert!(!r.is_string);
}

#[test]
fn classify_return_vec_u8() {
    let r = classify_return("Vec<u8>");
    assert!(r.is_bytes);
}

#[test]
fn classify_return_custom_struct() {
    let r = classify_return("StoreStats");
    assert!(!r.is_string);
    assert!(!r.is_prim);
    assert!(!r.is_bytes);
    assert!(!r.is_unit);
}

#[test]
fn classify_return_bool() {
    let r = classify_return("bool");
    assert!(r.is_prim);
}

#[test]
fn classify_return_vec_string() {
    let r = classify_return("Vec<String>");
    assert!(!r.is_prim);
    assert!(!r.is_string);
    assert!(!r.is_bytes);
    assert!(!r.is_unit);
    // Vec<String> is a serde return
}

// --- Parsing tests ---

fn parse_descriptor(tokens: &str) -> syn::Result<WasmDescriptor> {
    syn::parse_str::<WasmDescriptor>(tokens)
}

#[test]
fn parse_service_descriptor() {
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
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert_eq!(desc.type_name, "KvStore");
    assert!(desc.service.is_some());
    assert_eq!(desc.service.as_ref().unwrap().key_param, "store_id");
    assert_eq!(desc.methods.len(), 2);
    assert_eq!(desc.methods[0].access, WasmAccess::LifecycleCreate);
    assert_eq!(desc.methods[0].name, "new");
    assert_eq!(desc.methods[1].access, WasmAccess::Read);
    assert_eq!(desc.methods[1].name, "get");
}

#[test]
fn parse_pure_method_params() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "id";
            method pure validate_key {
                params { [str] key: &str, [prim] max_length: usize, }
                return_type = ();
                error_type = ValidationError;
                fallible;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let m = &desc.methods[0];
    assert_eq!(m.params.len(), 2);
    assert_eq!(m.params[0].tag, WasmParamTag::Str);
    assert_eq!(m.params[0].name, "key");
    assert_eq!(m.params[1].tag, WasmParamTag::Prim);
    assert_eq!(m.params[1].name, "max_length");
    assert!(m.is_fallible);
}

#[test]
fn parse_parse_tag() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "id";
            method read get_by_id {
                params { [parse] id: &KeyId, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let m = &desc.methods[0];
    assert_eq!(m.params[0].tag, WasmParamTag::Parse);
    assert!(m.params[0].ty.contains("KeyId"));
}

// --- Code generation tests ---

#[test]
fn expand_produces_tokens() {
    let desc = WasmDescriptor {
        type_name: "KvStore".to_string(),
        fn_prefix: None,
        service: Some(WasmServiceMeta {
            key_param: "store_id".to_string(),
        }),
        methods: vec![WasmMethod {
            access: WasmAccess::LifecycleCreate,
            name: "new".to_string(),
            params: vec![WasmParam {
                name: "config".to_string(),
                ty: "KvConfig".to_string(),
                tag: WasmParamTag::Serde,
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
    assert!(code.contains("__REGISTRY_KVSTORE"));
    // Should contain the create function
    assert!(code.contains("kv_store_new"));
    // Should contain destroy function
    assert!(code.contains("kv_store_destroy"));
}

#[test]
fn expand_pure_method() {
    let desc = WasmDescriptor {
        type_name: "KvUtils".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![WasmMethod {
            access: WasmAccess::Pure,
            name: "hash_key".to_string(),
            params: vec![WasmParam {
                name: "key".to_string(),
                ty: "&str".to_string(),
                tag: WasmParamTag::Str,
            }],
            return_type: Some(ReturnInfo {
                ty: "u64".to_string(),
                is_string: false,
                is_prim: true,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: false,
                serde_inner_ty: None,
            }),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    assert!(code.contains("kv_utils_hash_key"));
    // Pure + not fallible, but we still wrap in Result
    assert!(code.contains("Result"));
}

#[test]
fn explicit_empty_fn_prefix_omits_type_prefix() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            fn_prefix = _;
            type_name = KvUtils;
            method pure hash_key {
                params { [str] key: &str, }
                return_type = u64;
            }
        "#;
    let desc: WasmDescriptor = syn::parse_str(input).unwrap();
    let code = expand(&desc).to_string();
    assert!(code.contains("hash_key"));
    assert!(!code.contains("kv_utils_hash_key"));
}

#[test]
fn custom_fn_prefix_controls_exports_but_not_helpers() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            fn_prefix = custom;
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
    let desc: WasmDescriptor = syn::parse_str(input).unwrap();
    let code = expand(&desc).to_string();
    assert!(code.contains("custom_new"));
    assert!(code.contains("custom_get"));
    assert!(code.contains("custom_destroy"));
    assert!(code.contains("__with_read_kv_store"));
    assert!(!code.contains("__with_read_custom"));
}

#[test]
fn direct_structural_method_remains_unsupported() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            method structural move_range {
                params {}
                return_type = ();
            }
        "#;
    let err = syn::parse_str::<WasmDescriptor>(input).unwrap_err();
    assert!(
        err.to_string().contains("unknown access level"),
        "unexpected error: {}",
        err
    );
}

#[test]
fn skip_wasm_method_is_excluded() {
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
                skip wasm;
            }
        "#;
    let desc: WasmDescriptor = syn::parse_str(input).unwrap();
    assert_eq!(desc.methods.len(), 3);
    assert_eq!(desc.methods[2].skip_targets, vec!["wasm".to_string()]);

    let tokens = expand(&desc);
    let code = tokens.to_string();
    // set_time should be excluded from WASM output
    assert!(
        !code.contains("kv_store_set_time"),
        "set_time should be skipped for wasm but was found in output"
    );
    // get should still be included
    assert!(
        code.contains("kv_store_get"),
        "get should be present in wasm output"
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
    let desc: WasmDescriptor = syn::parse_str(input).unwrap();
    assert_eq!(desc.methods[0].skip_targets, vec!["tauri".to_string()]);
    // This method targets tauri, not wasm, so it should NOT be filtered
    let tokens = expand(&desc);
    let code = tokens.to_string();
    assert!(
        code.contains("kv_store_get"),
        "method with skip tauri should still appear in wasm output"
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
                skip wasm;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
        "#;
    let desc: WasmDescriptor = syn::parse_str(input).unwrap();
    let tokens = expand(&desc);
    let code = tokens.to_string();
    // When lifecycle create is skipped for this target, registry/helpers/destroy
    // should NOT be emitted — prevents duplicate definitions when multiple
    // descriptor groups share the same service type.
    assert!(
        !code.contains("__REGISTRY_KVSTORE"),
        "registry should NOT be emitted when lifecycle is skipped for wasm"
    );
    assert!(
        !code.contains("kv_store_new"),
        "create fn should not be emitted when lifecycle create is skipped"
    );
    assert!(
        !code.contains("kv_store_destroy"),
        "destroy fn should NOT be emitted when lifecycle is skipped for wasm"
    );
}

#[test]
fn async_method_skipped_in_wasm() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            type_name = DbDriver;
            method pure list {
                params {}
                return_type = Vec<String>;
                error_type = DbError;
                fallible;
            }
            method pure query {
                params { [str] sql: &str, }
                return_type = Vec<String>;
                error_type = DbError;
                fallible;
                async;
            }
        "#;
    let desc: WasmDescriptor = syn::parse_str(input).unwrap();
    assert_eq!(desc.methods.len(), 2);
    assert!(!desc.methods[0].is_async, "list should be sync");
    assert!(desc.methods[1].is_async, "query should be async");

    let tokens = expand(&desc);
    let code = tokens.to_string();
    assert!(
        code.contains("db_driver_list"),
        "sync method 'list' should appear in WASM output"
    );
    assert!(
        !code.contains("db_driver_query"),
        "async method 'query' should NOT appear in WASM output"
    );
}

// --- Bytes-tuple return tests ---

#[test]
fn classify_return_bytes_tuple() {
    let r = classify_return("(Vec<u8>, MutationMeta)");
    assert!(r.is_bytes_tuple);
    assert!(!r.is_bytes);
    assert!(!r.is_prim);
    assert!(!r.is_string);
    assert!(!r.is_unit);
    assert_eq!(r.serde_inner_ty.as_deref(), Some("MutationMeta"));
}

#[test]
fn classify_return_bytes_tuple_with_spaces() {
    let r = classify_return("(Vec < u8 > , SomeStruct)");
    assert!(r.is_bytes_tuple);
    assert_eq!(r.serde_inner_ty.as_deref(), Some("SomeStruct"));
}

#[test]
fn classify_return_non_bytes_tuple() {
    // A tuple where the first element is NOT Vec<u8> should not match
    let r = classify_return("(String, u32)");
    assert!(!r.is_bytes_tuple);
    assert!(r.serde_inner_ty.is_none());
}

#[test]
fn classify_return_triple_tuple_not_bytes_tuple() {
    // More than 2 elements should not match
    let r = classify_return("(Vec<u8>, String, u32)");
    assert!(!r.is_bytes_tuple);
}

#[test]
fn classify_return_bytes_tuple_with_generic_inner() {
    let r = classify_return("(Vec<u8>, HashMap<String, Value>)");
    assert!(r.is_bytes_tuple);
    assert_eq!(r.serde_inner_ty.as_deref(), Some("HashMap<String, Value>"));
}

#[test]
fn bytes_tuple_pure_method_codegen() {
    let desc = WasmDescriptor {
        type_name: "Engine".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![WasmMethod {
            access: WasmAccess::Pure,
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
    // Should use Uint8Array for bytes and serde for metadata
    assert!(
        code.contains("Uint8Array"),
        "expected Uint8Array conversion in output: {}",
        code
    );
    assert!(
        code.contains("serde_wasm_bindgen"),
        "expected serde conversion for metadata: {}",
        code
    );
    assert!(
        code.contains("Array"),
        "expected JS Array construction: {}",
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
    let desc: WasmDescriptor = syn::parse_str(input).unwrap();
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
        code.contains("Uint8Array"),
        "expected Uint8Array in service method output: {}",
        code
    );
}

// --- Map-as-Object serializer tests ---
//
// These guard against regression of the bug where pivot placements (and
// every other internally-tagged enum or HashMap return) round-tripped to
// JS as `Map`s instead of plain objects. Fix is to serialize via a
// `Serializer` configured with `serialize_maps_as_objects(true)`. If
// anyone reverts to bare `serde_wasm_bindgen::to_value(&x)` these tests
// fail.

fn assert_uses_object_serializer(code: &str) {
    assert!(
        code.contains("serialize_maps_as_objects"),
        "generated code must serialize through a Serializer with \
             .serialize_maps_as_objects(true). Got:\n{}",
        code
    );
    // No bare `to_value(&...)` for serde-return paths. (`from_value` is
    // JS→Rust deserialization, allowed to remain.)
    assert!(
        !code.contains("to_value (&"),
        "generated code must not call serde_wasm_bindgen::to_value \
             directly — use the configured Serializer. Got:\n{}",
        code
    );
}

#[test]
fn pure_method_serde_return_uses_object_serializer() {
    let desc = WasmDescriptor {
        type_name: "PivotUtils".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![WasmMethod {
            access: WasmAccess::Pure,
            name: "describe_placement".to_string(),
            params: vec![],
            return_type: Some(ReturnInfo {
                ty: "PivotFieldPlacement".to_string(),
                is_string: false,
                is_prim: false,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: false,
                serde_inner_ty: None,
            }),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let code = expand(&desc).to_string();
    assert_uses_object_serializer(&code);
}

#[test]
fn service_method_serde_return_uses_object_serializer() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = PivotEngine;
            key_type = str;
            key_param = "engine_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method read get {
                params { [str] id: &str, }
                return_type = PivotTableConfig;
                error_type = PivotError;
                fallible;
            }
        "#;
    let desc: WasmDescriptor = syn::parse_str(input).unwrap();
    let code = expand(&desc).to_string();
    assert_uses_object_serializer(&code);
}

#[test]
fn lifecycle_create_with_data_uses_object_serializer() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = PivotEngine;
            key_type = str;
            key_param = "engine_id";
            lifecycle create new {
                params {}
                return_type = PivotTableConfig;
                error_type = PivotError;
                fallible;
            }
        "#;
    let desc: WasmDescriptor = syn::parse_str(input).unwrap();
    let code = expand(&desc).to_string();
    assert_uses_object_serializer(&code);
}

#[test]
fn bytes_tuple_pure_method_uses_object_serializer() {
    let desc = WasmDescriptor {
        type_name: "Engine".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![WasmMethod {
            access: WasmAccess::Pure,
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
            }),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let code = expand(&desc).to_string();
    assert_uses_object_serializer(&code);
}

#[test]
fn bytes_tuple_service_method_uses_object_serializer() {
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
    let desc: WasmDescriptor = syn::parse_str(input).unwrap();
    let code = expand(&desc).to_string();
    assert_uses_object_serializer(&code);
}
